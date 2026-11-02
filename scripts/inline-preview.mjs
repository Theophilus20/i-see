/**
 * Turns the preview build into one self-contained HTML file (sample runs only, no
 * server): the script, the stylesheet, fonts and sample photos are all inlined.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-preview';
let html = readFileSync(join(dir, 'index.html'), 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, file) => {
  const js = readFileSync(join(dir, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, file) => `<style>${readFileSync(join(dir, file), 'utf8')}</style>`);
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

if (/src="\.\/assets|href="\.\/assets/.test(html)) {
  throw new Error('An asset was not inlined.');
}
const out = join(dir, 'i-see-preview.html');
writeFileSync(out, html);
const size = statSync(out).size;
console.log(`Wrote ${out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
// Variant for hosts that supply their own document skeleton: head contents and body contents only.
const fragment = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta charset="utf-8" \/>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .trim();
writeFileSync(join(dir, 'i-see-artifact.html'), fragment);
const leftovers = readdirSync(join(dir, 'assets')).filter((f) => !/\.(js|css)$/.test(f));
if (leftovers.length) console.log('Note: unreferenced files remain in assets/:', leftovers.join(', '));
