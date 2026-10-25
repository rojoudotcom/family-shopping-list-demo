// 企画のワークベンチの小さな関数（workbench/lib.mjs）のユニットテスト。
// 実行: npm test
//
// サーバや Copilot は起動せず、「Copilot の返事の文字列 → 画面に出す形」や
// 「画面から来たパス → 通すか拒むか」を、入力と出力の突き合わせだけで確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  appendVoiceRecord,
  buildAnswerText,
  cleanReply,
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
  validateVoiceRecord,
} from '../../workbench/lib.mjs';

test('stripFrontmatter: 先頭の --- で囲まれた設定部分を取り除く', () => {
  const text = '---\ndescription: 説明\nagent: agent\n---\n\n本文の1行目\n\n依頼：';
  assert.equal(stripFrontmatter(text), '本文の1行目\n\n依頼：');
});

test('stripFrontmatter: 設定部分が無ければ本文をそのまま返す', () => {
  assert.equal(stripFrontmatter('本文だけ\n'), '本文だけ');
});

test('parseResumeId: 最後に出る Resume の行から会話の id を取り出す', () => {
  const stderr =
    '\n\nChanges    +0 -0\nAI Credits 4.28 (4s)\nResume     copilot --resume=e2de77b3-dacb-45b0-b562-9d6a72c837ab\n';
  assert.equal(parseResumeId(stderr), 'e2de77b3-dacb-45b0-b562-9d6a72c837ab');
  assert.equal(parseResumeId('id の行が無い'), null);
});

test('parseQuestions: 番号つきの質問と、字下げした A. B. の選択肢を読む', () => {
  const reply = [
    'PRD を docs/prd/同じ品をまとめる.md に保存しました。',
    '',
    '1. チェックを付けた品目は、どう見せますか？',
    '   - A. 残して見た目を変える',
    '   - B. 末尾へ移す',
    '   - C. 一覧から隠す',
    '2. **すでに2行になっている品目は、まとめ直しますか？**',
    '   - A. まとめ直す',
    '   - B. まとめ直さない',
  ].join('\n');
  assert.deepEqual(parseQuestions(reply), [
    {
      no: 1,
      text: 'チェックを付けた品目は、どう見せますか？',
      options: [
        { key: 'A', label: '残して見た目を変える' },
        { key: 'B', label: '末尾へ移す' },
        { key: 'C', label: '一覧から隠す' },
      ],
    },
    {
      no: 2,
      text: 'すでに2行になっている品目は、まとめ直しますか？',
      options: [
        { key: 'A', label: 'まとめ直す' },
        { key: 'B', label: 'まとめ直さない' },
      ],
    },
  ]);
});

test('parseQuestions: 選択肢の無い番号つきの行は質問にしない', () => {
  assert.deepEqual(parseQuestions('1. 保存しました\n2. 次へ進みます'), []);
});

test('parseQuestions: 記号の後ろに「.」が無い選択肢（- A 残す）も読む', () => {
  const reply = [
    '1. 買った物をリストにどう見せますか？',
    '   - A 残して見た目を変える',
    '   - B リストの末尾へ移す',
    '   - 補足：Dさんは C、Eさんは B の意見でした。',
  ].join('\n');
  assert.deepEqual(parseQuestions(reply), [
    {
      no: 1,
      text: '買った物をリストにどう見せますか？',
      options: [
        { key: 'A', label: '残して見た目を変える' },
        { key: 'B', label: 'リストの末尾へ移す' },
      ],
    },
  ]);
});

test('parseChecklistQuestions: 番号と選択肢の記号が付いていれば外して使う', () => {
  const prd = '- [ ] 1. 買った物の見せ方（選択肢：A 残す／B 末尾へ移す）';
  assert.deepEqual(parseChecklistQuestions(prd), [
    {
      no: 1,
      text: '買った物の見せ方',
      options: [
        { key: 'A', label: '残す' },
        { key: 'B', label: '末尾へ移す' },
      ],
    },
  ]);
});

test('parseChecklistQuestions: PRD の「- [ ] 質問（選択肢：A／B）」から質問を拾う', () => {
  const prd =
    '## 決まっていないこと\n\n- [ ] 買った品目の見せ方（選択肢：末尾へ移す／隠す／そのまま）';
  assert.deepEqual(parseChecklistQuestions(prd), [
    {
      no: 1,
      text: '買った品目の見せ方',
      options: [
        { key: 'A', label: '末尾へ移す' },
        { key: 'B', label: '隠す' },
        { key: 'C', label: 'そのまま' },
      ],
    },
  ]);
});

