// シェア文は X の 1 ツイート（280 文字）に収まる。絵文字は 2 文字、URL は t.co の 23 文字として
// 数えられるため、DWORDlie・Daily・15 手・EXTRA SHOT 成功が最悪ケース。
// 数え方は result-screen.js の実装とは独立に書いて、取り違えを検出できるようにする。
import assert from "node:assert/strict";
import { openApp } from "./harness.mjs";

function tweetLength(text) {
  let length = 0;
  const body = text.replace(/https?:\/\/\S+/g, () => {
    length += 23;
    return "";
  });
  for (const ch of body) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) continue;
    const light = (cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    length += light ? 1 : 2;
  }
  return length;
}

export default [
  {
    name: "tweet-length",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const startTime = await page.evaluate(async () => {
        const [{ Logic }, records, { todayPID }] = await Promise.all([
          import("./js/core/logic.js?v=20260806-a"),
          import("./js/core/records.js?v=20260806-a"),
          import("./js/core/problems.js?v=20260806-a"),
        ]);
        const pid = todayPID();
        const logic = new Logic(pid);
        const startTime = Math.floor(Date.now() / 1000) - 10;
        const saved = records.addFinishedGame({
          version: "2.0.0",
          startTime,
          endTime: startTime + 20,
          gameMode: "uso",
          problemID: pid,
          guessWord: [...Array(14).fill(logic.ans2), logic.ans1],
          clear: true,
          usoResults: [],
          extraShot: { word: logic.ans2, success: true },
        });
        navigator.clipboard.writeText = (text) => {
          window.__copiedShareText = text;
          return Promise.resolve();
        };
        return saved.startTime;
      });
      await page.evaluate((time) => { location.hash = `#/result/uso/${time}`; }, startTime);
      await page.waitForURL(new RegExp(`#/result/uso/${startTime}$`));
      await page.getByRole("button", { name: "コピー", exact: true }).click();
      const text = await page.evaluate(() => window.__copiedShareText);
      assert.ok(tweetLength(text) <= 280, `the worst-case share text must fit in a tweet: ${tweetLength(text)}\n${text}`);
      assert.ok(text.includes("DOUBLE ⭐️ CLEAR!!"), `the DOUBLE CLEAR line should be announced: ${text}`);
      assert.ok(/EX:\n[🟩🟨⬜]{5}/u.test(text), `the EXTRA SHOT row should survive in the worst case: ${text}`);
    },
  },
];
