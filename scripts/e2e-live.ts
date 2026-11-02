/**
 * Drives the real app through a LIVE scan, end to end, against the mock Meta Model API:
 * browser → gateway → (mock) Muse Spark, SAM 3.1, Muse Wonder, web search → profile.
 * Proves the live wiring of the UI; it does not prove the real Meta service behaves the same.
 *   npx tsx scripts/e2e-live.ts [outDir]
 */
import { serve } from '@hono/node-server';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MockMeta, TEST_KEY } from '../tests/server/mock-meta';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';

const require = createRequire(import.meta.url);
// Playwright is preinstalled globally in CI images; it is not an npm dependency of the app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require('playwright') as any;
const out = process.argv[2] ?? 'e2e-shots';
mkdirSync(out, { recursive: true });

const mock = new MockMeta();
const url = await mock.start();
const cfg = loadConfig({ MODEL_API_KEY: TEST_KEY, META_API_BASE: `${url}/v1`, CONNECTORS: 'wikipedia', STATIC_DIR: 'dist', PORT: '0', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'http://127.0.0.1' } as NodeJS.ProcessEnv);
const { app, jobs } = createApp({ cfg, connectorFetch: (async () => new Response('offline', { status: 503 })) as typeof fetch });
const server = serve({ fetch: app.fetch, port: 8811, hostname: '127.0.0.1' });
const base = 'http://127.0.0.1:8811';

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
page.on('console', (m: { type(): string; text(): string }) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base + '/');
await page.waitForTimeout(1500);
const status = await page.locator('.status').innerText();
console.log('status pill:', status);
await page.goto(base + '/#/scan');
await page.waitForTimeout(500);
await page.locator('input[type=file]').setInputFiles(resolve('fixtures/specimens/moka-pot/photo.jpg'));
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, 'live-scan.png') });
await page.getByRole('button', { name: /Examine/ }).last().click();
await page.getByRole('button', { name: 'Send and examine' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'live-darkroom.png') });
await page.waitForFunction(() => (globalThis as unknown as { location: { hash: string } }).location.hash.startsWith('#/p/'), null, { timeout: 60000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: join(out, 'live-profile.png'), fullPage: true });
const profileUrl = page.url();
// Tapping a label, or a dot on a part already marked, selects that part: it never adds a second number.
{
  const pills = page.locator('.plate-pill');
  const before = await pills.count();
  const calls = mock.count('/v1/responses');
  await pills.first().click();
  await page.waitForTimeout(500);
  const dot = await page.locator('.plate-leaders circle').nth(1).boundingBox();
  if (dot) await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.waitForTimeout(800);
  const after = await pills.count();
  console.log('taps on a label and a dot: outlines', before, '->', after, '; outline requests', mock.count('/v1/responses') - calls);
  if (after !== before || mock.count('/v1/responses') !== calls) errors.push('tapping a label or a marked part added an outline');
}
await page.goto(profileUrl + '/parts');
await page.waitForSelector('.ipart', { timeout: 30000 });
// The cutaway is drawn from the photo with no text, checked against it, and each part found in it;
// the app draws the labels.
await page.waitForSelector('.cutaway-labelled .plate-frame img', { timeout: 90000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, 'live-parts.png'), fullPage: true });
console.log('cutaway labels:', (await page.locator('.cutaway-labelled .plate-pill').allInnerTexts()).map((t: string) => t.replace(/\s+/g, ' ')).join(' | '));
await page.locator('.cutaway-legend button').first().click();
await page.waitForTimeout(400);
console.log('tapping a name highlights it:', await page.locator('.cutaway-labelled .plate-region.on').count(), '| info:', (await page.locator('.cutaway-hover').innerText()).slice(0, 80));
await page.screenshot({ path: join(out, 'live-cutaway.png'), fullPage: false });
await page.getByRole('tab', { name: 'Against your photo' }).click();
await page.waitForSelector('.cutaway-compare', { timeout: 5000 });
// Leave and come back: the saved drawing still shows (no broken image).
await page.goto(profileUrl);
await page.waitForTimeout(500);
await page.goto(profileUrl + '/parts');
await page.waitForSelector('.cutaway-labelled .plate-frame img', { timeout: 20000 });
await page.waitForTimeout(500);
const ok = await page.evaluate(() => {
  const img = (globalThis as unknown as { document: { querySelector(s: string): { naturalWidth: number; complete: boolean } | null } }).document.querySelector('.cutaway-labelled .plate-frame img');
  return !!img && img.complete && img.naturalWidth > 0;
});
console.log('cutaway still shows after coming back:', ok);
if (!ok) errors.push('cutaway image broken after navigating back');
if (await page.getByRole('tab', { name: 'Workshop' }).count()) errors.push('the workshop should be gone');
console.log('inside parts:', await page.locator('.ipart').count(), 'flows:', await page.locator('.iflow').count());

// The interface in another language (Muse Spark translates the visible text; the mock wraps it in «»).
await page.goto(base + '/#/settings');
await page.waitForTimeout(600);
await page.locator('select').first().selectOption('fr');
await page.waitForFunction(() => (globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } }).document.querySelector('.topbar')?.textContent?.includes('«'), null, { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'live-settings-fr.png'), fullPage: true });
console.log('translated nav:', (await page.locator('.topbar nav').innerText()).replace(/\s+/g, ' '));
await page.locator('select').first().selectOption('en');
await page.waitForTimeout(500);
console.log('back to English:', (await page.locator('.topbar nav').innerText()).replace(/\s+/g, ' '));

// The camera: live recognition locks on and starts the scan by itself.
const camCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['camera'] });
const cam = await camCtx.newPage();
cam.on('pageerror', (e: Error) => errors.push('camera: ' + e.message));
await cam.goto(base + '/#/scan');
await cam.waitForTimeout(1200);
await cam.getByRole('button', { name: /camera/i }).first().click();
await cam.waitForTimeout(800);
if (await cam.locator('.camera-ask').count()) await cam.getByRole('button', { name: 'Allow' }).click();
await cam.waitForSelector('.rc-label', { timeout: 20000 });
await cam.screenshot({ path: join(out, 'live-camera-found.png') });
// Locking may already have started by now; catch it on screen if it has not finished.
if (await cam.locator('.reticle.locking').count().catch(() => 0)) await cam.screenshot({ path: join(out, 'live-camera-locking.png') }).catch(() => undefined);
await cam.waitForFunction(() => (globalThis as unknown as { location: { hash: string } }).location.hash.startsWith('#/run'), null, { timeout: 20000 });
await cam.waitForTimeout(1800);
await cam.screenshot({ path: join(out, 'live-camera-darkroom.png') });
console.log('camera: locked on and started the scan; glance calls so far =', mock.count('/v1/chat/completions'));
console.log('mock calls:', ['/v1/chat/completions', '/v1/responses'].map((p) => `${p}=${mock.count(p)}`).join(' '));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no browser errors');
await browser.close();
server.close();
jobs.close();
await mock.stop();
process.exit(errors.length ? 1 : 0);
