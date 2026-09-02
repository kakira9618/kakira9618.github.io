// EXTRA SHOT: 棄権・成功（DOUBLE CLEAR）・2 周目のスキップ・DWORDlie の嘘判定
import assert from "node:assert/strict";
import { Logic } from "../../js/core/logic.js?v=20260806-a";
import { pidForNumber } from "../../js/core/problems.js?v=20260806-a";
import { currentGame, goHash, openApp, settings, typeGuess } from "./harness.mjs";

const extraShotSettings = (overrides) => settings({ theme: "cyber", extraShot: true, ...overrides });

// 進行中ゲームを #/game で開き、1 手目で ans1 を当てて EXTRA SHOT 行を出す
async function clearFirstAnswer(page, baseUrl, logic) {
  await openApp(page, baseUrl, { hash: "#/game" });
  await page.locator("#screen-game.active .row").last().waitFor();
  await typeGuess(page, logic.ans1);
  await page.locator("#screen-game.active .fa-row").waitFor({ timeout: 8000 });
}

export default [
  {
    // 戻る操作: 確認後に棄権し、元のゲームだけを通常クリアとして記録する
    name: "forfeit",
    storage: {
      "dwordle2.settings": extraShotSettings(),
      "dwordle2.mode": "normal",
      "dwordle2.current.normal": currentGame(pidForNumber(321)),
      "dwordle2.history": [],
    },
    async run({ page, baseUrl }) {
      const logic = new Logic(pidForNumber(321));
      await clearFirstAnswer(page, baseUrl, logic);
      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      const dialog = page.getByRole("dialog", { name: "EXTRA SHOTを棄権しますか？" });
      await dialog.getByRole("button", { name: "キャンセル" }).click();
      await dialog.waitFor({ state: "detached" });
      assert.match(page.url(), /#\/game$/, "Cancelling the forfeit should keep EXTRA SHOT open");

      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await page.getByRole("dialog", { name: "EXTRA SHOTを棄権しますか？" }).getByRole("button", { name: "OK", exact: true }).click();
      await page.waitForURL(/#\/$/);
      const forfeited = await page.evaluate(() => {
        const history = JSON.parse(localStorage.getItem("dwordle2.history") || "[]");
        const record = history[0] ?? null;
        return {
          historyLength: history.length,
          clear: record?.clear,
          guesses: record?.guessWord,
          hasExtraShot: record ? Object.prototype.hasOwnProperty.call(record, "extraShot") : null,
          current: JSON.parse(localStorage.getItem("dwordle2.current.normal") || "null"),
          playCount: Number(localStorage.getItem("dwordle2.playCount")),
        };
      });
      assert.deepEqual(forfeited, { historyLength: 1, clear: true, guesses: [logic.ans1], hasExtraShot: false, current: null, playCount: 100 }, "Forfeiting EXTRA SHOT should settle one ordinary clear");
      assert.equal(await page.getByText("つづきから", { exact: true }).count(), 0);
    },
  },
  {
    // 成功: DOUBLE CLEAR として記録され、結果画面と問題一覧に反映される
    // （演出は「軽く」にして結果だけを見る。判定演出そのものは repeat-skip が見る）
    name: "success",
    storage: {
      "dwordle2.settings": extraShotSettings({ theme: "classic" }),
      "dwordle2.mode": "normal",
      "dwordle2.current.normal": currentGame(pidForNumber(322), { startTime: 1_800_000_100 }),
      "dwordle2.history": [],
    },
    async run({ page, baseUrl }) {
      const logic = new Logic(pidForNumber(322));
      await clearFirstAnswer(page, baseUrl, logic);
      assert.deepEqual(
        await page.locator("#screen-game .header .fa-counter").evaluate((counter) => [...counter.children].map((child) => child.textContent)),
        ["EXTRA", "SHOT"]
      );
      await typeGuess(page, logic.ans2);
      await page.waitForURL(/#\/result\/normal\/\d+$/, { timeout: 12000 });
      await page.getByText("DOUBLE CLEAR!", { exact: true }).waitFor();
      assert.equal(await page.locator(".answer-row .fa-crown").count(), 1, "the other answer should wear the crown");
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.history"))[0].extraShot),
        { word: logic.ans2, success: true, result: Array(5).fill("correct") },
        "EXTRA SHOT feedback should be saved with the record"
      );
      await goHash(page, "#/problems");
      await page.locator(".problem-level-tabs").getByRole("button", { name: "やさしい", exact: true }).click();
      await page.getByRole("button", { name: /問題 301 から 400/ }).click();
      const cell = page.getByRole("button", { name: "問題 No.322、DOUBLE CLEAR済み" });
      await cell.waitFor();
      assert.equal(await cell.evaluate((node) => node.classList.contains("double-clear")), true);
    },
  },
  {
    // 2 周目以降は判定演出をタップでスキップ可能。両回答を参照して全緑でも、
    // もう一方の答えそのものではない場合は専用メッセージを表示する。
    name: "repeat-skip",
    storage: {
      "dwordle2.settings": extraShotSettings({ theme: "classic", reduceFx: false }),
      "dwordle2.mode": "normal",
      "dwordle2.current.normal": currentGame(1, { startTime: 1_800_000_200 }),
      "dwordle2.history": [{ version: "2.0.0", startTime: 1_799_999_000, endTime: 1_799_999_060, gameMode: "normal", problemID: 1, guessWord: ["touch"], clear: true }],
      "dwordle2.achievements": {},
    },
    async run({ page, baseUrl }) {
      const logic = new Logic(1); // point / touch に対して pouch が「答えではない全緑」になる
      assert.deepEqual([logic.ans1, logic.ans2], ["point", "touch"]);
      assert.deepEqual(logic.queryWord("pouch"), Array(5).fill("correct"));
      await clearFirstAnswer(page, baseUrl, logic);
      await typeGuess(page, "pouch");
      await page.locator("#screen-game.active #board-scroll.extra-shot-skippable .fa-row.fa-charging").waitFor();
      // EXTRA SHOT 行ではなく通常盤面をタップしても、盤面領域全体のスキップが働く
      await page.locator("#screen-game.active #board .row").first().click();
      await page.waitForFunction(() => document.querySelectorAll("#screen-game.active .fa-row .tile.state-correct").length === 5, null, { timeout: 1500 });
      await page.waitForURL(/#\/result\/normal\/\d+$/, { timeout: 8000 });
      await page.getByText("全部緑。でも、もう一つの答えそのものではなかった！", { exact: true }).waitFor();
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.history")).at(-1)?.extraShot),
        { word: "pouch", success: false, result: Array(5).fill("correct") }
      );
    },
  },
  {
    // DWORDlie の EXTRA SHOT も両回答を参照し、表示する全マスで嘘を貫く
    name: "uso",
    storage: {
      "dwordle2.settings": extraShotSettings({ theme: "classic" }),
      "dwordle2.mode": "uso",
      "dwordle2.current.uso": currentGame(pidForNumber(323), { mode: "uso", startTime: 1_800_000_300 }),
      "dwordle2.history": [],
      "dwordle2.achievements": {},
    },
    async run({ page, baseUrl }) {
      const logic = new Logic(pidForNumber(323));
      await clearFirstAnswer(page, baseUrl, logic);
      await typeGuess(page, logic.ans2);
      await page.waitForURL(/#\/result\/uso\/\d+$/, { timeout: 12000 });
      const uso = await page.evaluate(() => {
        const record = JSON.parse(localStorage.getItem("dwordle2.history") || "[]")[0];
        return {
          attempt: record.extraShot,
          tileStates: [...document.querySelectorAll("#screen-result .fa-result .rcell")].map((tile) =>
            [...tile.classList].find((name) => ["unused", "used", "correct"].includes(name))
          ),
        };
      });
      assert.equal(uso.attempt.success, true);
      assert.ok(uso.attempt.result.every((state) => state !== "correct"), `Every DWORDlie EXTRA SHOT tile should lie: ${JSON.stringify(uso)}`);
      assert.deepEqual(uso.tileStates, uso.attempt.result, "The result screen should replay the saved lies exactly");
    },
  },
];
