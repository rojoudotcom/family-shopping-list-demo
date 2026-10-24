// 企画のワークベンチ：ブラウザから AI に文書を書かせる小さな画面。画面は2つある。
// - 顧客管理（CRM）：営業・サポート担当者が、ヒアリングのアジェンダ・議事録を作り、エンドユーザの声を登録する
// - 文書ツール：企画担当者が、議事録やエンドユーザの声から PRD を作る
// 依存パッケージゼロ（Node 標準ライブラリだけ）。データベースは使わず、結果はリポジトリ内のファイルに残る。
// 起動：`npm run workbench` → http://127.0.0.1:4174
//
// AI には GitHub Copilot CLI を子プロセスとして呼ぶ。VS Code の `/agenda` などと同じ
// `.github/prompts/<名前>.prompt.md` の本文に、画面で選んだファイル名を足して渡す。

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir, stat, access, writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_DIRS,
  appendVoiceRecord,
  buildAnswerText,
  diffSnapshots,
  formatDate,
  nextFreePath,
  normalizeRepoPath,
  parseChecklistQuestions,
  parseJsonLoose,
  parseQuestions,
  parseResumeId,
  redactSecrets,
  stripFrontmatter,
  cleanReply,
  validateVoiceRecord,
} from './lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT) || 4174;
const HOST = '127.0.0.1';
// copilot が PATH に無い環境では、COPILOT_BIN で実行ファイルの場所を指定できる。
const COPILOT_BIN = process.env.COPILOT_BIN || 'copilot';
const COPILOT_TIMEOUT_MS = 180_000;
// 文字起こしは擬似。用意した文字起こしを、待ち時間を見せてから返す。
const TRANSCRIBE_DELAY_MS = 3_000;
const MAX_JSON_BYTES = 1024 * 1024;
// 顧客管理の本体。エンドユーザの声の記録を、配列の JSON で持つ。書き込むのはこのサーバだけ。
const CRM_FILE = 'docs/crm/エンドユーザの声.json';

// Copilot に許さない操作。push・commit・GitHub への書き込みは人がやる。
const DENY_FLAGS = [
  '--deny-tool',
  'shell(git push)',
  '--deny-tool',
  'shell(gh)',
  '--deny-tool',
  'shell(git commit)',
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
};

// 画面の一覧に出す置き場。フォルダが無ければ空にする。
const LIST_DIRS = {
  customer: 'docs/customer',
  minutes: 'docs/minutes',
  hearing: 'docs/hearing',
  prd: 'docs/prd',
  audio: 'audio',
};

// 画面に出すエラーは、技術用語を使わない日本語にそろえる。
class UserError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const abs = (relPath) => join(ROOT, relPath);
const exists = async (relPath) =>
  access(abs(relPath)).then(
    () => true,
    () => false,
  );

async function listDir(relDir) {
  try {
    const entries = await readdir(abs(relDir), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const path = `${relDir}/${entry.name}`;
      const { size } = await stat(abs(path));
      files.push({ name: entry.name, path, size });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  } catch {
    return [];
  }
}

// 置き場の中のファイルの更新時刻を控える（Copilot が何を書いたかを、前後の比較で見つけるため）。
async function snapshot(relDir) {
  const map = new Map();
  for (const file of await listDir(relDir)) {
    map.set(file.path, (await stat(abs(file.path))).mtimeMs);
  }
  return map;
}

// 画面から来たパスを検査し、許した置き場の、実在するファイルだけを通す。
async function checkPath(input, allowedDirs = ALLOWED_DIRS) {
  const relPath = normalizeRepoPath(input, allowedDirs);
  if (!relPath || !(await exists(relPath))) {
    throw new UserError(400, `選んだファイルが見つかりません：${String(input ?? '')}`);
  }
  return relPath;
}

async function checkPaths(list, allowedDirs) {
  if (list === undefined || list === null || list === '') return [];
  const items = Array.isArray(list) ? list : [list];
  return Promise.all(items.filter(Boolean).map((p) => checkPath(p, allowedDirs)));
}

// Copilot CLI を1回呼ぶ。resumeId があれば、その会話の続きとして呼ぶ（--continue は使わない。
// 同時に複数の実行があると「直前の会話」が別のものになるため）。
function runCopilot(text, resumeId) {
  const args = [];
  if (resumeId) args.push(`--resume=${resumeId}`);
  args.push('-p', text, '--allow-all-tools', '--disable-builtin-mcps', ...DENY_FLAGS);

  return new Promise((resolve, reject) => {
    // シェルを通さず引数の配列で渡すので、画面の入力がコマンドとして解釈されることはない。
    const child = spawn(COPILOT_BIN, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, COPILOT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        error.code === 'ENOENT'
          ? new UserError(
              500,
              'AI（GitHub Copilot）が見つかりません。このパソコンに Copilot の道具を入れ、サインインしてください。',
            )
          : error,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new UserError(
            504,
            'AI の返事が3分を過ぎても来なかったので止めました。もう一度押してください。',
          ),
        );
        return;
      }
      if (code !== 0) {
        // 詳細はサーバの画面にだけ出す（サインインの案内などを画面に流さない）。
        console.error(`copilot が終了コード ${code} で止まりました:\n${redactSecrets(stderr)}`);
        reject(
          new UserError(
            502,
            'AI（GitHub Copilot）がうまく動きませんでした。サインインとネットワークを確かめて、もう一度押してください。',
          ),
        );
        return;
      }
      resolve({
        reply: redactSecrets(cleanReply(stdout)),
        sessionId: parseResumeId(stderr) || parseResumeId(stdout),
      });
    });
  });
}

