import ts from 'typescript';
import { readFileSync } from 'node:fs';

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const spatialURL = moduleURL(transpile(readFileSync(new URL('../src/spatial.ts', import.meta.url), 'utf8')));
export async function loadGame(path = new URL('../src/game.ts', import.meta.url)) {
  const source = transpile(readFileSync(path, 'utf8'))
    .replace("from 'matter-js'", `from '${import.meta.resolve('matter-js')}'`)
    .replace("from './spatial'", `from '${spatialURL}'`);
  return import(moduleURL(source));
}
export async function loadSpatial() { return import(spatialURL); }

export function installBrowserStubs() {
  const noop = () => {};
  const operations = { paths: 0, images: 0, canvases: 0, rects: 0 };
  const context = () => new Proxy({}, {
    get(_target, key) {
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (key === 'beginPath') return () => { operations.paths++; };
      if (key === 'drawImage') return () => { operations.images++; };
      return noop;
    },
    set() { return true; },
  });
  const canvas = () => {
    operations.canvases++;
    const ctx = context();
    return { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => {
      operations.rects++;
      return { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 };
    } };
  };
  globalThis.window = globalThis;
  globalThis.document = { createElement: canvas };
  globalThis.devicePixelRatio = 1;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.localStorage = { getItem: () => null, setItem: noop };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = noop;
  return { canvas, operations };
}

export function seeded(seed = 1010) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
