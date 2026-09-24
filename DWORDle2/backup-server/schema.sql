-- DWORDle 2 バックアップの保存先（Cloudflare D1）。
-- id はプレイヤー ID の SHA-256、day は端末のローカル日付。1 人 1 日 1 行。
CREATE TABLE IF NOT EXISTS backups (
  id TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  size INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (id, day)
) WITHOUT ROWID;
