import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Query, Sleeping } = Matter;
export const SIZE = 500;
export const STEP = 46;
// Touch devices (phones/tablets) get lighter effects: they have 120Hz screens and much weaker browsers.
const IS_MOBILE = typeof matchMedia !== 'undefined' && matchMedia('(pointer:coarse)').matches;
const PARTICLE_CAP = IS_MOBILE ? 220 : 650;
export const COLORS = ['#67cbb5', '#d1dc8a', '#ab96d4', '#e5a373', '#7ebbd2'];
export type Special = 'bomb' | 'oil' | 'magnet' | 'loot' | 'fire' | 'shock' | 'surprise' | 'chain' | 'icebomb' | 'stonebomb' | 'stone' | null;
export type Shape = { cells: number[][]; color: string; special: Special; id: number };
export type EventKind = 'rotate' | 'ice' | 'oil' | 'shake' | 'zone' | 'vortex' | 'pulse' | 'stone' | 'infest' | 'gravity' | 'growth' | 'fire' | 'bombard' | 'bloom' | 'barrier' | 'decay';
export type ActiveEvent = { kind: EventKind; progress: number };
export type Snapshot = { score: number; best: number; cells: number; slots: (Shape | null)[]; ammo: number[]; weapon: number; events: ActiveEvent[]; nextEvent: EventKind | null; nextIn: number; paused: boolean; over: boolean; round: number; dying: boolean; dieProgress: number };
type Cell = { x: number; y: number; gx: number; gy: number; special: Special; color: string; stone?: boolean; burn?: number; infected?: boolean; frozen?: boolean };
type Piece = { body: Matter.Body; cells: Cell[]; born: number; special: Special; activated: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Ring = { x: number; y: number; life: number; radius: number; color: string };
type Oil = { x: number; y: number; life: number; r: number; burning?: boolean };
// Frozen slick left by an ice bomb: slippery, and it shields oil from fire.
type Ice = { x: number; y: number; life: number; r: number };
type Fire = { x: number; y: number; r: number; life: number };
type Projectile = { x: number; y: number; tx: number; ty: number; life: number };
let nextId = 0;
const bases = [ [[0,0]], [[0,0],[1,0],[0,1],[1,1]], Array.from({length:9},(_,i)=>[i%3,Math.floor(i/3)]), [[0,0],[1,0],[2,0]], [[0,0],[1,0],[2,0],[3,0]], [[0,0],[0,1],[1,1]], [[0,0],[0,1],[0,2],[1,2],[2,2]] ];
// Petrified cells: immovable, but still destructible by lines and weapons.
const STONE_COLOR = '#8a958f';
// Random side pulls for the gravity event: down, right, up, left.
const GRAV_DIRS = [[0,1],[1,0],[0,-1],[-1,0]];
// All events, fired one at a time: the next one is picked in advance every 20s.
const EVENTS:EventKind[]=['rotate','ice','oil','shake','zone','vortex','pulse','stone','infest','gravity','growth','fire','bombard','bloom','barrier','decay'];
const EVENT_SPACING=20;
// Hidden special-cell clock: roughly one special per 12–15 spawned pieces.
let specialClock=12+Math.floor(Math.random()*4);
// Weighted pool: fire is deliberately the rarest special.
const SPECIAL_WEIGHTS:{k:Exclude<Special,null>;w:number}[]=[{k:'bomb',w:5},{k:'oil',w:4},{k:'magnet',w:4},{k:'loot',w:4},{k:'shock',w:4},{k:'surprise',w:4},{k:'chain',w:4},{k:'icebomb',w:4},{k:'stonebomb',w:4},{k:'fire',w:1}];
function pickSpecial(excludeSurprise=false):Special{
  const pool=excludeSurprise?SPECIAL_WEIGHTS.filter(e=>e.k!=='surprise'):SPECIAL_WEIGHTS;
  const total=pool.reduce((s,e)=>s+e.w,0);
  let r=Math.random()*total;
  for(const e of pool){r-=e.w;if(r<=0)return e.k;}
  return 'bomb';
}
function takeSpecial():Special{
  if(--specialClock>0)return null;
  specialClock=12+Math.floor(Math.random()*4);
  return pickSpecial();
}
// Per-theme board look: canvas background, grid tints and the piece palette.
// UI-side chrome (panels, buttons) is themed in CSS; this covers the canvas.
export const THEME_LOOK:Record<string,{board:string;gridA:string;gridB:string;dot:string;palette:string[]}>={
  standard:{board:'#182321',gridA:'#1d2926',gridB:'#1b2724',dot:'#8ca59b15',palette:['#67cbb5','#d1dc8a','#ab96d4','#e5a373','#7ebbd2']},
  day:{board:'#dde6d3',gridA:'#d5e0c9',gridB:'#cfdac4',dot:'#5a6a5522',palette:['#2f9e8c','#a3b32e','#8a5fc0','#e07b3a','#3b8bb5']},
  night:{board:'#0a1220',gridA:'#101a30',gridB:'#0d1626',dot:'#8fa4e018',palette:['#4f7fd9','#7fd4e8','#b39ce8','#e8a0c8','#6fc79a']},
  mono:{board:'#161616',gridA:'#1f1f1f',gridB:'#1a1a1a',dot:'#ffffff10',palette:['#9e9e9e','#c9c9c9','#787878','#e0e0e0','#5c5c5c']},
  neon:{board:'#150829',gridA:'#1e0d3a',gridB:'#190b31',dot:'#ff2ea61e',palette:['#ff2ea6','#b366ff','#00e5ff','#ff6ec7','#7c4dff']},
  green:{board:'#0a1f10',gridA:'#123018',gridB:'#0e2914',dot:'#52d97718',palette:['#52d977','#a8e05f','#38b2c8','#e0c95f','#6fe0a8']},
  red:{board:'#22090a',gridA:'#301113',gridB:'#2a0e0f',dot:'#ff615218',palette:['#ff6152','#ff9e6b','#e84a6f','#d94f3d','#ffb37a']},
  acid:{board:'#2b0033',gridA:'#3d004a',gridB:'#340041',dot:'#ccff0022',palette:['#ff00d4','#ccff00','#00e5ff','#ff5e00','#7cff00']},
};
// Active piece palette (follows the selected theme; new pieces pick from it).
let PALETTE=THEME_LOOK.standard.palette;
// Bombardment drops only tiny shapes (≤3 cells).
const smallBases = [ [[0,0]], [[0,0],[1,0]], [[0,0],[0,1]], [[0,0],[1,0],[2,0]], [[0,0],[0,1],[0,2]], [[0,0],[1,0],[0,1]] ];
const bigBases = [
  [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]],
  [[0,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]],
  [[0,0],[1,0],[2,0],[3,0],[4,0]],
  [[0,0],[1,0],[2,0],[3,0],[0,1],[0,2],[0,3]]
];
// Connected random polyomino of n cells grown inside a 4×4 box, so slot previews keep fitting.
function randomPoly(n:number):number[][]{
  const set=new Set<string>(['1,1']);let guard=0;
  while(set.size<n&&guard++<300){
    const arr=[...set];const [cx,cy]=arr[Math.floor(Math.random()*arr.length)].split(',').map(Number);
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];const [dx,dy]=dirs[Math.floor(Math.random()*4)];
    const nx=cx+dx,ny=cy+dy;if(nx>=0&&nx<4&&ny>=0&&ny<4)set.add(nx+','+ny);
  }
  return [...set].map(s=>s.split(',').map(Number));
}
export function makeBigShape(color=PALETTE[Math.floor(Math.random()*PALETTE.length)],special:Special|null=null):Shape{
  let cells=Math.random()<.55?bigBases[Math.floor(Math.random()*bigBases.length)].map(c=>[...c]):randomPoly(7+Math.floor(Math.random()*3));
  const turns=Math.floor(Math.random()*4);
  for(let i=0;i<turns;i++)cells=cells.map(([x,y])=>[-y,x]);
  if(Math.random()<.5)cells=cells.map(([x,y])=>[-x,y]);
  const minX=Math.min(...cells.map(c=>c[0])),minY=Math.min(...cells.map(c=>c[1]));
  cells=cells.map(([x,y])=>[x-minX,y-minY]);
  return {cells,color,special:special??takeSpecial(),id:nextId++};
}
export function makeShape(index = Math.floor(Math.random()*bases.length), color = PALETTE[Math.floor(Math.random()*PALETTE.length)], special: Special | undefined = undefined): Shape {
  let cells = bases[index].map(c=>[...c]);
  if (index >= 3) {
    const turns = Math.floor(Math.random()*4);
    for(let i=0;i<turns;i++) cells=cells.map(([x,y])=>[-y,x]);
    const minX=Math.min(...cells.map(c=>c[0])), minY=Math.min(...cells.map(c=>c[1]));
    cells=cells.map(([x,y])=>[x-minX,y-minY]);
  }
  return { cells, color, special: special===undefined ? takeSpecial() : special, id:nextId++ };
}
function rounded(ctx: CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number) { ctx.beginPath();ctx.roundRect(x,y,w,h,r); }
export function drawBlock(ctx:CanvasRenderingContext2D,x:number,y:number,color:string,special:Special=null,size=41) {
  const h=size/2;
  ctx.save();ctx.translate(x,y);
  ctx.shadowColor='#00000065';ctx.shadowBlur=7;ctx.shadowOffsetY=5;
  rounded(ctx,-h,-h+5,size,size,6);ctx.fillStyle=color;ctx.fill();ctx.shadowColor='transparent';
  rounded(ctx,-h,-h+5,size,size,6);ctx.fillStyle='#00000045';ctx.fill();
  const grad=ctx.createLinearGradient(-h,-h,h,h);grad.addColorStop(0,color);grad.addColorStop(1,color);
  rounded(ctx,-h,-h,size,size-1,6);ctx.fillStyle=grad;ctx.fill();
  const light=ctx.createLinearGradient(0,-h,0,h);light.addColorStop(0,'#ffffff16');light.addColorStop(1,'#0000000b');ctx.fillStyle=light;ctx.fill();
  ctx.strokeStyle='#ffffff32';ctx.lineWidth=1;rounded(ctx,-h+.7,-h+.7,size-1.4,size-2.4,5.5);ctx.stroke();
  ctx.beginPath();ctx.moveTo(-h+7,-h+3);ctx.lineTo(h-7,-h+3);ctx.strokeStyle='#ffffff3b';ctx.stroke();
  if(special){
    ctx.strokeStyle='#1b3335';ctx.fillStyle='#1b3335';ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';
    if(special==='bomb'){ctx.beginPath();ctx.arc(0,2,7,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(3,-4);ctx.lineTo(6,-9);ctx.lineTo(9,-9);ctx.stroke();ctx.fillStyle='#fff1bc';ctx.beginPath();ctx.arc(10,-10,2,0,7);ctx.fill();}
    if(special==='oil'){ctx.beginPath();ctx.moveTo(0,-11);ctx.bezierCurveTo(-15,4,-6,11,0,10);ctx.bezierCurveTo(8,10,12,3,0,-11);ctx.fill();}
    if(special==='magnet'){ctx.beginPath();ctx.moveTo(-7,-8);ctx.lineTo(-7,3);ctx.arc(0,3,7,Math.PI,0,true);ctx.lineTo(7,-8);ctx.stroke();ctx.beginPath();ctx.moveTo(-10,-3);ctx.lineTo(-4,-3);ctx.moveTo(4,-3);ctx.lineTo(10,-3);ctx.stroke();}
    if(special==='loot'){ctx.strokeRect(-8,-5,16,13);ctx.strokeRect(-10,-8,20,5);ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(0,8);ctx.moveTo(0,-8);ctx.bezierCurveTo(-13,-18,-10,-3,0,-8);ctx.bezierCurveTo(13,-18,10,-3,0,-8);ctx.stroke();}
    if(special==='fire'){ctx.beginPath();ctx.moveTo(0,-12);ctx.bezierCurveTo(9,-5,10,3,5,9);ctx.bezierCurveTo(2,12,-3,12,-6,8);ctx.bezierCurveTo(-10,3,-3,-3,0,-12);ctx.fill();}
    if(special==='shock'){ctx.beginPath();ctx.arc(0,2,3.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(0,2,8.5,-.55,.55);ctx.stroke();ctx.beginPath();ctx.arc(0,2,8.5,Math.PI-.55,Math.PI+.55);ctx.stroke();ctx.beginPath();ctx.arc(0,2,13.5,-.75,.75);ctx.stroke();ctx.beginPath();ctx.arc(0,2,13.5,Math.PI-.75,Math.PI+.75);ctx.stroke();}
    if(special==='surprise'){ctx.beginPath();ctx.arc(0,-2,6.5,Math.PI*.85,Math.PI*2.15);ctx.stroke();ctx.beginPath();ctx.moveTo(4.5,3.5);ctx.lineTo(1,7.5);ctx.lineTo(1,10.5);ctx.stroke();ctx.beginPath();ctx.arc(1,14.5,1.9,0,Math.PI*2);ctx.fill();}
    if(special==='chain'){ctx.beginPath();ctx.moveTo(3,-11);ctx.lineTo(-5,1);ctx.lineTo(-1,1);ctx.lineTo(-3,11);ctx.lineTo(5,-2);ctx.lineTo(1,-2);ctx.closePath();ctx.fill();}
    if(special==='icebomb'){ctx.lineWidth=1.7;for(let i=0;i<3;i++){const a=i*Math.PI/3+Math.PI/6;ctx.beginPath();ctx.moveTo(-Math.cos(a)*9.5,-Math.sin(a)*9.5);ctx.lineTo(Math.cos(a)*9.5,Math.sin(a)*9.5);ctx.stroke();for(const s of[-1,1]){ctx.beginPath();ctx.moveTo(Math.cos(a)*9.5*s,Math.sin(a)*9.5*s);ctx.lineTo(Math.cos(a)*9.5*s-Math.sin(a)*3,Math.sin(a)*9.5*s+Math.cos(a)*3);ctx.stroke();}}ctx.beginPath();ctx.arc(0,0,2.2,0,Math.PI*2);ctx.fill();}
    // Stone bomb: a little boulder with facets.
    if(special==='stonebomb'){ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3+.3,r=i%2?9.5:7;const px=Math.cos(a)*r,py=Math.sin(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(-3,4);ctx.lineTo(0,-2);ctx.lineTo(4,1);ctx.stroke();ctx.globalAlpha=1;}
    if(special==='stone'){ctx.strokeStyle='#00000038';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-h+8,-h+14);ctx.lineTo(-h+16,-h+21);ctx.lineTo(-h+9,-h+29);ctx.moveTo(h-9,-h+9);ctx.lineTo(h-15,-h+19);ctx.lineTo(h-8,-h+27);ctx.moveTo(-h+17,h-7);ctx.lineTo(-h+25,h-13);ctx.stroke();}
  }
  ctx.restore();
}

export class PhysicsGame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  engine: Matter.Engine;
  pieces: Piece[]=[];
  particles: Particle[]=[];
  rings: Ring[]=[];
  oils: Oil[]=[];
  fires: Fire[]=[];
  ices: Ice[]=[];
  projectiles: Projectile[]=[];
  score=0; best=0; round=1; cells=0;
  slots:(Shape|null)[]=[];
  ammo=[3,0,0,0]; weapon=-1; weaponExpiry=0;
  paused=false; over=false; sound=true;
  elapsed=0; event:EventKind|null=null; eventLeft=0; eventTotal=1;
  // Second event slot: a surprise (or an event fired while another runs) starts
  // alongside instead of interrupting the running one. Max 2 at a time.
  event2:EventKind|null=null; event2Left=0; event2Total=1; zone2:{x:number;y:number;r:number}|null=null;
  // The next event is pre-picked and announced with a countdown that never stops —
  // area events no longer freeze it.
  pendingEvent:EventKind|null=null; nextEvent=EVENT_SPACING; growthPlaced=0;
  themeKey='standard';
  // Chain lightning: up to 9 hops, 0.3s apart, each destroying one block.
  chainLeft=0; chainFrom:{x:number;y:number}|null=null; chainTick=0; bolts:Array<{x1:number;y1:number;x2:number;y2:number;life:number}>=[];
  // Anti-overstack: a placed piece that would form a 3rd layer is nudged toward free space.
  nudge:{p:Piece;tx:number;ty:number;t:number;tries:number}|null=null;
  settleTick=0;
  // Soft defeat: the counter counts up while the board blurs, then the restart menu fades in.
  dying=false; overAt=0;
  // Overflow grace: after >100 blocks the game waits a moment so line clears can save the run.
  overPending=0;
  // Pulse event: three hammer blows instead of one.
  pulsePushes=0; pulseTick=0;
  viewAngle=0; rotationStart=0; rotationTarget=0;
  zone:{x:number;y:number;r:number}|null=null;
  dragged:Piece|null=null; dragOffset={x:0,y:0}; pointer={x:250,y:250}; dragSlot=-1;
  screenPointerX=0; screenPointerY=0;
  started=false; last=0; frame=0; uiTick=0; lineTick=0; burnTick=0; bombardTick=0; gravityDir=0; accumulator=0;
  audio:AudioContext|null=null;
  // Render caches: device-pixel scale, per-(color,special) block sprites, prebuilt board grid.
  scale=1; sprites=new Map<string,HTMLCanvasElement>(); spriteLogical=0; spriteHalf=0;
  gridLayer:HTMLCanvasElement|null=null;
  drawList:Piece[]=[]; bins:Array<Array<{p:Piece;c:Cell}>>|null=null;
  lastDraw=0; pauseDrawn=false; ro:ResizeObserver|null=null;
  onUpdate:(s:Snapshot)=>void;
  constructor(canvas:HTMLCanvasElement,onUpdate:(s:Snapshot)=>void) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d')!;this.onUpdate=onUpdate;
    this.fit();
    this.ro=new ResizeObserver(()=>this.fit());this.ro.observe(canvas);
    // Sleeping lets resting piles cost ~0 CPU; solver iterations back to Matter defaults.
    this.engine=Engine.create({gravity:{x:0,y:0},enableSleeping:true,positionIterations:6,velocityIterations:4});
    const walls=[Bodies.rectangle(250,4,550,32,{isStatic:true}),Bodies.rectangle(250,496,550,32,{isStatic:true}),Bodies.rectangle(4,250,32,550,{isStatic:true}),Bodies.rectangle(496,250,32,550,{isStatic:true})];
    Composite.add(this.engine.world,walls);
    try{this.best=Number(localStorage.getItem('1010-physics-best'))||0;this.sound=localStorage.getItem('1010-sound')!=='off';}catch{}
    this.reset();
    this.frame=requestAnimationFrame(this.loop);
  }
  fit(){
    const css=this.canvas.getBoundingClientRect().width||SIZE;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const s=Math.max(1,Math.min(2,css/SIZE*dpr));
    const px=Math.round(SIZE*s);
    if(this.canvas.width!==px){this.canvas.width=px;this.canvas.height=px;}
    this.scale=s;this.ctx.setTransform(s,0,0,s,0,0);
    this.buildSprites();this.buildGrid();this.pauseDrawn=false;
  }
  buildSprites(){
    this.sprites.clear();
    const logical=41+28;
    const px=Math.ceil(logical*this.scale);
    for(const color of [...PALETTE,STONE_COLOR])for(const special of [null,'bomb','oil','magnet','loot','fire','shock','surprise','chain','icebomb','stonebomb','stone'] as Special[]){
      const c=document.createElement('canvas');c.width=px;c.height=px;
      const g=c.getContext('2d')!;
      g.scale(this.scale,this.scale);g.translate(logical/2,logical/2);
      drawBlock(g,0,0,color,special,41);
      this.sprites.set(color+'|'+special,c);
    }
    this.spriteLogical=logical;this.spriteHalf=logical/2;
  }
  buildGrid(){
    const look=THEME_LOOK[this.themeKey];
    const c=document.createElement('canvas');const px=Math.round(SIZE*this.scale);
    c.width=px;c.height=px;const g=c.getContext('2d')!;g.scale(this.scale,this.scale);
    for(let r=0;r<10;r++)for(let col=0;col<10;col++){
      g.beginPath();g.roundRect(21+col*46,21+r*46,44,44,4);g.fillStyle=(r+col)%2===0?look.gridA:look.gridB;g.fill();
      g.strokeStyle='#ffffff03';g.lineWidth=1;g.stroke();
      g.fillStyle=look.dot;g.beginPath();g.arc(43+col*46,43+r*46,1,0,7);g.fill();
    }
    this.gridLayer=c;
  }
  // Theme switch: repaint the canvas chrome and recolor existing pieces to the new palette.
  setTheme(key:string){
    if(!THEME_LOOK[key]||key===this.themeKey&&PALETTE===THEME_LOOK[key].palette)return;
    const old=THEME_LOOK[this.themeKey].palette;
    this.themeKey=key;PALETTE=THEME_LOOK[key].palette;
    for(const p of this.pieces)for(const c of p.cells){const i=old.indexOf(c.color);if(i>=0)c.color=PALETTE[i%PALETTE.length];}
    this.slots=this.slots.map(s=>{if(!s)return s;const i=old.indexOf(s.color);return i>=0?{...s,color:PALETTE[i%PALETTE.length]}:s;});
    this.buildSprites();this.buildGrid();this.pauseDrawn=false;this.emit();
  }
  wake(b:Matter.Body){if(b.isSleeping)Sleeping.set(b,false);}
  wakeAll(){for(const p of this.pieces)this.wake(p.body);}
  snapshot():Snapshot{
    const events:ActiveEvent[]=[];
    if(this.event)events.push({kind:this.event,progress:this.event==='growth'?this.growthPlaced/15:this.eventLeft/this.eventTotal});
    if(this.event2)events.push({kind:this.event2,progress:this.event2==='growth'?this.growthPlaced/15:this.event2Left/this.event2Total});
    return {score:this.score,best:this.best,cells:this.cells,slots:[...this.slots],ammo:[...this.ammo],weapon:this.weapon,events,nextEvent:this.pendingEvent,nextIn:Math.max(0,this.nextEvent-this.elapsed),paused:this.paused,over:this.over,round:this.round,dying:this.dying,dieProgress:this.dying?Math.min(1,Math.max(0,1-(this.overAt-this.elapsed)/2.5)):0};
  }
  emit(){this.onUpdate(this.snapshot());}
  reset(){
    this.pieces.forEach(p=>Composite.remove(this.engine.world,p.body));this.pieces=[];
    this.particles=[];this.rings=[];this.oils=[];this.fires=[];this.ices=[];this.projectiles=[];this.score=0;this.cells=0;this.round=1;this.burnTick=0;this.bombardTick=0;this.gravityDir=0;
    this.chainLeft=0;this.chainFrom=null;this.bolts=[];this.nudge=null;this.dying=false;this.overAt=0;this.overPending=0;this.pulsePushes=0;this.pulseTick=0;
    this.ammo=[3,0,0,0];this.weapon=-1;this.weaponExpiry=0;this.paused=false;this.over=false;this.elapsed=0;this.event=null;this.eventLeft=0;this.event2=null;this.event2Left=0;this.zone2=null;this.viewAngle=0;this.dragged=null;this.dragSlot=-1;this.started=false;
    this.pendingEvent=EVENTS[Math.floor(Math.random()*EVENTS.length)];this.nextEvent=EVENT_SPACING;this.growthPlaced=0;specialClock=12+Math.floor(Math.random()*4);
    this.engine.gravity.x=0;this.engine.gravity.y=0;
    this.slots=[makeShape(5,PALETTE[0],null),makeShape(1,PALETTE[1],null),makeShape(3,PALETTE[2],null)];
    this.spawn({cells:[[0,0],[1,0],[0,1],[1,1]],color:PALETTE[1],special:null,id:nextId++},111,135,-.09);
    this.spawn({cells:[[0,0],[0,1],[0,2]],color:PALETTE[2],special:null,id:nextId++},359,131,.10);
    this.spawn({cells:[[0,0],[0,1],[1,1],[2,1]],color:PALETTE[0],special:null,id:nextId++},240,257,.075);
    this.spawn({cells:[[0,0],[1,0],[2,0]],color:PALETTE[3],special:null,id:nextId++},365,359,-.12);
    this.spawn({cells:[[0,0],[1,0],[0,1],[1,1]],color:PALETTE[4],special:null,id:nextId++},115,375,.075);
    this.spawn({cells:[[0,0]],color:PALETTE[2],special:'loot',id:nextId++},291,438,-.11);
    this.emit();this.draw();this.pauseDrawn=false;
  }
  spawn(shape:Shape,x:number,y:number,angle=0):Piece {
    const meanX=shape.cells.reduce((s,c)=>s+c[0],0)/shape.cells.length,meanY=shape.cells.reduce((s,c)=>s+c[1],0)/shape.cells.length;
    const cells:Cell[]=shape.cells.map(([gx,gy],i)=>({x:(gx-meanX)*STEP,y:(gy-meanY)*STEP,gx,gy,color:shape.color,special:i===0?shape.special:null}));
    return this.createPiece(cells,x,y,angle,shape.special);
  }
  createPiece(cells:Cell[],x:number,y:number,angle:number,special:Special):Piece{
    // During the ice event everything that enters the field freezes in place.
    if(this.event==='ice'||this.event2==='ice')for(const c of cells)if(!c.stone)c.frozen=true;
    const parts=cells.map(c=>Bodies.rectangle(x+c.x,y+c.y,43,43,{chamfer:{radius:3},density:.0018}));
    const body=parts.length===1?parts[0]:Body.create({parts});
    body.frictionAir=.045;body.friction=.12;body.restitution=.26;
    const cx=body.position.x-x,cy=body.position.y-y;
    const local=cells.map(c=>({...c,x:c.x-cx,y:c.y-cy}));
    Body.setAngle(body,angle);
    const p={body,cells:local,born:this.elapsed,special,activated:false};
    this.pieces.push(p);Composite.add(this.engine.world,body);return p;
  }
  worldCell(p:Piece,c:Cell){const co=Math.cos(p.body.angle),si=Math.sin(p.body.angle);return{x:p.body.position.x+c.x*co-c.y*si,y:p.body.position.y+c.x*si+c.y*co};}
  toWorld(clientX:number,clientY:number){const r=this.canvas.getBoundingClientRect();const x=(clientX-r.left)/r.width*SIZE-250,y=(clientY-r.top)/r.height*SIZE-250;const co=Math.cos(-this.viewAngle),si=Math.sin(-this.viewAngle);return{x:250+x*co-y*si,y:250+x*si+y*co};}
  isInside(clientX:number,clientY:number){const r=this.canvas.getBoundingClientRect();return clientX>=r.left&&clientX<=r.right&&clientY>=r.top&&clientY<=r.bottom;}
  wakeAudio(){if(!this.audio)try{this.audio=new AudioContext();}catch{}if(this.audio?.state==='suspended')void this.audio.resume();this.started=true;}
  tone(freq=350,seconds=.06,type:OscillatorType='sine',volume=.04){if(!this.sound||!this.audio)return;try{const o=this.audio.createOscillator(),g=this.audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,this.audio.currentTime);o.frequency.exponentialRampToValueAtTime(freq*.45,this.audio.currentTime+seconds);g.gain.setValueAtTime(volume,this.audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,this.audio.currentTime+seconds);o.connect(g);g.connect(this.audio.destination);o.start();o.stop(this.audio.currentTime+seconds);}catch{}}
  beginSlot(index:number,clientX:number,clientY:number){if(this.paused||this.over||this.dying||!this.slots[index]||this.dragSlot!==-1)return;this.wakeAudio();this.weapon=-1;this.dragSlot=index;this.screenPointerX=clientX;this.screenPointerY=clientY;this.pointer=this.toWorld(clientX,clientY);this.tone(220,.04);this.emit();}
  move(clientX:number,clientY:number){
    if(this.paused||this.over)return;
    this.screenPointerX=clientX;this.screenPointerY=clientY;
    this.pointer=this.toWorld(clientX,clientY);
    // Slot pieces float above the field while dragging — they land only on release.
  }
  boardDown(clientX:number,clientY:number){
    if(this.paused||this.over||this.dying)return;this.wakeAudio();this.pointer=this.toWorld(clientX,clientY);
    if(this.weapon>=0){this.shoot(this.pointer.x,this.pointer.y);return;}
    const bodies=Query.point(this.pieces.map(p=>p.body),this.pointer);if(!bodies.length)return;
    this.dragged=this.pieces.find(p=>p.body===bodies[bodies.length-1])||null;
    // Petrified pieces are immovable — they cannot be picked up.
    if(this.dragged&&this.dragged.body.isStatic)this.dragged=null;
    if(this.dragged){this.wake(this.dragged.body);this.dragOffset={x:this.pointer.x-this.dragged.body.position.x,y:this.pointer.y-this.dragged.body.position.y};}
  }
  release(cancel=false,clientX?:number,clientY?:number){
    if(this.dragSlot<0&&!this.dragged)return;
    if(this.dragSlot>=0&&!cancel&&clientX!==undefined&&clientY!==undefined){
      const shape=this.slots[this.dragSlot];
      // The piece lands only when the pointer is released over the board.
      if(shape&&this.isInside(clientX,clientY)){
        this.screenPointerX=clientX;this.screenPointerY=clientY;this.pointer=this.toWorld(clientX,clientY);
        const gx=Math.max(85,Math.min(415,this.pointer.x)),gy=Math.max(85,Math.min(415,this.pointer.y));
        // Drop along the field's current "down", slightly above the drop point, so it visibly falls onto the pile.
        const dx=Math.sin(this.viewAngle),dy=Math.cos(this.viewAngle);
        // The piece keeps its tray orientation: counter-rotate by the field's snapped angle
        // so it never looks "twisted by 90°" after the rotate event.
        const snap=-Math.round(this.viewAngle/(Math.PI/2))*(Math.PI/2);
        const p=this.spawn(shape,gx-dx*10,gy-dy*10,snap);
        Body.setVelocity(p.body,{x:dx*.6,y:dy*.6});
        this.slots[this.dragSlot]=null;this.addScore(shape.cells.length*5);this.activate(p);this.tone(300,.1);this.burst(gx,gy,p.cells[0].color,7);
        // Dropping a shape onto frozen blocks shatters them.
        this.shatterUnder(p);
        // A piece placed on top of a 2-layer pile slides away to free space.
        this.checkOverstack(p);
        // The growth event ends after 15 big shapes are placed — no timer.
        // (Either slot can host growth; the countdown keeps running regardless.)
        if(this.event==='growth'||this.event2==='growth'){
          this.growthPlaced++;
          if(this.growthPlaced>=15){
            if(this.event==='growth'){this.event=null;this.zone=null;}
            if(this.event2==='growth'){this.event2=null;this.zone2=null;}
            this.growthPlaced=0;this.rings.push({x:250,y:250,radius:380,life:1,color:'#b8e098'});this.tone(700,.3,'triangle');this.emit();
          }
        }
      }
    }
    this.dragged=null;this.dragSlot=-1;
    if(this.slots.every(s=>s===null))this.refill();this.emit();
  }
  activate(p:Piece){
    if(p.activated)return;p.activated=true;
    if(p.cells.some(c=>c.special==='bomb'))p.born=this.elapsed+.55;
    const oc=p.cells.find(c=>c.special==='oil');
    if(oc){const w=this.worldCell(p,oc);this.oils.push({x:w.x,y:w.y,r:94,life:13});this.rings.push({x:w.x,y:w.y,radius:100,life:1,color:'#c29eea'});}
  }
  // A surprise special already on the field (or in the slots)?
  hasSurprise(includeSlots=true){
    if(includeSlots&&this.slots.some(s=>s&&s.special==='surprise'))return true;
    for(const p of this.pieces)for(const c of p.cells)if(c.special==='surprise')return true;
    return false;
  }
  refill(){
    this.round++;
    this.slots=this.event==='growth'?[makeBigShape(),makeBigShape(),makeBigShape()]:[makeShape(),makeShape(),makeShape()];
    // Cap concurrent events at two: while one surprise is already in play or two
    // events run at once, no new surprise specials spawn (re-rolled from the pool).
    let seen=this.hasSurprise(false)?1:0;
    const twoEvents=!!(this.event&&this.event2);
    for(const s of this.slots)if(s&&s.special==='surprise'){if(seen>0||twoEvents)s.special=pickSpecial(true);else seen++;}
    this.tone(620,.05);
  }
  // Weapons are capped at 25 charges.
  grantAmmo(i:number,n:number){this.ammo[i]=Math.min(25,this.ammo[i]+n);}
  addScore(n:number){this.score+=n;if(this.score>this.best){this.best=this.score;try{localStorage.setItem('1010-physics-best',String(this.best));}catch{}}}
  burst(x:number,y:number,color:string,n=12){if(this.particles.length>PARTICLE_CAP+60)return;for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=1+Math.random()*5;this.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.4+Math.random()*.5,max:.9,color,size:2+Math.random()*5});}}
  destroyCells(test:(x:number,y:number,p:Piece,c:Cell)=>boolean,reward=true){
    let count=0;const originals=[...this.pieces];const blasts:Array<{x:number;y:number}>=[];
    for(const p of originals){
      const removed=p.cells.filter(c=>{const w=this.worldCell(p,c);return test(w.x,w.y,p,c);});if(!removed.length)continue;
      count+=removed.length;
      removed.forEach(c=>{const w=this.worldCell(p,c);this.burst(w.x,w.y,c.color);
        if(c.special==='loot'){const wp=Math.floor(Math.random()*4);this.grantAmmo(wp,wp===3?3:5);this.weaponExpiry=this.elapsed+25;this.rings.push({x:w.x,y:w.y,radius:110,life:1,color:'#dedf93'});this.tone(950,.3,'triangle');}
        if(c.special==='fire')this.startFire(w.x,w.y,78,3.8);
        // Impulse bomb: a pure shockwave that hurls everything nearby outward.
        if(c.special==='shock')this.shockwave(w.x,w.y);
        // Surprise cell: fires a random event off-schedule.
        if(c.special==='surprise')this.surpriseTrigger(w.x,w.y);
        // Chain lightning: lightning hops block to block from here.
        if(c.special==='chain')this.startChain(w.x,w.y);
        // Ice bomb: a small area ices over and its blocks freeze (once).
        if(c.special==='icebomb')this.iceBomb(w.x,w.y);
        // Stone bomb: nearby blocks turn to stone in a small radius.
        if(c.special==='stonebomb')this.petrify(w.x,w.y,72);
        if(c.infected&&c.special==='bomb')blasts.push(w);
        if(c.infected&&c.special==='oil')this.oils.push({x:w.x,y:w.y,r:82,life:10});
      });
      const remaining=p.cells.filter(c=>!removed.includes(c));
      Composite.remove(this.engine.world,p.body);this.pieces=this.pieces.filter(q=>q!==p);
      if(this.dragged===p)this.dragged=null;
      // Connected components preserve intact sections, including perforated 3×3 squares.
      const pending=new Set(remaining);
      while(pending.size){
        const first=pending.values().next().value as Cell;const group=[first];pending.delete(first);
        for(let i=0;i<group.length;i++)for(const candidate of [...pending])if(Math.abs(candidate.gx-group[i].gx)+Math.abs(candidate.gy-group[i].gy)===1){group.push(candidate);pending.delete(candidate);}
        const points=group.map(c=>this.worldCell(p,c));const x=points.reduce((s,w)=>s+w.x,0)/points.length,y=points.reduce((s,w)=>s+w.y,0)/points.length;
        const mx=group.reduce((s,c)=>s+c.x,0)/group.length,my=group.reduce((s,c)=>s+c.y,0)/group.length;
        const fragment=this.createPiece(group.map(c=>({...c,x:c.x-mx,y:c.y-my})),x,y,p.body.angle,group.some(c=>c.special===p.special)?p.special:null);
        fragment.activated=p.activated;fragment.born=p.born;
        if(fragment.cells.every(c=>c.stone))Body.setStatic(fragment.body,true);
        Body.setVelocity(fragment.body,{x:p.body.velocity.x-(y-p.body.position.y)*p.body.angularVelocity,y:p.body.velocity.y+(x-p.body.position.x)*p.body.angularVelocity});Body.setAngularVelocity(fragment.body,p.body.angularVelocity);
      }
    }
    for(const b of blasts)this.explode(b.x,b.y,85);
    if(reward)this.addScore(count*10);return count;
  }
  explode(x:number,y:number,r=95){
    this.destroyCells((cx,cy)=>Math.hypot(cx-x,cy-y)<r);
    this.pieces.forEach(p=>{if(p.body.isStatic)return;const dx=p.body.position.x-x,dy=p.body.position.y-y,d=Math.hypot(dx,dy)||1;if(d<r*2.7){this.wake(p.body);const f=13*(1-d/(r*2.7));Body.setVelocity(p.body,{x:p.body.velocity.x+dx/d*f,y:p.body.velocity.y+dy/d*f});Body.setAngularVelocity(p.body,(Math.random()-.5)*.12);}});
    // A blast touching an oil slick sets it alight.
    for(const o of this.oils)if(Math.hypot(o.x-x,o.y-y)<r+o.r*.5)this.igniteOil(o);
    this.rings.push({x,y,radius:r*2,life:.8,color:'#f6c293'});this.burst(x,y,'#ffe9ba',30);this.tone(100,.35,'sawtooth',.065);
  }
  // Impulse-bomb blast: no destruction, just a violent radial push.
  shockwave(x:number,y:number){
    for(const p of this.pieces){
      if(p.body.isStatic)continue;
      let dx=p.body.position.x-x,dy=p.body.position.y-y,d=Math.hypot(dx,dy);
      if(d<1){const a=Math.random()*Math.PI*2;dx=Math.cos(a);dy=Math.sin(a);d=1;}
      if(d<200){this.wake(p.body);const v=7+(1-d/200)*18;Body.setVelocity(p.body,{x:p.body.velocity.x+dx/d*v,y:p.body.velocity.y+dy/d*v});Body.setAngularVelocity(p.body,(Math.random()-.5)*.22);}
    }
    for(const o of this.oils)if(Math.hypot(o.x-x,o.y-y)<200+o.r*.5)this.igniteOil(o);
    this.rings.push({x,y,radius:360,life:.9,color:'#8fd7e8'});this.burst(x,y,'#bfe9f5',16);this.tone(70,.4,'sawtooth',.055);
  }
  // Surprise cell: rolls a random event outside the 20s cycle. The event that is
  // already running (in either slot) is never interrupted — the rolled event either
  // prolongs it (same continuous kind) or starts alongside in slot 2.
  surpriseTrigger(x:number,y:number,forced?:EventKind){
    let kind=forced||EVENTS[Math.floor(Math.random()*EVENTS.length)];
    // Continuous events that make sense to prolong when they roll again.
    const prolongable=new Set<EventKind>(['rotate','ice','oil','shake','vortex','gravity','bombard','fire','barrier']);
    if(kind===this.event&&prolongable.has(kind)){this.eventLeft+=this.eventTotal;this.rings.push({x,y,radius:200,life:1,color:'#e8d98a'});this.tone(500,.3,'triangle');this.emit();return;}
    if(kind===this.event2&&prolongable.has(kind)){this.event2Left+=this.event2Total;this.rings.push({x,y,radius:200,life:1,color:'#e8d98a'});this.tone(500,.3,'triangle');this.emit();return;}
    // Growth cannot run twice — re-roll once if it is already active.
    if(kind==='growth'&&(this.event==='growth'||this.event2==='growth'))kind=EVENTS[Math.floor(Math.random()*EVENTS.length)];
    if(kind==='growth'&&(this.event==='growth'||this.event2==='growth'))return;
    if(!this.event)this.startEvent(kind,1);else this.startEvent(kind,2);
  }
  // Chain lightning: up to 9 hops with 0.3s between strikes, each destroying one nearby block.
  startChain(x:number,y:number){
    this.chainLeft=9;this.chainFrom={x,y};this.chainTick=.12;
    this.rings.push({x,y,radius:60,life:.5,color:'#ffe98a'});
  }
  selectWeapon(level:number){if(this.paused||this.over||this.dying||!this.ammo[level])return;this.wakeAudio();this.weapon=this.weapon===level?-1:level;this.emit();}
  shoot(x:number,y:number){
    const level=this.weapon;if(level<0||!this.ammo[level])return;this.ammo[level]--;
    if(level===0){let closest:{p:Piece;c:Cell;d:number}|null=null;for(const p of this.pieces)for(const c of p.cells){const w=this.worldCell(p,c),d=Math.hypot(w.x-x,w.y-y);if(d<32&&(!closest||d<closest.d))closest={p,c,d};}if(closest){const hit=closest;this.destroyCells((_,__,p,c)=>p===hit.p&&c===hit.c);}this.rings.push({x,y,radius:30,life:.3,color:'#82dfc7'});this.tone(800,.09,'triangle');}
    if(level===1){this.destroyCells((cx,cy)=>Math.hypot(cx-x,cy-y)<62);this.rings.push({x,y,radius:75,life:.45,color:'#b9a2e9'});this.tone(170,.15,'sawtooth');}
    if(level===2){this.destroyCells((cx)=>Math.abs(cx-x)<27);for(let y0=20;y0<480;y0+=35)this.burst(x,y0,'#8ad8fa',4);this.rings.push({x,y,radius:90,life:.35,color:'#8ad8fa'});this.tone(1200,.2,'sawtooth');}
    if(level===3)this.projectiles.push({x:250,y:520,tx:x,ty:y,life:.5});
    // Any shot landing on an oil slick — even the non-explosive ones — lights the area up.
    // The bomb projectile does it on impact instead.
    if(level!==3)for(const o of this.oils){const near=level===2?Math.abs(o.x-x)<o.r+27:Math.hypot(o.x-x,o.y-y)<o.r+20;if(near)this.igniteOil(o);}
    if(!this.ammo[level])this.weapon=-1;this.emit();
  }
  checkLines(){
    const bins=this.bins??(this.bins=Array.from({length:100},()=>[] as Array<{p:Piece;c:Cell}>));
    for(const b of bins)b.length=0;
    for(const p of this.pieces){if(p===this.dragged)continue;for(const c of p.cells){const w=this.worldCell(p,c);const col=Math.floor((w.x-20)/46),row=Math.floor((w.y-20)/46);if(col>=0&&col<10&&row>=0&&row<10)bins[row*10+col].push({p,c});}}
    const hit=new Set<Cell>();let lines=0;
    for(let k=0;k<10;k++){
      if(Array.from({length:10},(_,i)=>bins[k*10+i].length>0).every(Boolean)){lines++;for(let i=0;i<10;i++)bins[k*10+i].forEach(e=>hit.add(e.c));}
      if(Array.from({length:10},(_,i)=>bins[i*10+k].length>0).every(Boolean)){lines++;for(let i=0;i<10;i++)bins[i*10+k].forEach(e=>hit.add(e.c));}
    }
    if(hit.size){const n=this.destroyCells((_,__,___,c)=>hit.has(c));this.addScore(lines*100);const level=n>=40?3:n>=30?2:n>=20?1:0;this.grantAmmo(level,level===3?3:5);this.weaponExpiry=this.elapsed+25;this.tone(680,.3,'triangle');this.emit();}
  }
  // Continuous "area" events run a full 10 seconds; instants stay snappy.
  eventTotal_(e:EventKind){return e==='growth'?1:(e==='rotate'||e==='ice'||e==='oil'||e==='shake'||e==='vortex'||e==='gravity'||e==='bombard'||e==='fire'||e==='barrier')?10:e==='zone'?3:e==='pulse'?3.2:e==='stone'||e==='infest'?2.5:e==='bloom'?3.2:e==='decay'?3:7;}
  // Starts an event in slot 1 (main) or slot 2 (alongside — never interrupts slot 1).
  startEvent(kind:EventKind,slot:1|2){
    if(this.over)return;
    const e=kind,total=this.eventTotal_(e);
    const z=()=>({x:115+Math.random()*270,y:115+Math.random()*270,r:105});
    // Ice freezes the whole field and puts out every fire; pulse hammers three times.
    if(e==='ice')this.freezeEverything();
    if(e==='pulse'){this.pulsePushes=3;this.pulseTick=.6;}
    if(slot===1){
      this.event=e;this.eventLeft=total;this.eventTotal=total;this.zone=null;
      if(e==='rotate'){this.rotationStart=this.viewAngle;this.rotationTarget=this.viewAngle+(Math.random()<.5?Math.PI/2:Math.PI);}
      if(e==='zone')this.zone={x:115+Math.random()*270,y:115+Math.random()*270,r:95};
      // Petrify and barrier zones are half again as big as they used to be.
      if(e==='stone')this.zone={x:115+Math.random()*270,y:115+Math.random()*270,r:158};
      if(e==='infest')this.zone=z();
      if(e==='bloom')this.zone={x:130+Math.random()*240,y:130+Math.random()*240,r:115};
      if(e==='barrier')this.zone={x:130+Math.random()*240,y:130+Math.random()*240,r:132};
      if(e==='oil')this.oils.push({x:100+Math.random()*300,y:100+Math.random()*300,r:131,life:12});
      if(e==='gravity')this.gravityDir=Math.floor(Math.random()*4);
      if(e==='growth'){this.growthPlaced=0;for(let i=0;i<3;i++)if(this.slots[i]&&this.dragSlot!==i)this.slots[i]=makeBigShape();}
      if(e==='fire')this.startFire(100+Math.random()*300,100+Math.random()*300,120,5);
      if(e==='bombard')this.bombardTick=.3;
    }else{
      // Slot 2: if one is already running there, it is replaced (slot 1 untouched).
      this.event2=e;this.event2Left=total;this.event2Total=total;this.zone2=null;
      if(e==='zone')this.zone2={x:115+Math.random()*270,y:115+Math.random()*270,r:95};
      if(e==='stone')this.zone2={x:115+Math.random()*270,y:115+Math.random()*270,r:158};
      if(e==='infest')this.zone2=z();
      if(e==='bloom')this.zone2={x:130+Math.random()*240,y:130+Math.random()*240,r:115};
      if(e==='barrier')this.zone2={x:130+Math.random()*240,y:130+Math.random()*240,r:132};
      if(e==='oil')this.oils.push({x:100+Math.random()*300,y:100+Math.random()*300,r:131,life:12});
      if(e==='gravity')this.gravityDir=Math.floor(Math.random()*4);
      if(e==='fire')this.startFire(100+Math.random()*300,100+Math.random()*300,120,5);
      if(e==='bombard')this.bombardTick=.3;
    }
    this.tone(450,.22,'triangle');this.emit();
  }
  // Ends the event in the given slot and applies its finisher (zone blast etc.).
  endEvent(slot:1|2){
    const k=slot===1?this.event:this.event2;
    const z=slot===1?this.zone:this.zone2;
    if(!k)return;
    if(k==='zone'&&z)this.explode(z.x,z.y,z.r);
    if(k==='stone'&&z)this.petrify(z.x,z.y,z.r);
    if(k==='infest'&&z)this.infect(z.x,z.y,z.r);
    if(k==='bloom'&&z)this.bloomTransform(z);
    if(k==='decay')this.decayTransform();
    // Pulse already hammered its three blows during the event — nothing to do at the end.
    if(k==='pulse')this.pulsePushes=0;
    if(slot===1){this.event=null;this.zone=null;}else{this.event2=null;this.zone2=null;}
    this.emit();
  }
  // Wild growth: up to 3 separate pieces inside the zone (even single cells) become rings of 8.
  bloomTransform(z:{x:number;y:number;r:number}){
    const inside=this.pieces.filter(p=>!p.body.isStatic&&p!==this.dragged&&p.cells.some(c=>{const w=this.worldCell(p,c);return Math.hypot(w.x-z.x,w.y-z.y)<z.r;}));
    for(const p of [...inside].sort(()=>Math.random()-.5).slice(0,3)){
      const pos={...p.body.position},ang=p.body.angle,vel={...p.body.velocity},av=p.body.angularVelocity,color=p.cells[0].color;
      Composite.remove(this.engine.world,p.body);this.pieces=this.pieces.filter(q=>q!==p);
      if(this.dragged===p)this.dragged=null;
      const ring:Shape={cells:bigBases[1].map(c=>[...c]),color,special:null,id:nextId++};
      const np=this.spawn(ring,pos.x,pos.y,ang);
      Body.setVelocity(np.body,vel);Body.setAngularVelocity(np.body,av);this.wake(np.body);
    }
    this.rings.push({x:z.x,y:z.y,radius:z.r*1.5,life:1,color:'#a5e087'});this.burst(z.x,z.y,'#b6f09a',22);this.tone(620,.35,'triangle');
  }
  // Decay: every shape on the field splits into individual single-cell blocks.
  decayTransform(){
    for(const p of [...this.pieces]){
      if(p.cells.length<=1)continue;
      const ang=p.body.angle,vel=p.body.velocity,av=p.body.angularVelocity;
      Composite.remove(this.engine.world,p.body);this.pieces=this.pieces.filter(q=>q!==p);
      if(this.dragged===p)this.dragged=null;
      for(const c of p.cells){
        const w=this.worldCell(p,c);
        const single:Shape={cells:[[0,0]],color:c.color,special:c.stone?null:c.special,id:nextId++};
        const np=this.spawn(single,w.x,w.y,ang);
        const rx=w.x-p.body.position.x,ry=w.y-p.body.position.y;
        Body.setVelocity(np.body,{x:vel.x-ry*av,y:vel.y+rx*av});
        Body.setAngularVelocity(np.body,(Math.random()-.5)*.15);this.wake(np.body);
        if(c.stone){np.cells[0].stone=true;Body.setStatic(np.body,true);}
        if(c.frozen&&!c.stone)np.cells[0].frozen=true;
      }
    }
    this.burst(250,250,'#c9d8c0',20);this.tone(240,.4,'sawtooth',.05);
  }
  // Force barrier: hard-ejects anything inside, keeps newcomers away while active.
  enforceBarrier(z:{x:number;y:number;r:number}){
    for(const p of this.pieces){
      if(p.body.isStatic)continue;
      let dx=p.body.position.x-z.x,dy=p.body.position.y-z.y,d=Math.hypot(dx,dy);
      if(d<1){const a=Math.random()*Math.PI*2;dx=Math.cos(a);dy=Math.sin(a);d=1;}
      if(d<z.r){this.wake(p.body);Body.setPosition(p.body,{x:z.x+dx/d*(z.r+7),y:z.y+dy/d*(z.r+7)});Body.setVelocity(p.body,{x:dx/d*9,y:dy/d*9});}
      else if(d<z.r+34){this.wake(p.body);Body.applyForce(p.body,p.body.position,{x:dx/d*(z.r+34-d)*.00035*p.body.mass,y:dy/d*(z.r+34-d)*.00035*p.body.mass});}
    }
  }
  // Anti-overstack: at most 2 block layers per spot (a "spot" = within half a cell).
  spotCount(x:number,y:number,exclude:Piece){
    let n=0;
    for(const p of this.pieces){
      if(p===exclude||p===this.dragged||p.body.isStatic)continue;
      for(const c of p.cells){const w=this.worldCell(p,c);if(Math.abs(w.x-x)<23&&Math.abs(w.y-y)<23)n++;}
    }
    return n;
  }
  layerViolation(p:Piece){
    for(const c of p.cells){const w=this.worldCell(p,c);if(this.spotCount(w.x,w.y,p)>=2)return{x:w.x,y:w.y};}
    return null;
  }
  freeTarget(x:number,y:number,exclude:Piece){
    let best:{x:number;y:number;d:number}|null=null;
    for(let row=0;row<10;row++)for(let col=0;col<10;col++){
      const cx=43+col*46,cy=43+row*46;
      if(this.spotCount(cx,cy,exclude)>=2)continue;
      const d=Math.hypot(cx-x,cy-y);
      if(!best||d<best.d)best={x:cx,y:cy,d};
    }
    return best;
  }
  // Called after a placement: if the piece would sit on a 3rd layer, gently slide it to free space.
  checkOverstack(p:Piece){
    if(this.dying||this.over)return;
    const v=this.layerViolation(p);if(!v)return;
    const t=this.freeTarget(v.x,v.y,p);if(!t)return;
    if(!this.nudge)this.nudge={p,tx:t.x,ty:t.y,t:2.5,tries:0};
    this.wake(p.body);this.tone(160,.12,'triangle',.03);
  }
  togglePause(){if(this.over||this.dying)return;this.release(true);this.paused=!this.paused;this.emit();}
  toggleSound(){this.sound=!this.sound;try{localStorage.setItem('1010-sound',this.sound?'on':'off');}catch{}if(this.sound){this.wakeAudio();this.tone();}return this.sound;}
  petrify(x:number,y:number,r:number){
    for(const p of this.pieces){
      let touched=false;
      for(const c of p.cells){const w=this.worldCell(p,c);if(Math.hypot(w.x-x,w.y-y)<r){c.stone=true;c.color=STONE_COLOR;c.burn=0;touched=true;}}
      // Whole piece turns to stone: static body, immune to every impulse and event.
      if(touched&&!p.body.isStatic)Body.setStatic(p.body,true);
    }
    this.rings.push({x,y,radius:r*1.6,life:1,color:'#b9c4bb'});this.tone(90,.4,'sawtooth',.05);
  }
  infect(x:number,y:number,r:number){
    const kinds:Special[]=['bomb','oil','magnet'];
    // The whole area catches ONE random status, not a mix per cell.
    const kind=kinds[Math.floor(Math.random()*kinds.length)];
    for(const p of this.pieces)for(const c of p.cells){const w=this.worldCell(p,c);if(Math.hypot(w.x-x,w.y-y)<r){c.special=kind;c.infected=true;}}
    this.rings.push({x,y,radius:r*1.5,life:1,color:'#a9e07e'});this.tone(520,.3,'triangle');
  }
  startFire(x:number,y:number,r:number,life:number){
    if(this.fires.length>=8)return;
    this.fires.push({x,y,r,life});
    this.rings.push({x,y,radius:r*1.4,life:.9,color:'#ffab5e'});this.tone(210,.35,'sawtooth',.05);
  }
  // Shots and blasts that touch an oil slick set the whole area on fire —
  // unless ice covers the slick, which keeps it safely cold and slippery.
  underIce(x:number,y:number){return this.ices.some(s=>Math.hypot(s.x-x,s.y-y)<s.r*.92);}
  igniteOil(o:{x:number;y:number;r:number;life:number;burning?:boolean}){
    if(o.burning||this.underIce(o.x,o.y))return;
    o.burning=true;
    this.startFire(o.x,o.y,Math.min(70,o.r*.55),3.5);
    this.rings.push({x:o.x,y:o.y,radius:o.r*1.2,life:1,color:'#ff9a4e'});
  }
  // Ice bomb: covers a small area with a slippery frozen patch; blocks inside freeze once.
  iceBomb(x:number,y:number){
    this.ices.push({x,y,r:142,life:14});
    for(const p of this.pieces)for(const c of p.cells){
      if(c.stone||c.frozen)continue;
      const w=this.worldCell(p,c);
      if(Math.hypot(w.x-x,w.y-y)<142){c.frozen=true;c.burn=0;}
    }
    // Fire under the new ice goes out; oil can no longer be lit while iced.
    for(const o of this.oils)if(Math.hypot(o.x-x,o.y-y)<142+o.r*.4)o.burning=false;
    this.fires=this.fires.filter(f=>Math.hypot(f.x-x,f.y-y)>142);
    this.burst(x,y,'#dff6ff',14);this.rings.push({x,y,radius:215,life:.9,color:'#a5eaff'});this.tone(320,.3,'sine',.05);
  }
  // The ice event freezes everything on the field and snuffs out every fire.
  freezeEverything(){
    for(const p of this.pieces)for(const c of p.cells){if(c.stone)continue;c.frozen=true;c.burn=0;}
    this.fires=[];
    for(const o of this.oils)o.burning=false;
  }
  // Frozen blocks shatter when the player drops another shape onto them.
  shatterUnder(p:Piece){
    if(this.dying||this.over)return;
    const pts=p.cells.map(c=>this.worldCell(p,c));
    const victims=new Set<Cell>();
    for(const q of this.pieces){
      if(q===p)continue;
      for(const c of q.cells){
        if(!c.frozen||c.stone)continue;
        const w=this.worldCell(q,c);
        if(pts.some(v=>Math.hypot(w.x-v.x,w.y-v.y)<46))victims.add(c);
      }
    }
    if(!victims.size)return;
    for(const c of victims){const q=this.pieces.find(x=>x.cells.includes(c));if(q){const w=this.worldCell(q,c);this.burst(w.x,w.y,'#dff6ff',6);}}
    this.destroyCells((_,__,_q,c)=>victims.has(c));
    this.tone(950,.14,'triangle',.05);
  }
  // One hammer blow of the shockwave event.
  pulseHit(vmax:number){
    this.pieces.forEach(p=>{
      if(p.body.isStatic)return;
      this.wake(p.body);
      let dx=p.body.position.x-250,dy=p.body.position.y-250,d=Math.hypot(dx,dy);
      if(d<1){const a=Math.random()*Math.PI*2;dx=Math.cos(a);dy=Math.sin(a);d=1;}
      const v=vmax+Math.random()*5;
      Body.setVelocity(p.body,{x:dx/d*v,y:dy/d*v});
      Body.setAngularVelocity(p.body,(Math.random()-.5)*.3);
    });
    this.rings.push({x:250,y:250,radius:480,life:.9,color:'#7cdec6'});
    this.tone(80,.35,'sawtooth',.055);
  }
  spawnBomber(){
    const base=smallBases[Math.floor(Math.random()*smallBases.length)];
    const shape:Shape={cells:base.map(c=>[...c]),color:COLORS[Math.floor(Math.random()*COLORS.length)],special:null,id:nextId++};
    // Spawn just below the top wall (accounting for the shape's half-height) so nothing clips into it.
    const hCells=Math.max(...base.map(c=>c[1]))+1;
    const p=this.spawn(shape,60+Math.random()*380,26+hCells*23,(-.5+Math.random())*.4);
    Body.setVelocity(p.body,{x:(Math.random()-.5)*3,y:9+Math.random()*3});
    Body.setAngularVelocity(p.body,(Math.random()-.5)*.1);
  }
  gameOver(){
    // Soft defeat: no harsh sound — the counter counts up for ~2.5s while the
    // board blurs out (dieProgress), then the restart menu fades in (over=true).
    if(this.dying||this.over)return;
    this.dying=true;this.overAt=this.elapsed+2.5;
    this.release(true);this.dragged=null;this.dragSlot=-1;this.nudge=null;
    this.emit();
  }
  update(dt:number){
    this.elapsed+=dt;
    if(this.over)return;
    // The soft-defeat window ends: freeze the board and show the restart menu.
    if(this.dying&&this.elapsed>=this.overAt){this.dying=false;this.over=true;this.paused=true;this.slots=[null,null,null];this.emit();}
    if(this.weaponExpiry&&this.elapsed>this.weaponExpiry){this.ammo=[0,0,0,0];this.weapon=-1;this.weaponExpiry=0;}
    // The 20s countdown never stops — area events no longer freeze it. When it
    // runs out the pre-picked event fires: into slot 1, or alongside (slot 2)
    // if another event is still running.
    if(!this.dying&&this.pendingEvent&&this.elapsed>=this.nextEvent){
      const kind=this.pendingEvent;
      this.pendingEvent=EVENTS[Math.floor(Math.random()*EVENTS.length)];
      this.nextEvent=this.elapsed+EVENT_SPACING;
      if(!this.event)this.startEvent(kind,1);else this.startEvent(kind,2);
    }
    this.engine.gravity.x=0;this.engine.gravity.y=0;
    const kinds=new Set<EventKind>();if(this.event)kinds.add(this.event);if(this.event2)kinds.add(this.event2);
    const zOf=(k:EventKind)=>this.event===k?this.zone:this.event2===k?this.zone2:null;
    if(kinds.size&&!this.dying){
      // Growth is goal-driven (15 placed shapes), everything else runs on its timer.
      if(this.event&&this.event!=='growth')this.eventLeft-=dt;
      if(this.event2&&this.event2!=='growth')this.event2Left-=dt;
      if(kinds.has('rotate')){const main=this.event==='rotate';const left=main?this.eventLeft:this.event2Left,total=main?this.eventTotal:this.event2Total;const t=Math.min(1,1-left/total),e=t*t*(3-2*t);this.viewAngle=this.rotationStart+(this.rotationTarget-this.rotationStart)*e;this.engine.gravity.x=Math.sin(this.viewAngle)*.45;this.engine.gravity.y=Math.cos(this.viewAngle)*.45;}
      if(kinds.has('shake')){this.engine.gravity.x=Math.sin(this.elapsed*30)*2.1;this.engine.gravity.y=Math.cos(this.elapsed*24)*2.1;}
      if(kinds.has('gravity')){const g=GRAV_DIRS[this.gravityDir];this.engine.gravity.x=g[0]*1.15;this.engine.gravity.y=g[1]*1.15;}
      if(kinds.has('vortex'))this.pieces.forEach(p=>{if(p.body.isStatic)return;this.wake(p.body);const dx=250-p.body.position.x,dy=250-p.body.position.y;Body.applyForce(p.body,p.body.position,{x:(dx-dy)*.000012*p.body.mass,y:(dy+dx)*.000012*p.body.mass});});
      if(kinds.has('bombard')){this.bombardTick-=dt;if(this.bombardTick<=0){this.bombardTick=.65+Math.random()*.5;this.spawnBomber();}}
      if(kinds.has('barrier')&&zOf('barrier'))this.enforceBarrier(zOf('barrier')!);
      if(kinds.has('pulse')&&this.pulsePushes>0){this.pulseTick-=dt;if(this.pulseTick<=0){this.pulseHit(18+Math.random()*8);this.pulsePushes--;this.pulseTick=.85;}}
      if(this.event&&this.event!=='growth'&&this.eventLeft<=0)this.endEvent(1);
      if(this.event2&&this.event2!=='growth'&&this.event2Left<=0)this.endEvent(2);
    }
    // Chain lightning: one strike every 0.3s destroys the nearest block to the last one.
    if(this.chainLeft>0&&this.chainFrom){
      this.chainTick-=dt;
      if(this.chainTick<=0){
        const from=this.chainFrom;
        let best:{p:Piece;c:Cell;d:number;wx:number;wy:number}|null=null;
        for(const p of this.pieces){
          if(p===this.dragged)continue;
          for(const c of p.cells){
            if(c.stone)continue;
            const w=this.worldCell(p,c);const d2=Math.hypot(w.x-from.x,w.y-from.y);
            if(d2<130&&d2>2&&(!best||d2<best.d))best={p,c,d:d2,wx:w.x,wy:w.y};
          }
        }
        if(!best){this.chainLeft=0;this.chainFrom=null;}
        else{
          const wasChain=best.c.special==='chain';
          this.destroyCells((_,__,p,c)=>p===best!.p&&c===best!.c);
          this.bolts.push({x1:from.x,y1:from.y,x2:best.wx,y2:best.wy,life:.25});
          this.burst(best.wx,best.wy,'#ffe98a',8);this.tone(1300,.08,'square',.03);
          if(!wasChain){
            this.chainLeft--;
            if(this.chainLeft<=0){this.chainFrom=null;}
            else{this.chainFrom={x:best.wx,y:best.wy};this.chainTick=.3;}
          }
          // A struck chain cell starts its own continuation via its destroy hook.
        }
      }
    }
    this.bolts.forEach(b=>b.life-=dt);this.bolts=this.bolts.filter(b=>b.life>0);
    // Anti-overstack: gently slide a just-placed 3rd-layer piece toward free space.
    if(this.nudge){
      const n=this.nudge,p=n.p;
      if(!this.pieces.includes(p)){this.nudge=null;}
      else{
        const b=p.body;const dx=n.tx-b.position.x,dy=n.ty-b.position.y;const d=Math.hypot(dx,dy);
        n.t-=dt;
        if(d<16||n.t<=0){
          const v=this.layerViolation(p);
          if(v&&n.tries<2){const t2=this.freeTarget(v.x,v.y,p);if(t2){n.tx=t2.x;n.ty=t2.y;n.t=2.5;n.tries++;}else this.nudge=null;}
          else this.nudge=null;
        }else{
          this.wake(b);
          Body.applyForce(b,b.position,{x:Math.max(-.09,Math.min(.09,dx*.00034-b.velocity.x*b.mass*.00018)),y:Math.max(-.09,Math.min(.09,dy*.00034-b.velocity.y*b.mass*.00018))});
        }
      }
    }
    // Continuous anti-overstack sweep: physics (blasts, decay, bombard) can still
    // cram a 3rd layer onto a spot — the offending piece slides off and shoves
    // whatever it catches on the way.
    this.settleTick+=dt;
    if(this.settleTick>.3&&!this.dying){
      this.settleTick=0;
      for(const p of this.pieces){
        if(p===this.dragged||p.body.isStatic)continue;
        if(this.nudge&&this.nudge.p===p)continue;
        const v=this.layerViolation(p);
        if(!v)continue;
        const t=this.freeTarget(v.x,v.y,p);
        if(!t)continue;
        this.wake(p.body);
        const dx=t.x-p.body.position.x,dy=t.y-p.body.position.y,d=Math.hypot(dx,dy)||1;
        Body.setVelocity(p.body,{x:p.body.velocity.x+dx/d*4.2,y:p.body.velocity.y+dy/d*4.2});
        this.tone(140,.09,'triangle',.02);
        break; // one slide per sweep keeps it calm and observable
      }
    }
    // Any nonzero gravity (rotate/shake/gravity events) means the pile must fall, not sleep.
    if(this.engine.gravity.x!==0||this.engine.gravity.y!==0)this.wakeAll();
    const iceOn=kinds.has('ice');
    for(const p of [...this.pieces]){
      const oil=this.oils.find(o=>Math.hypot(p.body.position.x-o.x,p.body.position.y-o.y)<o.r);
      const slick=!oil&&this.ices.find(s=>Math.hypot(p.body.position.x-s.x,p.body.position.y-s.y)<s.r);
      p.body.frictionAir=iceOn?.002:oil?(p.body.speed<1.1?.13:.009):slick?.008:.045;p.body.friction=oil?.65:iceOn?.001:slick?.02:.12;
      // Thrown bombs fuse and detonate at the bomb cell.
      if(p.activated&&this.elapsed>p.born&&p!==this.dragged){const bc=p.cells.find(c=>c.special==='bomb');if(bc){const w=this.worldCell(p,bc);bc.special=null;this.explode(w.x,w.y,105);continue;}}
      // Any magnet cell (built-in or infected) passively attracts nearby pieces.
      if(p.cells.some(c=>c.special==='magnet')){for(const other of this.pieces){if(other===p||other.body.isStatic)continue;const dx=p.body.position.x-other.body.position.x,dy=p.body.position.y-other.body.position.y,d=Math.hypot(dx,dy);if(d>25&&d<210){this.wake(other.body);Body.applyForce(other.body,other.body.position,{x:dx/d*.0006*other.body.mass,y:dy/d*.0006*other.body.mass});}}}
      // Keep fast throws within the arena even under extreme impulses.
      if(!p.body.isStatic&&(p.body.position.x < -20 || p.body.position.x > 520 || p.body.position.y < -20 || p.body.position.y > 520)){Body.setPosition(p.body,{x:Math.max(65,Math.min(435,p.body.position.x)),y:Math.max(65,Math.min(435,p.body.position.y))});Body.setVelocity(p.body,{x:0,y:0});this.wake(p.body);}
    }
    if(this.dragged){const p=this.dragged,b=p.body;this.wake(b);const target={x:Math.max(38,Math.min(462,this.pointer.x-this.dragOffset.x)),y:Math.max(38,Math.min(462,this.pointer.y-this.dragOffset.y))};const dx=target.x-b.position.x,dy=target.y-b.position.y;const fx=dx*.00032-b.velocity.x*b.mass*.00018,fy=dy*.00032-b.velocity.y*b.mass*.00018;Body.applyForce(b,b.position,{x:Math.max(-.08,Math.min(.08,fx)),y:Math.max(-.08,Math.min(.08,fy))});}
    Engine.update(this.engine,1000/60);
    this.lineTick+=dt;if(this.lineTick>.3){this.lineTick=0;this.checkLines();}
    this.burnTick+=dt;if(this.burnTick>.3){this.burnTick=0;this.destroyCells((_,__,___,c)=>!!c.burn&&this.elapsed>c.burn);}
    // Fire zones burn out, ignite everything inside them (burning oil slicks ignite too) and pop embers.
    const sources:Array<{x:number;y:number;r:number}>=[];
    for(const f of this.fires){f.life-=dt;sources.push(f);if(Math.random()<dt*5)this.burst(f.x+(Math.random()-.5)*f.r*.8,f.y+(Math.random()-.5)*f.r*.8,'#ffb35c',2);}
    for(const o of this.oils)if(o.burning)sources.push(o);
    if(sources.length)for(const p of this.pieces)for(const c of p.cells){
      if(c.stone||(c.burn&&c.burn>this.elapsed))continue;
      const w=this.worldCell(p,c);
      for(const s of sources)if(Math.hypot(w.x-s.x,w.y-s.y)<s.r){c.burn=this.elapsed+2.4+Math.random()*.9;break;}
    }
    this.fires=this.fires.filter(f=>f.life>0);
    // Compact particles in place: no per-frame allocations, no filter/slice garbage for the GC.
    let keep=0;for(let i=0;i<this.particles.length;i++){const p=this.particles[i];p.life-=dt;if(p.life<=0)continue;p.x+=p.vx*dt*60;p.y+=p.vy*dt*60;p.vx*=.96;p.vy*=.96;this.particles[keep++]=p;}this.particles.length=keep;
    if(this.particles.length>PARTICLE_CAP)this.particles.splice(0,this.particles.length-PARTICLE_CAP);
    this.rings.forEach(r=>r.life-=dt);this.rings=this.rings.filter(r=>r.life>0);
    for(const o of this.oils){o.life-=dt;for(const f of this.fires)if(Math.hypot(o.x-f.x,o.y-f.y)<f.r+o.r*.5&&!this.underIce(o.x,o.y))o.burning=true;}
    this.oils=this.oils.filter(o=>o.life>0);
    // Ice patches melt away on their own.
    for(const s of this.ices)s.life-=dt;
    this.ices=this.ices.filter(s=>s.life>0);
    // A shot crossing an oil slick sets it alight mid-flight.
    for(const pr of this.projectiles){pr.life-=dt;pr.x+=(pr.tx-pr.x)*dt*12;pr.y+=(pr.ty-pr.y)*dt*12;const slick=this.oils.find(o=>!o.burning&&Math.hypot(o.x-pr.x,o.y-pr.y)<o.r*.85);if(slick)this.igniteOil(slick);if(pr.life<=0)this.explode(pr.tx,pr.ty,115);}this.projectiles=this.projectiles.filter(p=>p.life>0);
    // Overflow of blocks ends the game — but only after a grace window so that
    // line clears triggered by the same placement get a fair chance to save it.
    let cells=0;for(const p of this.pieces)cells+=p.cells.length;this.cells=cells;
    if(!this.dying&&!this.over){
      if(cells>100){
        if(!this.overPending)this.overPending=this.elapsed+0.3;
        if(this.elapsed>=this.overPending)this.gameOver();
      }else this.overPending=0;
    }
    // Cleared a line during the defeat animation? The player is saved.
    if(this.dying&&cells<=100){this.dying=false;this.overPending=0;this.emit();}
  }
  loop=(time:number)=>{
    const dt=this.last?Math.min((time-this.last)/1000,.05):1/60;this.last=time;
    if(!this.paused){
      this.accumulator+=dt;
      while(this.accumulator>=1/60&&!this.paused){this.update(1/60);this.accumulator-=1/60;}
      // Physics runs at a fixed 60Hz, so painting at 120Hz (Poco/Xiaomi screens) only doubles GPU work.
      if(time-this.lastDraw>=14){this.draw();this.lastDraw=time;}
      this.uiTick+=dt;if(this.uiTick>.09){this.emit();this.uiTick=0;}
    }else{
      this.accumulator=0;
      // Board is frozen while paused: paint once, then idle.
      if(!this.pauseDrawn){this.draw();this.pauseDrawn=true;}
    }
    this.frame=requestAnimationFrame(this.loop);
  };
  draw(){
    const ctx=this.ctx;ctx.clearRect(0,0,500,500);ctx.save();
    rounded(ctx,17,17,466,466,9);ctx.clip();
    ctx.fillStyle=THEME_LOOK[this.themeKey].board;ctx.fillRect(0,0,500,500);
    const kinds=new Set<EventKind>();if(this.event)kinds.add(this.event);if(this.event2)kinds.add(this.event2);
    ctx.translate(250,250);if(kinds.has('shake'))ctx.translate(Math.sin(this.elapsed*44)*2,Math.cos(this.elapsed*37)*2);ctx.rotate(this.viewAngle);ctx.translate(-250,-250);
    // Board grid is prebuilt once and blitted — saves ~300 path ops per frame.
    if(this.gridLayer)ctx.drawImage(this.gridLayer,0,0,SIZE,SIZE);
    if(kinds.has('ice')){const g=ctx.createRadialGradient(250,250,40,250,250,340);g.addColorStop(0,'#8cd9ec08');g.addColorStop(1,'#8cd9ec66');ctx.fillStyle=g;ctx.fillRect(15,15,470,470);ctx.strokeStyle='#a5eaff55';ctx.lineWidth=1;for(let i=0;i<9;i++){ctx.beginPath();ctx.moveTo(25+i*60,20);ctx.lineTo(70+i*30,130);ctx.lineTo(50+i*50,225);ctx.stroke();}}
    for(const oil of this.oils){ctx.save();ctx.globalAlpha=Math.min(1,oil.life);const g=ctx.createRadialGradient(oil.x,oil.y,10,oil.x,oil.y,oil.r);g.addColorStop(0,'#0c121ed9');g.addColorStop(.65,'#201e3877');g.addColorStop(.87,'#6e819f33');g.addColorStop(1,'#9c83ba00');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(oil.x,oil.y,oil.r,oil.r*.8,.3,0,7);ctx.fill();if(oil.burning){ctx.globalAlpha=Math.min(1,oil.life)*(.5+.3*Math.sin(this.elapsed*21+oil.x));const fg=ctx.createRadialGradient(oil.x,oil.y,4,oil.x,oil.y,oil.r);fg.addColorStop(0,'#ffbe6280');fg.addColorStop(1,'#ff6a1e00');ctx.fillStyle=fg;ctx.beginPath();ctx.ellipse(oil.x,oil.y,oil.r,oil.r*.8,.3,0,7);ctx.fill();}ctx.restore();}
    for(const f of this.fires){ctx.save();ctx.globalAlpha=Math.min(.85,f.life*.4)*(.6+.25*Math.sin(this.elapsed*15+f.x*.1));const g=ctx.createRadialGradient(f.x,f.y,6,f.x,f.y,f.r);g.addColorStop(0,'#ffc06a66');g.addColorStop(.55,'#ff7b2455');g.addColorStop(1,'#ff5a1e00');ctx.fillStyle=g;ctx.beginPath();ctx.arc(f.x,f.y,f.r,0,7);ctx.fill();ctx.restore();}
    // Frozen patches: pale cyan gloss with frost cracks.
    for(const s of this.ices){ctx.save();ctx.globalAlpha=Math.min(1,s.life)*.55;const g=ctx.createRadialGradient(s.x,s.y,8,s.x,s.y,s.r);g.addColorStop(0,'#bdf0ff55');g.addColorStop(.7,'#8fdcff30');g.addColorStop(1,'#8fdcff00');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(s.x,s.y,s.r,s.r*.86,.2,0,7);ctx.fill();ctx.strokeStyle='#ffffff35';ctx.lineWidth=1;for(let i=0;i<5;i++){const a=i*1.27+s.x*.05;ctx.beginPath();ctx.moveTo(s.x+Math.cos(a)*s.r*.18,s.y+Math.sin(a)*s.r*.18);ctx.lineTo(s.x+Math.cos(a+.4)*s.r*.72,s.y+Math.sin(a+.4)*s.r*.72);ctx.stroke();}ctx.restore();}
    // Zone markers for every active zone event (both slots).
    const zoneEvents:Array<{k:EventKind;z:{x:number;y:number;r:number}}>=[];
    if(this.event&&this.zone)zoneEvents.push({k:this.event,z:this.zone});
    if(this.event2&&this.zone2)zoneEvents.push({k:this.event2,z:this.zone2});
    for(const {k,z} of zoneEvents){
      if(k==='zone'||k==='stone'||k==='infest'){const col=k==='zone'?'#f08069':k==='stone'?'#b9c4bb':'#b9e087';ctx.save();ctx.globalAlpha=.25+Math.sin(this.elapsed*10)*.1;ctx.fillStyle=col;ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,7);ctx.fill();ctx.restore();ctx.strokeStyle=col;ctx.setLineDash([7,6]);ctx.lineWidth=2;ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,7);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(z.x-12,z.y);ctx.lineTo(z.x+12,z.y);ctx.moveTo(z.x,z.y-12);ctx.lineTo(z.x,z.y+12);ctx.stroke();}
      else if(k==='bloom'||k==='barrier'){const col=k==='bloom'?'#a5e087':'#7fd8c8';ctx.save();ctx.globalAlpha=.22+.08*Math.sin(this.elapsed*9);ctx.fillStyle=col;ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,7);ctx.fill();ctx.restore();ctx.strokeStyle=col;ctx.lineWidth=2;ctx.setLineDash([9,7]);ctx.lineDashOffset=k==='barrier'?-this.elapsed*46:0;ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,7);ctx.stroke();ctx.setLineDash([]);if(k==='bloom'){for(let i=0;i<3;i++){ctx.globalAlpha=.5;ctx.beginPath();ctx.arc(z.x,z.y,z.r*.3+((this.elapsed*26+i*z.r*.4)%z.r*.85),0,7);ctx.strokeStyle=col+'77';ctx.stroke();}ctx.globalAlpha=1;}}
    }
    if(kinds.has('vortex')||kinds.has('pulse')){ctx.strokeStyle='#8dcfbc44';ctx.lineWidth=2;for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(250,250,30+((this.elapsed*50+i*50)%200),this.elapsed+i,this.elapsed+i+Math.PI*1.4);ctx.stroke();}}
    if(kinds.has('gravity')){const g=GRAV_DIRS[this.gravityDir];ctx.fillStyle='#8dcfbc';for(let i=0;i<2;i++){const off=(this.elapsed*70+i*30)%60;ctx.globalAlpha=.45-off*.006;ctx.save();ctx.translate(250+g[0]*(185+off),250+g[1]*(185+off));ctx.rotate(Math.atan2(g[1],g[0])-Math.PI/2);ctx.beginPath();ctx.moveTo(0,13);ctx.lineTo(-10,-6);ctx.lineTo(10,-6);ctx.closePath();ctx.fill();ctx.restore();}ctx.globalAlpha=1;}
    const list=this.drawList;list.length=0;
    for(const p of this.pieces)if(p!==this.dragged)list.push(p);
    if(this.dragged)list.push(this.dragged);
    for(const p of list){
      if(p.cells.some(c=>c.special==='magnet')){ctx.strokeStyle='#ab96d455';ctx.lineWidth=1.5;const {x,y}=p.body.position;for(let i=0;i<2;i++){ctx.beginPath();ctx.arc(x,y,40+(this.elapsed*30+i*55)%115,0,7);ctx.stroke();}}
      // Soft glow instead of per-block shadowBlur (canvas shadows are the #1 mobile canvas killer).
      if(p===this.dragged){const {x,y}=p.body.position;const g=ctx.createRadialGradient(x,y,8,x,y,55);g.addColorStop(0,'#83dfb766');g.addColorStop(1,'#83dfb700');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,55,0,7);ctx.fill();}
      ctx.save();ctx.translate(p.body.position.x,p.body.position.y);ctx.rotate(p.body.angle);
      for(const c of p.cells){const spr=this.sprites.get(c.color+'|'+(c.stone?'stone':c.special));if(spr)ctx.drawImage(spr,c.x-this.spriteHalf,c.y-this.spriteHalf,this.spriteLogical,this.spriteLogical);else drawBlock(ctx,c.x,c.y,c.color,c.stone?'stone':c.special);
        // Burning cells flicker orange until they burn out.
        if(c.burn&&c.burn>this.elapsed){ctx.globalAlpha=.3+.28*Math.sin(this.elapsed*29+c.gx*2.7+c.gy*4.1);ctx.fillStyle='#ff8c2e';rounded(ctx,c.x-20.5,c.y-20.5,41,41,6);ctx.fill();ctx.globalAlpha=1;}
        // Frozen cells wear a cyan coat with a white sheen.
        if(c.frozen&&!c.stone){ctx.globalAlpha=.38;ctx.fillStyle='#bdeeff';rounded(ctx,c.x-20.5,c.y-20.5,41,41,6);ctx.fill();ctx.globalAlpha=.85;ctx.strokeStyle='#eaffff';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(c.x-11,c.y+10);ctx.lineTo(c.x+11,c.y-10);ctx.stroke();ctx.globalAlpha=1;}}
      if(p.special==='bomb'&&p.activated){ctx.globalAlpha=.4+.3*Math.sin(this.elapsed*35);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(p.cells[0].x,p.cells[0].y,13,0,7);ctx.fill();ctx.globalAlpha=1;}
      ctx.restore();
    }
    if(this.dragged){ctx.beginPath();ctx.moveTo(this.dragged.body.position.x,this.dragged.body.position.y);ctx.lineTo(this.pointer.x,this.pointer.y);ctx.strokeStyle='#d9f6e660';ctx.setLineDash([3,5]);ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(this.pointer.x,this.pointer.y,5,0,7);ctx.stroke();}
    for(const p of this.particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);}ctx.globalAlpha=1;
    for(const r of this.rings){ctx.strokeStyle=r.color;ctx.lineWidth=2+r.life*3;ctx.globalAlpha=Math.min(1,r.life);ctx.beginPath();ctx.arc(r.x,r.y,Math.max(1,r.radius*(1-r.life*.75)),0,7);ctx.stroke();}ctx.globalAlpha=1;
    // Chain lightning: jagged bright segments fading fast.
    for(const b of this.bolts){
      ctx.globalAlpha=Math.max(0,Math.min(1,b.life*4));ctx.strokeStyle='#ffe98a';ctx.lineWidth=2.2;
      const dx=b.x2-b.x1,dy=b.y2-b.y1;const len=Math.hypot(dx,dy)||1;const px=-dy/len,py=dx/len;
      ctx.beginPath();ctx.moveTo(b.x1,b.y1);
      for(const t of [.25,.5,.75]){const off=6*Math.sin(t*17+b.x1*3+b.y1);ctx.lineTo(b.x1+dx*t+px*off,b.y1+dy*t+py*off);}
      ctx.lineTo(b.x2,b.y2);ctx.stroke();
      ctx.strokeStyle='#ffffffcc';ctx.lineWidth=1;ctx.stroke();
    }ctx.globalAlpha=1;
    for(const p of this.projectiles){ctx.shadowBlur=15;ctx.shadowColor='#ffc592';ctx.fillStyle='#e9d8be';ctx.beginPath();ctx.arc(p.x,p.y,12,0,7);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#424440';ctx.beginPath();ctx.arc(p.x-2,p.y-3,8,0,7);ctx.fill();}
    // Floating slot-piece preview: hovers above the pile (with a drop shadow) until released over the board.
    if(this.dragSlot>=0&&!this.dragged&&this.isInside(this.screenPointerX,this.screenPointerY)){
      const shape=this.slots[this.dragSlot];
      if(shape){
        const dx=Math.sin(this.viewAngle),dy=Math.cos(this.viewAngle);
        const mx=shape.cells.reduce((s,c)=>s+c[0],0)/shape.cells.length,my=shape.cells.reduce((s,c)=>s+c[1],0)/shape.cells.length;
        // Counter-rotate the ghost exactly like the landing piece: it keeps its tray look.
        const snap=-Math.round(this.viewAngle/(Math.PI/2))*(Math.PI/2),co=Math.cos(snap),si=Math.sin(snap);
        // Per-cell soft shadow under the ghost (one big ellipse looked like a halo under bars).
        ctx.globalAlpha=.18;ctx.fillStyle='#000000';
        for(const [sx,sy] of shape.cells){
          const ox=(sx-mx)*STEP,oy=(sy-my)*STEP;
          ctx.beginPath();ctx.ellipse(this.pointer.x+ox*co-oy*si,this.pointer.y+ox*si+oy*co+5,22,15,0,0,7);ctx.fill();
        }
        ctx.globalAlpha=1;
        for(let i=0;i<shape.cells.length;i++){
          const [gx,gy]=shape.cells[i];
          const ox=(gx-mx)*STEP,oy=(gy-my)*STEP;
          const spr=this.sprites.get(shape.color+'|'+(i===0?shape.special:null));
          if(spr){ctx.globalAlpha=.93;ctx.drawImage(spr,this.pointer.x+ox*co-oy*si-dx*12-this.spriteHalf,this.pointer.y+ox*si+oy*co-dy*12-this.spriteHalf,this.spriteLogical,this.spriteLogical);}
        }
        ctx.globalAlpha=1;
      }
    }
    if(this.weapon>=0){ctx.strokeStyle='#a4e9cc';ctx.lineWidth=1.5;const {x,y}=this.pointer;ctx.beginPath();ctx.arc(x,y,[16,62,26,115][this.weapon],0,7);ctx.stroke();ctx.beginPath();ctx.moveTo(x-7,y);ctx.lineTo(x+7,y);ctx.moveTo(x,y-7);ctx.lineTo(x,y+7);ctx.stroke();}
    ctx.restore();
  }
  dispose(){cancelAnimationFrame(this.frame);this.ro?.disconnect();Composite.clear(this.engine.world,false);Engine.clear(this.engine);void this.audio?.close();}
}
