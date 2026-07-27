// エクスポートした JSON を検証する開発用ツール。
//
//   node tools/verify-export.mjs dwordle2_history_1750000000.json
//   pbpaste | node tools/verify-export.mjs        （標準入力からでも読める）
//
// 見るのは 2 つ:
//   1. ファイル全体の署名（HMAC-SHA-256）。書き出したあとで中身が変わっていないか
//   2. 実績ごとの署名。1 局で決まる実績を「初見の問題」で達成したのかどうか
//      （fresh = 初見 / replay = 一度遊んだ問題 / restored = 履歴からの復元で判別不能）
//
// どちらもソースに鍵が入っているので、偽造そのものを防ぐものではない。
// 詳しくは js/core/signature.js と js/core/achievement-mark.js のコメントを参照。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { verifyPayload } = await import(path.join(root, "js/core/signature.js"));
const { MARK, verifyAchievementMark } = await import(path.join(root, "js/core/achievement-mark.js"));

const MARK_LABEL = {
  [MARK.FRESH]: "初見の問題で達成",
  [MARK.REPLAY]: "一度遊んだ問題で達成（答えを知っていた可能性がある）",
  [MARK.RESTORED]: "履歴からの復元・インポート（どちらか不明）",
};

async function readInput(file) {
  if (file) return readFile(path.resolve(process.cwd(), file), "utf8");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const text = await readInput(process.argv[2]);
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error("JSON として読み取れなかった");
  process.exit(1);
}
if (data?.app !== "dwordle2") {
  console.error("DWORDle 2 のエクスポート JSON ではない");
  process.exit(1);
}

// ---- ファイル全体の署名 ----
const { signature, ...payload } = data;
if (typeof signature !== "string") {
  console.log("ファイルの署名: 無し（署名を入れる前のエクスポート、または手で作った JSON）");
} else if (await verifyPayload(payload, signature)) {
  console.log("ファイルの署名: 一致（書き出したときのまま）");
} else {
  console.log("ファイルの署名: 不一致（書き出したあとで中身が変わっている）");
}

console.log(`履歴: ${Array.isArray(data.history) ? data.history.length : 0} 件`);

// ---- 実績ごとの署名 ----
const achievements = data.achievements ?? {};
const entries = Object.entries(achievements);
if (entries.length === 0) {
  console.log("実績: 記録なし");
  process.exit(0);
}

const counts = new Map();
const lines = [];
for (const [id, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
  const unlockedAt = Number(value?.at);
  const state = value?.sig ? verifyAchievementMark(id, value.sig, unlockedAt) : null;
  // 署名を持たない実績（カウント系・イベント系）は状態を持たないので数えない
  if (!value?.sig) continue;
  const label = state ? MARK_LABEL[state] : "不明（署名が合わない）";
  counts.set(state ?? "unknown", (counts.get(state ?? "unknown") ?? 0) + 1);
  lines.push(`  ${id.padEnd(20)} ${new Date(unlockedAt * 1000).toISOString().slice(0, 10)}  ${label}`);
}
console.log(`実績: ${entries.length} 件（うち 1 局で決まるもの ${lines.length} 件）`);
for (const [state, count] of counts) console.log(`  ${MARK_LABEL[state] ?? "不明"}: ${count} 件`);
console.log(lines.join("\n"));
