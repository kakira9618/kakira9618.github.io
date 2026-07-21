import assert from "node:assert/strict";
import { achievementIdsFromHistory } from "../js/core/achievements.js";
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

{
  const ids = achievementIdsFromHistory([clearRecord({ pid: 10000, guesses: 3, duration: 15 })]);
  assert(ids.has("first-play"));
  assert(ids.has("first-clear"));
  assert(ids.has("migrator"));
  assert(ids.has("extreme-clear"));
  assert(ids.has("h-lightning"), "3 Guesses in 20 seconds should restore Lightning Fast");
}

{
  const ids = achievementIdsFromHistory([clearRecord({ guesses: 2, duration: 15 })]);
  assert(!ids.has("h-lightning"), "fewer than 3 Guesses must not restore Lightning Fast");
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
  assert(achievementIdsFromHistory(both).has("weekend"), "Saturday + Sunday clears should restore Weekend Wordler");
  assert(!achievementIdsFromHistory(both.slice(0, 1)).has("weekend"), "Saturday alone must not restore Weekend Wordler");
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
  assert(achievementIdsFromHistory(dailyRegular).has("daily-30"), "30 Daily clears should restore Daily Regular");
}

{
  const usoWins = Array.from({ length: 20 }, (_, index) =>
    clearRecord({ mode: "uso", pid: index + 1, startTime: 1_700_000_000 + index * 100 })
  );
  const ids = achievementIdsFromHistory(usoWins);
  assert(ids.has("uso-20"), "20 DWORDlie wins should restore Lie Buster");
  assert(!achievementIdsFromHistory(usoWins.slice(0, 19)).has("uso-20"));
}

{
  // 10 手 × 100 ゲームで 1000 Guess
  const grind = Array.from({ length: 100 }, (_, index) =>
    clearRecord({ pid: (index % 5) + 1, guesses: 10, startTime: 1_700_000_000 + index * 3600 })
  );
  const ids = achievementIdsFromHistory(grind);
  assert(ids.has("guesses-1000"), "1000 total Guesses should restore A Thousand Words");
  assert(ids.has("plays-100"));
  assert(!ids.has("plays-300"));
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
