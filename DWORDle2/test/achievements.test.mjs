import assert from "node:assert/strict";
import {
  ACHIEVEMENTS,
  COLLECTOR_REQUIREMENT,
  achievementCountableRecords,
  achievementIdsFromHistory,
} from "../js/core/achievements.js";
import { Logic, queryWordPair } from "../js/core/logic.js";
import { ALL_WORDS } from "../js/data/words.js";

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
assert.equal(COLLECTOR_REQUIREMENT, 30, "Achievement Hunter should require 30 unlocked achievements");
assert.equal(
  ACHIEVEMENTS.find((achievement) => achievement.id === "collector")?.desc,
  "実績を 30 個解除する"
);
assert.equal(
  ACHIEVEMENTS.find((achievement) => achievement.id === "h-lexicon")?.desc,
  "通算 1000 種類の異なる単語を Guess する"
);
assert.equal(
  ACHIEVEMENTS.find((achievement) => achievement.id === "h-zorome")?.desc,
  "3 桁以上のゾロ目 No. を 10 種類クリアする"
);
assert.equal(
  ACHIEVEMENTS.some((achievement) => achievement.name.includes("ワードラー") || achievement.name === "初日の出ワードル"),
  false,
  "achievement names should consistently use DWORDler"
);
assert.equal(
  ACHIEVEMENTS.some((achievement) => /(?:1095|1825) 日連続/.test(achievement.desc)),
  false,
  "play streak achievements should not require more than one year"
);
assert.equal(ACHIEVEMENTS.find((achievement) => achievement.id === "h-play-days-1095")?.desc, "通算 1095 日プレイする（約 3 年）");
assert.equal(ACHIEVEMENTS.find((achievement) => achievement.id === "h-play-days-1825")?.desc, "通算 1825 日プレイする（約 5 年）");

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
  const words = Array.from({ length: 1000 }, (_, index) => `w${String(index).padStart(4, "0")}`);
  const lexicon = clearRecord();
  lexicon.clear = false;
  lexicon.guessWord = words;
  assert(achievementIdsFromHistory([lexicon]).has("h-lexicon"), "1000 distinct Guesses should restore Well of Words");

  const shortLexicon = { ...lexicon, guessWord: words.slice(0, 999) };
  assert(!achievementIdsFromHistory([shortLexicon]).has("h-lexicon"), "999 distinct Guesses must not restore Well of Words");
}

{
  const zoromePids = [111, 222, 333, 444, 555, 666, 777, 888, 999, 1111];
  const clears = zoromePids.map((pid, index) =>
    clearRecord({ pid, startTime: 1_700_000_000 + index * 100 })
  );
  assert(achievementIdsFromHistory(clears).has("h-zorome"), "10 distinct repdigit puzzle clears should restore Repdigit Collector");
  assert(!achievementIdsFromHistory(clears.slice(0, 9)).has("h-zorome"), "9 repdigit puzzle clears must not restore Repdigit Collector");

  const twoDigitAndDuplicates = [
    ...clears.slice(0, 9),
    clearRecord({ pid: 11, startTime: 1_700_002_000 }),
    clearRecord({ pid: 22, startTime: 1_700_002_100 }),
    clearRecord({ pid: 111, startTime: 1_700_002_200 }),
  ];
  assert(
    !achievementIdsFromHistory(twoDigitAndDuplicates).has("h-zorome"),
    "two-digit numbers and duplicate puzzle clears must not count toward the 10 repdigits"
  );
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
    clearRecord({ mode: "uso", pid: index + 1, startTime: 1_700_000_000 + index * 100 })
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
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const records = [
    clearRecord({ pid: 1, mode: "normal", startTime: base }),
    clearRecord({ pid: 1, mode: "normal", startTime: base + 600 }), // 同日・同問題の再プレイ
    clearRecord({ pid: 2, mode: "normal", startTime: base + 1200 }), // 同日の別問題
    clearRecord({ pid: 1, mode: "uso", startTime: base + 1800 }), // 同日・同 No. の別モードも再プレイ
    clearRecord({ pid: 1, mode: "normal", startTime: base + 86400 }), // 別日の同問題
  ];
  assert.deepEqual(
    achievementCountableRecords(records),
    [records[0], records[2], records[4]],
    "replays of the same puzzle number on the same local day should be excluded regardless of mode"
  );
}

// 同日・同問題の再プレイに含まれる Guess は、履歴復元でも隠し実績を解除しない
{
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const logic = new Logic(1);
  const palindrome = ALL_WORDS.find((w) => w === [...w].reverse().join("") && !logic.isGameClear(w));
  assert(palindrome, "回文の単語が見つかるはず");
  const first = clearRecord({ pid: 1, startTime: base });
  const replay = { ...clearRecord({ pid: 1, startTime: base + 600 }), guessWord: [palindrome, logic.ans1] };
  assert(
    !achievementIdsFromHistory([first, replay]).has("h-mirror"),
    "a same-day replay must not restore secret achievements"
  );
  const nextDay = { ...replay, startTime: base + 86400, endTime: base + 86400 + 15 };
  assert(
    achievementIdsFromHistory([first, nextDay]).has("h-mirror"),
    "the same puzzle on another day should restore secret achievements"
  );
}

