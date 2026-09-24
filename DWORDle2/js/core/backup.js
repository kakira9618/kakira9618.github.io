// プレイデータのバックアップ。ブラウザのデータ削除で履歴が消える事故への備え。
//
// 1. リモート: プレイヤーカードを発行済みの人だけ、エクスポート JSON を暗号化して
//    backup-server/（Cloudflare Worker）へ送る。サーバーは 1 人 1 日 1 枠で世代を持ち、
//    取り出しは管理者だけ（tools/fetch-backup.mjs）。
//    送るのは「中身が前回から変わっている」かつ「日付が変わった or 前回成功から一定時間」のとき。
//    オフライン・失敗は黙って諦め、次のきっかけ（起動・ゲーム終了・オンライン復帰）で再挑戦する。
// 2. 端末: navigator.storage.persist() で、容量不足や Safari の長期未訪問による
//    自動削除の対象から外してもらう（手動のデータ削除は防げない）。
// 3. 手元への書き出しの促し: 判定だけここに置き、ダイアログは ui/backup-reminder.js。

import { loadJSON, saveJSON } from "./store.js?v=20260806-a";
import { exportJSON, getHistory, countPlays } from "./records.js?v=20260806-a";
import { canonicalJSON } from "./signature.js?v=20260806-a";
import { isDebugMode } from "./debug.js?v=20260806-a";
import { getSettings } from "./settings.js?v=20260806-a";
import { backupCryptoAvailable, encryptBackup } from "./backup-crypto.js?v=20260806-a";
import { BACKUP } from "../config.js?v=20260806-a";

const STATE_KEY = "backup";
const REMINDER_KEY = "exportReminder";
const PERSIST_KEY = "persistRequested";
const DAY_MS = 24 * 60 * 60 * 1000;

let inFlight = null;
const listeners = new Set();

// 端末のローカル日付（YYYY-MM-DD）。サーバーの世代もこの日付で分ける。
export function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getBackupState() {
  const state = loadJSON(STATE_KEY, null);
  return state && typeof state === "object" ? state : {};
}

export function onBackupStateChange(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function updateState(patch) {
  const next = { ...getBackupState(), ...patch };
  saveJSON(STATE_KEY, next);
  for (const handler of listeners) handler(next);
}

export function remoteBackupConfigured() {
  return Boolean(BACKUP.endpoint);
}

// カード発行済みのときだけ ID を返す（getPlayerId と違い、未発番なら作らない）
export function issuedPlayerId() {
  const card = loadJSON("playerCard", null);
  const id = loadJSON("playerId", null);
  if (!card?.issuedAt || !/^[0-9A-F]{8}$/.test(id ?? "")) return null;
  return id;
}

// 設定画面の表示用: 今の状態を 1 つの値で返す
export function remoteBackupStatus() {
  if (!remoteBackupConfigured()) return "unavailable";
  if (!getSettings().autoBackup) return "off";
  if (!issuedPlayerId()) return "no-card";
  return "on";
}

// 送る・送らないの判定（純粋関数。テスト用に公開）
export function shouldAttemptBackup(state, now = Date.now()) {
  if (state.lastAttemptAt && now - state.lastAttemptAt < BACKUP.retryAfterMs) return false;
  if (!state.lastSuccessAt) return true;
  if (state.lastDay !== localDay(new Date(now))) return true;
  return now - state.lastSuccessAt >= BACKUP.minIntervalMs;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// エクスポートの中身（書き出し時刻と署名を除く）の指紋。変化がなければ送らない。
async function contentDigest(text) {
  const { exportedAt, signature, ...content } = JSON.parse(text);
  return sha256Hex(canonicalJSON(content));
}

async function runBackup(playerId) {
  const text = await exportJSON();
  const digest = await contentDigest(text);
  const state = getBackupState();
  if (digest === state.lastDigest) return "unchanged";
  const now = new Date();
  const envelope = await encryptBackup(playerId, localDay(now), text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKUP.requestTimeoutMs);
  try {
    // text/plain は CORS の事前確認（OPTIONS）が要らない単純リクエストになる
    const response = await fetch(`${BACKUP.endpoint}/backup`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(envelope),
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`backup failed: ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
  updateState({ lastSuccessAt: now.getTime(), lastDay: localDay(now), lastDigest: digest, lastAttemptAt: 0 });
  return "sent";
}

// 条件がそろっていればバックアップを送る。失敗しても例外は投げない。
// 戻り値はテスト・デバッグ用（"sent" | "unchanged" | "skipped" | "failed"）。
export async function maybeBackup() {
  if (inFlight) return inFlight;
  if (remoteBackupStatus() !== "on" || isDebugMode() || !backupCryptoAvailable()) return "skipped";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "skipped";
  if (!shouldAttemptBackup(getBackupState())) return "skipped";
  const playerId = issuedPlayerId();
  inFlight = runBackup(playerId)
    .catch((error) => {
      console.warn("backup:", error);
      updateState({ lastAttemptAt: Date.now() });
      return "failed";
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function scheduleBackup(delayMs) {
  setTimeout(() => void maybeBackup(), delayMs);
}

// ---- 端末側の保護 ----

// 定着したプレイヤーにだけ、1 回だけ永続化を頼む（Firefox は許可ダイアログを出すため）
export async function maybeRequestPersistentStorage() {
  const storage = globalThis.navigator?.storage;
  if (!storage?.persist || isDebugMode() || loadJSON(PERSIST_KEY, false)) return;
  if (countPlays() < BACKUP.persistAfterPlays) return;
  try {
    if (await storage.persisted?.()) return;
    saveJSON(PERSIST_KEY, true);
    await storage.persist();
  } catch {
    // 非対応・拒否はそのまま（自動削除の対象になるだけ）
  }
}

// ---- 手元への書き出しの促し ----

function reminderState() {
  const state = loadJSON(REMINDER_KEY, null);
  return state && typeof state === "object" ? state : {};
}

const keptGameCount = () => getHistory().filter((g) => !g.discarded).length;

// 書き出したら（設定画面・促しダイアログのどちらでも）呼ぶ
export function markExported(now = Date.now()) {
  saveJSON(REMINDER_KEY, { ...reminderState(), lastExportAt: now, gamesAtExport: keptGameCount() });
}

export function snoozeExportReminder(now = Date.now()) {
  saveJSON(REMINDER_KEY, { ...reminderState(), snoozedAt: now });
}

// 促しを出すべきか（純粋関数。テスト用に公開）
export function exportReminderDue({ games, reminder, remoteActive, now = Date.now() }) {
  const rule = BACKUP.reminder;
  if (games < rule.minPlays) return false;
  if (games - (reminder.gamesAtExport ?? 0) < rule.playsSinceExport) return false;
  const last = Math.max(reminder.lastExportAt ?? 0, reminder.snoozedAt ?? 0);
  const intervalDays = remoteActive ? rule.intervalDaysWithRemote : rule.intervalDays;
  return now - last >= intervalDays * DAY_MS;
}

export function shouldShowExportReminder() {
  if (isDebugMode()) return false;
  return exportReminderDue({
    games: keptGameCount(),
    reminder: reminderState(),
    remoteActive: remoteBackupStatus() === "on" && Boolean(getBackupState().lastSuccessAt),
  });
}
