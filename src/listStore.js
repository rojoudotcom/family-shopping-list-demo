// 買い物リストの状態を扱う「純粋ロジック」。DOM には一切触れません。
//
// ここにある関数はすべて「品物の配列を受け取り、新しい配列（または値）を返す」純粋関数です。
// 引数を書き換えず（イミュータブル）、同じ入力なら常に同じ出力を返します。
// DOM や localStorage から切り離してあるからこそ、ブラウザを起動せずに
// 高速なユニットテスト（test/unit）で検証できます。
//
// 品物の形: { id: number, name: string, bought: boolean }

export const FILTERS = Object.freeze({
  ALL: 'all',
  TO_BUY: 'to-buy',
  BOUGHT: 'bought',
});

/**
 * 品物を1件追加する。品名は前後の空白を除去し、空文字なら拒否する。
 * 新しい id は「現在の最大 id + 1」。外部カウンターに頼らず一意性を保てる。
 * @param {Array} items
 * @param {string} name
 * @returns {Array} 品物を末尾に加えた新しい配列
 */
export function addItem(items, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    throw new Error('品名を入力してください');
  }
  const nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  return [...items, { id: nextId, name: trimmed, bought: false }];
}

/**
 * 指定した id の品物の「買った」フラグを反転する。
 * @param {Array} items
 * @param {number} id
 * @returns {Array}
 */
export function toggleBought(items, id) {
  return items.map((item) => (item.id === id ? { ...item, bought: !item.bought } : item));
}

/**
 * 指定した id の品物を削除する。
 * @param {Array} items
 * @param {number} id
 * @returns {Array}
 */
export function deleteItem(items, id) {
  return items.filter((item) => item.id !== id);
}

/**
 * 絞り込み条件に一致する品物だけを返す。
 * @param {Array} items
 * @param {string} filter FILTERS のいずれか
 * @returns {Array}
 */
export function filterItems(items, filter) {
  switch (filter) {
    case FILTERS.TO_BUY:
      return items.filter((item) => !item.bought);
    case FILTERS.BOUGHT:
      return items.filter((item) => item.bought);
    default:
      return items;
  }
}

/**
 * まだ買っていない（bought が false の）品物の数を数える。
 * @param {Array} items
 * @returns {number}
 */
export function countToBuy(items) {
  return items.filter((item) => !item.bought).length;
}

/**
 * 買った（bought が true の）品物をまとめて削除する。
 * まだ買っていない品物は、同じ順で残る。
 * @param {Array} items
 * @returns {Array}
 */
export function clearBought(items) {
  return items.filter((item) => !item.bought);
}
