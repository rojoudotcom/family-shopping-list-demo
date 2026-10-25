// 社内の管理画面（デモ用のモックアップ）の動き。
//
// 擬似のもの: タブの切り替え、「AI に〜させる」ボタン（2秒待って用意済みの文書を見せるだけ）、
//             CI の結果の ✓、QA のコメントのコピー。AI は呼びません。
// 本物のもの: 「画面で確かめる」の行の追加。アプリと同じ addItem を読み込んで使います。
//             そのため、機能の PR をマージする前は main の動き（同じ名前でも行が増える）になります。

import { addItem } from '../src/listStore.js';

const AI_WAIT_MS = 2000;

// --- タブ ---------------------------------------------------------------

const tabs = [...document.querySelectorAll('.tab')];

function showScreen(name) {
  const known = tabs.some((tab) => tab.dataset.screen === name);
  const target = known ? name : 'crm';
  for (const tab of tabs) {
    const selected = tab.dataset.screen === target;
    tab.setAttribute('aria-selected', String(selected));
    document.getElementById(`screen-${tab.dataset.screen}`).hidden = !selected;
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    window.location.hash = tab.dataset.screen;
  });
}
window.addEventListener('hashchange', () => showScreen(window.location.hash.slice(1)));
showScreen(window.location.hash.slice(1));

// --- 「AI に〜させる」（擬似） ---------------------------------------------

function pseudoAi(buttonId, workingId, docId) {
  const button = document.getElementById(buttonId);
  const working = document.getElementById(workingId);
  const doc = document.getElementById(docId);
  button.addEventListener('click', () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    doc.hidden = true;
    working.hidden = false;
    setTimeout(() => {
      working.hidden = true;
      doc.hidden = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }, AI_WAIT_MS);
  });
}

pseudoAi('agenda-button', 'agenda-working', 'agenda-doc');
pseudoAi('minutes-button', 'minutes-working', 'minutes-doc');
pseudoAi('prd-button', 'prd-working', 'prd-doc');

// --- 画面で確かめる（本物の addItem） --------------------------------------

// 受け入れ条件ごとの「前提」「足す名前」「期待する行の数」。
const AC_CASES = {
  'AC-01': { start: ['牛乳'], input: '牛乳', expectedRows: 1 },
  'AC-02': { start: ['milk'], input: 'Milk', expectedRows: 1 },
  'AC-03': { start: ['牛乳'], input: '卵', expectedRows: 2 },
};

const tryForm = document.getElementById('try-form');
const tryInput = document.getElementById('try-input');
const tryError = document.getElementById('try-error');
const tryList = document.getElementById('try-list');
const tryCount = document.getElementById('try-count');
const tryGoal = document.getElementById('try-goal');
const engineState = document.getElementById('engine-state');

let items = [];
let currentCase = null;

function itemsFromNames(names) {
  return names.reduce((list, name) => addItem(list, name), []);
}

// いま読み込んでいる addItem が、マージ前と後のどちらの動きかを見分ける。
function describeEngine() {
  const rows = addItem([{ id: 1, name: 'milk', bought: false }], 'Milk').length;
  engineState.textContent =
    rows === 1
      ? 'いまの addItem：新しい動き（同じ名前なら行が増えない）'
      : 'いまの addItem：マージ前の main の動き（同じ名前でも行が増える）';
  engineState.dataset.state = rows === 1 ? 'new' : 'old';
}

function render() {
  tryList.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      li.className = 'try-list__item';
      li.textContent = `「${item.name}」`;
      return li;
    }),
  );

  if (!currentCase) {
    tryGoal.textContent = '';
    tryCount.textContent = `行の数：${items.length}`;
    tryCount.dataset.verdict = '';
    return;
  }
  const { id, expectedRows, added } = currentCase;
  tryGoal.textContent = `${id}：前提の行を用意しました。入力欄の名前を「追加」してください。`;
  if (!added) {
    tryCount.textContent = `行の数：${items.length}`;
    tryCount.dataset.verdict = '';
    return;
  }
  const ok = items.length === expectedRows;
  tryCount.textContent = ok
    ? `行の数：${items.length}（${id} の期待は ${expectedRows}）→ 期待どおり`
    : `行の数：${items.length}（${id} の期待は ${expectedRows}）→ 期待と違う`;
  tryCount.dataset.verdict = ok ? 'ok' : 'ng';
}

function startCase(id) {
  const testCase = AC_CASES[id];
  items = itemsFromNames(testCase.start);
  currentCase = { id, expectedRows: testCase.expectedRows, added: false };
  tryInput.value = testCase.input;
  tryError.textContent = '';
  render();
  tryInput.focus();
}

for (const button of document.querySelectorAll('[data-ac]')) {
  button.addEventListener('click', () => startCase(button.dataset.ac));
}

tryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    items = addItem(items, tryInput.value);
  } catch (error) {
    tryError.textContent = error.message;
    return;
  }
  tryError.textContent = '';
  tryInput.value = '';
  if (currentCase) {
    currentCase.added = true;
  }
  render();
  tryInput.focus();
});

document.getElementById('try-reset').addEventListener('click', () => {
  items = [];
  currentCase = null;
  tryInput.value = '';
  tryError.textContent = '';
  render();
  tryInput.focus();
});

describeEngine();
render();

// --- QA のコメント（クリップボードへ） -------------------------------------

const comment = document.getElementById('qa-comment');
const copied = document.getElementById('qa-copied');

document.getElementById('qa-copy').addEventListener('click', async () => {
  const text = comment.value.trim();
  try {
    await window.navigator.clipboard.writeText(text);
    copied.textContent = 'クリップボードに写しました';
  } catch {
    // クリップボードが使えないときは、文を選んだ状態にして手で写せるようにする。
    comment.focus();
    comment.select();
    copied.textContent = '選んだ文を Ctrl+C（Mac は ⌘+C）で写してください';
  }
});
