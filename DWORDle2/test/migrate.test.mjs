import assert from "node:assert/strict";
import { Logic } from "../js/core/logic.js";

const storage = new Map();
globalThis.localStorage = {
  get length() { return storage.size; },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};

const makeLegacyGame = ({ startTime, gameMode, problemID }) => {
  const logic = new Logic(problemID);
  return {
    complete: true,
    startTime,
    endTime: startTime + 30,
    gameMode,
    problemID,
    guessWord: [logic.ans1],
  };
};

const existing = makeLegacyGame({ startTime: 1_700_000_000, gameMode: "normal", problemID: 1 });
existing.clear = true;
storage.set("dwordle2.history", JSON.stringify([existing]));
storage.set(
  "/Tonyu/Projects/dwordle/history.json",
  JSON.stringify({
    version: 1,
    "1700000100": makeLegacyGame({ startTime: 1_700_000_100, gameMode: "normal", problemID: 2 }),
  })
);
storage.set(
  "/Tonyu/Projects/dwordlie/history.json",
  JSON.stringify({
    version: 1,
    "1700000200": makeLegacyGame({ startTime: 1_700_000_200, gameMode: "uso", problemID: 3 }),
  })
);

const { scanLegacyHistory, importFromLocalStorage } = await import("../js/core/migrate.js");
const { getHistory } = await import("../js/core/records.js");
const { achievementIdsFromHistory } = await import("../js/core/achievements.js");

assert.equal(scanLegacyHistory().length, 2, "both original games should be detected");
assert.equal(importFromLocalStorage(), 2);
assert.equal(getHistory().length, 3, "existing DWORDle 2 history should be preserved and merged");
assert.equal(importFromLocalStorage(), 0, "re-importing the same records should not duplicate them");
assert.deepEqual(new Set(getHistory().map((record) => record.gameMode)), new Set(["normal", "uso"]));

const achievementIds = achievementIdsFromHistory(getHistory());
assert(achievementIds.has("migrator"));
assert(achievementIds.has("first-clear"));
assert(achievementIds.has("uso-clear"));

// ---- (startTime, gameMode) の衝突: 別 problemID は 1 秒ずらして共存し、再インポートは冪等 ----
{
  const { addImportedGames } = await import("../js/core/records.js");
  const makeImported = (problemID) => {
    const logic = new Logic(problemID);
    return {
      startTime: 1_700_000_000, // 既存の problemID 1 と同時刻
      endTime: 1_700_000_030,
      gameMode: "normal",
      problemID,
      guessWord: [logic.ans1],
      imported: "json",
    };
  };
  assert.equal(addImportedGames([makeImported(5)]), 1, "same startTime with a different puzzle should be imported");
  const moved = getHistory().find((record) => record.problemID === 5);
  assert.equal(moved.startTime, 1_700_000_001, "the colliding record should be shifted by one second");
  assert.equal(addImportedGames([makeImported(5)]), 0, "re-importing the shifted record should be skipped as a duplicate");
}

// ---- 壊れたレコードの除外: No.0（デイリーエイリアス）や不正な Guess は取り込まない ----
{
  const { importFromText } = await import("../js/core/migrate.js");
  const before = getHistory().length;
  const { added } = await (async () => importFromText(JSON.stringify({
    app: "dwordle2",
    version: 1,
    history: [
      { startTime: 1_800_000_000, endTime: 1_800_000_030, gameMode: "normal", problemID: 0, guessWord: ["about"] },
      { startTime: 1_800_000_100, endTime: 1_800_000_130, gameMode: "normal", problemID: 99999, guessWord: ["about"] },
      { startTime: 1_800_000_200, endTime: 1_800_000_230, gameMode: "normal", problemID: 7, guessWord: ["ABCDE!"] },
    ],
  })))();
  assert.equal(added, 0, "records with an invalid PID or malformed Guesses must be rejected");
  assert.equal(getHistory().length, before);
}

// ---- 段階解放のプレイ回数: インポートは数えず、同じ問題の再プレイは数える ----
{
  const { addFinishedGame, countPlays } = await import("../js/core/records.js");
  assert.equal(countPlays(), 1, "imported records must not count toward menu unlock plays");
  const logic = new Logic(7);
  const play = () =>
    addFinishedGame({
      startTime: 1_900_000_000,
      endTime: 1_900_000_030,
      gameMode: "normal",
      problemID: 7,
      guessWord: [logic.ans1],
    });
  play();
  play(); // 同じ問題の再プレイ（startTime は自動で 1 秒ずれる）
  assert.equal(countPlays(), 3, "same-puzzle replays must count toward menu unlock plays");
}

console.log("履歴移行テスト: OK");
