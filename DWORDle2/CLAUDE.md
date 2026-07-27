# DWORDle 2 の作業ルール

## 「バージョンを上げて」と言われたとき

`tools/bump-version.mjs` が唯一の窓口。手で `js/config.js` の `APP_VERSION` や
`package.json` の `version` を書き換えたり、自分で tag / push したりしない。

1. 前バージョンからの変更を読む

   ```
   node tools/bump-version.mjs --changes
   ```

   直近のタグ (`dwordle2-vX.Y.Z`) から HEAD までの、DWORDle2 配下のコミットと差分規模、
   それにリリースノートの下書きが出る。
   必要なら `git log dwordle2-vX.Y.Z..HEAD -- .` や `git diff` で中身も読む。

2. 上げ幅を判断する

   - `patch`: バグ修正・文言や見た目の微調整・内部整理のみ
   - `minor`: 機能追加、遊べる内容や UI の拡張（後方互換）
   - `major`: 保存データの非互換な変更、ゲーム体験の作り直し級の変更

3. 実行する（判断した種別を伝える。ユーザーが番号を指定したときはその番号を渡す）

   ```
   node tools/bump-version.mjs minor        # または patch / major / 2.3.0
   ```

   スクリプトが `js/config.js` と `package.json` を書き換え、`npm test` を通し、
   「バージョンを vX.Y.Z に更新」→ `tools/make-source-hash.mjs` →
   「バージョン表示のハッシュを更新」の 2 コミットを作り、タグを打って push する。
   リリースノート（箇条書き）も出力し、タグのメッセージに書き込む。

4. 完了報告では、判断した種別とその根拠（どの変更を見てそう決めたか）と、
   出力されたリリースノートを載せる。

主なオプション: `--dry-run`（実行予定だけ表示）、`--no-push`、`--skip-tests`、
`--force`（切り戻しなど非増加を許可）、`--note "一行"`（タグのメッセージに追記）、
`--range A..B`（対象範囲の指定）。

## リリースノート

`node tools/bump-version.mjs --notes`（= `npm run notes`）で、直近のタグから HEAD までの
箇条書きが出る。バージョンを上げるときは自動で出力・タグへ記録されるので、普段このコマンドを
単体で叩くのは「公開済みバージョンのノートを作り直したいとき」くらい:

```
node tools/bump-version.mjs --notes --range dwordle2-v2.0.0..dwordle2-v2.1.0
git show dwordle2-v2.1.0        # 発行時のノートはタグのメッセージにも残っている
```

各コミットの件名から作り、次のように振り分ける（ルールは `RELEASE_NOTE_RULES`、
テストは `test/release-notes.test.mjs`）。

- バージョン運用のコミット（`バージョンを vX.Y.Z に更新` / ハッシュ更新）→ 出さない
- 遊ぶ人から見えない変更（`test/` `tools/` `.github/` だけ、ビルド・CI・リファクタ・
  開発用スクリプトなど）→ 最後の 1 行「安定性を向上（内部の改善 N 件）」にまとめる
- それ以外 → 件名をそのまま 1 行ずつ

スクリプトの出力は下書きとして扱ってよい。件名のままでは伝わらない行があれば、
完了報告のときにそこだけ言葉を補う。分類の取りこぼしが続くようなら
`RELEASE_NOTE_RULES` を直す（普通の文章に紛れる語を足すと誤爆するので狭めに書く）。

タグは `dwordle2-v` 接頭辞。リポジトリ (kakira9618.github.io) は複数サイトの共用なので、
プロジェクト名で名前空間を分けている。差分参照・コミット対象も DWORDle2 配下に限定する。

## ハッシュ表示だけを更新したいとき

バージョンを上げずにデプロイするときは `node tools/make-source-hash.mjs`。
コミットは自分自身のハッシュを含められないので「コードをコミット → 生成 → 生成物をコミット」の順で回す。

## エクスポート JSON の署名

`node tools/verify-export.mjs <ファイル>`（標準入力も可）で、書き出した JSON を 2 段階で調べる。

- **ファイル全体の署名**: `js/core/signature.js` の HMAC-SHA-256。書き出したあとで中身が
  変わっていないかを見る。インポート時にも照合し、合わなければトーストで知らせる
  （取り込み自体は止めない）。旧 DWORDle / DWORDlie の履歴には署名が無いので照合しない。
- **実績ごとの署名**: `js/core/achievement-mark.js`。1 局の内容で決まる実績
  （`PLAY_ACHIEVEMENT_IDS`）に、初見の問題で達成したか（fresh / replay / restored）を
  8 桁 16 進で埋め込む。実績 ID と解除時刻を混ぜるので、同じ状態でも実績ごとに違う値になる。

どちらも鍵がソースに入っているので偽造は防げない。狙いは「JSON を眺めても分からない」まで。
`MARK_SALT` や `HMAC_KEY`、署名の作り方を変えると、それ以前の署名がすべて読めなくなるので変えない。

## 公開（ビルド）について

`master` への push で `.github/workflows/pages.yml` が GitHub Actions から Pages へ配信する。
`dist/` はビルド成果物なのでコミットしない（`.gitignore` 済み）。

`tools/build.mjs` は**バンドルしない**。ディレクトリ構成とファイル名を保ったまま
各 `.js` / `.css` を個別に minify するだけ。この前提が崩れると import map・Web Worker・
動的 import・`sw.js` の事前キャッシュ一覧が一斉に壊れるので、
バンドルやファイル名ハッシュを導入したくなったら先にユーザーへ相談する。

新しい公開ファイル（画像など）を足したときは `tools/build.mjs` 側の作業は不要
（除外リスト方式なので、追加したものは自動的に公開される）。
公開したくない開発用ファイルを足したときだけ `BUILD.exclude` に加える。

ビルド成果物の動作確認は `npm run test:dist`（dist を配信して UI スモークを回す）。
リポジトリは複数サイト共用なので、ワークフローはリポジトリ全体を `_site` へ複製してから
`DWORDle2/` だけを差し替える。ここを「dist だけアップロード」に変えると他サイトが消える。
