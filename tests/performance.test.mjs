import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStubs, loadGame, loadSpatial, seeded } from './helpers.mjs';

const { canvas, operations } = installBrowserStubs();
const { PhysicsGame, THEME_LOOK } = await loadGame();
const { PointIndex } = await loadSpatial();
const game = () => {
  const g = new PhysicsGame(canvas(), () => {});
  g.pendingEvent = null;
  return g;
};

test('spatial counts match brute force, including strict edges, exclusions and reuse', () => {
  const random = seeded(), index = new PointIndex(46);
  for (let round = 0; round < 4; round++) {
    index.clear();
    const points = Array.from({ length: 200 }, (_, i) => ({
      x: random() * 700 - 100, y: random() * 700 - 100, value: i % 8,
    }));
    points.push({ x: 23, y: 0, value: 1 }, { x: -23, y: 0, value: 1 });
    for (const p of points) index.add(p.x, p.y, p.value);
    for (let i = 0; i < 500; i++) {
      const x = i ? random() * 700 - 100 : 0, y = i ? random() * 700 - 100 : 0, exclude = i % 8;
      const count = points.filter(p => p.value !== exclude && Math.abs(p.x - x) < 23 && Math.abs(p.y - y) < 23).length;
      assert.equal(index.count(x, y, 23, exclude), count);
      assert.equal(index.count(x, y, 23, exclude, 2), Math.min(2, count));
    }
  }
});

test('indexed overstack detection and target selection preserve brute-force results', () => {
  const g = game(), random = seeded();
  for (let i = 0; i < 35; i++) {
    const p = g.spawn({ cells: [[0, 0], [1, 0], [0, 1]], color: '#67cbb5', special: null, id: i },
      40 + random() * 420, 40 + random() * 420, random() * 6);
    if (i % 7 === 0) p.body.isStatic = true;
  }
  g.dragged = g.pieces[2];
  const index = g.buildSpotIndex();
  for (const p of g.pieces) {
    assert.deepEqual(g.layerViolation(p, index), g.layerViolation(p));
    assert.deepEqual(g.freeTarget(p.body.position.x, p.body.position.y, p, index),
      g.freeTarget(p.body.position.x, p.body.position.y, p));
  }
  g.dispose();
});

test('line masks preserve all hits, intersections, out-of-board cells and dragged exclusions', () => {
  const g = game(), random = seeded();
  g.pieces = [];
  const add = (col, row) => g.pieces.push({ body: { position: { x: 43 + col * 46, y: 43 + row * 46 }, angle: 0 },
    cells: [{ x: 0, y: 0 }], special: null });
  g.destroyCells = predicate => {
    g.hits = g.pieces.flatMap(p => p.cells.filter(c => {
      const w = g.worldCell(p, c); return predicate(w.x, w.y, p, c);
    }));
    return g.hits.length;
  };
  for (let round = 0; round < 100; round++) {
    g.pieces = []; g.hits = []; g.score = 0;
    for (let k = 0; k < 10; k++) { add(k, 3); add(6, k); }
    for (let k = 0; k < 80; k++) add(Math.floor(random() * 14) - 2, Math.floor(random() * 14) - 2);
    g.dragged = round % 2 ? g.pieces[0] : null;
    const bins = Array.from({ length: 100 }, () => []);
    for (const p of g.pieces) {
      if (p === g.dragged) continue;
      for (const c of p.cells) {
        const w = g.worldCell(p, c), col = Math.floor((w.x - 20) / 46), row = Math.floor((w.y - 20) / 46);
        if (col >= 0 && col < 10 && row >= 0 && row < 10) bins[row * 10 + col].push(c);
      }
    }
    const expected = new Set(); let lines = 0;
    for (let k = 0; k < 10; k++) {
      for (const row of [true, false]) {
        const cells = Array.from({ length: 10 }, (_, i) => bins[row ? k * 10 + i : i * 10 + k]);
        if (cells.every(b => b.length)) { lines++; for (const b of cells) for (const c of b) expected.add(c); }
      }
    }
    g.checkLines();
    assert.deepEqual(new Set(g.hits), expected);
    assert.equal(g.score, lines * 100);
  }
  g.dispose();
});

test('same-scale resize retains caches; real resize and theme changes rebuild them', () => {
  const g = game(), grid = g.gridLayer, sprite = g.sprites.values().next().value;
  const before = operations.canvases;
  g.fit();
  assert.equal(operations.canvases, before);
  assert.equal(g.gridLayer, grid);
  assert.equal(g.sprites.values().next().value, sprite);
  globalThis.devicePixelRatio = 2;
  g.fit();
  assert.notEqual(g.gridLayer, grid);
  assert.equal(g.scale, 2);
  globalThis.devicePixelRatio = 1;
  g.setTheme('neon');
  assert.equal(g.themeKey, 'neon');
  assert.ok(THEME_LOOK.neon.palette.includes(g.pieces[0].cells[0].color));
  g.dispose();
});

test('non-palette sprites are cached and invalidated on scale or theme changes', () => {
  const g = game();
  const first = g.getSprite('#123456', 'shock'), before = operations.canvases;
  assert.equal(g.getSprite('#123456', 'shock'), first);
  assert.equal(operations.canvases, before);
  assert.notEqual(g.getSprite('#123456', 'bomb'), first);
  g.setTheme('day');
  assert.notEqual(g.getSprite('#123456', 'shock'), first);
  g.dispose();
});

test('expired burns still destroy cells; empty burn checks leave the board untouched', () => {
  const g = game();
  const cells = g.pieces.flatMap(p => p.cells);
  let calls = 0;
  g.destroyCells = predicate => { calls++; return cells.filter(c => predicate(0, 0, null, c)).length; };
  g.burnTick = .31; g.update(1 / 60);
  assert.equal(calls, 0);
  cells[0].burn = .001;
  g.burnTick = .31; g.update(1 / 60);
  assert.equal(calls, 1);
  g.dispose();
});
