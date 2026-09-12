import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, VolumeX, Pause, Play, RotateCcw, Trophy, Crosshair, ScanLine, Zap, CircleDot, Snowflake, Droplets, Magnet, Bomb, Gift, Flame, Wind, RotateCw, Activity, Orbit, X, Boxes, ArrowUpRight, Shield, Settings2, Mountain, Biohazard, ChevronsDown, Expand, Waves, Sprout, Palette, Languages, Sparkles, Split } from 'lucide-react';
import { PhysicsGame, type Snapshot, type Shape, type EventKind } from './game';
import { STR, fmt, LOCALE, LANG_ORDER, LANG_LABEL, THEME_ORDER, type Lang, type ThemeKey } from './i18n';

const eventIcons: Record<EventKind, typeof Zap> = { rotate: RotateCw, ice: Snowflake, oil: Droplets, shake: Activity, zone: Crosshair, vortex: Wind, pulse: Orbit, stone: Mountain, infest: Biohazard, gravity: ChevronsDown, growth: Expand, fire: Flame, bombard: Bomb, bloom: Sprout, barrier: Shield, decay: Split };
const ALL_EVENTS = Object.keys(eventIcons) as EventKind[];
const weapons = [Crosshair, CircleDot, ScanLine, Bomb];
const specialIcons = [Bomb, Droplets, Magnet, Gift, Flame, Waves, Sparkles, Zap, Snowflake, Mountain];
// Mirrors the CSS html{zoom:1.25} rule: fixed-position lengths get multiplied by the
// ancestor zoom, so the pointer-following ghost must divide its client coords back.
const PAGE_ZOOM = typeof window!=='undefined' && window.matchMedia('(hover:hover) and (pointer:fine)').matches ? 1.25 : 1;
// Circular progress ring around an active-event icon (0..1).
const Ring = ({p}:{p:number}) => {
  const c=2*Math.PI*15.5,v=Math.max(0,Math.min(1,p));
  return <svg className="event-ring" viewBox="0 0 36 36" aria-hidden="true"><circle className="ring-bg" cx="18" cy="18" r="15.5"/><circle className="ring-fg" cx="18" cy="18" r="15.5" strokeDasharray={c.toFixed(2)} strokeDashoffset={(c*(1-v)).toFixed(2)}/></svg>;
};
const initial:Snapshot = { score:0,best:0,cells:0,slots:[],ammo:[3,0,0,0],weapon:-1,events:[],nextEvent:null,nextIn:0,paused:false,over:false,round:1,dying:false,dieProgress:0 };

// Memoized: the game emits snapshots ~11x/sec and previews would otherwise rebuild every time.
const ShapePreview = memo(function ShapePreview({shape,large=false}:{shape:Shape;large?:boolean}) {
  const w=Math.max(...shape.cells.map(c=>c[0]))+1,h=Math.max(...shape.cells.map(c=>c[1]))+1;
  const cell=large?34:Math.min(29,Math.floor(80/h),Math.floor(116/w));
  const Symbol=shape.special==='bomb'?Bomb:shape.special==='oil'?Droplets:shape.special==='magnet'?Magnet:shape.special==='fire'?Flame:shape.special==='loot'?Gift:shape.special==='shock'?Waves:shape.special==='surprise'?Sparkles:shape.special==='chain'?Zap:shape.special==='icebomb'?Snowflake:shape.special==='stonebomb'?Mountain:null;
  return <div className="shape-preview" style={{width:w*cell,height:h*cell+4}}>{shape.cells.map(([x,y],i)=><div key={i} className="preview-block" style={{left:x*cell,top:y*cell,width:cell-3,height:cell-3,'--block-color':shape.color} as React.CSSProperties}>{i===0&&Symbol&&<Symbol size={15} strokeWidth={2}/>}</div>)}</div>;
});

const loadLang=():Lang=>{try{const v=localStorage.getItem('1010-lang') as Lang;if(v&&LANG_ORDER.includes(v))return v;}catch{}return 'ru';};
const loadTheme=():ThemeKey=>{try{const v=localStorage.getItem('1010-theme') as ThemeKey;if(v&&THEME_ORDER.includes(v))return v;}catch{}return 'standard';};

