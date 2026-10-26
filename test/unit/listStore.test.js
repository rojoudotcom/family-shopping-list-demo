// listStore.js（純粋ロジック）のユニットテスト。Node 標準のテストランナーを使う。
// 実行: npm test （内部では `node --test test/unit/*.test.js` を呼ぶ）
//
// ユニットテストは「一番小さな単位（＝ここでは純粋関数）」を、ブラウザを起動せずに
// 単体で検証するテストです。純粋関数は「入力 → 期待する出力」を突き合わせるだけで
// 済むため、DOM や保存領域を用意する必要がなく、ミリ秒で終わります。
// PR ごとに CI がこれを実行し、ロジックの取り違えがあれば即座に赤で知らせます。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addItem,
  toggleBought,
  deleteItem,
  clearBought,
  filterItems,
  countToBuy,
  FILTERS,
} from '../../src/listStore.js';

test('addItem: まだ買っていない品物を末尾に追加する', () => {
  const result = addItem([], '牛乳');
  assert.deepEqual(result, [{ id: 1, name: '牛乳', bought: false }]);
});

test('addItem: 品名の前後の空白を取り除く', () => {
  const result = addItem([], '  たまご  ');
  assert.equal(result[0].name, 'たまご');
});

test('addItem: 空文字・空白だけの品名は日本語のメッセージで拒否する', () => {
  assert.throws(() => addItem([], ''), { message: '品名を入力してください' });
  assert.throws(() => addItem([], '   '), { message: '品名を入力してください' });
  assert.throws(() => addItem([], undefined), { message: '品名を入力してください' });
});

test('addItem: 新しい id は「現在の最大 id + 1」', () => {
  const first = addItem([], '牛乳');
  const second = addItem(first, 'パン');
  assert.equal(second[1].id, 2);

  // 途中の品物を消しても、id が重複しない。
  const gapped = [
    { id: 1, name: '牛乳', bought: false },
    { id: 5, name: 'パン', bought: true },
  ];
  assert.equal(addItem(gapped, 'りんご')[2].id, 6);
});

test('toggleBought: 指定した id の品物だけ「買った」を反転する', () => {
  const items = addItem(addItem([], '牛乳'), 'パン');
  const toggled = toggleBought(items, 1);
  assert.equal(toggled[0].bought, true);
  assert.equal(toggled[1].bought, false);
});

test('toggleBought: もう一度呼ぶと元の状態に戻る', () => {
  let items = addItem([], '牛乳');
  items = toggleBought(items, 1);
  items = toggleBought(items, 1);
  assert.equal(items[0].bought, false);
});

test('deleteItem: 指定した id の品物だけ削除する', () => {
  const items = addItem(addItem([], '牛乳'), 'パン');
  const remaining = deleteItem(items, 1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].name, 'パン');
});

test('filterItems: 絞り込み条件ごとに正しい部分集合を返す', () => {
  let items = addItem(addItem([], 'まだ買っていない品物'), '買った品物');
  items = toggleBought(items, 2);

  const all = filterItems(items, FILTERS.ALL);
  assert.equal(all.length, 2);

  const toBuy = filterItems(items, FILTERS.TO_BUY);
  assert.equal(toBuy.length, 1);
  assert.equal(toBuy[0].name, 'まだ買っていない品物');

  const bought = filterItems(items, FILTERS.BOUGHT);
  assert.equal(bought.length, 1);
  assert.equal(bought[0].name, '買った品物');
});

test('countToBuy: まだ買っていない品物だけ数える', () => {
  let items = addItem(addItem(addItem([], '牛乳'), 'パン'), 'りんご');
  assert.equal(countToBuy(items), 3);
  items = toggleBought(items, 2);
  assert.equal(countToBuy(items), 2);
  assert.equal(countToBuy([]), 0);
});

test('どの関数も引数の配列と品物を書き換えない（イミュータブル）', () => {
  const original = Object.freeze([
    Object.freeze({ id: 1, name: '牛乳', bought: false }),
    Object.freeze({ id: 2, name: 'パン', bought: true }),
  ]);

  // 凍結した入力でも例外にならない＝書き換えようとしていない。
  addItem(original, 'りんご');
  toggleBought(original, 1);
  deleteItem(original, 1);
  filterItems(original, FILTERS.TO_BUY);
  countToBuy(original);

  assert.deepEqual(original, [
    { id: 1, name: '牛乳', bought: false },
    { id: 2, name: 'パン', bought: true },
  ]);
});

test('toggleBought: 新しい配列と新しい品物を返し、元の品物は使い回さない', () => {
  const items = addItem([], '牛乳');
  const toggled = toggleBought(items, 1);
  assert.notEqual(toggled, items);
  assert.notEqual(toggled[0], items[0]);
  assert.equal(items[0].bought, false);
});

test('AC-01 clearBought: チェックを付けた行がすべて消える', () => {
  const items = [
    { id: 1, name: '牛乳', bought: true },
    { id: 2, name: 'パン', bought: true },
  ];
  assert.deepEqual(clearBought(items), []);
});

test('AC-02 clearBought: まだ買っていない品の行は同じ順で残る', () => {
  const items = [
    { id: 1, name: '牛乳', bought: false },
    { id: 2, name: 'パン', bought: true },
    { id: 3, name: 'たまご', bought: false },
  ];
  assert.deepEqual(clearBought(items), [
    { id: 1, name: '牛乳', bought: false },
    { id: 3, name: 'たまご', bought: false },
  ]);
});

test('AC-03 clearBought: チェックを付けた行がなければ新しい配列で同じ内容を返す', () => {
  const items = Object.freeze([{ id: 1, name: '牛乳', bought: false }]);
  const result = clearBought(items);
  assert.notEqual(result, items);
  assert.deepEqual(result, [{ id: 1, name: '牛乳', bought: false }]);
});
