// プレイヤー行動ログ。将来の称号・実績の材料として、操作イベントを端末内に記録する。
// 記録先は localStorage（dwordle2.activity）のみで、外部送信は一切しない。
//
// データ形式（"activity" キー）:
//   {
//     version: 1,
//     counters: { "click:title:本日の問題": 5, "key:physical": 123, ... },  // 種別:ID → 累計回数
//     screens: { title: { visits: 10, totalMs: 123456 }, ... },             // 画面ごとの訪問回数と滞在時間
//     usage: { themes: { cyber: 123456, ... }, bgm: { normal: 123456, ... } }, // テーマ / BGM の累計使用時間（ms）
//     events: [ [unix秒, 種別, ID], ... ]                                   // 直近の生イベント（リングバッファ）
//   }
// counters / screens は無制限に育っても小さい集計値。events は EVENT_LIMIT 件で古い方から捨てる。
// ID にはボタンのラベル文字列を使うため表示言語で変わり得る。称号の判定条件に使うときは
// 両言語のキーを見るか、counters ではなく screens / 専用カウンタを使うこと。

import { loadJSON, saveJSON } from "./store.js";
import { getSettings, onSettingsChange } from "./settings.js?v=20260723-fa";

// 生イベントの保持件数（1 件 ≈ 50 バイトなので 2000 件で約 100KB）
const EVENT_LIMIT = 2000;
// 保存はまとめて行う（操作のたびに localStorage へ書かない）
const FLUSH_DELAY_MS = 2000;
// ID に使うラベルの最大長
const LABEL_MAX_CHARS = 40;

let data = null;
let dirty = false;
let flushTimer = 0;
let currentScreen = null; // trackScreen で更新（app.js から通知される）
let screenEnteredAt = 0; // 滞在計測の起点。バックグラウンド中は 0（計測停止）
let activeTheme = null; // 使用時間を計測中のテーマ（initActivity で開始）
let themeSince = 0; // テーマ使用時間の計測起点。バックグラウンド中は 0（計測停止）

function ensureLoaded() {
  if (data === null) {
    data = loadJSON("activity", null);
    if (!data || data.version !== 1) {
      data = { version: 1, counters: {}, screens: {}, events: [] };
    }
    // usage は後から追加したフィールド（既存の保存データには無い）
    data.usage ??= {};
    data.usage.themes ??= {};
    data.usage.bgm ??= {};
  }
  return data;
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  if (!dirty || data === null) return;
  dirty = false;
  saveJSON("activity", data);
}

// counters だけを増やす（打鍵などの高頻度イベント用。リングバッファには残さない）
export function logCount(id, n = 1) {
  const activity = ensureLoaded();
  activity.counters[id] = (activity.counters[id] ?? 0) + n;
  scheduleFlush();
}

// counters を増やし、リングバッファにも [時刻, 種別, ID] を残す
export function logEvent(type, id) {
  const activity = ensureLoaded();
  const key = `${type}:${id}`;
  activity.counters[key] = (activity.counters[key] ?? 0) + 1;
  activity.events.push([Math.floor(Date.now() / 1000), type, id]);
  if (activity.events.length > EVENT_LIMIT) {
    activity.events.splice(0, activity.events.length - EVENT_LIMIT);
  }
  scheduleFlush();
}

// 現在の画面の滞在時間を積み、計測の起点を進める
function settleScreenTime() {
  if (!currentScreen || !screenEnteredAt) return;
  const activity = ensureLoaded();
  const screen = (activity.screens[currentScreen] ??= { visits: 0, totalMs: 0 });
  screen.totalMs += Math.max(0, Date.now() - screenEnteredAt);
  screenEnteredAt = Date.now();
  scheduleFlush();
}

// 使用中テーマの経過時間を積み、計測の起点を進める
function settleThemeTime() {
  if (!activeTheme || !themeSince) return;
  const activity = ensureLoaded();
  activity.usage.themes[activeTheme] = (activity.usage.themes[activeTheme] ?? 0) + Math.max(0, Date.now() - themeSince);
  themeSince = Date.now();
  scheduleFlush();
}

