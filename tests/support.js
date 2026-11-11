import { expect } from '@playwright/test';

export function monitor(page, baseURL) {
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /context lost|GL_INVALID|shader error/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('blob:')) requests.push(url);
    if (url.startsWith('http') && new URL(url).origin !== baseURL) errors.push(`Unexpected network request ${url}`);
  });
  page.on('requestfailed', request => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      errors.push(`${request.url()} failed with ${request.failure()?.errorText}`);
    }
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} from ${response.url()}`);
  });
  return { errors, requests };
}

export async function capture(page, testInfo, name, checkWorld = true) {
  const path = testInfo.outputPath(`${name}.png`);
  const screenshot = await page.screenshot({ path, timeout: 25_000 });
  if (!checkWorld) return path;
  const image = await page.evaluate(async base64 => {
    const source = new Image();
    source.src = `data:image/png;base64,${base64}`;
    await source.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 72;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0, total = 0, squared = 0, black = 0, saturated = 0;
    for (let y = 15; y < 61; y++) {
      for (let x = 22; x < 106; x++) {
        const offset = (y * canvas.width + x) * 4;
        const luma = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
        count++;
        total += luma;
        squared += luma * luma;
        if (luma < 7) black++;
        if (luma > 248) saturated++;
      }
    }
    const average = total / count;
    return {
      average,
      deviation: Math.sqrt(squared / count - average * average),
      blackFraction: black / count,
      whiteFraction: saturated / count,
    };
  }, screenshot.toString('base64'));
  expect(image.average, `${name} mean luminance`).toBeGreaterThan(18);
  expect(image.deviation, `${name} contrast`).toBeGreaterThan(10);
  expect(image.blackFraction, `${name} black-world fraction`).toBeLessThan(0.30);
  expect(image.whiteFraction, `${name} blown-out fraction`).toBeLessThan(0.64);
  return path;
}