test('buildAnswerText: 選んだ答えと理由を、番号順の日本語の文にする', () => {
  const questions = [
    { no: 1, text: '見せ方', options: [{ key: 'B', label: '末尾へ移す' }] },
    { no: 2, text: 'まとめ直し', options: [{ key: 'A', label: 'まとめ直す' }] },
  ];
  const text = buildAnswerText({ 2: 'A', 1: 'B' }, { 1: 'Zoom の投票で決まった' }, questions);
  assert.match(text, /^質問への答えです。/);
  assert.ok(text.indexOf('質問1') < text.indexOf('質問2'));
  assert.match(text, /- 質問1：B（末尾へ移す）。理由：Zoom の投票で決まった/);
  assert.match(text, /- 質問2：A（まとめ直す）\n/);
  assert.equal(buildAnswerText({}), '');
});

test('normalizeRepoPath: 許可した置き場の中のパスだけを通す', () => {
  assert.equal(
    normalizeRepoPath('docs/minutes/2026-10-05_ヒアリング1回目.md'),
    'docs/minutes/2026-10-05_ヒアリング1回目.md',
  );
  assert.equal(normalizeRepoPath('README.md'), 'README.md');
  assert.equal(normalizeRepoPath('audio/a.m4a', ['audio']), 'audio/a.m4a');
});

test('normalizeRepoPath: 遡り・絶対パス・置き場の外・置き場そのものは拒む', () => {
  assert.equal(normalizeRepoPath('docs/minutes/../../package.json'), null);
  assert.equal(normalizeRepoPath('../secret.md'), null);
  assert.equal(normalizeRepoPath('/etc/passwd'), null);
  assert.equal(normalizeRepoPath('C:\\Windows\\win.ini'), null);
  assert.equal(normalizeRepoPath('src/app.js'), null);
  assert.equal(normalizeRepoPath('docs/minutes/'), null);
  assert.equal(normalizeRepoPath('docs/minutesX/a.md'), null);
  assert.equal(normalizeRepoPath('docs/voice/a.md', ['docs/minutes']), null);
  assert.equal(normalizeRepoPath(undefined), null);
  assert.equal(normalizeRepoPath('docs/minutes/a\0.md'), null);
});

test('formatDate: 地方時の YYYY-MM-DD を返す', () => {
  assert.equal(formatDate(new Date(2026, 9, 26, 9, 0)), '2026-10-26');
});

test('nextFreePath: 同じ名前があれば _2, _3 を付けて上書きしない', () => {
  const taken = new Set([
    'docs/hearing/2026-10-26_アジェンダ.md',
    'docs/hearing/2026-10-26_アジェンダ_2.md',
  ]);
  assert.equal(
    nextFreePath('docs/hearing', '2026-10-26_アジェンダ', '.md', (p) => taken.has(p)),
    'docs/hearing/2026-10-26_アジェンダ_3.md',
  );
  assert.equal(
    nextFreePath('docs/prd', '新しい', '.md', () => false),
    'docs/prd/新しい.md',
  );
});

test('diffSnapshots: 新しくできたファイルと、更新時刻が変わったファイルを返す', () => {
  const before = new Map([
    ['docs/prd/a.md', 1],
    ['docs/prd/b.md', 2],
  ]);
  const after = new Map([
    ['docs/prd/a.md', 1],
    ['docs/prd/b.md', 3],
    ['docs/prd/c.md', 4],
  ]);
  assert.deepEqual(diffSnapshots(before, after), ['docs/prd/b.md', 'docs/prd/c.md']);
});

test('redactSecrets: トークンらしき文字列を伏せる', () => {
  const text = redactSecrets(`token ghp_${'a'.repeat(36)} end`);
  assert.equal(text, 'token ［伏せ字］ end');
});

test('cleanReply: 作業の記録の行と利用量の欄を除き、人に向けた文だけ残す', () => {
  const stdout = [
    '● Read 問い合わせ記録.md',
    '  │ docs/customer/問い合わせ記録.md',
    '  └ 15 lines read',
    '',
    'PRD を保存しました。',
    '',
    'Changes    +0 -0',
  ].join('\n');
  assert.equal(cleanReply(stdout), 'PRD を保存しました。');
});

test('parseQuestions / parseChecklistQuestions: 文の先頭に重なった「Q1.」を外す', () => {
  const reply = '1. Q1. 誰が使うのか\n   - A. 夫婦だけ\n   - B. 子どもも';
  assert.equal(parseQuestions(reply)[0].text, '誰が使うのか');
  const prd = '- [ ] Q2. どう反映するのか（選択肢：A. 開いた時／B. 自動）';
  assert.equal(parseChecklistQuestions(prd)[0].text, 'どう反映するのか');
  // 番号は AI が付けたもの（Q2）を使う。答えを返すときに番号がずれないように。
  assert.equal(parseChecklistQuestions(prd)[0].no, 2);
});

