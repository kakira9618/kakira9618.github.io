import assert from "node:assert/strict";
import { ACHIEVEMENTS, achievementIdsFromHistory } from "../js/core/achievements.js";
import { Logic, queryWordPair } from "../js/core/logic.js";

function clearRecord({
  pid = 1,
  mode = "normal",
  guesses = 3,
  startTime = 1_700_000_000,
  duration = 15,
  imported = "json",
} = {}) {
  const logic = new Logic(pid);
  const filler = logic.ans1 === "about" ? "other" : "about";
  return {
    startTime,
    endTime: startTime + duration,
    gameMode: mode,
    problemID: pid,
    guessWord: [...Array(Math.max(0, guesses - 1)).fill(filler), logic.ans1],
    clear: true,
    imported,
  };
}

assert.equal(ACHIEVEMENTS.find((achievement) => achievement.id === "new-year")?.name, "初日の出DWORDler");
assert.equal(
  ACHIEVEMENTS.some((achievement) => achievement.name.includes("ワードラー") || achievement.name === "初日の出ワードル"),
  false,
  "achievement names should consistently use DWORDler"
);

{
  const ids = achievementIdsFromHistory([clearRecord({ pid: 10000, guesses: 3, duration: 10 })]);
  assert(ids.has("first-play"));
  assert(ids.has("first-clear"));
  assert(ids.has("migrator"));
  assert(ids.has("extreme-clear"));
  assert(ids.has("h-lightning"), "3 Guesses in 10 seconds should restore Lightning Fast");
}

{
  const ids = achievementIdsFromHistory([clearRecord({ guesses: 2, duration: 10 })]);
  assert(!ids.has("h-lightning"), "fewer than 3 Guesses must not restore Lightning Fast");
}

{
  const ids = achievementIdsFromHistory([clearRecord({ guesses: 3, duration: 11 })]);
  assert(!ids.has("h-lightning"), "more than 10 seconds must not restore Lightning Fast");
}

{
  const chainedClear = clearRecord({ pid: 1, guesses: 5 });
  chainedClear.guessWord = ["about", "tears", "spare", "equip", "point"];
  const ids = achievementIdsFromHistory([chainedClear]);
  assert(ids.has("h-alphabet"), "a clear with 5 chained Guess words should restore Alphabet Marathon");
}

{
  const tooShort = clearRecord({ pid: 1, guesses: 4 });
  tooShort.guessWord = ["tears", "spare", "equip", "point"];
  const brokenChain = clearRecord({ pid: 1, guesses: 5 });
  brokenChain.guessWord = ["about", "tears", "crane", "equip", "point"];
  const uncleared = clearRecord({ pid: 1, guesses: 5 });
  uncleared.guessWord = ["about", "tears", "spare", "equip", "point"];
  uncleared.clear = false;

  assert(!achievementIdsFromHistory([tooShort]).has("h-alphabet"), "fewer than 5 chained Guesses must not restore Alphabet Marathon");
  assert(!achievementIdsFromHistory([brokenChain]).has("h-alphabet"), "a broken Guess chain must not restore Alphabet Marathon");
  assert(!achievementIdsFromHistory([uncleared]).has("h-alphabet"), "a chained loss must not restore Alphabet Marathon");
}

{
  const games = Array.from({ length: 5 }, (_, index) =>
    clearRecord({ mode: "uso", startTime: 1_700_000_000 + index * 100 })
  );
  const ids = achievementIdsFromHistory(games);
  assert(ids.has("uso-clear"));
  assert(ids.has("uso-5"));
  assert(ids.has("streak-3"));
  assert(ids.has("streak-5"));
}

{
  const game = clearRecord({ guesses: 3, duration: 0 });
  game.endTime = game.startTime;
  const ids = achievementIdsFromHistory([game]);
  assert(!ids.has("speed-60"), "unknown/zero imported duration must not restore speed achievements");
  assert(!ids.has("h-lightning"));
}

{
  const lost = clearRecord({ pid: 42, startTime: 1_700_000_000 });
  lost.clear = false;
  const won = clearRecord({ pid: 42, startTime: 1_700_000_100 });
  const ids = achievementIdsFromHistory([lost, won]);
  assert(ids.has("revenge"), "a later clear after a loss should restore Revenge");
}

{
  const dailyGames = Array.from({ length: 7 }, (_, index) =>
    clearRecord({ pid: 20260715 + index, startTime: 1_700_000_000 + index * 86400 })
  );
  const ids = achievementIdsFromHistory(dailyGames);
  assert(ids.has("daily-7"), "seven historical consecutive Daily clears should restore Perfect Week");
}

