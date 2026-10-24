// 企画のワークベンチ（workbench/server.mjs）が使う、副作用のない小さな関数たち。
// ファイルも子プロセスも触らないので、ユニットテスト（test/unit/workbench.test.js）で
// 入力と出力を突き合わせるだけで確かめられます。

import { posix } from 'node:path';

// 画面から指定できるファイルの置き場。ここに無い場所のパスは受け付けない。
export const ALLOWED_DIRS = [
  'docs/customer',
  'docs/minutes',
  'docs/hearing',
  'docs/prd',
  'docs/crm',
  'audio',
];

// ディレクトリ以外で、名指しで読ませてよいファイル（PRD の「いまのアプリの機能」）。
export const ALLOWED_FILES = ['README.md'];

// `.prompt.md` の先頭にある `---` で囲まれた設定部分（frontmatter）を取り除き、本文だけ返す。
export function stripFrontmatter(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trim() !== '---') return lines.join('\n').trim();
  const end = lines.indexOf('---', 1);
  if (end === -1) return lines.join('\n').trim();
  return lines
    .slice(end + 1)
    .join('\n')
    .trim();
}

// Copilot が最後に表示する「Resume  copilot --resume=<id>」の行から、会話の続きに使う id を取り出す。
export function parseResumeId(output) {
  const match = /--resume=([0-9a-zA-Z-]{8,64})/.exec(String(output));
  return match ? match[1] : null;
}

// Copilot の返事に並ぶ「番号つきの質問＋選択肢」を、画面のラジオボタン用の形に直す。
// 実際に見た形は2通りある（記号の後ろの「.」は付くときと付かないときがある）：
//   1. 買った品目は、どう見せますか？
//      - A. 末尾へ移す
//      - B 一覧から隠す
//   2. すでに2行の品目は、どう扱いますか。（A. 利用者が消す／B. 自動でまとめる）
// 選択肢が2つ以上ある質問だけを残す。1件も取れなければ空の配列を返す。
const OPTION_LINE = /^\s*(?:[-*・]\s*)?(?:[(（]\s*)?([A-DＡ-Ｄ])(?:\s*[.．)）:：、]\s*|\s+)(.+)$/;
const KEYED_LABEL = /^([A-DＡ-Ｄ])(?:\s*[.．)）:：、]\s*|\s+)(.+)$/;
const INLINE_OPTIONS =
  /^(.*?)[（(]\s*(?:選択肢[:：]\s*)?([A-DＡ-Ｄ](?:\s*[.．:：、]\s*|\s+).+?)[）)]\s*[。.]?\s*$/;

export function parseQuestions(text) {
  const questions = [];
  let current = null;
  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\*\*/g, '').trimEnd();
    const question = /^\s{0,3}(?:#{1,6}\s*)?(?:Q)?(\d{1,2})[.．)）、]\s*(.+)$/.exec(line);
    const option = OPTION_LINE.exec(line);
    if (option && current && /^\s+|^\s*[-*・(（]/.test(line)) {
      current.options.push({ key: toAsciiUpper(option[1]), label: option[2].trim() });
    } else if (question) {
      // 選択肢が同じ行の括弧の中にあれば、それを使う。
      const inline = INLINE_OPTIONS.exec(question[2]);
      current = inline
        ? {
            no: Number(question[1]),
            text: cleanQuestionText(inline[1]),
            options: toOptions(inline[2]),
          }
        : { no: Number(question[1]), text: cleanQuestionText(question[2]), options: [] };
      questions.push(current);
    }
  }
  return questions.filter((q) => q.options.length >= 2);
}

// PRD 本文の「決まっていないこと」に書かれた
//   - [ ] 質問（選択肢：A／B）
//   1. 質問（選択肢：A. …／B. …）
// という行からも質問を拾う（返事の形が想定と違ったときの予備）。
export function parseChecklistQuestions(markdown) {
  const questions = [];
  for (const line of String(markdown).split('\n')) {
    const match =
      /^\s*(?:[-*]\s*(?:\[[ xX]\]\s*)?)?(.+?)[（(]選択肢[:：]\s*(.+?)[）)]\s*[。.]?\s*$/.exec(line);
    if (!match) continue;
    const options = toOptions(match[2]);
    if (options.length < 2) continue;
    questions.push({
      // 「Q2. 質問」のように番号が付いていれば、その番号を使い（AI と同じ番号で答えるため）、文からは外す。
      no:
        Number(/^\s*(?:Q\s*)?(\d{1,2})\s*[.．)）:：]/i.exec(match[1])?.[1]) || questions.length + 1,
      text: cleanQuestionText(match[1]),
      options,
    });
  }
  return questions;
}