test('parseQuestions: 同じ行の括弧に並んだ選択肢（A. …／B. …）も読む', () => {
  const reply = [
    '1. 買った品物を、リストでどう見せますか。（A. 一覧から隠す／B. 末尾へ移す／C. 残して見た目を変える）',
    '   - Bさん・Dさんは A、Aさん・Eさんは B を希望していて、分かれています。',
    '2. すでに2行になっている同じ品物は、どう扱いますか。（A. 利用者が自分で消す／B. 次に開いたとき自動で1行にまとめる）',
  ].join('\n');
  const questions = parseQuestions(reply);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].text, '買った品物を、リストでどう見せますか。');
  assert.deepEqual(
    questions[0].options.map((o) => o.key + o.label),
    ['A一覧から隠す', 'B末尾へ移す', 'C残して見た目を変える'],
  );
  assert.equal(questions[1].no, 2);
});

test('parseChecklistQuestions: 番号つきの行「1. 質問（選択肢：…）」も拾い、その番号を使う', () => {
  const prd = [
    '## 決まっていないこと',
    '',
    '1. 買った品物の見せ方。意見が分かれている。（選択肢：A. 一覧から隠す／B. 末尾へ移す）',
    '2. 2行の品物の扱い（選択肢：A. 利用者が消す／B. 「自動」でまとめる（次に開いたとき））',
  ].join('\n');
  const questions = parseChecklistQuestions(prd);
  assert.deepEqual(
    questions.map((q) => [q.no, q.text, q.options.length]),
    [
      [1, '買った品物の見せ方。意見が分かれている。', 2],
      [2, '2行の品物の扱い', 2],
    ],
  );
  assert.equal(questions[1].options[1].label, '「自動」でまとめる（次に開いたとき）');
});

// ---- 顧客管理（CRM）：お客さんの声の記録 ----

const transcript = [
  'Bさん：卵は先週買って、チェックを付けたままでした。今週また足したら、新しい行が増えていました。',
  'Aさん：私も賛成です。2行あると、どちらを信じればいいのか分からなくなるので。',
].join('\n');

const goodRecord = () => ({
  日付: '2026-10-19',
  お客さん: 'Aさん（夫）・Bさん（妻）',
  経路: 'ヒアリング',
  分類: '買った品の見せ方',
  困りごと: 'チェック済みの卵を足すと、行が増える。',
  要望: '前からある行を、まだ買っていない状態に戻してほしい。',
  そのままの言葉: ['今週また足したら、新しい行が増えていました。'],
  対応の状況: '開発チームへ共有',
});

test('validateVoiceRecord: 形がそろい、言葉が文字起こしにある記録は通す', () => {
  assert.deepEqual(validateVoiceRecord(goodRecord(), transcript), []);
});

test('validateVoiceRecord: 文字起こしに無い「そのままの言葉」は拒む（空白とかぎ括弧の違いは見ない）', () => {
  const spaced = {
    ...goodRecord(),
    そのままの言葉: ['「今週また足したら、 新しい行が増えていました。」'],
  };
  assert.deepEqual(validateVoiceRecord(spaced, transcript), []);
  const invented = { ...goodRecord(), そのままの言葉: ['卵が2つになって困りました。'] };
  assert.equal(validateVoiceRecord(invented, transcript).length, 1);
  assert.match(validateVoiceRecord(invented, transcript)[0], /文字起こしに無い言葉/);
});

test('validateVoiceRecord: 日付の形・決まった言葉・空の項目・配列を拒む', () => {
  const bad = { ...goodRecord(), 日付: '10月19日', 分類: '重複', 要望: '', 対応の状況: '済み' };
  const errors = validateVoiceRecord(bad, transcript);
  assert.equal(errors.length, 4);
  assert.deepEqual(validateVoiceRecord([goodRecord()]), [
    '記録が1件の形（項目の集まり）になっていません。',
  ]);
  assert.equal(validateVoiceRecord({ ...goodRecord(), そのままの言葉: [] }).length, 1);
});

test('appendVoiceRecord: 番号は最大＋1、登録元を付けて末尾に足し、元の配列は変えない', () => {
  const records = Object.freeze([{ 番号: 1 }, { 番号: 5 }]);
  const updated = appendVoiceRecord(records, goodRecord(), 'docs/hearing/x_文字起こし.txt');
  assert.equal(updated.length, 3);
  assert.equal(updated[2].番号, 6);
  assert.equal(updated[2].登録元, 'docs/hearing/x_文字起こし.txt');
  assert.equal(records.length, 2);
});

test('parseJsonLoose: ```json の囲みがあっても読む', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('{"a": 1}'), { a: 1 });
  assert.throws(() => parseJsonLoose('読めない'));
});

test('docs/crm/お客さんの声.json: 最初から入れた記録が、問い合わせ記録の言葉どおりで検査を通る', () => {
  const records = JSON.parse(readFileSync('docs/crm/お客さんの声.json', 'utf8'));
  const inquiries = readFileSync('docs/customer/問い合わせ記録.md', 'utf8');
  assert.ok(records.length >= 5);
  for (const record of records.filter((r) => r.登録元.startsWith('docs/customer/'))) {
    assert.deepEqual(validateVoiceRecord(record, inquiries), [], `番号 ${record.番号}`);
  }
});
