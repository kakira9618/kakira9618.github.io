# DWORDle 2 バックアップサーバー

プレイヤーカードを発行したプレイヤーのプレイデータ（エクスポート JSON を暗号化したもの）を
受け取って保存する Cloudflare Worker。保存先は D1（SQLite）。無料枠だけで動く想定
（1 日 10 万リクエスト・書き込み 10 万行・容量 5GB。超えたら止まるだけで課金はされない）。

- クライアント: `js/core/backup.js`（送る条件）と `js/core/backup-crypto.js`（暗号化）
- 取り出し: `tools/fetch-backup.mjs`（管理者の手元で復号する）
- このディレクトリはサイトには公開しない（`tools/build.mjs` の `BUILD.exclude`）

本番: `https://dwordle2-backup.backup-server.workers.dev`（kakira9618 の Cloudflare アカウント）。
管理者トークンは `~/.config/dwordle2/backup-admin-token`（リポジトリには入れない）。

## 初回セットアップ（済み。作り直すときの手順）

```sh
cd backup-server
npx wrangler login
npx wrangler d1 create dwordle2-backup        # 表示された database_id を wrangler.toml へ
npx wrangler d1 execute dwordle2-backup --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN           # 取り出し用のトークン（長い乱数。手元にも控える）
npx wrangler deploy                           # 表示された URL を js/config.js の BACKUP.endpoint へ
```

Worker のコードを変えたときは `cd backup-server && npx wrangler deploy` だけでよい
（GitHub Pages への push とは連動しない）。

`openssl rand -hex 32` などでトークンを作る。トークンはリポジトリに入れない。

## 復旧の手順（プレイヤーから依頼が来たら）

プレイヤー ID（カード右端・設定 → データに出る 8 桁）を教えてもらう。

```sh
export DWORDLE2_BACKUP_TOKEN=$(cat ~/.config/dwordle2/backup-admin-token)
node tools/fetch-backup.mjs 1A2B3C4D --list            # 世代一覧
node tools/fetch-backup.mjs 1A2B3C4D                   # 最新を復元 → dwordle2_history_restore_*.json
node tools/fetch-backup.mjs 1A2B3C4D --day 2026-09-20  # 日付を指定して復元
```

できた JSON をプレイヤーに渡し、設定 → データ →「プレイ履歴をインポート」→ 貼り付けで取り込んでもらう。
新しい端末ではプレイヤー ID が変わるので、以後のバックアップは新しい ID の下に溜まる。

## 仕様

- `POST /backup`: `{ v, id, day, c, iv, data }`。`id` はプレイヤー ID の SHA-256、`day` は端末の日付。
  1 人 1 日 1 枠で同じ日は上書き（60 秒以内の連打は 429）。1 人あたり新しい日付から 30 枠を残す。
  Origin が `ALLOWED_ORIGINS` に無ければ 403。
- `GET /admin/backups/:id` / `GET /admin/backups/:id/:day`: `Authorization: Bearer <ADMIN_TOKEN>`。
- サーバーは中身を復号できない（鍵はプレイヤー ID から作る）。改ざんされた封筒は復号時に失敗するので、
  世代をさかのぼって正常なものを使う。
- ソースは公開されている前提。秘密はトークン（Cloudflare の secret）とプレイヤー ID だけ。

ローカルで試すとき: `npx wrangler d1 execute dwordle2-backup --local --file=schema.sql` のあと
`npx wrangler dev`（`ALLOWED_ORIGINS` に `http://localhost:8642` を足す）。
Worker の単体テストは `test/backup.test.mjs`（D1 を node:sqlite で代用）。