// 「A. 残す／B. 末尾へ移す」や「残す／末尾へ移す」を選択肢の配列にする。
// 「A 残す」「A. 残す」のように記号が付いていればその記号を使い、無ければ A, B, C … を振る。
function toOptions(labelsText) {
  return labelsText
    .split(/[／/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label, i) => {
      const keyed = KEYED_LABEL.exec(label);
      return keyed
        ? { key: toAsciiUpper(keyed[1]), label: keyed[2].trim() }
        : { key: 'ABCD'[i] || String(i + 1), label };
    });
}

// 質問の文の先頭に重ねて付く「Q1.」「1.」を外す。
function cleanQuestionText(text) {
  return text.replace(/^\s*(?:Q\s*)?\d{1,2}\s*[.．)）:：]\s*/i, '').trim();
}

function toAsciiUpper(ch) {
  const code = ch.charCodeAt(0);
  // 全角の Ａ〜Ｄ を半角に直す。
  const ascii = code >= 0xff21 && code <= 0xff3a ? String.fromCharCode(code - 0xfee0) : ch;
  return ascii.toUpperCase();
}

// 画面で選んだ答えを、Copilot に返す日本語の文にする。
// answers は {1: 'B'}、reasons は {1: '理由'}、questions は parseQuestions の結果（選択肢の文言に使う）。
export function buildAnswerText(answers, reasons = {}, questions = []) {
  const byNo = new Map(questions.map((q) => [String(q.no), q]));
  const lines = Object.keys(answers || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((no) => {
      const key = String(answers[no]);
      const option = byNo.get(String(no))?.options.find((o) => o.key === key);
      const reason = String(reasons?.[no] ?? '').trim();
      const choice = option ? `${key}（${option.label}）` : key;
      return `- 質問${no}：${choice}${reason ? `。理由：${reason}` : ''}`;
    });
  if (lines.length === 0) return '';
  return [
    '質問への答えです。',
    ...lines,
    '答えを PRD の本文に移し、決めた理由も1行で残して、同じ PRD のファイルを書き直してください。',
  ].join('\n');
}

// 画面から来たパスを検査して、リポジトリ内の相対パス（区切りは /）に正規化して返す。
// 許可した置き場の外・`..` での遡り・絶対パスは null を返す。
export function normalizeRepoPath(input, allowedDirs = ALLOWED_DIRS, allowedFiles = ALLOWED_FILES) {
  if (typeof input !== 'string' || input === '' || input.includes('\0')) return null;
  const slashed = input.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) return null;
  if (slashed.split('/').includes('..')) return null;
  const normalized = posix.normalize(slashed);
  if (allowedFiles.includes(normalized)) return normalized;
  const ok = allowedDirs.some(
    (dir) => normalized.startsWith(`${dir}/`) && normalized !== `${dir}/`,
  );
  return ok ? normalized : null;
}

// 地方時の日付を YYYY-MM-DD で返す（保存するファイル名の先頭に使う）。
export function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 同じ名前のファイルがあれば _2, _3 … を付けて、既存のファイルを上書きしない名前を返す。
// exists は「その相対パスがもうあるか」を答える関数。
export function nextFreePath(dir, stem, ext, exists) {
  let candidate = `${dir}/${stem}${ext}`;
  for (let i = 2; exists(candidate); i += 1) candidate = `${dir}/${stem}_${i}${ext}`;
  return candidate;
}

// 実行前後のファイル一覧（相対パス → 更新時刻）を比べ、新しくできた・書き換わったファイルを返す。
export function diffSnapshots(before, after) {
  const changed = [];
  for (const [path, mtime] of after) {
    if (!before.has(path) || before.get(path) !== mtime) changed.push(path);
  }
  return changed.sort();
}

