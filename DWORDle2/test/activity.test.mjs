// 行動ログのお気に入り集計（テーマ / BGM の累計使用時間）のテスト。
// お気に入り = 使用時間が最長のもの。まだ記録が無ければ null（カード側は「-」表示）。
import assert from "node:assert/strict";

const data = new Map();
globalThis.localStorage = {
  getItem: (key) => data.has(key) ? data.get(key) : null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
};

// initActivity が触る DOM API の最小フェイク（イベントは発火させない）
globalThis.document = {
  hidden: false,
  addEventListener: () => {},
};
globalThis.addEventListener = () => {};

// 既存ユーザーの保存データ（usage フィールドが無い頃の形式）から始める
data.set("dwordle2.activity", JSON.stringify({
  version: 1,
  counters: { "key:physical": 3 },
  screens: { title: { visits: 1, totalMs: 1000 } },
  events: [],
}));

const { setSetting } = await import("../js/core/settings.js?v=20260723-fa");
const {
  favoriteBgmTrackId,
  favoriteThemeId,
  getActivity,
  initActivity,
  logBgmTime,
} = await import("../js/core/activity.js?v=20260723-fa");

// usage の無い既存データでも壊れず、お気に入りは「無し」(null) になる
assert.equal(favoriteBgmTrackId(), null, "no favorite BGM before any listening time is logged");
assert.equal(favoriteThemeId(), null, "no favorite theme before any usage time is logged");
assert.equal(getActivity().counters["key:physical"], 3, "existing counters must survive the usage-field migration");

// BGM 聴取時間: 累計が最長の曲がお気に入りになる
logBgmTime("classic", 1000);
logBgmTime("pop", 600);
logBgmTime("pop", 600);
assert.equal(favoriteBgmTrackId(), "pop", "the favorite should be the track with the longest total time");
logBgmTime("classic", 300);
assert.equal(favoriteBgmTrackId(), "classic", "the favorite should follow the new longest track");

// 不正な呼び出し（ID 無し・0 以下・NaN）は無視する
logBgmTime(null, 100);
logBgmTime("uso", 0);
logBgmTime("uso", -50);
logBgmTime("uso", NaN);
assert.deepEqual(getActivity().usage.bgm, { classic: 1300, pop: 1200 }, "invalid logBgmTime calls must not change totals");

// テーマ使用時間: initActivity で現テーマの計測が始まり、切替後は新テーマに積まれる
initActivity(); // 既定テーマ cyber で計測開始
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(favoriteThemeId(), "cyber", "the current theme should accrue usage time from startup");
setSetting("theme", "classic");
await new Promise((resolve) => setTimeout(resolve, 500));
assert.equal(favoriteThemeId(), "classic", "after switching, the new theme should overtake with more usage");
const themeTotals = getActivity().usage.themes;
assert.ok(
  themeTotals.cyber > 0 && themeTotals.classic > themeTotals.cyber,
  `both themes should have positive totals with classic ahead (${JSON.stringify(themeTotals)})`
);

// 集計は少し置くと localStorage に書き出される
await new Promise((resolve) => setTimeout(resolve, 2200));
const persisted = JSON.parse(data.get("dwordle2.activity"));
assert.equal(persisted.usage.bgm.classic, 1300, "BGM listening totals should be persisted");
assert.ok(persisted.usage.themes.classic > 0, "theme usage totals should be persisted");

console.log("行動ログ（お気に入り集計）テスト: OK");
