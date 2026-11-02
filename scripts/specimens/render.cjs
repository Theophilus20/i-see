/**
 * Renders the specimen plates used by the I SEE preview.
 *
 *   npm run specimens
 *
 * 1. Bundles scripts/specimens/stage.ts (three.js studio + procedural specimens) with esbuild.
 * 2. Runs it in headless Chromium (software WebGL) and reads back two passes per view:
 *    a 2x supersampled photographic render, and an ID pass from the same camera with
 *    one flat colour per part and no anti-aliasing.
 * 3. Traces each part's visible pixels into an SVG path (pixel-boundary tracing, then
 *    Douglas-Peucker simplification; holes kept, fill-rule evenodd), and finds a deep
 *    interior anchor with a distance transform.
 * 4. Writes fixtures/specimens/<id>/photo[-n].jpg and masks[-n].json, plus a debug
 *    overlay into the scratch directory (SPECIMEN_DEBUG_DIR or os.tmpdir()).
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const esbuild = require('esbuild');
const sharp = require('sharp');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'fixtures', 'specimens');
const DEBUG = process.env.SPECIMEN_DEBUG_DIR || path.join(os.tmpdir(), 'isee-specimens-debug');

/** Camera and lighting per plate. Units are metres. */
const VIEWS = [
  {
    file: 'photo',
    masks: 'masks',
    spec: {
      specimen: 'moka-pot',
      camera: [0.0, 0.205, 0.6],
      target: [0.0, 0.098, 0.0],
      fov: 26,
      yaw: -0.42,
      key: [-0.75, 1.05, 0.8],
      exposure: 1.0,
      blobs: [[0.24, 0.24, 0.38, 1.5], [0.118, 0.118, 0.7, 0.55]],
      fog: [0.75, 1.9],
      envIntensity: 0.75,
      envRotation: 0.7,
    },
  },
  {
    file: 'photo-2',
    masks: 'masks-2',
    spec: {
      specimen: 'moka-pot',
      camera: [0.05, 0.028, 0.33],
      target: [0.0, 0.07, 0.0],
      fov: 30,
      yaw: 0.3,
      key: [-0.6, 0.9, 0.9],
      exposure: 0.85,
      blobs: [[0.24, 0.24, 0.38, 1.5], [0.118, 0.118, 0.7, 0.55]],
      fog: [0.5, 1.6],
      envIntensity: 0.75,
      envRotation: 0.7,
    },
  },
  {
    file: 'photo',
    masks: 'masks',
    spec: {
      specimen: 'brass-fitting',
      camera: [0.0, 0.088, 0.105],
      target: [0.0, 0.011, 0.0],
      fov: 26,
      yaw: -0.38,
      key: [-0.7, 1.1, 0.6],
      exposure: 0.9,
      blobs: [[0.075, 0.042, 0.28, 1.6], [0.034, 0.024, 0.55, 0.6]],
      fog: [0.2, 0.7],
      envIntensity: 0.6,
      envRotation: 0.7,
    },
  },
];

// ---------------------------------------------------------------------------
// Mask tracing
// ---------------------------------------------------------------------------