// 画面に出す前に、トークンらしき文字列を伏せる（念のため）。
export function redactSecrets(text) {
  return String(text)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '［伏せ字］')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{20,}/g, '$1［伏せ字］');
}

// Copilot の返事（標準出力）から、作業の記録（● Read … のような行と、その下の │ └ の行）と、
// 最後に付く利用量の欄（Changes / AI Credits / Tokens / Resume）を除き、人に向けた文だけ残す。
export function cleanReply(text) {
  return String(text)
    .split('\n')
    .filter((line) => !/^\s*[●│└]/.test(line))
    .filter((line) => !/^(Changes|AI Credits|Tokens|Resume|Total usage|Usage)\b/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- 顧客管理（CRM）：お客さんの声の記録 ----

// 1件の記録が持つ項目と、決まった言葉から選ぶ項目の選択肢（.github/prompts/crm.prompt.md と同じ）。
export const VOICE_CHANNELS = ['ヒアリング', '電話', 'メール', 'アプリ内の問い合わせフォーム'];
export const VOICE_CATEGORIES = [
  '同じ品が2行になる',
  '買った品の見せ方',
  '家族での共有',
  '文字の見やすさ',
  'そのほか',
];
export const VOICE_STATUSES = ['回答済み', '開発チームへ共有', '要望として記録', '対応中'];
const VOICE_TEXT_FIELDS = ['お客さん', '困りごと', '要望'];

// 比べるときに、空白・改行・かぎ括弧の違いは見ない。
const squash = (text) => String(text).replace(/[\s「」『』]/g, '');

// AI が書いた記録を検査する。問題があれば、画面に出せる日本語の文の配列を返す（無ければ空）。
// transcript を渡すと、「そのままの言葉」が文字起こしに言葉どおりにあるかも確かめる。
export function validateVoiceRecord(record, transcript) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['記録が1件の形（項目の集まり）になっていません。'];
  }
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.日付 ?? ''))) {
    errors.push('「日付」が 2026-10-19 の形になっていません。');
  }
  for (const field of VOICE_TEXT_FIELDS) {
    if (typeof record[field] !== 'string' || record[field].trim() === '') {
      errors.push(`「${field}」が空です。`);
    }
  }
  const choices = [
    ['経路', VOICE_CHANNELS],
    ['分類', VOICE_CATEGORIES],
    ['対応の状況', VOICE_STATUSES],
  ];
  for (const [field, allowed] of choices) {
    if (!allowed.includes(record[field])) {
      errors.push(`「${field}」が決まった言葉（${allowed.join('／')}）のどれでもありません。`);
    }
  }
  const quotes = record.そのままの言葉;
  if (!Array.isArray(quotes) || quotes.length === 0 || quotes.some((q) => typeof q !== 'string')) {
    errors.push('「そのままの言葉」が1つもありません。');
  } else if (transcript !== undefined) {
    const source = squash(transcript);
    for (const quote of quotes) {
      if (!squash(quote) || !source.includes(squash(quote))) {
        errors.push(`文字起こしに無い言葉が「そのままの言葉」に入っています：${quote}`);
      }
    }
  }
  return errors;
}

// 検査を通った記録に、番号と登録元を付けて、一覧の末尾に足した新しい配列を返す。
export function appendVoiceRecord(records, record, source) {
  const next = records.reduce((max, r) => Math.max(max, Number(r.番号) || 0), 0) + 1;
  const entry = {
    番号: next,
    日付: record.日付,
    お客さん: record.お客さん.trim(),
    経路: record.経路,
    分類: record.分類,
    困りごと: record.困りごと.trim(),
    要望: record.要望.trim(),
    そのままの言葉: record.そのままの言葉.map((q) => q.trim()),
    対応の状況: record.対応の状況,
    登録元: source,
  };
  return [...records, entry];
}

// AI が JSON の前後に ```json の囲みを付けてしまったときのために、それを外してから読む。
export function parseJsonLoose(text) {
  const body = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(body);
}
