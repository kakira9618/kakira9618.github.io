// 行動ログのお気に入り集計（テーマ / BGM の累計使用時間）と、
// counters のキー数に上限があること（問題番号入りラベルで無制限に増えない）のテスト。
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

const { setSetting } = await import("../js/core/settings.js?v=20260803-a");
const {
  COUNTER_KEY_LIMIT,
  favoriteBgmTrackId,
  favoriteThemeId,
  getActivity,
  initActivity,
  logBgmTime,
  logCount,
  logEvent,
} = await import("../js/core/activity.js?v=20260803-a");

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

// counters のキー数の上限: 問題一覧のように番号や進捗を含むラベルでも際限なく増えない。
// 上限に達したあとの新しい ID は `click:problems:*` へまとめ、既存キーは数え続ける。
{
  const before = Object.keys(getActivity().counters).length;
  logEvent("click", "title:本日の問題"); // 上限前の通常キー（あとで加算されることを確認する）
  const knownKey = "click:title:本日の問題";
  assert.equal(getActivity().counters[knownKey], 1);
  // 問題一覧のセルを大量にタップした状況（ラベルは番号と進捗を含むので毎回違うキーになる）
  for (let pid = 1; pid <= COUNTER_KEY_LIMIT + 200; pid++) {
    logEvent("click", `problems:問題 ${pid}、未プレイ`);
  }
  const counters = getActivity().counters;
  const keys = Object.keys(counters);
  assert.ok(
    keys.length <= COUNTER_KEY_LIMIT + 8,
    `counter keys must stay bounded (${keys.length} keys for ${COUNTER_KEY_LIMIT + 200} distinct ids)`
  );
  assert.ok(counters["click:problems:*"] > 0, "ids beyond the limit must be folded into a per-screen bucket");
  assert.equal(
    keys.filter((key) => key.startsWith("click:problems:") && key !== "click:problems:*").length,
    COUNTER_KEY_LIMIT - before - 1,
    "only the keys that fit under the limit should be kept individually"
  );
  // 上限に達したあとも、既に存在するキーの計数は続く
  logEvent("click", "title:本日の問題");
  logCount("key:physical");
  assert.equal(getActivity().counters[knownKey], 2, "existing counters must keep counting after the limit");
  assert.equal(getActivity().counters["key:physical"], 4, "existing counters must keep counting after the limit");
}

// 集計は少し置くと localStorage に書き出される
await new Promise((resolve) => setTimeout(resolve, 2200));
const persisted = JSON.parse(data.get("dwordle2.activity"));
assert.equal(persisted.usage.bgm.classic, 1300, "BGM listening totals should be persisted");
assert.ok(persisted.usage.themes.classic > 0, "theme usage totals should be persisted");

console.log("行動ログ（お気に入り集計）テスト: OK");
