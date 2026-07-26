import assert from "node:assert/strict";
import { Logic } from "../js/core/logic.js?v=20260725-b";

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

const { scanLegacyHistory, importFromLocalStorage } = await import("../js/core/migrate.js?v=20260725-b");
const { getHistory } = await import("../js/core/records.js?v=20260725-b");
const { achievementIdsFromHistory } = await import("../js/core/achievements.js?v=20260725-b");

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
  const { addImportedGames } = await import("../js/core/records.js?v=20260725-b");
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
  const { importFromText } = await import("../js/core/migrate.js?v=20260725-b");
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

// ---- 手で編集されたエクスポート JSON: startTime / gameMode を検証・正規化して取り込む ----
// 未知の gameMode をそのまま履歴へ入れると MODES[gameMode] を引く画面が例外で開けなくなり、
// 非数値の startTime は履歴のソートと結果画面 URL のキーを壊す。
{
  const { importFromText } = await import("../js/core/migrate.js?v=20260725-b");
  const { MODES } = await import("../js/core/records.js?v=20260725-b");
  const before = getHistory().length;
  const { added } = importFromText(
    JSON.stringify({
      app: "dwordle2",
      version: 1,
      history: [
        { startTime: "not-a-number", endTime: null, gameMode: "cheat", problemID: 1234, guessWord: ["about"] },
        { startTime: 1_760_000_000, endTime: "bogus", gameMode: "cheat", problemID: 1235, guessWord: ["about"] },
      ],
    })
  );
  assert.equal(added, 1, "a record without a usable startTime must be rejected");
  assert.equal(getHistory().length, before + 1);
  const normalized = getHistory().find((record) => record.problemID === 1235);
  assert.equal(normalized.gameMode, "normal", "an unknown gameMode must be normalized to normal");
  assert.ok(MODES[normalized.gameMode], "every stored record must resolve to a known mode");
  assert.equal(normalized.endTime, 1_760_000_000, "a malformed endTime must fall back to startTime");
  assert.ok(
    getHistory().every((record) => Number.isFinite(Number(record.startTime)) && MODES[record.gameMode]),
    "history must never contain records the screens cannot render"
  );
}

// ---- 壊れた usoResults: 画面が各行を配列として反復するので、形が完全なものだけ通す ----
{
  const { importFromText } = await import("../js/core/migrate.js?v=20260725-b");
  const { CELL } = await import("../js/core/logic.js?v=20260725-b");
  const goodRow = [CELL.UNUSED, CELL.USED, CELL.CORRECT, CELL.UNUSED, CELL.USED];
  const { added } = importFromText(
    JSON.stringify({
      app: "dwordle2",
      version: 1,
      history: [
        // 行が配列ですらない / 長さ違い / 未知の状態 / 手数と行数が合わない
        { startTime: 1_770_000_000, endTime: 1_770_000_030, gameMode: "uso", problemID: 21, guessWord: ["about"], usoResults: [42] },
        { startTime: 1_770_000_100, endTime: 1_770_000_130, gameMode: "uso", problemID: 22, guessWord: ["about"], usoResults: [["correct"]] },
        { startTime: 1_770_000_200, endTime: 1_770_000_230, gameMode: "uso", problemID: 23, guessWord: ["about"], usoResults: [["correct", "used", "unused", "used", "nope"]] },
        { startTime: 1_770_000_300, endTime: 1_770_000_330, gameMode: "uso", problemID: 24, guessWord: ["about"], usoResults: [goodRow, goodRow] },
        // 形が完全なものはそのまま残す
        { startTime: 1_770_000_400, endTime: 1_770_000_430, gameMode: "uso", problemID: 25, guessWord: ["about"], usoResults: [goodRow] },
      ],
    })
  );
  assert.equal(added, 5, "records with a malformed usoResults should still be imported (without the broken field)");
  const cellStates = new Set([CELL.UNUSED, CELL.USED, CELL.CORRECT]);
  for (const problemID of [21, 22, 23, 24]) {
    const record = getHistory().find((r) => r.problemID === problemID);
    assert.equal(record.usoResults, undefined, `malformed usoResults must be dropped (No.${problemID})`);
  }
  assert.deepEqual(getHistory().find((r) => r.problemID === 25).usoResults, [goodRow], "well-formed usoResults must be kept");
  assert.ok(
    getHistory().every(
      (record) =>
        record.usoResults === undefined ||
        (Array.isArray(record.usoResults) &&
          record.usoResults.length === record.guessWord.length &&
          record.usoResults.every((row) => Array.isArray(row) && row.length === 5 && row.every((s) => cellStates.has(s))))
    ),
    "history must never contain a usoResults shape the screens cannot render"
  );
}

// ---- 旧作形式の startTime: 非数値キーで startTime も無いレコードは取り込まない ----
{
  const { importFromText } = await import("../js/core/migrate.js?v=20260725-b");
  const before = getHistory().length;
  const { added } = importFromText(
    JSON.stringify({
      version: 1,
      "not-a-time": { complete: true, gameMode: "normal", problemID: 31, guessWord: ["about"] },
      "1780000000": { complete: true, gameMode: "normal", problemID: 32, guessWord: ["about"] },
    })
  );
  assert.equal(added, 1, "a legacy record whose startTime resolves to NaN must be rejected");
  assert.equal(getHistory().length, before + 1);
  assert.equal(getHistory().find((r) => r.problemID === 31), undefined);
  assert.equal(getHistory().find((r) => r.problemID === 32).startTime, 1_780_000_000, "the key should be used as startTime");
}

// ---- 実績を解除しないインポート: noAchievements が付き、実績判定から恒久的に除外される ----
{
  const { importFromText } = await import("../js/core/migrate.js?v=20260725-b");
  const logic = new Logic(11);
  const { added } = importFromText(
    JSON.stringify({
      version: 1,
      "1750000000": {
        complete: true,
        startTime: 1_750_000_000,
        endTime: 1_750_000_005, // 3 手 5 秒クリア → 通常なら h-lightning が付く
        gameMode: "normal",
        problemID: 11,
        guessWord: ["about", "brick", logic.ans1],
      },
    }),
    { withAchievements: false }
  );
  assert.equal(added, 1);
  const record = getHistory().find((r) => r.problemID === 11);
  assert.equal(record.noAchievements, true, "records imported without achievements must carry the flag");
  const ids = achievementIdsFromHistory(getHistory());
  assert(!ids.has("h-lightning"), "flagged records must not unlock achievements in later reconciles");

  // 本作エクスポート形式の再インポートでも、レコード既存の noAchievements は維持される
  const { added: reAdded } = importFromText(
    JSON.stringify({ app: "dwordle2", version: 1, history: [{ ...record, startTime: 1_750_100_000 }] }),
    { withAchievements: true }
  );
  assert.equal(reAdded, 1);
  const reRecord = getHistory().find((r) => r.startTime === 1_750_100_000);
  assert.equal(reRecord.noAchievements, true, "re-importing an export must preserve the original choice");
}

// ---- 段階解放のプレイ回数: インポートは数えず、同じ問題の再プレイは数える ----
{
  const { addFinishedGame, countPlays } = await import("../js/core/records.js?v=20260725-b");
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
