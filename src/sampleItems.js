// デモ用の見本のリスト（架空）。ABC家族が土曜の買い物をしたあとの状態。
//
// チェックを付けた行がたまり、まだ買っていない品（卵・玉ねぎ・おやつ）が
// その間に埋もれている。「買った品をまとめて消す」機能の前と後を見せるために使う。
// 品物の形は listStore.js と同じ { id, name, bought }。

export const SAMPLE_ITEMS = Object.freeze([
  { id: 1, name: '牛乳', bought: true },
  { id: 2, name: '食パン', bought: true },
  { id: 3, name: '卵', bought: false },
  { id: 4, name: 'バナナ', bought: true },
  { id: 5, name: '鶏むね肉', bought: true },
  { id: 6, name: 'ヨーグルト', bought: true },
  { id: 7, name: '玉ねぎ', bought: false },
  { id: 8, name: '洗剤', bought: true },
  { id: 9, name: 'にんじん', bought: true },
  { id: 10, name: '麦茶', bought: true },
  { id: 11, name: 'おやつ', bought: false },
  { id: 12, name: 'ノート', bought: true },
]);
