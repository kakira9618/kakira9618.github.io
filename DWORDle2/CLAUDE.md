# DWORDle 2 の作業ルール

## 「バージョンを上げて」と言われたとき

`tools/bump-version.mjs` が唯一の窓口。手で `js/config.js` の `APP_VERSION` や
`package.json` の `version` を書き換えたり、自分で tag / push したりしない。

1. 前バージョンからの変更を読む

   ```
   node tools/bump-version.mjs --changes
   ```

   直近のタグ (`dwordle2-vX.Y.Z`) から HEAD までの、DWORDle2 配下のコミットと差分規模が出る。
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

4. 完了報告では、判断した種別とその根拠（どの変更を見てそう決めたか）を書く。

主なオプション: `--dry-run`（実行予定だけ表示）、`--no-push`、`--skip-tests`、
`--force`（切り戻しなど非増加を許可）、`--note "一行"`（タグのメッセージに追記）。

タグは `dwordle2-v` 接頭辞。リポジトリ (kakira9618.github.io) は複数サイトの共用なので、
プロジェクト名で名前空間を分けている。差分参照・コミット対象も DWORDle2 配下に限定する。

## ハッシュ表示だけを更新したいとき

バージョンを上げずにデプロイするときは `node tools/make-source-hash.mjs`。
コミットは自分自身のハッシュを含められないので「コードをコミット → 生成 → 生成物をコミット」の順で回す。
