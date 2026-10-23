# 家族の買い物リスト

研修用に作った架空のデモアプリです。家族それぞれが買うものを書き足し、買ったらチェックを付けます。
素の HTML・CSS・JavaScript だけで作っています（フレームワーク・ビルド工程なし）。

## アプリの機能

- 品物の追加・削除
- 「買った」のチェック
- 「すべて／まだ買っていない／買った」での絞り込み
- 「あと N 品」の表示
- ブラウザの `localStorage` への保存（リロードしても残る）

機能はわざと最小限にしてあります。新しい機能は、研修の中で PRD から追加します。

## このリポジトリで実演すること

1. GitHub Copilot と一緒に PRD（製品要求仕様書）を書く（置き場は `docs/prd/`）
2. PRD を GitHub の Issue に分ける
3. Issue を Copilot に割り当て、Pull Request（PR）を作らせる
4. CI（Lint とユニットテスト）の結果を見ながら PR をレビューし、`main` にマージする

`main` にマージすると、`.github/workflows/deploy.yml` が GitHub Pages に公開します。

## ディレクトリ構成

```
index.html                  画面（src/app.js を ES モジュールとして読み込む）
src/
  listStore.js              DOM に依存しない純粋関数（ユニットテストの対象）
  app.js                    DOM の配線と localStorage への保存
  styles.css                スタイル
scripts/serve.mjs           依存ゼロの静的サーバ（ローカル確認用）
test/unit/listStore.test.js ユニットテスト（node:test）
.github/workflows/
  ci.yml                    CI: Lint とユニットテスト（PR ごとに実行）
  deploy.yml                CD: main への push で GitHub Pages に公開
```

品物を扱うロジックは `listStore.js` に純粋関数として置き、DOM から切り離しています。
そのため、ユニットテストはブラウザを起動せずにミリ秒で終わります。

## ローカルでの実行

Node.js 20 以上が必要です。

```bash
npm ci               # 依存パッケージを導入する（初回のみ）
npm run serve        # http://localhost:4173 を開く
npm test             # ユニットテスト（node:test）
npm run lint         # ESLint と Prettier のチェック
```

Lint で整形の指摘が出たら、`npm run format` で自動修正できます。
