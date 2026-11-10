import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { installBrowserStubs, loadGame, seeded } from './helpers.mjs';

const { canvas, operations } = installBrowserStubs();
const { PhysicsGame } = await loadGame(process.argv[2] ? resolve(process.argv[2]) : undefined);
const originalRandom = Math.random;
Math.random = seeded();
const g = new PhysicsGame(canvas(), () => {});
g.pendingEvent = null;
for (let i = 0; i < 20; i++) g.spawn({ cells: [[0, 0], [1, 0], [0, 1]], color: '#67cbb5', special: null, id: i },
  55 + (i % 7) * 58, 55 + Math.floor(i / 7) * 110, i * .1);
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = (label, iterations, fn) => {
  for (let i = 0; i < 100; i++) fn();
  const samples = [];
  for (let run = 0; run < 7; run++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    samples.push((performance.now() - start) / iterations);
  }
  console.log(`${label}: ${median(samples).toFixed(4)} ms/op (median of 7)`);
};
measure('Overstack sweep (79 cells)', 500, () => {
  const index = g.buildSpotIndex?.();
  for (const p of g.pieces) g.layerViolation(p, index);
});
measure('Free target lookup', 500, () => g.freeTarget(250, 250, g.pieces[0], g.buildSpotIndex?.()));
// Avoid clearing full lines so every run has identical input.
g.destroyCells = () => 0;
measure('Line checks', 1000, () => g.checkLines());
const created = operations.canvases;
measure('Unchanged resize', 50, () => g.fit());
console.log(`Resize canvases allocated: ${operations.canvases - created}`);
g.setTheme('neon');
for (let i = 0; i < 10; i++) g.spawn({ cells: [[0, 0]], color: '#67cbb5', special: null, id: 100 + i }, 50 + i * 42, 400);
g.draw();
const paths = operations.paths;
for (let i = 0; i < 60; i++) g.draw();
console.log(`Canvas paths for 60 themed frames with bombard colors: ${operations.paths - paths}`);
g.dispose();
Math.random = originalRandom;
