// Makes dist/index.html runnable by double-click (file://):
// browsers block inline <script type="module"> on file:// origins, so we
// downgrade them to classic scripts. Safe because the single-file bundle
// contains no import/export statements (vite-plugin-singlefile inlines all).
//
// Vite places the bundle <script> in <head>, BEFORE <div id="root">. Module
// scripts are deferred so that used to work; classic scripts execute at once,
// which would hit `getElementById('root')` before the div exists (React #299).
// So every converted script is relocated to the end of <body>.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../dist/index.html', import.meta.url);
let html = readFileSync(path, 'utf8');

// Step 1: mark every module script as a converted classic script.
const before = html;
html = html.replace(/<script type="module"[^>]*>/g, '<script data-file-safe>');
html = html.replace(/<style rel="stylesheet"[^>]*>/, '<style>');
if (html === before) {
  console.log('file-safe: nothing to rewrite (already converted?)');
  process.exit(0);
}

// Step 2: relocate converted blocks to just before </body>. Matching runs to
// the nearest </script> — exactly how the HTML parser would see it (an inline
// script can never contain a literal </script>, or the page itself would break).
const moved = [];
html = html.replace(/<script data-file-safe>[\s\S]*?<\/script>/g, m => {
  moved.push(m.replace('<script data-file-safe>', '<script>'));
  return '';
});
// NOTE: replacer must be a function — a string replacement would interpret
// `$&`/`` $` ``/`$'` sequences that are abundant in minified React code.
html = html.replace('</body>', () => moved.join('\n') + '\n</body>');

writeFileSync(path, html);
console.log(`file-safe: converted ${moved.length} script(s) to classic and moved to end of <body> — works over file://`);