export default function App(){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const game=useRef<PhysicsGame|null>(null);
  const [state,setState]=useState<Snapshot>(initial);
  const [sound,setSound]=useState(true);
  const [tab,setTab]=useState<'game'|'rules'|'events'>('game');
  const [confirmRestart,setConfirmRestart]=useState(false);
  const [ghost,setGhost]=useState<{shape:Shape;x:number;y:number;inside:boolean}|null>(null);
  const ghostRef=useRef<{shape:Shape;x:number;y:number;inside:boolean}|null>(null);
  const [fullscreen,setFullscreen]=useState(false);
  const [lang,setLang]=useState<Lang>(loadLang);
  const [theme,setTheme]=useState<ThemeKey>(loadTheme);
  const t=STR[lang];

  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('1010-theme',theme);}catch{}game.current?.setTheme(theme);},[theme]);
  useEffect(()=>{try{localStorage.setItem('1010-lang',lang);}catch{}},[lang]);
  const cycleTheme=()=>setTheme(cur=>THEME_ORDER[(THEME_ORDER.indexOf(cur)+1)%THEME_ORDER.length]);
  const cycleLang=()=>setLang(cur=>LANG_ORDER[(LANG_ORDER.indexOf(cur)+1)%LANG_ORDER.length]);

  useEffect(()=>{
    if(!canvasRef.current)return;
    const instance=new PhysicsGame(canvasRef.current,setState);game.current=instance;setSound(instance.sound);instance.setTheme(theme);
    const move=(e:PointerEvent)=>{instance.move(e.clientX,e.clientY);if(ghostRef.current){if(instance.dragSlot<0){ghostRef.current=null;setGhost(null);}else{const g={...ghostRef.current,x:e.clientX,y:e.clientY,inside:instance.isInside(e.clientX,e.clientY)};ghostRef.current=g;setGhost(g);}}};
    const up=(e:PointerEvent)=>{instance.release(false,e.clientX,e.clientY);ghostRef.current=null;setGhost(null);};
    const cancel=()=>{instance.release(true);ghostRef.current=null;setGhost(null);};
    const key=(e:KeyboardEvent)=>{if(e.code==='Space'||e.code==='Escape'){e.preventDefault();instance.togglePause();setTab('game');setConfirmRestart(false);ghostRef.current=null;setGhost(null);}if(['Digit1','Digit2','Digit3','Digit4'].includes(e.code))instance.selectWeapon(Number(e.code.slice(-1))-1);};
    const visibility=()=>{if(document.hidden&&!instance.paused&&!instance.over){instance.togglePause();setTab('game');ghostRef.current=null;setGhost(null);}};
    const fs=()=>setFullscreen(!!document.fullscreenElement);
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);document.addEventListener('fullscreenchange',fs);
    return()=>{instance.dispose();game.current=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('fullscreenchange',fs);};
  },[]);
  const pause=()=>{game.current?.togglePause();setTab('game');setConfirmRestart(false);setGhost(null);ghostRef.current=null;};
  const restart=()=>{game.current?.reset();setConfirmRestart(false);setTab('game');setGhost(null);ghostRef.current=null;};
  const askRestart=()=>{if(game.current&&!game.current.paused)game.current.togglePause();setConfirmRestart(true);setTab('game');};
  const toggleSound=()=>{const v=game.current?.toggleSound();if(v!==undefined)setSound(v);};
  const startDrag=(i:number,e:React.PointerEvent)=>{if(state.paused||!state.slots[i]||ghostRef.current)return;e.preventDefault();game.current?.beginSlot(i,e.clientX,e.clientY);const g={shape:state.slots[i]!,x:e.clientX,y:e.clientY,inside:false};ghostRef.current=g;setGhost(g);};
  const toggleFullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}};
  const num=(n:number)=>n.toLocaleString(LOCALE[lang]);
  const cellLevel=state.cells>85?'danger':state.cells>60?'warn':'ok';
  const modal=state.paused||state.over;
  // Soft defeat: the board blurs out while the block tablo itself swells up so the
  // player sees WHY the game ended — the number stays put.
  const blurStyle=state.dying?{filter:`blur(${(state.dieProgress*6).toFixed(1)}px)`,transition:'filter .35s linear'}:state.over?{filter:'blur(6px)'}:undefined;
  const numStyle=state.dying||state.over?{transform:`scale(${(1+state.dieProgress*.5).toFixed(3)})`}:{transform:'scale(1)'};
  // Countdown keeps ticking even while events run; live events show their own widgets.
  const NextIcon=state.nextEvent?eventIcons[state.nextEvent]:Zap;
  const nextAria=state.nextEvent?fmt(t.nextAria,{name:t.events[state.nextEvent].n,n:Math.ceil(state.nextIn)}):'';

  return <div className="app">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="site-header">
      <a className="brand" href="#" aria-label="1010 Physics" onClick={e=>e.preventDefault()}>
        <span className="brand-mark"><i/><i/><i/><i/></span>
        <span className="wordmark">1010<span className="wordmark-dot">.</span></span>
        <span className="brand-divider"/><span className="brand-edition">PHYSICS</span>
      </a>
      <div className="header-right">
        <span className="live-dot"><i/><span>{t.physicsTag}</span></span>
        <div className="header-controls">
          <button className={`icon-button ${!sound?'muted':''}`} onClick={toggleSound} aria-label={t.sound}>{sound?<Volume2/>:<VolumeX/>}</button>
          <button className={`icon-button ${modal?'is-active':''}`} onClick={pause} aria-label={modal?t.resume:t.pause}>{modal?<Play/>:<Pause/>}</button>
          <span className="control-divider"/>
          <button className="icon-button restart-button" onClick={askRestart} aria-label={t.restart}><RotateCcw/></button>
        </div>
      </div>
    </header>

    <main className="game-layout">
      <div className="scorebar">
        <div className="score-group">
          <div className="score-box"><span className="score-label">{t.score}</span><span className="score-number" key={Math.floor(state.score/100)}>{num(state.score)}</span></div>
          <div className="score-box best-box"><span className="score-label"><Trophy size={11}/> {t.best}</span><span className="score-number">{num(state.best)}</span></div>
        </div>
        <div className="micro-status">
          <div className={`event-row n${Math.min(3,1+state.events.length)}`}>
            <div className={`event-timer countdown ${state.events.length===0&&state.nextIn<=3?'soon':''}`} aria-label={nextAria}>
              <span className="event-timer-icon"><NextIcon size={20}/></span>
              <span className="event-timer-digits">{Math.ceil(state.nextIn)}<small>{t.secondsUnit}</small></span>
            </div>
            {state.events.map(ev=>{const Icon=eventIcons[ev.kind];return (
              <div className="event-timer event-live" key={ev.kind} aria-label={fmt(t.activeAria,{name:t.events[ev.kind].n})}>
                <span className="event-timer-icon"><Icon size={20}/><Ring p={ev.progress}/></span>
                <span className="event-timer-info"><strong>{t.events[ev.kind].n}</strong></span>
              </div>);})}
          </div>
        </div>
      </div>

      <div className="arena-section" style={blurStyle}>
        <aside className="arsenal" aria-label={t.weapons.join(', ')}>
          <div className="arsenal-top"><Crosshair size={13}/></div>
          {weapons.map((Icon,i)=><button key={i} className={`weapon-button weapon-${i} ${state.weapon===i?'selected':''} ${state.ammo[i]>0?'available':''}`} aria-label={fmt(t.weaponAria,{name:t.weapons[i],n:state.ammo[i]})} aria-pressed={state.weapon===i} disabled={!state.ammo[i]||modal} onClick={()=>game.current?.selectWeapon(i)}><Icon size={20}/><span className="weapon-level">{Array.from({length:i+1},(_,j)=><i key={j}/>)}</span>{state.ammo[i]>0&&<span className="ammo-dot">{state.ammo[i]}</span>}</button>)}
        </aside>
        <div className={`board-frame ${state.events[0]?'event-'+state.events[0].kind:''} ${state.weapon>=0?'aiming':''}`}>
          <span className="board-bolt bolt-tl"/><span className="board-bolt bolt-tr"/><span className="board-bolt bolt-bl"/><span className="board-bolt bolt-br"/>
          <canvas ref={canvasRef} className="game-canvas" onPointerDown={e=>{e.preventDefault();game.current?.boardDown(e.clientX,e.clientY);}} aria-label={t.boardAria}/>
          {state.events.map(ev=>{const Icon=eventIcons[ev.kind];return <div key={ev.kind} className="event-flash"><Icon size={58} strokeWidth={1.25}/></div>;})}
          {modal&&<div className="board-pause-veil"/>}
        </div>
      </div>

      <div className={`timer counter-${cellLevel}`} role="progressbar" aria-label={t.blocks} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.cells}>
        <Boxes size={13}/><div className="timer-track"><div className="timer-fill" style={{width:`${Math.min(100,state.cells)}%`}}><span/></div></div><span className="timer-value" style={numStyle}>{state.cells}<small>/100</small></span>
      </div>
      <div className="tray" aria-label={t.slot} style={blurStyle}>
        {[0,1,2].map(i=><div key={i} className={`shape-slot ${!state.slots[i]?'empty-slot':''} ${ghost?.shape.id===state.slots[i]?.id?'dragging-slot':''}`} onPointerDown={e=>startDrag(i,e)} role="button" tabIndex={modal?-1:0} aria-label={`${t.slot} ${i+1}`} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&state.slots[i]&&!modal){e.preventDefault();const r=canvasRef.current!.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;game.current?.beginSlot(i,cx,cy);game.current?.move(cx,cy);game.current?.release(false,cx,cy);}}}>
          {state.slots[i]?<div className="slot-shape" key={state.slots[i]!.id}><ShapePreview shape={state.slots[i]!}/></div>:<span className="slot-check"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="m6 12 4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>}
          <div className="slot-grip"><i/><i/><i/></div>
        </div>)}
      </div>
      <div className="bottom-decoration" aria-hidden="true"><span/><i/><span/></div>
    </main>

    {/* Fixed overlays live in a portal: acid/mono themes put a CSS filter on .app/body,
        and a filtered ancestor would become the containing block and shove them off-center. */}
    {ghost&&!ghost.inside&&!modal&&createPortal(<div className="drag-ghost" style={{left:ghost.x/PAGE_ZOOM,top:ghost.y/PAGE_ZOOM}}><ShapePreview shape={ghost.shape} large/></div>,document.body)}

    {modal&&createPortal(<div className={`modal-backdrop ${state.over?'slow':''}`} onClick={()=>{if(!state.over&&!confirmRestart)pause();}}>
      <section className="pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-heading" onClick={e=>e.stopPropagation()}>
        <div className="modal-head"><div className="modal-eyebrow"><span/>1010 PHYSICS</div>{!state.over&&<button className="icon-button" onClick={pause} aria-label={t.back}><X size={20}/></button>}</div>
        {confirmRestart&&!state.over?<>
          <div className="modal-title-row"><h1 id="pause-heading">{t.confirmTitle}</h1><span className="pause-emblem"><RotateCcw size={28}/></span></div>
          <p className="modal-intro">{t.confirmIntro}</p>
        </>:<h1 id="pause-heading" className="sr-only">{state.over?t.overTitle:t.pauseTitle}</h1>}
        <div className="modal-stats"><div><span>{t.score}</span><strong>{num(state.score)}</strong></div><div><span>{t.best}</span><strong>{num(state.best)}</strong></div><div><span>{t.round}</span><strong>{state.round.toString().padStart(2,'0')}</strong></div></div>
        {!state.over&&!confirmRestart&&<>
          <nav className="modal-tabs" aria-label={t.tabGame}>{(['game','rules','events'] as const).map(k=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{k==='game'?t.tabGame:k==='rules'?t.tabRules:t.tabEvents}</button>)}</nav>
          <div className="tab-content">
            {tab==='game'&&<>
              <button className="setting-row" onClick={toggleSound}><span><Volume2 size={18}/>{t.sound}</span><i className={`switch ${sound?'on':''}`} role="switch" aria-checked={sound} aria-label={t.sound}><b/></i></button>
              <button className="setting-row" onClick={toggleFullscreen}><span><ArrowUpRight size={18}/>{t.fullscreen}</span><span className="setting-value">{fullscreen?t.exitFs:t.openFs}<ArrowUpRight size={14}/></span></button>
              <button className="setting-row" onClick={cycleTheme}><span><Palette size={18}/>{t.themeLabel}</span><span className="setting-value">{t.themes[theme]}</span></button>
              <button className="setting-row" onClick={cycleLang}><span><Languages size={18}/>{t.languageLabel}</span><span className="setting-value">{LANG_LABEL[lang]}</span></button>
              {state.events.map(ev=>{const Icon=eventIcons[ev.kind];return <div className="setting-row" key={ev.kind}><span><Icon size={18}/>{t.events[ev.kind].n}</span><span className="setting-value">{t.active}</span></div>;})}
              <div className="menu-tip"><Settings2 size={16}/><span>{t.kbdHint}</span></div>
            </>}
            {tab==='rules'&&<div className="rules-content">{t.rules.map((p,i)=>p.b?<p key={i}><strong>{p.b}</strong> {p.t}</p>:<p key={i}>{p.t}</p>)}
              <div className="weapon-guide">{weapons.map((Icon,i)=><div key={i}><Icon size={17}/><span>{t.weapons[i]}</span><small>{t.weaponGuide[i]}</small></div>)}</div>
              <p>{t.weaponNote}</p>
            </div>}
            {tab==='events'&&<div className="events-content"><p className="events-intro">{t.eventsIntro}</p>{ALL_EVENTS.map(k=>{const Icon=eventIcons[k];return <div className="event-guide" key={k}><span><Icon size={19}/></span><div><strong>{t.events[k].n}</strong><p>{t.events[k].d}</p></div></div>;})}<div className="special-guide"><h3>{t.specialsTitle}</h3>{specialIcons.map((Icon,i)=><div key={i}><Icon size={17}/><span><strong>{t.specials[i].n}</strong> — {t.specials[i].d}</span></div>)}</div></div>}
          </div>
        </>}
        <div className="modal-actions"><button className="primary-button" onClick={state.over||confirmRestart?restart:pause}>{state.over||confirmRestart?<RotateCcw size={18}/>:<Play size={18} fill="currentColor"/>}{state.over?t.playAgain:confirmRestart?t.restart:t.resume}<span>↗</span></button>{!state.over&&<button className="secondary-button" onClick={confirmRestart?()=>setConfirmRestart(false):()=>setConfirmRestart(true)}>{confirmRestart?t.back:t.restart}</button>}</div>
      </section>
    </div>,document.body)}
  </div>;
}