{
  // 2026-01-01 09:00 JST 前後（ローカル時刻依存を避けるため正午 UTC ベースで組む）
  const newYearNoon = Math.floor(Date.UTC(2026, 0, 1, 3, 0, 0) / 1000);
  const ids = achievementIdsFromHistory([clearRecord({ startTime: newYearNoon })]);
  assert(ids.has("new-year"), "a clear on January 1 should restore First Sunrise");
  assert(!ids.has("christmas"));
}

{
  const earlyMorning = new Date(2026, 6, 20, 6, 30, 0); // ローカル 6:30
  const ids = achievementIdsFromHistory([
    clearRecord({ startTime: Math.floor(earlyMorning.getTime() / 1000) }),
  ]);
  assert(ids.has("early-bird"), "a clear between 5 and 8 a.m. should restore Early Bird");
}

{
  const saturday = new Date(2026, 6, 18, 12, 0, 0); // 2026-07-18 (土)
  const sunday = new Date(2026, 6, 19, 12, 0, 0); // 2026-07-19 (日)
  const both = [
    clearRecord({ pid: 1, startTime: Math.floor(saturday.getTime() / 1000) }),
    clearRecord({ pid: 2, startTime: Math.floor(sunday.getTime() / 1000) }),
  ];
  assert(achievementIdsFromHistory(both).has("weekend"), "Saturday + Sunday clears should restore Weekend DWORDler");
  assert(!achievementIdsFromHistory(both.slice(0, 1)).has("weekend"), "Saturday alone must not restore Weekend DWORDler");
}

{
  const base = new Date(2026, 6, 20, 12, 0, 0);
  const sameDayWins = Array.from({ length: 5 }, (_, index) =>
    clearRecord({ pid: index + 1, startTime: Math.floor(base.getTime() / 1000) + index * 600 })
  );
  assert(achievementIdsFromHistory(sameDayWins).has("same-day-5"), "5 wins in one day should restore On Fire Today");
  assert(!achievementIdsFromHistory(sameDayWins.slice(0, 4)).has("same-day-5"));
}

{
  const manyDays = Array.from({ length: 30 }, (_, index) =>
    clearRecord({ pid: index + 1, startTime: 1_700_000_000 + index * 86400 })
  );
  const ids = achievementIdsFromHistory(manyDays);
  assert(ids.has("play-days-30"), "playing on 30 days should restore Consistency Pays");
  assert(!achievementIdsFromHistory(manyDays.slice(0, 29)).has("play-days-30"));
}

{
  const dailyRegular = Array.from({ length: 30 }, (_, index) =>
    clearRecord({ pid: 20260601 + index, startTime: 1_700_000_000 + index * 86400 })
  );
  const ids = achievementIdsFromHistory(dailyRegular);
  assert(ids.has("daily-30"), "30 Daily clears should restore Daily Regular");
  assert(ids.has("daily-streak-30"), "30 consecutive Daily clears should restore Perfect Month");
}

{
  // 通算 30 回のデイリークリアでも、途中が抜けると連続 30 日にはならない
  const dates = [];
  for (let d = 1; d <= 15; d++) dates.push(20260600 + d); // 6/1-6/15
  for (let d = 17; d <= 30; d++) dates.push(20260600 + d); // 6/17-6/30（6/16 が抜け）
  dates.push(20260701);
  const gapped = dates.map((pid, index) => clearRecord({ pid, startTime: 1_700_000_000 + index * 86400 }));
  const ids = achievementIdsFromHistory(gapped);
  assert(ids.has("daily-30"));
  assert(!ids.has("daily-streak-30"), "a gapped Daily run must not restore Perfect Month");
}

{
  // 連続プレイ日数（敗北した日もプレイ日として数える）
  const consecutive = Array.from({ length: 14 }, (_, index) => {
    const record = clearRecord({ pid: (index % 5) + 1, startTime: 1_700_000_000 + index * 86400 });
    if (index % 2 === 0) record.clear = false;
    return record;
  });
  const ids = achievementIdsFromHistory(consecutive);
  assert(ids.has("play-streak-3"), "3 consecutive play days should restore Three Days Straight");
  assert(ids.has("play-streak-7"));
  assert(ids.has("play-streak-14"));
  assert(!achievementIdsFromHistory(consecutive.slice(0, 13)).has("play-streak-14"));

  // 1 日おきのプレイは連続にならない
  const everyOtherDay = Array.from({ length: 6 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, startTime: 1_700_000_000 + index * 2 * 86400 })
  );
  assert(!achievementIdsFromHistory(everyOtherDay).has("play-streak-3"));
}