/** Traces the boundary of a binary mask along pixel edges. Returns closed loops of [x, y] corners. */
function traceLoops(mask, W, H) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const W1 = W + 1;
  const key = (x, y) => y * W1 + x;
  // Directed edges with the inside on the right (screen coordinates, y down).
  const out = new Map(); // start key -> array of {x0,y0,x1,y1,used}
  const addEdge = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    let arr = out.get(k);
    if (!arr) out.set(k, (arr = []));
    arr.push({ x0, y0, x1, y1, used: false });
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] !== 1) continue;
      if (!inside(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!inside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const arr of out.values()) {
    for (const start of arr) {
      if (start.used) continue;
      const loop = [];
      let e = start;
      while (e && !e.used) {
        e.used = true;
        loop.push([e.x0, e.y0]);
        const cands = (out.get(key(e.x1, e.y1)) || []).filter((c) => !c.used);
        if (cands.length <= 1) e = cands[0];
        else {
          // At a pinch point, turn right so diagonally touching pixels stay separate.
          const dx = e.x1 - e.x0;
          const dy = e.y1 - e.y0;
          const right = [-dy, dx];
          e = cands.find((c) => c.x1 - c.x0 === right[0] && c.y1 - c.y0 === right[1]) || cands[0];
        }
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function dpOpen(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let max = -1;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = len === 1 && dx === 0 && dy === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (d > max) {
      max = d;
      at = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const left = dpOpen(pts.slice(0, at + 1), eps);
  const right = dpOpen(pts.slice(at), eps);
  return left.slice(0, -1).concat(right);
}

/** Simplify a closed loop: split at the point farthest from the first, simplify both halves. */
function simplifyLoop(loop, eps) {
  if (loop.length < 8) return loop;
  const [x0, y0] = loop[0];
  let far = 0;
  let fd = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - x0, loop[i][1] - y0);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = dpOpen(loop.slice(0, far + 1), eps);
  const b = dpOpen(loop.slice(far).concat([loop[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** Chamfer distance transform; returns the pixel deepest inside the mask. */
function deepestPoint(mask, W, H) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      else v = Math.min(v, a);
      if (y > 0) v = Math.min(v, d[i - W] + a);
      else v = Math.min(v, a);
      if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + b);
      if (x < W - 1 && y > 0) v = Math.min(v, d[i - W + 1] + b);
      d[i] = v;
    }
  let best = 0;
  let bi = -1;
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + a);
      else v = Math.min(v, a);
      if (y < H - 1) v = Math.min(v, d[i + W] + a);
      else v = Math.min(v, a);
      if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + b);
      if (x > 0 && y < H - 1) v = Math.min(v, d[i + W - 1] + b);
      d[i] = v;
      if (v > best) {
        best = v;
        bi = i;
      }
    }
  return bi < 0 ? null : { x: (bi % W) + 0.5, y: Math.floor(bi / W) + 0.5, depth: best };
}

function masksFromIds(rgba, W, H, parts) {
  // GL reads bottom-up: flip while decoding.
  const label = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W;
    for (let x = 0; x < W; x++) {
      const p = (src + x) * 4;
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      if (Math.abs(g - 128) > 2 || Math.abs(b - 64) > 2) continue;
      label[y * W + x] = Math.round(rgba[p] / 20);
    }
  }
  const out = [];
  for (const part of parts) {
    const mask = new Uint8Array(W * H);
    let count = 0;
    let minx = W, miny = H, maxx = -1, maxy = -1;
    for (let i = 0; i < W * H; i++) {
      if (label[i] !== part.index) continue;
      mask[i] = 1;
      count++;
      const x = i % W;
      const y = (i - x) / W;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    if (count < 40) continue; // hidden in this view
    const loops = traceLoops(mask, W, H)
      .map((l) => simplifyLoop(l, 0.75))
      .filter((l) => l.length >= 3 && Math.abs(polygonArea(l)) >= 6);
    const d = loops.map((l) => `M${l.map(([x, y]) => `${x} ${y}`).join('L')}Z`).join('');
    const anchor = deepestPoint(mask, W, H);
    out.push({
      part: part.part,
      label: part.label,
      path: d,
      box: { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 },
      anchor: { x: Math.round(anchor.x * 10) / 10, y: Math.round(anchor.y * 10) / 10 },
      area: Math.round((count / (W * H)) * 100000) / 100000,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Photographic finishing
// ---------------------------------------------------------------------------

function grain(W, H, seed, amount) {
  const buf = Buffer.alloc(W * H * 4);
  let s = seed >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < W * H; i++) {
    const n = (r() + r() + r() - 1.5) * amount;
    const v = Math.max(0, Math.min(255, Math.round(128 + n * 255)));
    buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

async function finishPhoto(pngBase64, W, H) {
  const vignette = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><radialGradient id="g" cx="50%" cy="46%" r="72%">
        <stop offset="0.55" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d3c6"/>
      </radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const base = await sharp(Buffer.from(pngBase64, 'base64')).resize(W, H, { kernel: 'lanczos3' }).png().toBuffer();
  return sharp(base)
    .composite([
      { input: vignette, blend: 'multiply' },
      { input: grain(W, H, 7, 0.035), raw: { width: W, height: H, channels: 4 }, blend: 'soft-light' },
    ])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

async function debugOverlay(jpg, masks, W, H, file) {
  const colours = ['#0064E0', '#F3425F', '#45BD62', '#9360F7', '#FB724B', '#2ABBA7', '#FF66BF', '#54C7EC', '#F7B928', '#1C2B33'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${masks
    .map((m, i) => {
      const c = colours[i % colours.length];
      return `<path d="${m.path}" fill="${c}" fill-opacity="0.18" fill-rule="evenodd" stroke="${c}" stroke-width="1.5"/>
        <circle cx="${m.anchor.x}" cy="${m.anchor.y}" r="4" fill="${c}"/>
        <text x="${m.anchor.x + 7}" y="${m.anchor.y + 4}" font-family="sans-serif" font-size="15" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${m.part}</text>`;
    })
    .join('')}</svg>`;
  await sharp(jpg).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
}

// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(DEBUG, { recursive: true });
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, 'stage.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    minify: true,
    logLevel: 'warning',
  });
  const js = bundle.outputFiles[0].text;

  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
  });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
    await page.setContent('<!doctype html><html><body style="margin:0;background:#000"></body></html>');
    await page.addScriptTag({ content: js });

    const only = process.argv.slice(2);
    for (const v of VIEWS) {
      const tag = `${v.spec.specimen}/${v.file}`;
      if (only.length && !only.some((o) => tag.includes(o))) continue;
      const t0 = Date.now();
      const res = await page.evaluate((spec) => window.ISEE_STAGE.render(spec), v.spec);
      const dir = path.join(OUT, v.spec.specimen);
      fs.mkdirSync(dir, { recursive: true });
      const jpg = await finishPhoto(res.photo, res.width, res.height);
      fs.writeFileSync(path.join(dir, `${v.file}.jpg`), jpg);
      const masks = masksFromIds(Buffer.from(res.ids, 'base64'), res.width, res.height, res.parts);
      fs.writeFileSync(path.join(dir, `${v.masks}.json`), JSON.stringify(masks, null, 1) + '\n');
      await debugOverlay(jpg, masks, res.width, res.height, path.join(DEBUG, `${v.spec.specimen}-${v.file}-overlay.png`));
      console.log(
        `${tag}.jpg  ${res.width}x${res.height}  ${(jpg.length / 1024).toFixed(0)} KB  ${masks.length} masks (${masks.map((m) => m.part).join(', ')})  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
    }
  } finally {
    await browser.close();
  }
  console.log(`Debug overlays: ${DEBUG}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { traceLoops, simplifyLoop, deepestPoint, masksFromIds, polygonArea };
