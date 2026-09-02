// プレイヤーカード: 解放条件・発行と保存・拡大操作・称号と昇格演出・カテゴリバッジ
import assert from "node:assert/strict";
import { goHash, openApp, passGate, settings } from "./harness.mjs";

const games = (count) => Array.from({ length: count }, (_, i) => ({
  gameMode: "normal", problemID: 200 + i, startTime: 1750000000 + i * 86400, endTime: 1750000300 + i * 86400, guessWord: ["about", "crane"], clear: i % 2 === 0,
}));

// Pixel 3 / Chrome 相当（実タッチ・等倍）
const pixel3 = {
  viewport: { width: 393, height: 786 },
  userAgent: "Mozilla/5.0 (Linux; Android 12; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
};

const cardScale = (page) => page.locator(".player-card-tilt").evaluate((tilt) => new DOMMatrix(getComputedStyle(tilt).transform).a);

// 拡大は CSS トランジションなので、目標倍率に届くまで少し待ってから読む
async function waitForZoom(page) {
  let scale = await cardScale(page);
  for (let i = 0; i < 40 && scale <= 2.8; i++) {
    await page.waitForTimeout(50);
    scale = await cardScale(page);
  }
  return scale;
}

export default [
  {
    // 5 プレイ未満はロック（メニュー施錠 + 直接 URL はタイトルへ戻す）
    name: "locked",
    storage: { "dwordle2.playCount": 4, "dwordle2.menuUnlockSeen": 4 },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "プレイヤーカード（あと1回プレイで解放）", exact: true }).waitFor();
      await page.evaluate(() => { location.hash = "#/card"; });
      await page.waitForURL(/#\/$/);
      assert.equal(await page.locator("#screen-title.active").count(), 1, "navigating to #/card before 5 plays must redirect to the title");
    },
  },
  {
    // 5 プレイで解放。名前を保存してカードを発行し、canvas に描かれ、画像を保存できる
    name: "issue",
    page: pixel3,
    storage: { "dwordle2.playCount": 5, "dwordle2.menuUnlockSeen": 5, "dwordle2.history": games(6) },
    async run({ page, context, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "プレイヤーカード", exact: true }).click();
      await page.waitForURL(/#\/card$/);
      // シェア / 保存ボタンは発行前には見えない（[hidden] が display: flex に負ける退行の防止）
      await page.getByRole("button", { name: "カードを発行" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "画像をシェア" }).isVisible(), false, "the share/save buttons must stay hidden until the card is issued");
      await page.getByLabel("プレイヤー名").fill("テスト太郎");
      await page.getByRole("button", { name: "カードを発行" }).click();
      const canvas = page.locator(".player-card-canvas");
      await canvas.waitFor();
      const painted = await canvas.evaluate((node) => {
        const { data } = node.getContext("2d").getImageData(0, 0, node.width, node.height);
        const colors = new Set();
        for (let i = 0; i < data.length; i += 4096) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
        return { width: node.width, height: node.height, colorCount: colors.size };
      });
      assert.deepEqual([painted.width, painted.height], [2400, 1350], "the card image should be rendered at 2x");
      assert.ok(painted.colorCount > 4, `the card should actually be painted (sampled colors: ${painted.colorCount})`);
      await page.getByRole("button", { name: "画像をシェア" }).waitFor();
      // 画像を保存: Blob URL 経由で実際にダウンロードが発生する（iOS Safari 対策の退行防止）
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "画像を保存" }).click(),
      ]);
      assert.match(download.suggestedFilename(), /^DWORDle2_player_card_\d+\.png$/);
      assert.match(download.url(), /^blob:/, "the card image must be saved via a Blob URL, not a data: URL");
      const playerId = await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.playerId")));
      assert.match(playerId, /^[0-9A-F]{8}$/, "the player ID must be 8 uppercase hex digits");

      // ダブルタップで 3 倍に拡大し、もう一度ダブルタップで等倍 Tilt に戻る（実タッチ）
      const tiltBox = await page.locator(".player-card-tilt").boundingBox();
      const cdp = await context.newCDPSession(page);
      const tap = { x: tiltBox.x + tiltBox.width * 0.55, y: tiltBox.y + tiltBox.height * 0.5 };
      const doubleTap = async () => {
        for (let i = 0; i < 2; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tap] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await page.waitForTimeout(70);
        }
      };
      await page.waitForTimeout(360);
      await doubleTap();
      const zoomed = await waitForZoom(page);
      assert.ok(zoomed > 2.8 && zoomed < 3.2, `Double-tap should zoom the card to 3x: ${zoomed}`);
      await page.waitForTimeout(360);
      await doubleTap();
      await page.waitForFunction(() => !document.querySelector(".player-card-stage")?.classList.contains("is-zoomed"));
      assert.equal(await page.locator(".player-card-tilt").evaluate((tilt) => tilt.style.transform), "", "a second double-tap should return to the normal Tilt state");

      // PC のマウス操作でも、ダブルクリックで 3 倍 → 再ダブルクリックで等倍
      const stageBox = await page.locator(".player-card-stage").boundingBox();
      const center = { x: stageBox.x + stageBox.width / 2, y: stageBox.y + stageBox.height / 2 };
      await page.mouse.dblclick(center.x, center.y);
      const desktopZoom = await waitForZoom(page);
      assert.ok(desktopZoom > 2.8 && desktopZoom < 3.2, `Desktop double-click should zoom the card to 3x: ${desktopZoom}`);
      await page.mouse.dblclick(center.x, center.y);
      await page.waitForFunction(() => !document.querySelector(".player-card-stage")?.classList.contains("is-zoomed"));

      // 名前と ID は保存され、再訪問時はカードが自動表示される
      await page.reload({ waitUntil: "load" });
      await passGate(page);
      await goHash(page, "#/card");
      await canvas.waitFor();
      assert.equal(await page.getByLabel("プレイヤー名").inputValue(), "テスト太郎", "the player name must persist across reloads");
      assert.equal(await page.getByRole("button", { name: "カードを発行" }).count(), 0, "an already issued card should be shown without the issue button");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.playerId"))), playerId, "the player ID must persist");

      // 称号ラダー: 最上位は王（実績全解除 + 1000 プレイ）。多い方のモードの王になり、同数なら DWORDle。
      const ranks = await page.evaluate(async () => {
        const mod = await import("./js/ui/player-card.js?v=20260806-a");
        const pick = (stats) => {
          const rank = mod.rankForStats(stats);
          return `${rank.id}:${rank.titleJa}`;
        };
        const ach = { achUnlocked: 10, achTotal: 10 };
        const noAch = { achUnlocked: 9, achTotal: 10 };
        return {
          apprentice: pick({ ...noAch, plays: 5, normalPlays: 5, usoPlays: 0 }),
          kingNormal: pick({ ...ach, plays: 1000, normalPlays: 600, usoPlays: 400 }),
          kingUso: pick({ ...ach, plays: 1000, normalPlays: 400, usoPlays: 600 }),
          kingTie: pick({ ...ach, plays: 1000, normalPlays: 500, usoPlays: 500 }),
          masterBelowKingPlays: pick({ ...ach, plays: 999, normalPlays: 999, usoPlays: 0 }),
          diamondWithoutAllAchievements: pick({ ...noAch, plays: 1500, normalPlays: 0, usoPlays: 1500 }),
        };
      });
      assert.deepEqual(ranks, {
        apprentice: "BRONZE:見習いDWORDler",
        kingNormal: "KING:DWORDleの王",
        kingUso: "KING:DWORDlieの王",
        kingTie: "KING:DWORDleの王",
        masterBelowKingPlays: "MASTER:伝説のDWORDler",
        diamondWithoutAllAchievements: "DIAMOND:頂のDWORDler",
      });
    },
  },
  {
    // 昇格演出: 前回カードを見たときよりランクが上がっていたら RANK UP 演出が 1 回だけ出る。
    // 演出中は拡大できず、終われば戻る。カテゴリバッジは実績 9 カテゴリ + 隠しの計 10 個
    name: "rank-up-and-badges",
    storage: {
      "dwordle2.settings": settings({ reduceFx: false }), // 演出を軽くすると昇格演出はトーストだけになる
      "dwordle2.playCount": 96,
      "dwordle2.menuUnlockSeen": 96,
      "dwordle2.history": games(96),
      "dwordle2.playerCard": { name: "テスト太郎", issuedAt: 1750000000, seenRankTier: 1 },
      "dwordle2.playerId": "0123ABCD",
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl, { hash: "#/card" });
      await page.locator(".player-card-stage.is-rank-up").waitFor();
      const box = await page.locator(".player-card-tilt").boundingBox();
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.dblclick(center.x, center.y);
      assert.equal(await page.locator(".player-card-stage.is-zoomed").count(), 0, "double-click must not zoom the card during a rank-up");
      await page.locator(".rank-up-overlay .rank-up-name").filter({ hasText: "GOLD RANK" }).waitFor();
      await page.locator(".rank-up-overlay").waitFor({ state: "detached" });
      assert.equal(await page.locator(".player-card-stage.is-rank-up").count(), 0, "zoom must be unlocked when the rank-up animation finishes");
      await page.mouse.dblclick(center.x, center.y);
      await page.locator(".player-card-stage.is-zoomed").waitFor();
      await page.mouse.dblclick(center.x, center.y);
      await page.waitForFunction(() => !document.querySelector(".player-card-stage")?.classList.contains("is-zoomed"));
      // 一度見た昇格は次の表示では繰り返さない
      await page.reload({ waitUntil: "load" });
      await passGate(page);
      await goHash(page, "#/card");
      await page.locator(".player-card-canvas").waitFor();
      await page.waitForTimeout(1000);
      assert.equal(await page.locator(".rank-up-overlay").count(), 0, "the rank-up celebration must play only once per promotion");

      const badges = await page.evaluate(async () => {
        const [cardMod, achMod] = await Promise.all([import("./js/ui/player-card.js?v=20260806-a"), import("./js/core/achievements.js?v=20260806-a")]);
        const states = cardMod.categoryBadgeStates();
        return { cats: states.map((b) => b.cat), expected: [...achMod.ACHIEVEMENT_CATEGORIES.map((c) => c.id), "hidden"], earned: states.filter((b) => b.earned).length };
      });
      assert.deepEqual(badges.cats, badges.expected, "badges must cover every achievement category plus hidden");
      assert.equal(badges.cats.length, 10);
      assert.equal(badges.earned, 0, "no badge should be earned before unlocking achievements");
      await page.evaluate(async () => {
        const mod = await import("./js/core/achievements.js?v=20260806-a");
        localStorage.setItem("dwordle2.achievements", JSON.stringify(Object.fromEntries(mod.ACHIEVEMENTS.map((a) => [a.id, 1750000000]))));
      });
      await page.reload({ waitUntil: "load" });
      await passGate(page);
      await goHash(page, "#/card");
      await page.locator(".player-card-canvas").waitFor();
      assert.ok(
        await page.evaluate(async () => (await import("./js/ui/player-card.js?v=20260806-a")).categoryBadgeStates().every((b) => b.earned)),
        "unlocking every achievement must earn all 10 category badges"
      );
    },
  },
];