{
  // 1 日 1 回を 5 年続けた履歴（長期の隠し実績をまとめて確認）
  const fiveYears = Array.from({ length: 1825 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, startTime: 1_700_000_000 + index * 86400 })
  );
  const ids = achievementIdsFromHistory(fiveYears);
  assert(ids.has("play-days-100"), "100 play days should restore A Hundred Days");
  assert(ids.has("h-play-days-365"), "365 play days should restore 365 Days of Footprints");
  assert(ids.has("h-play-streak-365"), "365 consecutive days should restore A Year's Vow");
  assert(ids.has("h-play-streak-1095"));
  assert(ids.has("h-play-streak-1825"));
  assert(ids.has("wins-200"), "1825 wins should restore Living Legend");
  assert(!ids.has("h-plays-5000"));
  assert(!achievementIdsFromHistory(fiveYears.slice(0, 1824)).has("h-play-streak-1825"));
}

{
  // 通算プレイ回数の隠し実績（同日に集中していても回数は積み上がる）
  const marathon = Array.from({ length: 5000 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, guesses: 1, startTime: 1_700_000_000 + index * 3600 })
  );
  const ids = achievementIdsFromHistory(marathon);
  assert(ids.has("h-plays-5000"), "5000 games should restore Endless Pursuit");
  assert(ids.has("plays-500"));
}

{
  // 1 ゲームの Guess で A-Z 全てを使う（クリア不要）
  const base = {
    startTime: 1_700_000_000,
    endTime: 1_700_000_100,
    gameMode: "normal",
    problemID: 1,
    clear: false,
    imported: "json",
  };
  const pangram = { ...base, guessWord: ["abcde", "fghij", "klmno", "pqrst", "uvwxy", "zebra"] };
  assert(achievementIdsFromHistory([pangram]).has("all-letters"), "using all 26 letters should restore A to Z");
  const missingZ = { ...base, guessWord: ["abcde", "fghij", "klmno", "pqrst", "uvwxy"] };
  assert(!achievementIdsFromHistory([missingZ]).has("all-letters"), "25 letters must not restore A to Z");
}

{
  const usoWins = Array.from({ length: 20 }, (_, index) =>
    clearRecord({ mode: "uso", pid: index + 1, startTime: 1_700_000_000 + index * 100 })
  );
  const ids = achievementIdsFromHistory(usoWins);
  assert(ids.has("uso-20"), "20 DWORDlie wins should restore Lie Detector");
  assert(!achievementIdsFromHistory(usoWins.slice(0, 19)).has("uso-20"));
}

{
  const usoMarathon = Array.from({ length: 800 }, (_, index) =>
    clearRecord({ mode: "uso", pid: (index % 5) + 1, guesses: 1, startTime: 1_700_000_000 + index * 3600 })
  );
  const ids = achievementIdsFromHistory(usoMarathon);
  assert(ids.has("h-uso-800"), "800 DWORDlie wins should restore Eight Hundred Lies");
  assert(!achievementIdsFromHistory(usoMarathon.slice(0, 799)).has("h-uso-800"));
}

{
  // 10 手 × 100 ゲームで 1000 Guess
  const grind = Array.from({ length: 100 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, guesses: 10, startTime: 1_700_000_000 + index * 3600 })
  );
  const ids = achievementIdsFromHistory(grind);
  assert(ids.has("guesses-1000"), "1000 total Guesses should restore A Thousand Words");
  assert(ids.has("plays-30"), "100 games should restore Getting the Hang of It");
  assert(ids.has("plays-100"));
  assert(!ids.has("plays-300"));
  assert(!ids.has("plays-500"));
  assert(!ids.has("guesses-3000"));
}

{
  // 10 手 × 300 ゲームで 3000 Guess
  const bigGrind = Array.from({ length: 300 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, guesses: 10, startTime: 1_700_000_000 + index * 3600 })
  );
  const ids = achievementIdsFromHistory(bigGrind);
  assert(ids.has("plays-300"));
  assert(ids.has("guesses-3000"), "3000 total Guesses should restore Three Thousand Words");
  assert(ids.has("wins-200"));
}

{
  const feedback = queryWordPair("block", "about", "black");
  assert(feedback.every((state) => state === "correct"));
  assert.notEqual("block", "about");
  assert.notEqual("block", "black");
}

{
  const logic = new Logic(1);
  assert.equal(logic.ans1, "point");
  assert.equal(logic.ans2, "touch");
  assert(queryWordPair("pouch", logic.ans1, logic.ans2).every((state) => state === "correct"));
  const ids = achievementIdsFromHistory([{
    startTime: 1_700_000_000,
    endTime: 1_700_000_030,
    gameMode: "normal",
    problemID: 1,
    guessWord: ["pouch"],
    clear: false,
    imported: "json",
  }]);
  assert(ids.has("h-phantom"), "an all-green non-answer should restore Phantom Answer");
}

console.log("実績遡及判定テスト: OK");
