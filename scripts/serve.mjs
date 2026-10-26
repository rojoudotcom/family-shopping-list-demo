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

// /pr/ の下は、いま開いている Copilot の PR（ブランチ名が copilot/ で始まるもの）のファイルを
// GitHub から取ってきて返す。手元を main のままにして、マージ前の画面をローカルで見るため。
const REPO = 'rojoudotcom/family-shopping-list-demo';

async function findPrBranch() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/pulls?state=open`);
  if (!response.ok) {
    return null;
  }
  const pulls = await response.json();
  const pr = pulls.find((pull) => pull.head.ref.startsWith('copilot/'));
  return pr ? pr.head.ref : null;
}

async function servePr(relativePath, res) {
  const branch = await findPrBranch();
  if (!branch) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('開いている Copilot の PR がありません');
    return;
  }
  const rest = relativePath.replace(/^[/\\]*pr[/\\]?/, '');
  const filePath = rest === '' || rest.endsWith('/') ? `${rest}index.html` : rest;
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${branch}/${filePath}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  // クエリ文字列を取り除き、ROOT より上の階層への遡り（パストラバーサル）を防ぐ。
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relativePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  if (requestPath === '/pr' || requestPath.startsWith('/pr/')) {
    if (requestPath === '/pr') {
      res.writeHead(301, { Location: '/pr/' });
      res.end();
      return;
    }
    await servePr(relativePath, res);
    return;
  }
  // 末尾が「/」のパス（/ や /mock/）は、そのフォルダの index.html を返す。
  const filePath = join(
    ROOT,
    relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath,
  );

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      // デモ中に画面を直したとき、再読み込みで必ず新しいファイルを読むようにする
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    // フォルダを「/」なしで開いたとき（/mock など）は、「/」付きの URL へ送り直す。
    if (error.code === 'EISDIR') {
      // 先頭の「/」は1つにそろえ、別のサイトへの送り直し（//example.com）にならないようにする。
      const location = encodeURI(`/${relativePath.replace(/^[/\\]+/, '')}/`);
      res.writeHead(301, { Location: location });
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`${ROOT} を http://localhost:${PORT} で配信しています`);
  console.log(`Copilot の PR の画面は http://localhost:${PORT}/pr/ で見られます`);
});
