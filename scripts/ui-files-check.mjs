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

await page.getByPlaceholder('https://api.deepseek.com').fill('http://127.0.0.1:5399');
await page.getByPlaceholder('deepseek-chat').fill('mock-model');
await page.locator('.ds-chip').filter({ hasText: '连接设置' }).click();
await page.waitForTimeout(200);

// 没有 key 时上传按钮禁用
const uploadButton = page.locator('.ds-files__row button').filter({ hasText: '上传' });
check(await uploadButton.isDisabled(), '没有 key 时上传按钮禁用');

// 填写 key 后刷新列表
await page.locator('.ds-advanced__keyrow input[type=password]').first().fill('test-key');
await page.waitForTimeout(200);
check(!(await uploadButton.isDisabled()), '填写 key 后上传按钮可用');
await page.locator('.ds-files__row button').filter({ hasText: '刷新列表' }).click();
await page.waitForTimeout(500);
const listText = await page.locator('.ds-files__list').innerText().catch(() => '');
check(listText.includes('mock-report.pdf'), '文件列表加载 mock 文件');
check(listText.includes('file-api-mock-1'), '文件列表显示 file_id');

// 上传
const fs = await import('node:fs');
const tmp = 'C:\\Users\\30775\\AppData\\Local\\Temp\\files-upload-test.txt';
fs.writeFileSync(tmp, 'hello file api');
await page.locator('.ds-files input[type=file]').setInputFiles(tmp);
await page.waitForTimeout(800);
const afterUpload = await page.locator('.ds-files__list').innerText().catch(() => '');
check(afterUpload.includes('mock-report.pdf'), '上传后列表刷新');
check(errors.length === 0, `无 JS 报错 (${errors.length})`);

console.log(JSON.stringify({ results, errors, failures: results.filter((r) => r.startsWith('FAIL')) }, null, 2));
await browser.close();
