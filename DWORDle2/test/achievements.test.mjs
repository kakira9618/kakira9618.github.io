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