// AI やこのサーバが書いた Markdown と JSON を、リポジトリの Prettier で整える（CI の Lint で落ちないように）。
// Prettier が入っていなければ何もしない。整形に失敗しても、文書はそのまま返す。
async function formatDocs(paths) {
  const prettier = abs('node_modules/.bin/prettier');
  const targets = paths.filter((p) => p.endsWith('.md') || p.endsWith('.json'));
  if (targets.length === 0 || !(await exists('node_modules/.bin/prettier'))) return;
  await new Promise((resolve) => {
    const child = spawn(prettier, ['--write', ...targets], { cwd: ROOT, stdio: 'ignore' });
    child.on('error', resolve);
    child.on('close', resolve);
  });
}

// 指示ファイルの本文＋依頼文で Copilot を呼び、対象の置き場で書き換わったファイルを返す。
async function runPrompt({ prompt, input, resumeId, watchDir }) {
  let text = input;
  if (prompt) {
    const body = stripFrontmatter(
      await readFile(abs(`.github/prompts/${prompt}.prompt.md`), 'utf8'),
    );
    text = `${body}\n${input}`;
  }
  const before = await snapshot(watchDir);
  const started = Date.now();
  const result = await runCopilot(text, resumeId);
  const changed = diffSnapshots(before, await snapshot(watchDir));
  await formatDocs(changed);
  const files = await Promise.all(
    changed.map(async (path) => ({ path, content: await readFile(abs(path), 'utf8') })),
  );
  return { ...result, files, seconds: Math.round((Date.now() - started) / 1000) };
}

const bullet = (label, paths) => paths.map((p) => `- ${label}：${p}`);

async function handleAgenda(body) {
  const user = await checkPaths(body.user, ['docs/customer']);
  const inquiries = await checkPaths(body.inquiries, ['docs/customer', 'docs/crm']);
  const minutes = await checkPaths(body.minutes, ['docs/minutes']);
  if (user.length + inquiries.length + minutes.length === 0) {
    throw new UserError(400, '読ませるファイルを1つ以上選んでください。');
  }
  const savePath = nextFreePath('docs/hearing', `${formatDate()}_アジェンダ`, '.md', (p) =>
    knownPaths.has(p),
  );
  const input = [
    '次のファイルを読んで、次のヒアリングのアジェンダを作ってください。',
    ...bullet('エンドユーザの情報', user),
    ...bullet('これまでの問い合わせ', inquiries),
    ...bullet('過去の議事録', minutes),
    `保存先：${savePath}（このファイル名で新しく保存してください）`,
  ].join('\n');
  return runPrompt({ prompt: 'agenda', input, watchDir: 'docs/hearing' });
}

async function handleTranscribe(body) {
  const audio = await checkPath(body.path, ['audio']);
  const stem = basename(audio, extname(audio));
  const transcriptPath = `docs/hearing/${stem}_文字起こし.txt`;
  // 擬似の文字起こし：画面に待ち時間を見せてから、用意したテキストを返す。
  await new Promise((resolve) => setTimeout(resolve, TRANSCRIBE_DELAY_MS));
  if (!(await exists(transcriptPath))) {
    throw new UserError(404, 'この録音の文字起こしは用意されていません');
  }
  return { path: transcriptPath, content: await readFile(abs(transcriptPath), 'utf8') };
}

