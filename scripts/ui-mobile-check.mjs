import { chromium } from 'playwright-core';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto('http://127.0.0.1:5300/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.getByPlaceholder('https://api.deepseek.com').fill('http://127.0.0.1:5399');
await page.getByPlaceholder('deepseek-chat').fill('mock-model');
await page.waitForTimeout(300);

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
console.log('overflow-x:', overflow);
console.log('studio tab visible:', await page.locator('.ds-worktabs').isVisible());
await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\m1-studio.png' });

// 抽屉
await page.locator('.ds-brand__collapse').click();
await page.waitForTimeout(400);
console.log('drawer open:', await page.locator('.ds-app.drawer-open').count());
await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\m2-drawer.png' });
await page.mouse.click(360, 420);
await page.waitForTimeout(400);
console.log('drawer closed:', (await page.locator('.ds-app.drawer-open').count()) === 0);

// 响应面板切换
await page.locator('.ds-pane-toggle').click();
await page.waitForTimeout(300);
console.log('show-response:', await page.locator('.ds-app.show-response').count());
await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\m3-response.png' });
await page.locator('.ds-pane-toggle').click();
await page.waitForTimeout(300);

// Chat 模式
await page.locator('.ds-modeswitch button').filter({ hasText: 'Chat' }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\m4-chat.png' });

const chatInput = page.locator('.ds-chat__box textarea');
await chatInput.fill('手机端测试');
await chatInput.press('Enter');
await page.waitForTimeout(3500);
console.log('chat bubbles:', await page.locator('.ds-chat-msg').count());
await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\m5-chat-done.png' });

console.log('errors:', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
