import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { capture, monitor } from './support.js';

const viewports = [
  { width: 1920, height: 1080 },
  { width: 2192, height: 1080 },
];
const stageNames = ['spawn', 'alley', 'market', 'arch', 'plaza', 'ads', 'muzzle', 'impact', 'low-health', 'encounter', 'operative-front', 'operative-crouch'];

const query = '/?qa&seed=2324&quality=High';
const snapshot = page => page.evaluate(() => window.__marketline.snapshot());
const stats = page => page.evaluate(() => window.__marketline.stats());

async function ready(page, baseURL) {
  const traffic = monitor(page, baseURL);
  await page.goto(query);
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'ready');
  await page.waitForFunction(() => Boolean(window.__marketline));
  return traffic;
}

async function deploy(page) {
  await page.locator('#deploy').click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).pointerLock).toBe(true);
}

async function frames(page, count) {
  await page.evaluate(async iterations => {
    for (let frame = 0; frame < iterations; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }, count);
}

function verified(timing, traffic) {
  expect(timing.finite, 'Finite actor transforms').toBe(true);
  expect(timing.errors, 'Runtime graphics errors').toEqual([]);
  expect(traffic.errors, 'Browser errors, shader errors and failed requests').toEqual([]);
  const assets = [...new Set(traffic.requests.map(url => new URL(url).pathname))].sort();
  expect(assets).toHaveLength(2);
  expect(assets[0]).toBe('/');
  expect(assets[1]).toMatch(/\.js$/);
}

for (const viewport of viewports) {
  test(`visual checkpoints and benchmark at ${viewport.width}×${viewport.height}`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize(viewport);
    const traffic = await ready(page, baseURL);
    await expect(page.locator('#menu-title')).toHaveText('MARKETLINE');
    await capture(page, testInfo, 'menu', false);

    for (const name of stageNames) {
      await page.evaluate(stage => window.__marketline.stage(stage), name);
      await frames(page, 3);
      for (const id of ['minimap', 'compass', 'timer', 'blue-score', 'red-score', 'health', 'ammo', 'reserve']) {
        await expect(page.locator('#' + id)).toBeVisible();
      }
      await expect(page.locator('#health')).toHaveText(name === 'low-health' ? '20' : '100');
      await expect(page.locator('#ammo')).toHaveText('30');
      if (name === 'ads') expect((await snapshot(page)).ads).toBeGreaterThan(0.95);
      if (name === 'low-health') await expect(page.locator('#health-meter')).toHaveClass('critical');
      if (name === 'encounter') {
        await expect(page.locator('.team-marker[data-team="friendly"]:visible').first()).toBeVisible();
        await expect(page.locator('.team-marker[data-team="enemy"]:visible')).toHaveText('ENEMY');
        await expect(page.locator('#crosshair')).toHaveClass(/hostile/);
      }
      await capture(page, testInfo, name);
    }

    await page.evaluate(() => window.__marketline.stage('team-cover'));
    await expect(page.locator('.team-marker[data-team="enemy"]:visible')).toHaveCount(0);
    await expect(page.locator('#crosshair')).not.toHaveClass(/hostile/);

    await page.keyboard.press('Escape');
    await deploy(page);
    await page.evaluate(() => window.__marketline.profileSetup());
    await frames(page, 35);
    await page.evaluate(() => window.__marketline.clearStats());
    await frames(page, 120);
    const timing = await stats(page);
    const { count, avg, p95, worst, calls, triangles, particles, rigidBodies, audioVoices, scale, hdr, gpu } = timing;
    const rounded = value => Math.round(value * 100) / 100;
    const report = {
      viewport, seed: 2324, quality: 'High', count, avg: rounded(avg), p95: rounded(p95), worst: rounded(worst),
      calls, triangles, particles, rigidBodies, audioVoices, scale, hdr, gpu,
    };
    const reportPath = testInfo.outputPath('performance.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    await testInfo.attach('performance', { path: reportPath, contentType: 'application/json' });
    console.log(JSON.stringify(report));
    expect(count).toBeGreaterThan(95);
    expect(avg).toBeGreaterThan(0);
    expect(p95).toBeGreaterThanOrEqual(avg * 0.65);
    expect(calls).toBeGreaterThan(0);
    expect(triangles).toBeGreaterThan(5_000);
    expect((await snapshot(page)).ammo).toBeLessThan(30);
    verified(timing, traffic);
  });
}

test('offline match input, combat, respawn and restart', async ({ page, context, baseURL }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const traffic = await ready(page, baseURL);
  await context.setOffline(true);

  await page.locator('#settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.getByLabel('Motion blur').selectOption('Off');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('marketline.settings')).blur)).toBe('Off');
  await page.getByRole('button', { name: 'Toggle fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.locator('#close-settings').click();

  await deploy(page);
  await frames(page, 3);
  const start = await snapshot(page);
  expect(start.fov).toBeGreaterThan(0);
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => {
      const current = (await snapshot(page)).position;
      return Math.hypot(current[0] - start.position[0], current[2] - start.position[2]);
    }).toBeGreaterThan(1.25);
  } finally {
    await page.keyboard.up('w');
  }
  expect(start.bots).toHaveLength(7);

  await page.mouse.down({ button: 'right' });
  await expect.poll(async () => (await snapshot(page)).ads).toBeGreaterThan(0.92);
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await snapshot(page)).ads).toBeLessThan(0.12);

  await page.keyboard.press('b');
  await expect(page.locator('#weapon-mode')).toHaveText('SEMI');
  await page.mouse.down();
  await expect(page.locator('#ammo')).toHaveText('29');
  await frames(page, 8);
  await expect(page.locator('#ammo')).toHaveText('29');
  await page.mouse.up();
  await page.keyboard.press('r');
  await expect(page.locator('#status')).toHaveText('RELOADING');
  await expect(page.locator('#ammo')).toHaveText('30');
  await expect(page.locator('#reserve')).toHaveText('119');
  await page.keyboard.press('b');
  await expect(page.locator('#weapon-mode')).toHaveText('AUTO');
  await page.keyboard.press('i');
  await page.keyboard.press('q');
  await expect(page.locator('#smoke-count')).toHaveText('0');
  await page.keyboard.press('g');
  await expect(page.locator('#frag-count')).toHaveText('0');

  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'pause');
  await expect.poll(async () => (await snapshot(page)).pointerLock).toBe(false);
  await page.setViewportSize({ width: 1490, height: 760 });
  await deploy(page);

  await page.evaluate(() => window.__marketline.encounter());
  const score = (await snapshot(page)).score[0];
  await page.mouse.down({ button: 'right' });
  await page.mouse.down();
  try {
    await expect.poll(async () => (await snapshot(page)).score[0], { timeout: 3000, intervals: [30, 50, 80] }).toBeGreaterThan(score);
  } finally {
    await page.mouse.up();
    await page.mouse.up({ button: 'right' });
  }
  await expect(page.locator('#feed')).toContainText('YOU');
  await capture(page, testInfo, 'elimination');

  await page.evaluate(() => window.__marketline.hurt(150));
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'dead');
  await expect(page.locator('#status')).toContainText('REDEPLOYING');
  await expect(page.locator('#health')).toHaveText('0');
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'play');
  await expect(page.locator('#health')).toHaveText('100');
  await expect(page.locator('#ammo')).toHaveText('30');

  await page.evaluate(() => window.__marketline.finish());
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'end');
  await expect(page.locator('#menu-title')).toHaveText(/VICTORY|DEFEAT|DRAW/);
  await capture(page, testInfo, 'after-action', false);
  await deploy(page);
  await expect.poll(async () => (await snapshot(page)).score).toEqual([0, 0]);
  expect((await snapshot(page)).time).toBeLessThan(4);
  verified(await stats(page), traffic);
});


test('the two production files boot directly from disk offline', async ({ page, context }) => {
  const traffic = monitor(page, 'file:');
  await context.setOffline(true);
  const index = new URL('../dist/index.html?qa&seed=2324&quality=Medium', import.meta.url);
  await page.goto(index.href);
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'ready');
  await deploy(page);
  await expect(page.locator('#health')).toHaveText('100');
  expect((await stats(page)).finite).toBe(true);
  expect(traffic.errors).toEqual([]);
  const urls = [...new Set(traffic.requests)];
  expect(urls).toEqual([index.href, new URL('./marketline.js', index).href]);
});

test('unassisted squads reach the elimination limit', async ({ page, baseURL }) => {
  const traffic = await ready(page, baseURL);
  const result = await page.evaluate(() => window.__marketline.playOut());
  expect(result.state).toBe('end');
  expect(Math.max(...result.scores)).toBe(30);
  expect(result.elapsed).toBeLessThan(600);
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'end');
  verified(await stats(page), traffic);
});
