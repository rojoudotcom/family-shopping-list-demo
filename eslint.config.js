// ESLint v9 のフラット設定（flat config）。
//
// このデモの「Lint」は2つの道具の組み合わせです。
//   - ESLint  : コードを実行せずに解析し、バグの芽や危険な書き方を検出する
//               （未使用の変数、未定義の変数の参照など）。
//   - Prettier: 整形（インデント・クォート・折り返し）を機械的にそろえる。
//               ※ Prettier の設定は .prettierrc.json 側にあります。
//
// 共有の設定パッケージには依存せず、ファイルの種類ごとに2グループへ分け、
// それぞれが使うグローバル変数を明示しています。こうすることで
// 「未定義の変数（no-undef）」チェックが正しく機能します
// （例: ブラウザ側では document は定義済み、Node 側では process は定義済み）。

export default [
  {
    // ブラウザで動くアプリのコード。
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
      },
    },
    rules: {
      // 使っていない変数は消し忘れ・書き間違いのサイン。エラーにする。
      'no-unused-vars': 'error',
      // 定義されていない名前の参照（タイプミス等）はエラーにする。
      'no-undef': 'error',
    },
  },
  {
    // Node 側で動くコード: 静的サーバ・テスト・設定ファイル。
    files: ['scripts/**/*.mjs', 'test/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'error',
    },
  },
];