async function handleMinutes(body) {
  const transcript = await checkPath(body.transcript, ['docs/hearing']);
  // 「…_文字起こし.txt」「…_台本.md」から、録音の名前の部分だけを取り出して議事録の名前にする。
  const stem = basename(transcript, extname(transcript)).replace(/_(文字起こし|台本)$/, '');
  const savePath = nextFreePath('docs/minutes', stem, '.md', (p) => knownPaths.has(p));
  const input = `${transcript}\n\n保存先：${savePath}（このファイル名で新しく保存してください）`;
  return runPrompt({ prompt: 'minutes', input, watchDir: 'docs/minutes' });
}

async function readCrm() {
  try {
    const records = JSON.parse(await readFile(abs(CRM_FILE), 'utf8'));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

// 文字起こしから、エンドユーザの声を1件、顧客管理に登録する。
// AI には登録待ちの JSON を書かせ、このサーバが形と「そのままの言葉」を確かめてから本体に足す。
async function handleCrm(body) {
  const transcript = await checkPath(body.transcript, ['docs/hearing']);
  const records = await readCrm();
  if (records.some((r) => r.登録元 === transcript)) {
    throw new UserError(409, 'この文字起こしは、もう顧客管理に登録してあります。');
  }
  const stem = basename(transcript, extname(transcript)).replace(/_(文字起こし|台本)$/, '');
  const draftPath = `docs/crm/登録待ち_${stem}.json`;
  const crmBefore = await readFile(abs(CRM_FILE), 'utf8').catch(() => null);
  const input = `${transcript}\n\n保存先：${draftPath}（このファイル名で保存してください）`;
  const result = await runPrompt({ prompt: 'crm', input, watchDir: 'docs/crm' });

  // 本体は AI に書き換えさせない。書き換わっていたら元に戻す。
  const crmAfter = await readFile(abs(CRM_FILE), 'utf8').catch(() => null);
  if (crmBefore !== null && crmAfter !== crmBefore) await writeFile(abs(CRM_FILE), crmBefore);

  const draft =
    result.files.find((f) => f.path === draftPath) ||
    result.files.find((f) => f.path.endsWith('.json') && f.path !== CRM_FILE);
  if (!draft) {
    throw new UserError(
      502,
      'AI は返事をしましたが、登録する記録が見つかりませんでした。もう一度押してください。',
    );
  }
  let record;
  try {
    record = parseJsonLoose(draft.content);
  } catch {
    throw new UserError(
      422,
      `AI が書いた記録を読み取れなかったので、登録しませんでした（${draft.path}）。`,
    );
  }
  const errors = validateVoiceRecord(record, await readFile(abs(transcript), 'utf8'));
  if (errors.length > 0) {
    throw new UserError(
      422,
      `記録に直すところがあったので、登録しませんでした（${draft.path}）。${errors.join(' ')}`,
    );
  }
  const updated = appendVoiceRecord(records, record, transcript);
  await writeFile(abs(CRM_FILE), `${JSON.stringify(updated, null, 2)}\n`);
  await formatDocs([CRM_FILE]);
  await unlink(abs(draft.path)).catch(() => {});
  return {
    sessionId: result.sessionId,
    seconds: result.seconds,
    path: CRM_FILE,
    record: updated[updated.length - 1],
    records: updated,
  };
}

async function handlePrd(body) {
  const sources = await checkPaths(body.sources);
  const request = String(body.request ?? '').trim();
  if (sources.length === 0 && !request) {
    throw new UserError(400, '読ませる資料を1つ以上選ぶか、依頼を書いてください。');
  }
  // 画面の「依頼」は範囲の補足として渡す。依頼の文だけを置くと、そこに書いた話題（たとえば
  // 「次の段階にする」と書いた共有の仕組み）を PRD の題材と読み違えることがあったため。
  const input = [
    '読むファイルに書かれた困りごとについて、PRD を書いてください。',
    ...(request ? [`依頼の補足：${request}`] : []),
    '',
    '読むファイル：',
    ...sources.map((p) => `- ${p}`),
    '',
    '保存先：docs/prd/ に、機能の名前をファイル名にして新しく保存してください。docs/prd/ にすでにあるファイルは書き換えません。',
  ].join('\n');
  const result = await runPrompt({ prompt: 'prd', input, watchDir: 'docs/prd' });
  const prd = result.files.find((f) => f.path.endsWith('.md')) || null;
  let questions = parseQuestions(result.reply);
  if (questions.length === 0 && prd) questions = parseChecklistQuestions(prd.content);
  return { ...result, prd, questions };
}

async function handlePrdAnswer(body) {
  const sessionId = String(body.sessionId ?? '');
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(sessionId)) {
    throw new UserError(
      400,
      'PRD を書いたときの会話が見つかりません。もう一度「PRD を書く」から始めてください。',
    );
  }
  const questions = Array.isArray(body.questions) ? body.questions : [];
  const text = buildAnswerText(body.answers, body.reasons, questions);
  if (!text) throw new UserError(400, '答えを1つ以上選んでください。');
  const result = await runPrompt({ input: text, resumeId: sessionId, watchDir: 'docs/prd' });
  let prd = result.files.find((f) => f.path.endsWith('.md')) || null;
  // 書き換わったファイルが見つからなければ、画面が覚えている PRD を読み直して返す。
  if (!prd && body.prdPath) {
    const path = await checkPath(body.prdPath, ['docs/prd']);
    prd = { path, content: await readFile(abs(path), 'utf8') };
  }
  // まだ残っている質問を PRD の「決まっていないこと」から拾い直し、続けて答えられるようにする。
  return { ...result, prd, questions: prd ? parseChecklistQuestions(prd.content) : [] };
}

async function handleFiles() {
  const result = {};
  for (const [key, dir] of Object.entries(LIST_DIRS)) result[key] = await listDir(dir);
  return result;
}

// nextFreePath は同期の exists を求めるので、呼ぶ直前に置き場の一覧を控えておく。
let knownPaths = new Set();
async function refreshKnownPaths() {
  const all = await handleFiles();
  knownPaths = new Set(Object.values(all).flatMap((files) => files.map((f) => f.path)));
}

// 録音を再生するための配信。シーク（途中から再生）のために Range に対応する。
async function serveAudio(req, res, url) {
  const relPath = await checkPath(url.searchParams.get('path'), ['audio']);
  const { size } = await stat(abs(relPath));
  const type = MIME_TYPES[extname(relPath).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(abs(relPath), { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(abs(relPath)).pipe(res);
}

// workbench/public/ の中だけを配信する。
async function serveStatic(res, pathname) {
  const relative = normalize(pathname === '/' ? 'index.html' : pathname).replace(
    /^([/\\]|\.\.[/\\])+/,
    '',
  );
  const filePath = join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) throw new UserError(404, 'ページが見つかりません');
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'text/plain; charset=utf-8',
    });
    res.end(body);
  } catch {
    throw new UserError(404, 'ページが見つかりません');
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(new UserError(413, '送った内容が大きすぎます。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new UserError(400, '送った内容を読み取れませんでした。'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

// ほかのサイトからこの画面の AI を勝手に動かされないための確認。
// - Host がこのパソコン自身であること（DNS の付け替えによる攻撃を防ぐ）
// - Origin が付いていれば、この画面自身であること
// - 書き込み系は Content-Type が application/json であること（よそのページからは事前確認なしに送れない）
function isTrustedRequest(req) {
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !allowedHosts.some((h) => origin === `http://${h}`)) return false;
  if (
    req.method === 'POST' &&
    !String(req.headers['content-type']).startsWith('application/json')
  ) {
    return false;
  }
  return true;
}

const ROUTES = {
  'POST /api/agenda': handleAgenda,
  'POST /api/transcribe': handleTranscribe,
  'POST /api/minutes': handleMinutes,
  'POST /api/crm': handleCrm,
  'POST /api/prd': handlePrd,
  'POST /api/prd/answer': handlePrdAnswer,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (!isTrustedRequest(req)) throw new UserError(403, 'この画面の外からは使えません。');
    if (req.method === 'GET' && url.pathname === '/api/files') {
      sendJson(res, 200, await handleFiles());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/crm') {
      sendJson(res, 200, { path: CRM_FILE, records: await readCrm() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/audio') {
      await serveAudio(req, res, url);
      return;
    }
    const handler = ROUTES[`${req.method} ${url.pathname}`];
    if (handler) {
      const body = await readJson(req);
      await refreshKnownPaths();
      const started = Date.now();
      const data = await handler(body);
      console.log(`${req.method} ${url.pathname} ${Math.round((Date.now() - started) / 1000)}秒`);
      sendJson(res, 200, data);
      return;
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      await serveStatic(res, url.pathname);
      return;
    }
    throw new UserError(404, 'ページが見つかりません');
  } catch (error) {
    if (!(error instanceof UserError)) console.error(error);
    const status = error instanceof UserError ? error.status : 500;
    const message =
      error instanceof UserError
        ? error.message
        : '思わぬ失敗が起きました。もう一度押してください。';
    if (!res.headersSent) sendJson(res, status, { error: message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`企画のワークベンチを http://${HOST}:${PORT} で開いています（終了は Ctrl-C）`);
});
