import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto('http://127.0.0.1:5302/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.getByPlaceholder('https://api.deepseek.com').fill('http://127.0.0.1:5399');
await page.getByPlaceholder('deepseek-chat').fill('mock-model');
await page.locator('.ds-send').click();
await page.locator('.ds-status').filter({ hasText: 'HTTP 200' }).waitFor({ timeout: 12000 });
await page.waitForTimeout(500);

console.log('status:', await page.locator('.ds-status').innerText());
console.log('content:', (await page.locator('.ds-md').innerText()).slice(0, 40).replace(/\n/g, ' '));
await page.locator('.ds-chip').filter({ hasText: '连接设置' }).click();
await page.waitForTimeout(300);
console.log('transport:', await page.locator('.ds-advanced__url').last().innerText());
console.log('errors:', errors.length, errors.slice(0, 2).join(' | '));

await browser.close();
