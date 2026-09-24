// プレイデータのバックアップ: 暗号化・サーバー（Worker + D1）・送る条件・書き出しの促し。
// 実行: node test/backup.test.mjs
// D1 は Node 内蔵の SQLite（node:sqlite）で同じ SQL を動かして代用する。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const { backupSlotId, encryptBackup, decryptBackup } = await import("../js/core/backup-crypto.js?v=20260806-a");
const { shouldAttemptBackup, exportReminderDue, localDay, issuedPlayerId } = await import("../js/core/backup.js?v=20260806-a");
const { BACKUP } = await import("../js/config.js?v=20260806-a");
const worker = await import("../backup-server/src/index.js");

// ---- 暗号化 ----
const ID = "1A2B3C4D";
const TEXT = JSON.stringify({ app: "dwordle2", version: 2, history: [{ startTime: 1, guessWord: ["about"] }] });
const DAY = localDay();

const slot = await backupSlotId(ID);
assert.match(slot, /^[0-9a-f]{64}$/);
assert.equal(await backupSlotId("1a2b3c4d "), slot, "ID の大文字小文字・空白は同じ枠に入るはず");
assert.notEqual(await backupSlotId("1A2B3C4E"), slot);

const envelope = await encryptBackup(ID, DAY, TEXT);
assert.equal(envelope.id, slot);
assert.equal(envelope.c, "gzip");
assert.ok(!JSON.stringify(envelope).includes("about"), "平文が封筒に残っていないはず");
assert.ok(!JSON.stringify(envelope).includes(ID), "ID そのものは送らないはず");
assert.equal(await decryptBackup(ID, envelope), TEXT);

await assert.rejects(decryptBackup("1A2B3C4E", envelope), "別の ID では復号できないはず");
// 1 文字でも書き換えられたら復号に失敗する
const flipped = envelope.data[5] === "A" ? "B" : "A";
await assert.rejects(decryptBackup(ID, { ...envelope, data: envelope.data.slice(0, 5) + flipped + envelope.data.slice(6) }));
// 別の日付の枠へ移し替えた封筒も弾く
await assert.rejects(decryptBackup(ID, { ...envelope, day: "2000-01-01" }));

// ---- サーバー ----
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const DB = fakeD1();
DB.exec(await readFile(new URL("../backup-server/schema.sql", import.meta.url), "utf8"));
const ORIGIN = "https://kakira9618.github.io";
const env = { DB, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8642`, ADMIN_TOKEN: "secret-token" };
const call = (method, path, { body, origin = ORIGIN, token } = {}) =>
  worker.default.fetch(
    new Request(`https://backup.example${path}`, {
      method,
      body,
      headers: { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }),
    env
  );

let res = await call("POST", "/backup", { body: JSON.stringify(envelope) });
assert.equal(res.status, 200, await res.clone().text());
assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN, "ゲームから結果を読めるよう CORS を返すはず");

assert.equal((await call("POST", "/backup", { body: JSON.stringify(envelope), origin: "https://evil.example" })).status, 403);
assert.equal((await call("POST", "/backup", { body: "{" })).status, 400);
assert.equal((await call("POST", "/backup", { body: JSON.stringify({ ...envelope, id: "ZZ" }) })).status, 400);
assert.equal((await call("POST", "/backup", { body: JSON.stringify({ ...envelope, day: "2000-01-01" }) })).status, 400);
assert.equal((await call("POST", "/backup", { body: "x".repeat(worker.LIMITS.maxBodyBytes + 1) })).status, 413);
// 同じ枠の連打は弾く（最初の保存は残る）
assert.equal((await call("POST", "/backup", { body: JSON.stringify(envelope) })).status, 429);

// 管理者 API
assert.equal((await call("GET", `/admin/backups/${slot}`)).status, 401);
assert.equal((await call("GET", `/admin/backups/${slot}`, { token: "wrong" })).status, 401);
res = await call("GET", `/admin/backups/${slot}`, { token: "secret-token" });
const list = await res.json();
assert.deepEqual(list.backups.map((b) => b.day), [DAY]);
res = await call("GET", `/admin/backups/${slot}/${DAY}`, { token: "secret-token" });
assert.equal(await decryptBackup(ID, await res.json()), TEXT, "サーバーを通っても復元できるはず");
assert.equal((await call("GET", `/admin/backups/${slot}/2000-01-01`, { token: "secret-token" })).status, 404);

