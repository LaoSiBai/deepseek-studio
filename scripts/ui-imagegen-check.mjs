import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
const check = (ok, label) => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`);

await page.goto('http://127.0.0.1:5300/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// 填本地 key（生图复用连接设置里的 key）
await page.locator('.ds-chip').filter({ hasText: '连接设置' }).click();
await page.locator('.ds-advanced__keyrow input[type=password]').first().fill('test-key');
await page.locator('.ds-chip').filter({ hasText: '连接设置' }).click();

// 切到生图
await page.locator('.ds-modeswitch button').filter({ hasText: '生图' }).click();
await page.waitForTimeout(400);
check((await page.locator('.ds-imagegen').count()) === 1, '生图模式渲染');
check((await page.locator('.ds-imagegen__empty').count()) === 1, '空状态提示');

// 生成
await page.locator('.ds-imagegen__prompt').fill('一只橘猫趴在窗台晒太阳');
await page.getByPlaceholder('https://api.minimaxi.com').fill('http://127.0.0.1:5399');
await page.locator('.ds-imagegen__go').click();
await page.locator('.ds-imagegen__card').first().waitFor({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);

check((await page.locator('.ds-imagegen__card').count()) === 1, '生成结果卡片出现');
check((await page.locator('.ds-imagegen__card img').count()) === 1, '结果图片渲染');
const meta = await page.locator('.ds-imagegen__meta').innerText().catch(() => '');
check(meta.includes('1 张成功'), '成功计数正确');

// 切走再回来，结果仍在（模块级缓存）
await page.locator('.ds-modeswitch button').filter({ hasText: 'Chat' }).click();
await page.waitForTimeout(300);
await page.locator('.ds-modeswitch button').filter({ hasText: '生图' }).click();
await page.waitForTimeout(300);
check((await page.locator('.ds-imagegen__card').count()) === 1, '切换模式后保留结果');

check(errors.length === 0, `无 JS 报错 (${errors.length})`);
await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\imagegen.png' });
console.log(JSON.stringify({ results, errors, failures: results.filter((r) => r.startsWith('FAIL')) }, null, 2));
await browser.close();
