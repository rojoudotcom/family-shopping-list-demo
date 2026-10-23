// 依存パッケージゼロ（Node 標準ライブラリだけ）の小さな静的ファイルサーバ。
// ローカルで動作確認するとき（`npm run serve`）に使います。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  // クエリ文字列を取り除き、ROOT より上の階層への遡り（パストラバーサル）を防ぐ。
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relativePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(ROOT, relativePath === '/' ? 'index.html' : relativePath);

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`${ROOT} を http://localhost:${PORT} で配信しています`);
});
