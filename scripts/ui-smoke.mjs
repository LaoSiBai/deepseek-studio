import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:5300/';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:5399';
const outDir = process.env.OUT_DIR || path.join(os.tmpdir(), 'dss-shots');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });

await page.getByPlaceholder('https://api.deepseek.com').fill(MOCK);
await page.getByPlaceholder('deepseek-chat').fill('mock-model');
await page.getByPlaceholder('输入消息内容').fill('请验证流式链路');
await page.screenshot({ path: path.join(outDir, '01-ready.png') });

await page.getByRole('button', { name: /发送/ }).click();
await page.waitForTimeout(280);
await page.screenshot({ path: path.join(outDir, '02-streaming.png') });
await page.waitForTimeout(1400);
await page.screenshot({ path: path.join(outDir, '03-done.png') });

// 原始输出 / Markdown 渲染切换
const rawToggle = page.locator('.ds-segmented button').filter({ hasText: '原始' });
await rawToggle.click();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(outDir, '03b-raw.png') });
await page.locator('.ds-segmented button').filter({ hasText: 'Markdown' }).click();
await page.waitForTimeout(200);

const status = await page.locator('.ds-status').innerText();
const content = await page.locator('.ds-md').innerText().catch(() => '');
const metrics = await page.locator('.ds-metrics').innerText();
const reasoning = await page.locator('.ds-reasoning__text').innerText().catch(() => '');
const framesTab = page.getByRole('button', { name: /流式帧/ });
await framesTab.click();
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(outDir, '04-frames.png') });

const paramsTab = page.getByRole('button', { name: /^参数/ });
await paramsTab.click();
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(outDir, '05-params.png') });

const rawTab = page.getByRole('button', { name: /请求体/ });
await rawTab.click();
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(outDir, '06-raw.png') });

console.log(JSON.stringify({ status, content, reasoning, metrics, errors, outDir }, null, 2));
await browser.close();