// BGM の聴取時間を積む（sound.js の BGM ループが、実際に音が出ている間だけ呼ぶ）
export function logBgmTime(trackId, ms) {
  if (!trackId || !(ms > 0)) return;
  const activity = ensureLoaded();
  activity.usage.bgm[trackId] = (activity.usage.bgm[trackId] ?? 0) + ms;
  scheduleFlush();
}

// 使用時間が最長の ID（= お気に入り）。まだ記録が無ければ null
function longestUsage(totals) {
  let best = null;
  for (const [id, ms] of Object.entries(totals)) {
    if (ms > 0 && (best === null || ms > totals[best])) best = id;
  }
  return best;
}

export function favoriteThemeId() {
  settleThemeTime(); // 使用中テーマのぶんも反映してから比べる
  return longestUsage(ensureLoaded().usage.themes);
}

export function favoriteBgmTrackId() {
  return longestUsage(ensureLoaded().usage.bgm);
}

// 画面遷移の通知（app.js の show() から呼ばれる）。訪問回数と滞在時間を集計する
export function trackScreen(name) {
  settleScreenTime();
  const activity = ensureLoaded();
  if (name !== currentScreen) {
    const screen = (activity.screens[name] ??= { visits: 0, totalMs: 0 });
    screen.visits += 1;
    logEvent("screen", name);
  }
  currentScreen = name;
  screenEnteredAt = document.hidden ? 0 : Date.now();
}

// クリックされた要素からログ用の ID を作る（aria-label > テキストの順で採用）
function clickId(target) {
  const label = (target.getAttribute("aria-label") ?? target.textContent ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, LABEL_MAX_CHARS);
  const fallback = target.classList.item(0) ?? target.tagName.toLowerCase();
  return `${currentScreen ?? "?"}:${label || fallback}`;
}

export function initActivity() {
  ensureLoaded();

  // ボタン類のクリックを網羅的に記録する（個別の画面コードには手を入れない）
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target?.closest?.('button, a, summary, [role="radio"], [role="switch"]');
      if (!target) return;
      logEvent("click", clickId(target));
    },
    { capture: true }
  );

  // 物理キーの累計打鍵数（内容は記録しない。リピートは数えない）
  document.addEventListener("keydown", (event) => {
    if (!event.repeat) logCount("key:physical");
  });

  // テーマ使用時間の計測を開始（お気に入りテーマ = 最長使用テーマの材料）
  activeTheme = getSettings().theme;
  themeSince = document.hidden ? 0 : Date.now();

  // 設定変更（どの項目をいじったか）。テーマ変更は使用時間を清算してから切り替える
  onSettingsChange((settings, key) => {
    logEvent("setting", key);
    if (key === "theme") {
      settleThemeTime();
      activeTheme = settings.theme;
    }
  });

  // 前面 / 背面の切り替え。背面中は画面滞在・テーマ使用時間を数えない
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      settleScreenTime();
      settleThemeTime();
      screenEnteredAt = 0;
      themeSince = 0;
      logCount("app:background");
      flush();
    } else {
      screenEnteredAt = Date.now();
      themeSince = Date.now();
      logCount("app:foreground");
    }
  });

  // ページを離れる直前に必ず書き出す
  addEventListener("pagehide", () => {
    settleScreenTime();
    settleThemeTime();
    flush();
  });
}

// 集計値の読み取り（将来の称号・実績の判定用）
export function getActivity() {
  const activity = ensureLoaded();
  return {
    version: activity.version,
    counters: { ...activity.counters },
    screens: Object.fromEntries(Object.entries(activity.screens).map(([k, v]) => [k, { ...v }])),
    usage: { themes: { ...activity.usage.themes }, bgm: { ...activity.usage.bgm } },
    events: activity.events.slice(),
  };
}
