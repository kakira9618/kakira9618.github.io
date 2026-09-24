// 管理者用: リモートバックアップを取り出して復号し、エクスポート JSON に戻す。
//
//   node tools/fetch-backup.mjs <プレイヤーID> --list            世代一覧
//   node tools/fetch-backup.mjs <プレイヤーID>                   最新の世代を復元
//   node tools/fetch-backup.mjs <プレイヤーID> --day 2026-09-25  指定日の世代を復元
//   node tools/fetch-backup.mjs <プレイヤーID> --file env.json   手元の封筒を復号（通信しない）
//
// 認証トークンは環境変数 DWORDLE2_BACKUP_TOKEN（wrangler secret の ADMIN_TOKEN と同じ値）。
// 送り先は js/config.js の BACKUP.endpoint（--endpoint か DWORDLE2_BACKUP_ENDPOINT で上書き可）。
// 出力は dwordle2_history_restore_<ID>_<日付>.json（--out で変更）。プレイヤーに渡し、
// 設定 → データ → インポート（DWORDle 2 のエクスポート JSON を貼り付け）で取り込んでもらう。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { backupSlotId, decryptBackup } = await import(path.join(root, "js/core/backup-crypto.js"));
const { verifyPayload } = await import(path.join(root, "js/core/signature.js"));
const { BACKUP } = await import(path.join(root, "js/config.js"));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: "boolean" },
    day: { type: "string" },
    file: { type: "string" },
    out: { type: "string" },
    endpoint: { type: "string" },
  },
});

const playerId = String(positionals[0] ?? "").trim().toUpperCase();
if (!/^[0-9A-F]{8}$/.test(playerId)) {
  console.error("使い方: node tools/fetch-backup.mjs <プレイヤーID（16 進 8 桁）> [--list | --day YYYY-MM-DD | --file 封筒.json]");
  process.exit(1);
}
const slot = await backupSlotId(playerId);

async function api(pathname) {
  const endpoint = values.endpoint ?? process.env.DWORDLE2_BACKUP_ENDPOINT ?? BACKUP.endpoint;
  const token = process.env.DWORDLE2_BACKUP_TOKEN;
  if (!endpoint) throw new Error("送り先が未設定（js/config.js の BACKUP.endpoint か --endpoint）");
  if (!token) throw new Error("環境変数 DWORDLE2_BACKUP_TOKEN が未設定");
  const response = await fetch(`${endpoint}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return JSON.parse(text);
}

const fmtTime = (sec) => new Date(sec * 1000).toLocaleString("ja-JP");

try {
  let envelope;
  if (values.file) {
    envelope = JSON.parse(await readFile(path.resolve(values.file), "utf8"));
  } else {
    const { backups } = await api(`/admin/backups/${slot}`);
    if (values.list) {
      if (backups.length === 0) console.log(`${playerId}: バックアップなし`);
      for (const b of backups) console.log(`${b.day}  ${fmtTime(b.createdAt)}  ${(b.size / 1024).toFixed(1)} KB`);
      process.exit(0);
    }
    const day = values.day ?? backups[0]?.day;
    if (!day) throw new Error(`${playerId}: バックアップなし`);
    envelope = await api(`/admin/backups/${slot}/${day}`);
  }

  const text = await decryptBackup(playerId, envelope);
  const data = JSON.parse(text);
  const { signature, ...payload } = data;
  const signed = signature ? await verifyPayload(payload, signature) : null;
  const out = values.out ?? `dwordle2_history_restore_${playerId}_${envelope.day}.json`;
  await writeFile(out, text);
  console.log(`${envelope.day} の世代を復元: ${out}`);
  console.log(`  書き出し時刻 ${fmtTime(data.exportedAt)} / 履歴 ${data.history?.length ?? 0} 件 / 実績 ${Object.keys(data.achievements ?? {}).length} 件`);
  console.log(`  署名: ${signed === null ? "なし" : signed ? "一致" : "不一致（改ざんの可能性）"}`);
} catch (error) {
  console.error(`失敗: ${error.message}`);
  process.exit(1);
}
