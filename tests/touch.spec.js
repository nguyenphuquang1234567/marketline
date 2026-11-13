import { expect, test } from '@playwright/test';

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
});

test('touch controls support moving, aiming and firing with independent fingers', async ({ page, context }, testInfo) => {
  await page.goto('/?qa');
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'ready');
  await page.locator('#settings').tap();
  await expect(page.getByLabel('Graphics')).toHaveValue('Low');
  await page.locator('#close-settings').tap();
  await page.locator('#deploy').tap();
  const controls = page.locator('#touch-controls');
  await expect(controls).toBeVisible();
  const snapshot = () => page.evaluate(() => window.__marketline.snapshot());
  expect((await snapshot()).pointerLock).toBe(false);

  const cdp = await context.newCDPSession(page);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const move = { id: 1, x: 150, y: 252 };
  const aim = { id: 2, x: 500, y: 170 };
  const sprint = controls.getByRole('button', { name: 'Sprint' });
  await sprint.tap();
  await expect(sprint).toHaveAttribute('aria-pressed', 'true');
  const initial = await snapshot();
  await send('touchStart', [move, aim]);
  move.y -= 62;
  aim.x += 28;
  await send('touchMove', [move, aim]);
  await expect(controls.locator('.touch-stick')).toBeVisible();
  await expect.poll(async () => {
    const current = (await snapshot()).position;
    return Math.hypot(current[0] - initial.position[0], current[2] - initial.position[2]);
  }).toBeGreaterThan(.5);
  expect(Math.abs((await snapshot()).yaw - initial.yaw)).toBeGreaterThan(.05);
  await page.screenshot({ path: testInfo.outputPath('landscape.png') });
  await send('touchCancel', []);
  await expect(controls.locator('.touch-stick')).toBeHidden();

  await controls.getByRole('button', { name: 'Aim' }).tap();
  await expect.poll(async () => (await snapshot()).ads).toBeGreaterThan(.85);
  const fire = controls.getByRole('button', { name: 'Fire' });
  const box = await fire.boundingBox();
  const finger = { id: 3, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const before = await snapshot();
  await send('touchStart', [finger]);
  finger.x -= 30;
  await send('touchMove', [finger]);
  await expect.poll(async () => (await snapshot()).ammo).toBeLessThan(before.ammo - 1);
  expect(Math.abs((await snapshot()).yaw - before.yaw)).toBeGreaterThan(.02);
  await send('touchCancel', []);
  await expect(fire).not.toHaveClass(/active/);

  await controls.getByRole('button', { name: 'Reload' }).tap();
  await expect.poll(async () => (await snapshot()).ammo).toBe(30);
  await controls.getByRole('button', { name: 'Pause' }).tap();
  await expect(controls).toBeHidden();
  await expect(page.locator('#menu')).toHaveAttribute('data-phase', 'pause');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#deploy').tap();
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Aim' })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('portrait.png') });
});
