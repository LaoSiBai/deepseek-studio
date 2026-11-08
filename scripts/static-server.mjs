import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const port = Number(process.env.PORT || 5302);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

http
  .createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const relative = requestPath === '/' ? '/index.html' : requestPath;
    const filePath = path.join(root, relative);
    const inside = filePath.startsWith(root);

    if (inside && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, {
        'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(fs.readFileSync(filePath));
      return;
    }

    // 静态站点没有 /api/*，对 SPA 回退到 index.html（模拟 GitHub Pages 的 404 行为）
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(root, 'index.html')));
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`static server on http://127.0.0.1:${port}`);
  });
