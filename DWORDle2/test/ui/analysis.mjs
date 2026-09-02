// 分析画面: Worker で候補を数え、正解の手まで表示する
import assert from "node:assert/strict";
import { Logic } from "../../js/core/logic.js?v=20260806-a";
import { pidForNumber } from "../../js/core/problems.js?v=20260806-a";
import { assertNoSeriousA11yViolations, openApp } from "./harness.mjs";

const pid = pidForNumber(1);

export default [
  {
    name: "analysis",
    storage: {
      "dwordle2.history": [
        { version: "2.0.0", startTime: 1_750_000_000, endTime: 1_750_000_020, gameMode: "normal", problemID: pid, guessWord: [new Logic(pid).ans1], clear: true, usoResults: [] },
      ],
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl, { hash: "#/result/normal/1750000000" });
      await page.getByRole("button", { name: "分析" }).click();
      await page.getByText("正解！").waitFor({ timeout: 30000 });
      assert.match(await page.getByText(/答えの組は .* 通り/).textContent(), /答えの組は 27,730 通り/, "Analysis should display unordered answer pairs");
      await assertNoSeriousA11yViolations(page, "Analysis screen");
    },
  },
];
