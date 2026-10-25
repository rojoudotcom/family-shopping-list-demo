// 社内の管理画面（デモ用のモックアップ）の動き。
//
// 擬似のもの: タブの切り替え、「AI に〜させる」ボタン（2秒待って用意済みの文書を見せるだけ）、
//             CI の結果の ✓、QA のコメントのコピー。AI は呼びません。
// 本物のもの: 「画面で確かめる」の「買った品を消す」。アプリと同じ src/listStore.js を読み込んで使います。
//             機能の PR をマージする前の main には clearBought が無いので、行は消えません。

// clearBought は機能の PR で足す関数です。マージ前の main に無くても画面が動くよう、
// 名前を指定せずに読み込み、あるかどうかを確かめてから使います。
import * as store from '../src/listStore.js';

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

// --- 画面で確かめる（本物の clearBought） ---------------------------------

// 受け入れ条件ごとの「前提の行」と「消したあとに残るはずの行」。
// 前提の行は [品名, チェックが付いているか]。
const AC_CASES = {
  'AC-01': {
    start: [
      ['牛乳', false],
      ['卵', true],
      ['パン', true],
    ],
    expected: ['牛乳'],
  },
  'AC-02': {
    start: [
      ['牛乳', false],
      ['卵', true],
      ['パン', false],
      ['りんご', false],
    ],
    expected: ['牛乳', 'パン', 'りんご'],
  },
  'AC-03': {
    start: [
      ['牛乳', false],
      ['卵', false],
    ],
    expected: ['牛乳', '卵'],
  },
};

const tryList = document.getElementById('try-list');
const tryCount = document.getElementById('try-count');
const tryGoal = document.getElementById('try-goal');
const tryClear = document.getElementById('try-clear');
const engineState = document.getElementById('engine-state');

const hasClearBought = typeof store.clearBought === 'function';

let items = [];
let currentCase = null;

function itemsFromRows(rows) {
  return rows.map(([name, bought], index) => ({ id: index + 1, name, bought }));
}

// いま読み込んでいる src/listStore.js が、マージ前と後のどちらかを見分ける。
function describeEngine() {
  engineState.textContent = hasClearBought
    ? 'いまのアプリ：新しい動き（チェックを付けた行をまとめて消せる）'
    : 'いまのアプリ：マージ前の main の動き（まとめて消す機能はまだ無い）';
  engineState.dataset.state = hasClearBought ? 'new' : 'old';
}

function render() {
  tryList.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      li.className = 'try-list__item';
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = item.bought;
      box.addEventListener('change', () => {
        items = store.toggleBought(items, item.id);
        render();
      });
      label.append(box, ` ${item.name}`);
      li.append(label);
      return li;
    }),
  );

  if (!currentCase) {
    tryGoal.textContent = '「この条件で試す」を押すと、前提の行を用意します。';
    tryCount.textContent = '';
    tryCount.dataset.verdict = '';
    return;
  }
  const { id, expected, pressed } = currentCase;
  tryGoal.textContent = `${id}：前提の行を用意しました。「買った品を消す」を押してください。`;
  if (!pressed) {
    tryCount.textContent = '';
    tryCount.dataset.verdict = '';
    return;
  }
  const names = items.map((item) => item.name);
  const ok = names.join('、') === expected.join('、');
  tryCount.textContent = `残った行：${names.join('、') || 'なし'}（${id} の期待は ${expected.join('、')}）→ ${
    ok ? '期待どおり' : '期待と違う'
  }`;
  tryCount.dataset.verdict = ok ? 'ok' : 'ng';
}

function startCase(id) {
  items = itemsFromRows(AC_CASES[id].start);
  currentCase = { id, expected: AC_CASES[id].expected, pressed: false };
  render();
  tryClear.focus();
}

for (const button of document.querySelectorAll('[data-ac]')) {
  button.addEventListener('click', () => startCase(button.dataset.ac));
}

tryClear.addEventListener('click', () => {
  if (hasClearBought) {
    items = store.clearBought(items);
  }
  if (currentCase) {
    currentCase.pressed = true;
  }
  render();
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
