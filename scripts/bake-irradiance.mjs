// Bakes the Al Marfa light probe volume to src/assets/al-marfa/irradiance.bin.
// Start `npm run dev` first, then: node scripts/bake-irradiance.mjs [http://localhost:5173]
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:5173';
const output = new URL('../src/assets/al-marfa/irradiance.bin', import.meta.url);
const browser = await chromium.launch({
  channel: existsSync(chromium.executablePath()) ? undefined : 'chrome',
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', error => console.error(error.message));
await page.goto(`${url}/?qa&seed=2324&quality=Ultra`);
await page.waitForFunction(() => Boolean(window.__marketline), null, { timeout: 180_000 });
await page.evaluate(() => window.__marketline.stage('market'));
const timer = setInterval(async () => {
  const done = await page.evaluate(() => window.__bakeProgress ?? 0).catch(() => 0);
  process.stdout.write(`\rbaking ${(done * 100).toFixed(0)}%`);
}, 5000);
const started = Date.now();
const encoded = await page.evaluate(() => window.__marketline.bakeIrradiance(2));
clearInterval(timer);
writeFileSync(output, Buffer.from(encoded, 'base64'));
console.log(`\nwrote ${output.pathname} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
await browser.close();
