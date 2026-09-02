// 実績画面と、実績の進捗リング・カード更新の通知（NEW バッジ）
import assert from "node:assert/strict";
import { reveal } from "../../js/core/secret.js?v=20260806-a";
import { assertNoSeriousA11yViolations, goHash, openApp, settings, toast } from "./harness.mjs";

export default [
  {
    name: "screen",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl, { hash: "#/achievements" });
      await page.getByRole("heading", { name: "実績" }).waitFor();
      await page.locator("#screen-achievements .ach-card").first().waitFor();
      await assertNoSeriousA11yViolations(page, "Achievements screen");
    },
  },
  {
    name: "rings-and-news",
    storage: {
      "dwordle2.settings": settings({ reduceFx: false }), // 演出を軽くすると昇格演出はトーストだけになる
      "dwordle2.achievements.sigVersion": 99,
      // 入門カテゴリを全解除（バッジ獲得）+ 勝利系と隠しを 1 つずつ解除
      "dwordle2.achievements": { "first-play": 1750000000, "first-clear": 1750000000, "daily-clear": 1750000000, "wins-10": 1750000000, "h-mirror": 1750000000 },
      // 5 勝ぶんの履歴（別日・別問題）→ 歴戦の勇者（50 勝）の進捗は 5 / 50
      "dwordle2.history": Array.from({ length: 5 }, (_, i) => ({
        gameMode: "normal", problemID: 401 + i, startTime: 1750000000 + i * 86400, endTime: 1750000300 + i * 86400, guessWord: ["about", "crane"], clear: true,
      })),
      // カード発行済み・既読バッジ無し → 入門バッジの獲得が未読なのでタイトルに NEW が出る
      "dwordle2.playerCard": { name: "リング", issuedAt: 1750000000, seenRankTier: 1, seenBadgeCats: [] },
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.locator(".menu-news-badge").waitFor();
      await page.getByRole("button", { name: "プレイヤーカード（ランクアップまたは新しいバッジがあります）" }).waitFor();

      // 実績画面: 解除済みは満円、カウント系は現在値ぶんのリング + 数値、二値系は 0%
      await goHash(page, "#/achievements");
      const rings = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("#screen-achievements .ach-card")];
        const read = (name) => {
          const card = cards.find((c) => c.querySelector(".name")?.textContent === name);
          if (!card) return null;
          return {
            ring: Number(card.querySelector(".badge-icon").style.getPropertyValue("--ach-ring")),
            count: card.querySelector(".ach-progress-count")?.textContent ?? null,
            locked: card.classList.contains("locked"),
          };
        };
        return { unlocked: read("勝ち星コレクター"), counting: read("歴戦の勇者"), binary: read("神の一手") };
      });
      assert.deepEqual(rings.unlocked, { ring: 1, count: null, locked: false }, "an unlocked achievement must show a full ring");
      assert.deepEqual(rings.counting, { ring: 0.1, count: "5 / 50", locked: true }, "a counting achievement must show its partial ring and value");
      assert.deepEqual(rings.binary, { ring: 0, count: null, locked: true }, "a per-game achievement must stay at 0% until unlocked");

      // カードのバッジ棚: 勝利カテゴリは 1/8 の進捗、隠しカテゴリは進捗を出さない（総数が漏れる）
      await goHash(page, "#/card");
      await page.locator(".player-card-canvas").waitFor();
      const badges = await page.evaluate(async () => {
        const states = (await import("./js/ui/player-card.js?v=20260806-a")).categoryBadgeStates();
        const byCat = (cat) => states.find((b) => b.cat === cat);
        return { basicEarned: byCat("basic").earned, wins: byCat("wins").progress, hidden: byCat("hidden").progress };
      });
      assert.deepEqual(badges, { basicEarned: true, wins: 1 / 8, hidden: null });

      // カードを見ると既読になり、タイトルの NEW は消える
      await goHash(page, "#/");
      await page.locator("#screen-title.active").waitFor();
      assert.equal(await page.locator(".menu-news-badge").count(), 0, "viewing the card must clear the NEW notice");

      // カード更新プレビューの合言葉: NEW バッジ → 昇格演出 → 消灯を実データなしで一巡できる
      await goHash(page, "#/settings");
      for (let i = 0; i < 5; i++) await page.locator(".debug-entry").click();
      const secret = page.getByRole("dialog", { name: "シークレット" }).getByLabel("秘密のキーワード");
      await secret.fill(reveal("aTwc4kOU"));
      await secret.press("Enter");
      await toast(page, "カード更新プレビュー ON").waitFor();
      await goHash(page, "#/");
      await page.locator(".menu-news-badge").waitFor();
      await goHash(page, "#/card");
      await page.locator(".rank-up-overlay .rank-up-name").filter({ hasText: "BRONZE RANK" }).waitFor();
      await goHash(page, "#/");
      await page.locator("#screen-title.active").waitFor();
      assert.equal(await page.locator(".menu-news-badge").count(), 0, "the card-news preview must disarm after the card is opened once");
    },
  },
];