// 世代の上限: 古い日付から消える（日付の検証をすり抜けるため時計を進めながら投稿する）
const realNow = Date.now;
try {
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < worker.LIMITS.keepSlots + 5; i++) {
    const at = base + i * 86400000;
    Date.now = () => at;
    const day = new Date(at).toISOString().slice(0, 10);
    const e = { ...(await encryptBackup("0000BEEF", day, TEXT)) };
    assert.equal((await call("POST", "/backup", { body: JSON.stringify(e) })).status, 200);
  }
} finally {
  Date.now = realNow;
}
const beef = await (await call("GET", `/admin/backups/${await backupSlotId("0000BEEF")}`, { token: "secret-token" })).json();
assert.equal(beef.backups.length, worker.LIMITS.keepSlots);
assert.equal(beef.backups.at(-1).day, "2026-01-06", "最も古い 5 世代が消えているはず");
// 別の人の世代には手を付けない
assert.equal((await (await call("GET", `/admin/backups/${slot}`, { token: "secret-token" })).json()).backups.length, 1);

// ---- 送る条件 ----
const noon = new Date(2026, 8, 25, 12, 0).getTime();
assert.equal(shouldAttemptBackup({}, noon), true, "初回は送る");
const sentAt = { lastSuccessAt: noon, lastDay: localDay(new Date(noon)) };
assert.equal(shouldAttemptBackup(sentAt, noon + 60_000), false, "直後は送らない");
assert.equal(shouldAttemptBackup(sentAt, noon + BACKUP.minIntervalMs), true, "同じ日でも時間が空けば送る");
const lateNight = new Date(2026, 8, 25, 23, 59).getTime();
const lateSent = { lastSuccessAt: lateNight, lastDay: localDay(new Date(lateNight)) };
assert.equal(shouldAttemptBackup(lateSent, lateNight + 2 * 60_000), true, "日付が変わったら間隔を待たずに送る");
assert.equal(shouldAttemptBackup({ ...sentAt, lastAttemptAt: noon + BACKUP.minIntervalMs }, noon + BACKUP.minIntervalMs + 1000), false, "失敗直後は再挑戦しない");

// カード未発行なら ID を作らず、送らない
assert.equal(issuedPlayerId(), null);
localStorage.setItem("dwordle2.playerId", JSON.stringify(ID));
assert.equal(issuedPlayerId(), null, "ID があってもカード未発行なら送らない");
localStorage.setItem("dwordle2.playerCard", JSON.stringify({ name: "A", issuedAt: 1 }));
assert.equal(issuedPlayerId(), ID);

// ---- 書き出しの促し ----
const DAY_MS = 86400000;
const rule = BACKUP.reminder;
const due = (games, reminder, remoteActive = false, now = noon) => exportReminderDue({ games, reminder, remoteActive, now });
assert.equal(due(rule.minPlays - 1, {}), false, "遊び始めの人には出さない");
assert.equal(due(rule.minPlays, {}), true, "一度も書き出していなければ出す");
assert.equal(due(rule.minPlays + 5, { lastExportAt: noon - 1000, gamesAtExport: 0 }), false, "書き出した直後は出さない");
const exported = { lastExportAt: noon - rule.intervalDays * DAY_MS, gamesAtExport: 30 };
assert.equal(due(30 + rule.playsSinceExport, exported), true);
assert.equal(due(30 + rule.playsSinceExport - 1, exported), false, "あまり遊んでいなければ出さない");
assert.equal(due(30 + rule.playsSinceExport, exported, true), false, "リモートが動いていれば間隔を広げる");
assert.equal(due(rule.minPlays, { snoozedAt: noon - DAY_MS }), false, "「あとで」の直後は出さない");

console.log("backup: ok");
