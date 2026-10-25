// 買い物リストの DOM 配線。
//
// このモジュールはブラウザ固有の処理だけを担当します
// （localStorage の読み書きと DOM への描画）。状態の変化そのものは
// すべて listStore.js の純粋関数に任せます。指針は「DOM を読む →
// 純粋関数を呼ぶ → DOM を書く」だけで、業務ロジックはここに書きません。

import {
  addItem,
  toggleBought,
  deleteItem,
  clearBought,
  filterItems,
  countToBuy,
  FILTERS,
} from './listStore.js';

const STORAGE_KEY = 'family-shopping-list-items';

// 絞り込みの結果が0件のときに出す文言。
const EMPTY_MESSAGES = {
  [FILTERS.ALL]: 'リストはまだ空です。',
  [FILTERS.TO_BUY]: 'まだ買っていない品物はありません。',
  [FILTERS.BOUGHT]: '買った品物はまだありません。',
};

let items = load();
let activeFilter = FILTERS.ALL;

const form = document.querySelector('#new-item-form');
const input = document.querySelector('#new-item-input');
const formError = document.querySelector('#form-error');
const list = document.querySelector('#item-list');
const counter = document.querySelector('#to-buy-count');
const emptyState = document.querySelector('#empty-state');
const clearBoughtButton = document.querySelector('#clear-bought-button');
const filterButtons = document.querySelectorAll('[data-filter]');

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // 保存データが壊れている・使えない場合でもアプリを止めない。空で始める。
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 保存できない環境（プライベートブラウズ等）でも、画面上の操作は続けられるようにする。
  }
}

function update(nextItems) {
  items = nextItems;
  save();
  render();
}

function buildItemRow(item) {
  const row = document.createElement('li');
  row.className = 'item' + (item.bought ? ' item--bought' : '');
  row.dataset.id = String(item.id);
  row.dataset.testid = 'item-row';

  const boughtLabel = document.createElement('label');
  boughtLabel.className = 'item__bought';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'item__checkbox';
  checkbox.checked = item.bought;
  checkbox.dataset.testid = 'item-bought';
  checkbox.setAttribute('aria-label', `「${item.name}」を買った`);
  checkbox.addEventListener('change', () => {
    update(toggleBought(items, item.id));
  });

  boughtLabel.append(checkbox, '買った');

  const name = document.createElement('span');
  name.className = 'item__name';
  name.textContent = item.name;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'item__delete';
  remove.textContent = '削除';
  remove.dataset.testid = 'item-delete';
  remove.setAttribute('aria-label', `「${item.name}」を削除`);
  remove.addEventListener('click', () => {
    update(deleteItem(items, item.id));
  });

  row.append(boughtLabel, name, remove);
  return row;
}

function render() {
  const visible = filterItems(items, activeFilter);

  list.replaceChildren(...visible.map(buildItemRow));
  counter.textContent = String(countToBuy(items));
  emptyState.textContent = EMPTY_MESSAGES[activeFilter];
  emptyState.hidden = visible.length > 0;

  for (const button of filterButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter));
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  let nextItems;
  try {
    // 品名の検証（空白の除去・空文字の拒否）は addItem に任せる。
    nextItems = addItem(items, input.value);
  } catch (error) {
    formError.textContent = error.message;
    input.focus();
    return;
  }
  formError.textContent = '';
  input.value = '';
  update(nextItems);
  input.focus();
});

clearBoughtButton.addEventListener('click', () => {
  update(clearBought(items));
});

input.addEventListener('input', () => {
  formError.textContent = '';
});

for (const button of filterButtons) {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    render();
  });
}

render();
