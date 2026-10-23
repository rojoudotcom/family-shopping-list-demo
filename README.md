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

3つの役割が、それぞれの文書を AI と作り、次の役割に渡します。各段階の指示は `.github/prompts/`、文書の形は `docs/templates/` にあります。

| 役割                 | 段階                                                       | 呼び出し                 | 置き場               |
| -------------------- | ---------------------------------------------------------- | ------------------------ | -------------------- |
| 営業・サポート担当者 | 利用者の情報と過去の記録から、ヒアリングのアジェンダを作る | `/agenda`                | `docs/hearing/`      |
|                      | ヒアリングの文字起こしから議事録を作る                     | `/minutes`               | `docs/minutes/`      |
| 企画担当者           | 議事録と問い合わせの記録から PRD を作る                    | `/prd`                   | `docs/prd/`          |
| エンジニア           | PRD から要件定義書を作る                                   | `/requirements`          | `docs/requirements/` |
|                      | 要件定義書から設計書を作る                                 | `/design`                | `docs/design/`       |
|                      | 要件定義書から Issue を作る                                | `/split`                 | GitHub の Issue      |
|                      | Issue を Copilot に任せ、PR・CI・レビューを経てマージする  | Issue の担当者に Copilot | `main`               |

`main` にマージすると GitHub Pages に公開され、PR の説明の `Fixes #番号` で Issue が閉じます。

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

## 企画のワークベンチ（エンジニアでない人向けの画面）

営業・サポート担当者と企画担当者が、VS Code を開かずにブラウザから AI に文書を書かせる画面です。
①ヒアリングのアジェンダ、②録音から議事録、③PRD と決まっていないことへの回答、の順に並んでいます。

```bash
npm run workbench    # http://127.0.0.1:4174 を開く（このパソコンからだけ開ける）
```

- AI が書いた文書は、このリポジトリの `docs/` にファイルとして保存されます。データベースは使いません。
- AI は GitHub Copilot です。画面の裏で Copilot CLI を呼び、VS Code の `/agenda`・`/minutes`・`/prd` と同じ
  `.github/prompts/` の指示を渡します。Copilot CLI を入れてサインインしておく必要があり、AI への問い合わせはネットワーク越しに行われます。
  `copilot` が PATH に無いときは、環境変数 `COPILOT_BIN` で場所を指定します。
- 文字起こしは、このデモでは擬似です。`audio/<名前>.m4a` を選ぶと、用意しておいた
  `docs/hearing/<名前>_文字起こし.txt` を数秒待ってから表示します。
- Copilot には `git push`・`git commit`・`gh` を禁止しています。コミットと push は人が行います。
