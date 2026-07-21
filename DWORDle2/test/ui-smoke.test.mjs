import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { Logic } from "../js/core/logic.js";
import { ACHIEVEMENTS } from "../js/core/achievements.js";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const relativePath = decodeURIComponent(requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1));
    let filePath = path.resolve(projectRoot, relativePath);
    if (!filePath.startsWith(`${projectRoot}${path.sep}`) && filePath !== path.join(projectRoot, "index.html")) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/`;
const unlocked = Object.fromEntries(ACHIEVEMENTS.map((achievement) => [achievement.id, 1]));
const ogPng = await readFile(path.join(projectRoot, "og.png"));
const ihdrOffset = ogPng.indexOf(Buffer.from("IHDR"));
assert.notEqual(ihdrOffset, -1, "OGP image should contain a PNG IHDR chunk");
assert.equal(ogPng.readUInt32BE(ihdrOffset + 4), 1200, "OGP image width should be 1200px");
assert.equal(ogPng.readUInt32BE(ihdrOffset + 8), 630, "OGP image height should be 630px");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
});
await page.addInitScript(({ unlockedAchievements }) => {
  localStorage.setItem("dwordle2.settings", JSON.stringify({
    theme: "classic",
    sfx: false,
    sfxVolume: 0,
    bgm: false,
    bgmVolume: 0,
    bgmTrack: "auto",
    language: "ja",
    keyboardHints: true,
    reduceFx: true,
    randomLevel: 1,
  }));
  localStorage.setItem("dwordle2.achievements", JSON.stringify(unlockedAchievements));
  localStorage.setItem("dwordle2.legacyImportPrompted", "true");
}, { unlockedAchievements: unlocked });
await page.addInitScript({ path: axePath });

async function assertNoSeriousA11yViolations(stage) {
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ["violations"] }));
  const violations = result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  const details = violations
    .map((violation) => `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => `  ${node.target.join(" ")}: ${node.failureSummary}`).join("\n")}`)
    .join("\n");
  assert.equal(violations.length, 0, `${stage} has serious accessibility violations:\n${details}`);
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const tutorial = page.getByRole("dialog", { name: "基本ルール" });
  await tutorial.waitFor();
  assert.equal(await tutorial.evaluate((node) => node.contains(document.activeElement)), true, "Tutorial should receive focus");
  await page.getByRole("button", { name: "わかった" }).click();
  const normalLogoBox = await page.locator(".logo").boundingBox();
  await page.getByRole("button", { name: "裏モードへ" }).click();
  const usoTutorial = page.getByRole("dialog", { name: "基本ルール" });
  await usoTutorial.waitFor();
  await usoTutorial.getByText("基本ルールは DWORDle と同じ").waitFor();
  await usoTutorial.getByText("判定は必ず嘘をつく").waitFor();
  assert.equal(await usoTutorial.locator(".tutorial-point").count(), 2, "DWORDlie tutorial should show two rules");
  await usoTutorial.getByRole("button", { name: "わかった" }).click();
  const usoLogoBox = await page.locator(".logo").boundingBox();
  assert.ok(
    normalLogoBox && usoLogoBox && Math.abs(normalLogoBox.y - usoLogoBox.y) <= 1,
    `DWORDle and DWORDlie logos should remain at the same vertical position: ${JSON.stringify({ normalLogoBox, usoLogoBox })}`
  );
  const usoBanner = page.getByText("う そ ぴ ょ ん", { exact: true });
  assert.equal(await usoBanner.isVisible(), true, "DWORDlie banner should be visible");
  const usoBannerBox = await usoBanner.boundingBox();
  assert.ok(
    usoBannerBox && usoLogoBox
      && usoBannerBox.y < usoLogoBox.y
      && usoLogoBox.y >= usoBannerBox.y + usoBannerBox.height
      && usoLogoBox.y - (usoBannerBox.y + usoBannerBox.height) <= 8,
    `DWORDlie banner should sit immediately above the logo: ${JSON.stringify({ usoBannerBox, usoLogoBox })}`
  );
  await page.getByRole("button", { name: "表モードへ" }).click();
  await assertNoSeriousA11yViolations("Title screen");
  const publicEntry = await page.evaluate(async () => {
    const assetPaths = ["/favicon.png", "/og.png", "/manifest.webmanifest"];
    const statuses = await Promise.all(assetPaths.map(async (assetPath) => (await fetch(assetPath)).status));
    return {
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      statuses,
    };
  });
  assert.equal(publicEntry.ogImage, "https://kakira9618.github.io/DWORDle2/og.png");
  assert.equal(publicEntry.twitterCard, "summary_large_image");
  assert.equal(publicEntry.manifest, "manifest.webmanifest");
  assert.deepEqual(publicEntry.statuses, [200, 200, 200], "Public metadata assets should be served");

  await page.getByRole("button", { name: "設定" }).click();
  await page.waitForURL(/#\/settings$/);
  const switches = page.getByRole("switch");
  await switches.first().waitFor();
  assert.equal(await switches.count(), 4, "All settings switches should expose the switch role");
  for (const label of ["キーボードヒント", "演出を軽くする", "効果音", "BGM"]) {
    await page.getByRole("switch", { name: label }).waitFor();
  }

  // 隠しテーマ Pop: 実績「三色盛り」解放済みなので選択でき、body クラスに反映される
  // BGM 一覧の「Candy Pop」と部分一致しないよう exact 指定でテーマの Pop を選ぶ
  await page.getByRole("radio", { name: "Pop", exact: true }).click();
  await page.locator("body.theme-pop").waitFor();
  await page.getByRole("radio", { name: "クラシック" }).click();
  await page.locator("body.theme-classic").waitFor();
  // クラス切替直後は数フレームだけ旧テーマの文字色が残る（transition の過渡状態）。
  // axe が過渡状態を拾わないよう、見出し文字の実際の色が classic に戻るまで待つ。
  await page.waitForFunction(() => {
    const targets = document.querySelectorAll("#screen-settings .header .title, #screen-settings .label .l1");
    return targets.length > 0 &&
      [...targets].every((node) => getComputedStyle(node).color === "rgb(242, 242, 242)");
  });

  await assertNoSeriousA11yViolations("Settings screen");
  await page.getByRole("button", { name: "タイトルへ戻る" }).click();

  await page.getByRole("button", { name: "番号を指定" }).click();
  const puzzleDialog = page.getByRole("dialog", { name: "番号を指定してプレイ" });
  await puzzleDialog.locator('input[type="number"]').fill("1");
  await puzzleDialog.getByRole("button", { name: "スタート" }).click();
  await page.waitForURL(/#\/game$/);
  await page.locator("#screen-game.active .row").last().waitFor();

  const answer = new Logic(1).ans1;
  await page.keyboard.type(answer);
  await page.keyboard.press("Enter");
  await page.waitForURL(/#\/result\/normal\/\d+$/, { timeout: 15000 });
  const resultUrl = page.url();
  await page.getByText("GAME CLEAR").waitFor();
  await page.getByRole("img", { name: /緑、位置一致/ }).first().waitFor();
  const guessedAnswerRow = page.locator(".answer-row:has(.guess-flag)");
  assert.equal(await guessedAnswerRow.count(), 1, "The guessed answer should have one rotating flag");
  assert.match(
    await guessedAnswerRow.getAttribute("aria-label"),
    /あなたが当てた答え/,
    "The flag meaning should also be exposed to assistive technology"
  );
  assert.equal(await page.locator(".amark").count(), 0, "The old textual answer marker should be removed");
  await assertNoSeriousA11yViolations("Result screen");

  await page.evaluate(() => { location.hash = "#/history"; });
  await page.waitForURL(/#\/history$/);
  const historyItem = page.locator("button.history-item").first();
  await historyItem.waitFor();
  await historyItem.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/#\/result\/normal\/\d+$/);

  await page.evaluate(() => { location.hash = "#/problems"; });
  await page.waitForURL(/#\/problems$/);
  const block = page.locator("button.block-cell").first();
  await block.waitFor();
  await block.focus();
  await page.keyboard.press("Enter");
  await page.locator("button.num-cell").first().waitFor();

  await page.goto(resultUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "分析" }).click();
  await page.getByText("正解！").waitFor({ timeout: 30000 });
  const analysisSummary = await page.getByText(/答えの組は .* 通り/).textContent();
  assert.match(analysisSummary, /答えの組は 27,730 通り/, "Analysis should display unordered answer pairs");
  const solvedCard = page.locator(".turn-card").filter({ hasText: "正解！" });
  assert.equal(await solvedCard.getByText("もっと絞れたかもしれない単語").count(), 0, "Winning Guess should not show suggestions");
  await assertNoSeriousA11yViolations("Analysis screen");

  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  assert.equal(viewport.includes("user-scalable=no"), false, "Pinch zoom must remain available");
  assert.equal(runtimeErrors.length, 0, `Runtime errors:\n${runtimeErrors.join("\n")}`);

  const shortPage = await browser.newPage({ viewport: { width: 393, height: 559 }, locale: "ja-JP" });
  await shortPage.addInitScript(() => {
    localStorage.setItem("dwordle2.settings", JSON.stringify({
      theme: "cyber",
      sfx: false,
      bgm: false,
      language: "ja",
      keyboardHints: true,
      reduceFx: false,
      randomLevel: 1,
    }));
    localStorage.setItem("dwordle2.legacyImportPrompted", "true");
    localStorage.setItem("dwordle2.tutorialSeen", "true");
  });
  await shortPage.goto(baseUrl, { waitUntil: "networkidle" });
  await shortPage.addStyleTag({ content: "#app { height: var(--app-height) !important; }" });
  const titleViewportMetrics = await shortPage.evaluate(() => ({
    appHeight: document.getElementById("app").getBoundingClientRect().height,
    innerHeight,
    fallbackHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim(),
  }));
  assert.ok(
    Math.abs(titleViewportMetrics.appHeight - titleViewportMetrics.innerHeight) <= 1,
    "Legacy Android viewport fallback should fill the visible title viewport"
  );
  assert.equal(titleViewportMetrics.fallbackHeight, `${titleViewportMetrics.innerHeight}px`);
  const shortLogoBox = await shortPage.locator(".logo").boundingBox();
  assert.ok(shortLogoBox && shortLogoBox.y >= 0, "Title logo should remain visible on a Pixel 3-height viewport");
  await shortPage.getByRole("button", { name: "デイリー問題" }).waitFor();
  await shortPage.getByRole("button", { name: "設定" }).scrollIntoViewIfNeeded();
  await shortPage.getByRole("button", { name: "設定" }).waitFor();

  await shortPage.getByRole("button", { name: "番号を指定" }).click();
  const shortPuzzleDialog = shortPage.getByRole("dialog", { name: "番号を指定してプレイ" });
  await shortPuzzleDialog.locator('input[type="number"]').fill("1");
  await shortPuzzleDialog.getByRole("button", { name: "スタート" }).click();
  await shortPage.waitForURL(/#\/game$/);
  await shortPage.locator("#screen-game.active").waitFor();
  const gameViewportMetrics = await shortPage.evaluate(() => ({
    appHeight: document.getElementById("app").getBoundingClientRect().height,
    gameHeight: document.getElementById("screen-game").getBoundingClientRect().height,
    innerHeight,
  }));
  assert.ok(
    Math.abs(gameViewportMetrics.appHeight - gameViewportMetrics.innerHeight) <= 1 &&
      Math.abs(gameViewportMetrics.gameHeight - gameViewportMetrics.innerHeight) <= 1,
    `Legacy Android viewport fallback should fill the visible game viewport: ${JSON.stringify(gameViewportMetrics)}`
  );
  await shortPage.waitForTimeout(50);
  const flightsBeforeLeave = await shortPage.evaluate(async () =>
    (await import("./js/fx/effects.js")).activeTileFlightCount()
  );
  assert.ok(flightsBeforeLeave > 0, "Tile gather animation should be active before leaving the game");
  await shortPage.getByRole("button", { name: "タイトルへ戻る" }).click();
  await shortPage.waitForURL(/#\/$/);
  const flightsAfterLeave = await shortPage.evaluate(async () =>
    (await import("./js/fx/effects.js")).activeTileFlightCount()
  );
  assert.equal(flightsAfterLeave, 0, "Tile gather animation should be removed when leaving the game");
  await shortPage.close();

  const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.addInitScript(() => {
    localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "cyber", sfx: false, bgm: false, language: "ja" }));
    localStorage.setItem("dwordle2.legacyImportPrompted", "true");
    localStorage.setItem("dwordle2.tutorialSeen", "true");
  });
  await fallbackPage.route("**/vendor/three.module.min.js", (route) => route.abort("failed"));
  await fallbackPage.goto(baseUrl, { waitUntil: "networkidle" });
  await fallbackPage.locator("body.theme-classic").waitFor();
  await fallbackPage.locator("#screen-title.active .logo").waitFor();
  await fallbackPage.getByRole("button", { name: "番号を指定" }).click();
  const fallbackDialog = fallbackPage.getByRole("dialog", { name: "番号を指定してプレイ" });
  await fallbackDialog.locator('input[type="number"]').fill("1");
  await fallbackDialog.getByRole("button", { name: "スタート" }).click();
  await fallbackPage.locator("#screen-game.active").waitFor();
  await fallbackContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
    reducedMotion: "reduce",
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.addInitScript(() => {
    localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "cyber", sfx: false, bgm: false, language: "ja", reduceFx: false }));
    localStorage.setItem("dwordle2.legacyImportPrompted", "true");
    localStorage.setItem("dwordle2.tutorialSeen", "true");
  });
  await reducedPage.goto(baseUrl, { waitUntil: "networkidle" });
  await reducedPage.locator("body.reduce-motion").waitFor();
  await reducedPage.getByRole("button", { name: "番号を指定" }).click();
  const reducedDialog = reducedPage.getByRole("dialog", { name: "番号を指定してプレイ" });
  await reducedDialog.locator('input[type="number"]').fill("1");
  await reducedDialog.getByRole("button", { name: "スタート" }).click();
  await reducedPage.locator("#screen-game.active .row").last().waitFor();
  const reducedFlights = await reducedPage.evaluate(async () =>
    (await import("./js/fx/effects.js")).activeTileFlightCount()
  );
  assert.equal(reducedFlights, 0, "Reduced motion should suppress tile gather flights");
  await reducedContext.close();

  await page.evaluate(async () => {
    const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260721-unlock-dialog");
    bgmUnlockCelebration([
      { id: "queue-test-a", name: "Queue Test A", desc: "First unlock" },
      { id: "queue-test-b", name: "Queue Test B", desc: "Second unlock" },
    ]);
  });
  const firstUnlock = page.getByRole("dialog", { name: "Queue Test A" });
  await firstUnlock.waitFor({ timeout: 1600 });
  assert.equal(await page.locator(".bgm-unlock").count(), 1, "Unlock dialogs should be serialized");
  assert.equal(
    await firstUnlock.evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(17, 24, 39)",
    "The unlock card should retain an opaque fallback background on old Chrome"
  );
  assert.notEqual(
    await page.locator("#unlock-layer").evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "The unlock dialog should have a separately rendered backdrop"
  );
  assert.equal(
    await firstUnlock.evaluate((node) => node.contains(document.activeElement)),
    true,
    "The unlock dialog should receive focus"
  );
  await firstUnlock.getByRole("button", { name: "あとで" }).click();
  const secondUnlock = page.getByRole("dialog", { name: "Queue Test B" });
  await secondUnlock.waitFor({ timeout: 1600 });
  assert.equal(await page.locator(".bgm-unlock").count(), 1, "Only one queued unlock dialog should be visible");
  await secondUnlock.getByRole("button", { name: "あとで" }).click();
  await page.locator(".bgm-unlock").waitFor({ state: "detached" });

  // 実績解放セレブレーション: 単発は大型カード、3 個以上は 1 枚にまとめる
  await page.evaluate(async () => {
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260721-unlock-dialog");
    achievementCelebration([
      { id: "smoke-single", icon: "trophy", color: "#ffd166", name: "スモーク実績", desc: "テスト用の実績です" },
    ]);
  });
  const achUnlock = page.getByRole("dialog", { name: "スモーク実績" });
  await achUnlock.waitFor({ timeout: 1600 });
  assert.equal(await page.locator(".ach-unlock").count(), 1, "A single achievement should show one celebration card");
  assert.equal(await page.locator(".ach-unlock .ach-confetti i").count() > 0, true, "The celebration should include confetti");
  assert.equal(
    await achUnlock.evaluate((node) => node.contains(document.activeElement)),
    true,
    "The achievement celebration should receive focus"
  );
  await achUnlock.getByRole("button", { name: "OK" }).click();
  await page.locator(".ach-unlock").waitFor({ state: "detached" });

  await page.evaluate(async () => {
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260721-unlock-dialog");
    achievementCelebration([
      { id: "smoke-a", icon: "star", color: "#ffd166", name: "実績A", desc: "" },
      { id: "smoke-b", icon: "gem", color: "#7ee8ff", name: "実績B", desc: "" },
      { id: "smoke-c", icon: "flame", color: "#ff9a5c", name: "実績C", desc: "" },
    ]);
  });
  const multiUnlock = page.getByRole("dialog", { name: /実績を 3 個解放/ });
  await multiUnlock.waitFor({ timeout: 1600 });
  assert.equal(await multiUnlock.locator(".ach-unlock-mini").count(), 3, "The combined celebration should list all achievements");
  await multiUnlock.getByRole("button", { name: "OK" }).click();
  await page.locator(".ach-unlock").waitFor({ state: "detached" });

  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForURL(/#\/settings$/);
  await page.getByRole("button", { name: "全データ削除" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "全データ削除" });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    deleteDialog.getByRole("button", { name: "OK" }).click(),
  ]);
  assert.match(page.url(), /#\/$/, "Deleting all data should reload at the title route");
  await page.locator("#screen-title.active").waitFor();

  console.log("UIスモーク + a11yテスト: OK");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
