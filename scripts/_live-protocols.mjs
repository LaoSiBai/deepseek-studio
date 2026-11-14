import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  proxy: { server: 'http://127.0.0.1:7890' },
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto('https://studio.laosibai.com/', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(600);
await page.locator('.ds-provider select').selectOption('minimax-intl');
await page.waitForTimeout(300);
const baseUrl = await page.getByPlaceholder('https://api.deepseek.com').inputValue();
const path = await page.getByPlaceholder('/chat/completions').inputValue();
console.log('baseUrl:', baseUrl);
console.log('path:', path);
await page.locator('.ds-chip').filter({ hasText: '连接设置' }).click();
const protocol = await page
  .locator('.ds-advanced__block')
  .filter({ hasText: '协议' })
  .locator('select')
  .inputValue();
console.log('protocol:', protocol);
console.log('errors:', errors.length, errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\live-protocols.png' });
await browser.close();
