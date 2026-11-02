/**
 * End-to-end check of the single-file preview in headless Chromium: runs both
 * samples, visits every view at desktop and phone widths, saves screenshots and
 * fails on console errors or horizontal overflow.
 *   node scripts/e2e.cjs [outDir]
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const out = process.argv[2] || path.join(process.cwd(), 'e2e-shots');
fs.mkdirSync(out, { recursive: true });
const file = 'file://' + path.resolve('dist-preview/i-see-preview.html');
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'];

(async () => {
  const browser = await chromium.launch({ args });
  const problems = [];
  for (const [name, viewport, scheme] of [
    ['desktop', { width: 1440, height: 900 }, 'light'],
    ['phone', { width: 390, height: 844 }, 'light'],
    ['dark', { width: 1280, height: 860 }, 'dark'],
  ]) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && problems.push(`[${name}] console: ${m.text()}`));
    page.on('pageerror', (e) => { problems.push(`[${name}] pageerror: ${e.message}`); console.log('PAGEERROR', name, page.url(), e.message); });
    const shot = async (label, opts = {}) => {
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`[${name}] ${label}: horizontal overflow ${overflow}px`);
      await page.screenshot({ path: path.join(out, `${name}-${label}.png`), fullPage: opts.full ?? false });
    };
    await page.goto(file);
    await page.waitForTimeout(2200);
    await shot('home');
    if (name !== 'dark') await shot('home-full', { full: true });

    const cards = await page.locator('.example-card').count();
    for (let i = 0; i < Math.min(cards, 3); i++) {
      const sample = `ex${i + 1}`;
      await page.goto(file + '#/');
      await page.waitForTimeout(300);
      try {
        await page.locator('.example-card').nth(i).click({ timeout: 8000 });
      } catch (e) {
        await page.screenshot({ path: path.join(out, `${name}-FAIL-${sample}.png`) });
        throw e;
      }
      await page.waitForTimeout(3500);
      await shot(`${sample}-darkroom`);
      await page.waitForFunction(() => location.hash.startsWith('#/p/'), null, { timeout: 40000 });
      await page.waitForTimeout(900);
      await shot(`${sample}-profile`);
      if (name === 'desktop') {
        await shot(`${sample}-profile-full`, { full: true });
        const f = page.locator('.finding').filter({ has: page.locator('.region-chip') }).first();
        if (await f.count()) {
          await f.hover();
          await shot(`${sample}-leader`);
        }
      }
      const base = page.url().replace(/#\/p\/([^/]+).*/, '#/p/$1');
      for (const tab of ['parts', 'history', 'whatif', 'sources', 'ask']) {
        if (name === 'dark' && !['whatif', 'parts'].includes(tab)) continue;
        await page.goto(base + '/' + tab);
        await page.waitForTimeout(tab === 'parts' ? 2500 : 600);
        if (tab === 'ask') {
          const chip = page.locator('.chip-btn').first();
          if (await chip.count()) {
            await chip.click();
            await page.waitForTimeout(1600);
          }
        }
        await shot(`${sample}-${tab}`, { full: name === 'desktop' });
      }
    }
    for (const p of ['passport', 'compare', 'method', 'settings', 'scan']) {
      if (name === 'dark' && p !== 'passport') continue;
      await page.goto(file + '#/' + p);
      await page.waitForTimeout(700);
      await shot(p, { full: name === 'desktop' });
    }
    await ctx.close();
  }
  await browser.close();
  if (problems.length) {
    console.log('PROBLEMS:\n' + problems.join('\n'));
    process.exitCode = 1;
  } else console.log('e2e: no console errors, no horizontal overflow.');
})();