{
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const samePuzzleWins = Array.from({ length: 5 }, (_, index) =>
    clearRecord({ pid: 1, startTime: base + index * 600 })
  );
  const ids = achievementIdsFromHistory(samePuzzleWins);
  assert(!ids.has("same-day-5"), "replaying one puzzle five times in a day must not restore On Fire Today");
  assert(!ids.has("streak-3"), "same-day replays of one puzzle must not build a win streak");
}

{
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const uniqueGames = Array.from({ length: 29 }, (_, index) =>
    clearRecord({ pid: index + 1, guesses: 10, startTime: base + index * 60 })
  );
  const duplicate = clearRecord({ pid: 1, guesses: 10, startTime: base + 3600 });
  const idsWithDuplicate = achievementIdsFromHistory([...uniqueGames, duplicate]);
  assert(!idsWithDuplicate.has("plays-30"), "a same-day replay must not reach the 30-play achievement");

  const nextDay = clearRecord({ pid: 1, guesses: 10, startTime: base + 86400 });
  assert(
    achievementIdsFromHistory([...uniqueGames, duplicate, nextDay]).has("plays-30"),
    "the same puzzle on another day should count toward cumulative achievements"
  );
}

{
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const uniqueGames = Array.from({ length: 99 }, (_, index) =>
    clearRecord({ pid: index + 1, guesses: 10, startTime: base + index * 60 })
  );
  const duplicate = clearRecord({ pid: 1, guesses: 10, startTime: base + 7200 });
  const duplicateIds = achievementIdsFromHistory([...uniqueGames, duplicate]);
  assert(!duplicateIds.has("plays-100"), "an excluded replay must not count as the 100th play");
  assert(!duplicateIds.has("guesses-1000"), "Guesses from an excluded replay must not reach the 1000-Guess achievement");

  const nextDay = clearRecord({ pid: 1, guesses: 10, startTime: base + 86400 });
  const nextDayIds = achievementIdsFromHistory([...uniqueGames, duplicate, nextDay]);
  assert(nextDayIds.has("plays-100"));
  assert(nextDayIds.has("guesses-1000"));
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
  // 「一ヶ月の誓い」は 30 日連続ちょうどで解除、29 日では解除しない
  const thirtyDays = Array.from({ length: 30 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, startTime: 1_700_000_000 + index * 86400 })
  );
  assert(achievementIdsFromHistory(thirtyDays).has("h-play-streak-30"), "30 consecutive days should unlock A Month's Vow");
  assert(!achievementIdsFromHistory(thirtyDays.slice(0, 29)).has("h-play-streak-30"), "29 consecutive days must not unlock A Month's Vow");
}

{
  // 1 日 1 回を 5 年続けた履歴（1 年 Streak と長期の通算日数実績をまとめて確認）
  const fiveYears = Array.from({ length: 1825 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, startTime: 1_700_000_000 + index * 86400 })
  );
  const ids = achievementIdsFromHistory(fiveYears);
  assert(ids.has("play-days-100"), "100 play days should restore A Hundred Days");
  assert(ids.has("h-play-days-365"), "365 play days should restore 365 Days of Footprints");
  assert(ids.has("h-play-streak-30"), "30+ consecutive days should restore A Month's Vow");
  assert(ids.has("h-play-days-1095"));
  assert(ids.has("h-play-days-1825"));
  assert(ids.has("wins-200"), "1825 wins should restore Living Legend");
  assert(!ids.has("h-plays-5000"));
  assert(!achievementIdsFromHistory(fiveYears.slice(0, 1824)).has("h-play-days-1825"));

  // 間隔が空いていても、異なるプレイ日が積み上がれば 3 年・5 年の実績を解放する。
  const nonConsecutiveDays = Array.from({ length: 1825 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, startTime: 1_700_000_000 + index * 2 * 86400 })
  );
  const nonConsecutiveIds = achievementIdsFromHistory(nonConsecutiveDays);
  assert(nonConsecutiveIds.has("h-play-days-1095"));
  assert(nonConsecutiveIds.has("h-play-days-1825"));
  assert(!nonConsecutiveIds.has("h-play-streak-30"), "non-consecutive play days must not restore the monthly streak");
}

{
  // 通算プレイ回数の隠し実績（同日でも別問題なら回数は積み上がる）
  const marathon = Array.from({ length: 5000 }, (_, index) =>
    clearRecord({ pid: index + 1, guesses: 1, startTime: 1_700_000_000 + index * 30 })
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
    clearRecord({ mode: "uso", pid: index + 1, guesses: 1, startTime: 1_700_000_000 + index * 30 })
  );
  const ids = achievementIdsFromHistory(usoMarathon);
  assert(ids.has("h-uso-800"), "800 DWORDlie wins should restore Eight Hundred Lies");
  assert(!achievementIdsFromHistory(usoMarathon.slice(0, 799)).has("h-uso-800"));
}

{
  // 10 手 × 100 ゲームで 1000 Guess
  const grind = Array.from({ length: 100 }, (_, index) =>
    clearRecord({ pid: index + 1, guesses: 10, startTime: 1_700_000_000 + index * 60 })
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
    clearRecord({ pid: index + 1, guesses: 10, startTime: 1_700_000_000 + index * 60 })
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
