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

  const tutorial = page.getByRole("dialog", { name: "基本ルール | DWORDle" });
  await tutorial.waitFor();
  assert.equal(await tutorial.evaluate((node) => node.contains(document.activeElement)), true, "Tutorial should receive focus");
  await page.getByRole("button", { name: "わかった" }).click();
  const normalLogoBox = await page.locator(".logo").boundingBox();
  await page.getByRole("button", { name: "裏モードへ" }).click();
  const usoTutorial = page.getByRole("dialog", { name: "基本ルール | DWORDlie" });
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
  await page.getByText("答えは2つ、盤面は1つ。10 手以内に「どちらか」を当てろ。", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("答えが 2 つある Wordle。10 手以内に「どちらか」を当てろ。", { exact: true }).count(),
    0
  );
  const randomButton = page.getByRole("button", { name: "ランダム（難しさを選択）", exact: true });
  await page.getByRole("button", { name: "本日の問題", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "デイリー問題", exact: true }).count(), 0);
  await randomButton.waitFor();
  await randomButton.click();
  const randomDialog = page.getByRole("dialog", { name: "ランダムにプレイ（難しさを選択）" });
  await randomDialog.waitFor();
  assert.equal(await page.getByText("難易度を選ぶ", { exact: false }).count(), 0);
  assert.equal(await page.getByText("難易度を選択", { exact: false }).count(), 0);
  await randomDialog.getByRole("button", { name: "閉じる" }).click();
  await assertNoSeriousA11yViolations("Title screen");
  const publicEntry = await page.evaluate(async () => {
    const assetPaths = ["/favicon.png", "/og.png", "/manifest.webmanifest"];
    const statuses = await Promise.all(assetPaths.map(async (assetPath) => (await fetch(assetPath)).status));
    return {
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      ogDescription: document.querySelector('meta[property="og:description"]')?.content,
      twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
      twitterDescription: document.querySelector('meta[name="twitter:description"]')?.content,
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      statuses,
    };
  });
  assert.equal(publicEntry.ogImage, "https://kakira9618.github.io/DWORDle2/og.png");
  assert.equal(publicEntry.ogDescription, "答えは2つ。盤面は1つ。新感覚Wordle！");
  assert.equal(publicEntry.twitterCard, "summary_large_image");
  assert.equal(publicEntry.twitterDescription, "答えは2つ。盤面は1つ。新感覚Wordle！");
  assert.equal(publicEntry.manifest, "manifest.webmanifest");
  assert.deepEqual(publicEntry.statuses, [200, 200, 200], "Public metadata assets should be served");

  await page.evaluate(() => {
    localStorage.setItem("dwordle2.current.normal", JSON.stringify({
      startTime: 1_700_000_000,
      gameMode: "normal",
      problemID: 20260722,
      guessWord: ["about", "other", "pouch"],
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  const continueButton = page.getByRole("button", { name: /つづきから.*Daily 2026-07-22・3手/ });
  await continueButton.waitFor();
  assert.deepEqual(
    await continueButton.locator(".continue-label > span").allTextContents(),
    ["つづきから", "（Daily 2026-07-22・3手）"],
    "the Continue label and progress details should render on separate lines"
  );
  await page.evaluate(() => localStorage.removeItem("dwordle2.current.normal"));
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "設定" }).click();
  await page.waitForURL(/#\/settings$/);
  const switches = page.getByRole("switch");
  await switches.first().waitFor();
  assert.equal(await switches.count(), 4, "All settings switches should expose the switch role");
  for (const label of ["キーボードヒント", "演出を軽くする", "効果音", "BGM"]) {
    await page.getByRole("switch", { name: label }).waitFor();
  }
  for (const copy of ["UIの言語を設定", "UIや背景のテーマを設定", "パーティクルを完全にオフにします"]) {
    await page.getByText(copy, { exact: true }).waitFor();
  }
  assert.equal(await page.getByText("低スペック端末向け", { exact: false }).count(), 0);
  const bgmPickerMetrics = await page.locator(".bgm-picker").evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));
  assert.equal(bgmPickerMetrics.clientHeight, 320, "BGM picker should have a fixed 320px inner viewport");
  assert.ok(bgmPickerMetrics.scrollHeight > bgmPickerMetrics.clientHeight, "BGM choices should scroll inside their picker");
  assert.equal(bgmPickerMetrics.overflowY, "auto");

  // 隠しテーマ「ポップ」: 実績「三色盛り」解放済みなので選択でき、body クラスに反映される
  await page.getByRole("radio", { name: "ポップ", exact: true }).click();
  await page.locator("body.theme-pop").waitFor();
  const normalPopVisuals = await page.evaluate(() => {
    const bodyStyle = getComputedStyle(document.body);
    const choice = document.querySelector(".bgm-choice:not(.locked):not(.active)");
    const choiceStyle = getComputedStyle(choice);
    return {
      pageBackground: bodyStyle.backgroundColor,
      choiceBackground: choiceStyle.backgroundImage,
      choiceColor: choiceStyle.color,
    };
  });
  assert.equal(normalPopVisuals.pageBackground, "rgb(255, 244, 248)");
  assert.match(normalPopVisuals.choiceBackground, /linear-gradient/, "Selectable Pop BGM rows should look like cards");
  assert.equal(normalPopVisuals.choiceColor, "rgb(74, 53, 80)");

  await page.evaluate(async () => {
    const { setAppMode } = await import("./js/ui/app.js?v=20260722-oldchrome-colormix");
    setAppMode("uso");
  });
  await page.locator("body.theme-pop.mode-uso").waitFor();
  await page.waitForFunction(() => {
    const choice = document.querySelector(".bgm-choice:not(.locked):not(.active)");
    return choice && getComputedStyle(choice).color === "rgb(255, 247, 252)";
  });
  const usoPopVisuals = await page.evaluate(() => {
    const bodyStyle = getComputedStyle(document.body);
    const choice = document.querySelector(".bgm-choice:not(.locked):not(.active)");
    const choiceStyle = getComputedStyle(choice);
    return {
      pageBackground: bodyStyle.backgroundColor,
      panelBackground: bodyStyle.getPropertyValue("--bg-panel-2").trim(),
      choiceBackground: choiceStyle.backgroundImage,
      choiceColor: choiceStyle.color,
    };
  });
  assert.equal(usoPopVisuals.pageBackground, "rgb(20, 8, 31)", "DWORDlie Pop should use a distinct dark palette");
  assert.equal(usoPopVisuals.panelBackground, "#2b1239");
  assert.match(usoPopVisuals.choiceBackground, /linear-gradient/);
  assert.equal(usoPopVisuals.choiceColor, "rgb(255, 247, 252)");
  assert.notEqual(usoPopVisuals.pageBackground, normalPopVisuals.pageBackground);
  await assertNoSeriousA11yViolations("Pop DWORDlie settings");
  await page.getByRole("button", { name: "タイトルへ戻る" }).click();
  await page.getByRole("button", { name: "遊び方" }).click();
  const usoPopHelp = page.getByRole("dialog", { name: "DWORDlie 遊び方" });
  await usoPopHelp.waitFor();
  const usoPopHelpTileColors = await usoPopHelp.evaluate((dialog) => {
    const styleOf = (selector) => {
      const style = getComputedStyle(dialog.querySelector(selector));
      return { background: style.backgroundColor, color: style.color };
    };
    return {
      answer: styleOf(".help-answers .htile"),
      correct: styleOf(".help-note .rcell.correct"),
      used: styleOf(".help-note .rcell.used"),
      unused: styleOf(".help-note .rcell.unused"),
    };
  });
  assert.deepEqual(usoPopHelpTileColors.answer, {
    background: "rgb(255, 255, 255)",
    color: "rgb(74, 53, 80)",
  }, "DWORDlie Pop help answer tiles should use dark text on white");
  assert.equal(usoPopHelpTileColors.correct.color, "rgb(6, 40, 26)");
  assert.equal(usoPopHelpTileColors.used.color, "rgb(32, 23, 0)");
  assert.equal(usoPopHelpTileColors.unused.color, "rgb(255, 255, 255)");
  await usoPopHelp.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("button", { name: "番号を指定" }).click();
  const usoPopPuzzleDialog = page.getByRole("dialog", { name: "番号を指定してプレイ" });
  const usoPopPuzzleInputBackground = await usoPopPuzzleDialog.locator('input[type="number"]').evaluate(
    (node) => getComputedStyle(node).backgroundColor
  );
  assert.notEqual(usoPopPuzzleInputBackground, "rgb(255, 255, 255)", "DWORDlie Pop should keep its existing dark puzzle-number input");
  await usoPopPuzzleDialog.getByRole("button", { name: "キャンセル" }).click();
  await page.getByRole("button", { name: "設定" }).click();
  await page.waitForURL(/#\/settings$/);

  await page.evaluate(async () => {
    const { setAppMode } = await import("./js/ui/app.js?v=20260722-oldchrome-colormix");
    setAppMode("normal");
  });
  await page.locator("body.theme-pop.mode-normal").waitFor();
  await page.evaluate(async () => {
    const { showHelpModal } = await import("./js/ui/help.js?v=20260722-oldchrome-colormix");
    showHelpModal("normal");
  });
  const popHelp = page.getByRole("dialog", { name: "DWORDle 遊び方" });
  await popHelp.waitFor();
  const popHelpTileBackground = await popHelp.locator(".help-answers .htile").first().evaluate(
    (node) => getComputedStyle(node).backgroundColor
  );
  assert.equal(popHelpTileBackground, "rgb(255, 255, 255)", "Pop help tiles should match the white in-game tiles");
  const helpLayering = await popHelp.evaluate((dialog) => ({
    line: Number(getComputedStyle(dialog.querySelector(".help-reaction-line")).zIndex),
    answerTile: Number(getComputedStyle(dialog.querySelector(".answer-tile")).zIndex),
    guessArea: Number(getComputedStyle(dialog.querySelector(".help-guess-area")).zIndex),
  }));
  assert.ok(
    helpLayering.line > helpLayering.answerTile && helpLayering.line > helpLayering.guessArea,
    `Help reaction line should render above tiles and letters: ${JSON.stringify(helpLayering)}`
  );
  await popHelp.locator(".help-reaction-line.show").waitFor({ timeout: 8000 });
  const helpLineGeometry = await popHelp.evaluate((dialog) => {
    const box = dialog.querySelector(".help-example-box");
    const line = dialog.querySelector(".help-reaction-line.show");
    const from = dialog.querySelector(".help-guess-area .htile.reacting");
    const to = dialog.querySelector(".answer-tile.reacting");
    const boxRect = box.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const angle = Number(line.style.transform.match(/rotate\(([-\d.]+)rad\)/)?.[1]);
    const width = Number.parseFloat(line.style.width);
    const startX = boxRect.left + Number.parseFloat(line.style.left);
    const startY = boxRect.top + Number.parseFloat(line.style.top) + line.offsetHeight / 2;
    return {
      startX,
      startY,
      endX: startX + width * Math.cos(angle),
      endY: startY + width * Math.sin(angle),
      expectedStartX: fromRect.left + fromRect.width / 2,
      expectedStartY: fromRect.top,
      expectedEndX: toRect.left + toRect.width / 2,
      expectedEndY: toRect.top + toRect.height / 2,
    };
  });
  for (const [actual, expected, label] of [
    [helpLineGeometry.startX, helpLineGeometry.expectedStartX, "start x"],
    [helpLineGeometry.startY, helpLineGeometry.expectedStartY, "start y"],
    [helpLineGeometry.endX, helpLineGeometry.expectedEndX, "end x"],
    [helpLineGeometry.endY, helpLineGeometry.expectedEndY, "end y"],
  ]) {
    assert.ok(Math.abs(actual - expected) <= 1, `Help reaction line ${label} should match: ${JSON.stringify(helpLineGeometry)}`);
  }
  await popHelp.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("button", { name: "タイトルへ戻る" }).click();
  await page.getByRole("button", { name: "番号を指定" }).click();
  const popPuzzleDialog = page.getByRole("dialog", { name: "番号を指定してプレイ" });
  const popPuzzleInputBackground = await popPuzzleDialog.locator('input[type="number"]').evaluate(
    (node) => getComputedStyle(node).backgroundColor
  );
  assert.equal(popPuzzleInputBackground, "rgb(255, 255, 255)", "The Pop puzzle-number input should use a white background");
  await popPuzzleDialog.getByRole("button", { name: "キャンセル" }).click();
  await page.getByRole("button", { name: "設定" }).click();
  await page.waitForURL(/#\/settings$/);
  await page.getByRole("radio", { name: "クラシック", exact: true }).click();
  await page.locator("body.theme-classic").waitFor();
  // クラス切替直後は数フレームだけ旧テーマの文字色が残る（transition の過渡状態）。
  // axe が過渡状態を拾わないよう、見出し文字の実際の色が classic に戻るまで待つ。
  await page.waitForFunction(() => {
    const targets = document.querySelectorAll(
      "#screen-settings .header .title, #screen-settings .label .l1, #bgm-picker-label"
    );
    return targets.length > 0 &&
      [...targets].every((node) => getComputedStyle(node).color === "rgb(242, 242, 242)");
  });

  await assertNoSeriousA11yViolations("Settings screen");
  await page.getByRole("button", { name: "タイトルへ戻る" }).click();

  await page.getByRole("button", { name: "番号を指定" }).click();
  const puzzleDialog = page.getByRole("dialog", { name: "番号を指定してプレイ" });
  await puzzleDialog.locator('input[type="number"]').fill("1");
  // 入力欄の Enter で primary アクション（スタート）が確定する
  await page.keyboard.press("Enter");
  await page.waitForURL(/#\/game$/);
  await page.locator("#screen-game.active .row").last().waitFor();

  await assertNoSeriousA11yViolations("Game screen");
  const answer = new Logic(1).ans1;
  await page.keyboard.type(answer);
  await page.keyboard.press("Enter");
  await page.waitForURL(/#\/result\/normal\/\d+$/, { timeout: 15000 });
  // 判定結果はライブリージョンで自動読み上げされる
  const announced = await page.locator("#sr-announcer").textContent();
  assert.match(announced, /の判定：/, "Guess feedback should be announced via the live region");
  const resultUrl = page.url();
  await page.getByText("GAME CLEAR").waitFor();
  await page.getByRole("img", { name: /緑、位置一致/ }).first().waitFor();
  const guessedAnswerRow = page.locator(".answer-row:has(.guess-flag)");
  assert.equal(await guessedAnswerRow.count(), 1, "The guessed answer should have one rotating flag");
  const guessedFlagBox = await guessedAnswerRow.locator(".guess-flag-slot").boundingBox();
  const guessedLastTileBox = await guessedAnswerRow.locator(".rcell").last().boundingBox();
  const guessedFlagGap = guessedFlagBox && guessedLastTileBox
    ? guessedFlagBox.x - (guessedLastTileBox.x + guessedLastTileBox.width)
    : null;
  assert.ok(
    guessedFlagBox && guessedLastTileBox
      && guessedFlagGap >= 13
      && guessedFlagBox.width <= 23.5,
    `The guessed-answer flag should sit to the right of the tile row: ${JSON.stringify({ guessedFlagBox, guessedLastTileBox })}`
  );
  assert.match(
    await guessedAnswerRow.getAttribute("aria-label"),
    /あなたが当てた答え/,
    "The flag meaning should also be exposed to assistive technology"
  );
  assert.equal(await page.locator(".amark").count(), 0, "The old textual answer marker should be removed");
  await assertNoSeriousA11yViolations("Result screen");

  await page.getByRole("button", { name: "もう一度", exact: true }).click();
  const replayDialog = page.getByRole("dialog", { name: "プレイ済みの問題" });
  await replayDialog.getByText(
    "この問題は本日プレイ済みです。今回のプレイは、プレイ数・勝利数などのカウント系実績には加算されません。",
    { exact: false }
  ).waitFor();
  await replayDialog.getByRole("button", { name: "キャンセル" }).click();

  await page.evaluate(() => { location.hash = "#/history"; });
  await page.waitForURL(/#\/history$/);
  const historyItem = page.locator("button.history-item").first();
  await historyItem.waitFor();
  await assertNoSeriousA11yViolations("History screen");
  await historyItem.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/#\/result\/normal\/\d+$/);

  await page.evaluate(() => { location.hash = "#/problems"; });
  await page.waitForURL(/#\/problems$/);
  const block = page.locator("button.block-cell").first();
  await block.waitFor();
  await assertNoSeriousA11yViolations("Problems screen");
  await block.focus();
  await page.keyboard.press("Enter");
  await page.locator("button.num-cell").first().waitFor();

  await page.evaluate(() => { location.hash = "#/achievements"; });
  await page.waitForURL(/#\/achievements$/);
  await page.getByRole("heading", { name: "実績" }).waitFor();
  await page.getByText("同じ日に同じ問題 No. を複数回プレイした場合、モードを問わず最初の 1 回だけを数えます", { exact: false }).waitFor();
  await assertNoSeriousA11yViolations("Achievements screen");

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
  await shortPage.getByRole("button", { name: "本日の問題" }).waitFor();
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
    (await import("./js/fx/effects.js?v=20260722-oldchrome-colormix")).activeTileFlightCount()
  );
  assert.ok(flightsBeforeLeave > 0, "Tile gather animation should be active before leaving the game");
  await shortPage.getByRole("button", { name: "タイトルへ戻る" }).click();
  await shortPage.waitForURL(/#\/$/);
  const flightsAfterLeave = await shortPage.evaluate(async () =>
    (await import("./js/fx/effects.js?v=20260722-oldchrome-colormix")).activeTileFlightCount()
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
    (await import("./js/fx/effects.js?v=20260722-oldchrome-colormix")).activeTileFlightCount()
  );
  assert.equal(reducedFlights, 0, "Reduced motion should suppress tile gather flights");
  await reducedContext.close();

  await page.evaluate(async () => {
    const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260722-oldchrome-colormix");
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
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260722-oldchrome-colormix");
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
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260722-oldchrome-colormix");
    achievementCelebration([
      { id: "smoke-a", icon: "star", color: "#ffd166", name: "実績A", desc: "" },
      { id: "smoke-b", icon: "gem", color: "#7ee8ff", name: "実績B", desc: "" },
      { id: "smoke-c", icon: "flame", color: "#ff9a5c", name: "実績C", desc: "" },
    ]);
  });
  const multiUnlock = page.getByRole("dialog", { name: /実績を 3 個解放/ });
  await multiUnlock.waitFor({ timeout: 1600 });
  assert.equal(await multiUnlock.locator(".ach-unlock-mini").count(), 3, "The combined celebration should list all achievements");
  // リストが収まっているときはスクロールの手掛かり（下端フェード）を出さない
  await page.waitForFunction(() => document.querySelector(".ach-unlock-grid-wrap")?.classList.contains("at-end"));
  assert.equal(
    await multiUnlock.locator(".ach-unlock-grid-wrap").evaluate((node) => node.classList.contains("scrollable")),
    false,
    "A short celebration list must not be marked scrollable"
  );
  await multiUnlock.getByRole("button", { name: "OK" }).click();
  await page.locator(".ach-unlock").waitFor({ state: "detached" });

  // リストが溢れるときは下端フェードで続きを示し、最下部まで送るとフェードが消える
  await page.evaluate(async () => {
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260722-oldchrome-colormix");
    achievementCelebration(
      Array.from({ length: 9 }, (_, i) => ({ id: `smoke-many-${i}`, icon: "star", color: "#ffd166", name: `実績${i + 1}`, desc: "" }))
    );
  });
  const manyUnlock = page.getByRole("dialog", { name: /実績を 9 個解放/ });
  await manyUnlock.waitFor({ timeout: 1600 });
  await page.waitForFunction(() => {
    const wrap = document.querySelector(".ach-unlock-grid-wrap");
    return wrap?.classList.contains("scrollable") && !wrap.classList.contains("at-end");
  });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".ach-unlock-grid-fade")).opacity === "1"
  );
  await manyUnlock.locator(".ach-unlock-grid").evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.waitForFunction(() => document.querySelector(".ach-unlock-grid-wrap")?.classList.contains("at-end"));
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".ach-unlock-grid-fade")).opacity === "0"
  );
  await manyUnlock.getByRole("button", { name: "OK" }).click();
  await page.locator(".ach-unlock").waitFor({ state: "detached" });

  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForURL(/#\/settings$/);
  await page.getByRole("button", { name: "全データ削除" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "全データ削除" });
  await deleteDialog.getByText("旧作 DWORDle / DWORDlie のデータは削除されません。").waitFor();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    deleteDialog.getByRole("button", { name: "OK" }).click(),
  ]);
  assert.match(page.url(), /#\/$/, "Deleting all data should reload at the title route");
  await page.locator("#screen-title.active").waitFor();

  // 判定オープン中の先行入力: 次の 1 行分をバッファし、オープン完了後に自動で確定する
  await page.getByRole("dialog", { name: "基本ルール | DWORDle" }).getByRole("button", { name: "わかった" }).click();
  await page.evaluate(async () => {
    const { setSetting } = await import("./js/core/settings.js?v=20260722-oldchrome-colormix");
    setSetting("theme", "classic");
    setSetting("sfx", false);
    setSetting("bgm", false);
  });
  await page.getByRole("button", { name: "番号を指定" }).click();
  const bufferDialog = page.getByRole("dialog", { name: "番号を指定してプレイ" });
  await bufferDialog.locator('input[type="number"]').fill("2");
  await page.keyboard.press("Enter");
  await page.waitForURL(/#\/game$/);
  await page.locator("#screen-game.active .row").last().waitFor();
  const bufferLogic = new Logic(2);
  const bufferWords = ["about", "cigar", "point"].filter((word) => !bufferLogic.isGameClear(word)).slice(0, 2);
  await page.keyboard.type(bufferWords[0]);
  await page.keyboard.press("Enter");
  // 1 行目の判定オープン中に、2 行目を先行入力する
  await page.keyboard.type(bufferWords[1]);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelectorAll('#board .tile[class*="state-"]').length === 10,
    { timeout: 15000 }
  );
  assert.match(
    await page.locator("#screen-game .header .sub").first().textContent(),
    /3 \/ 10/,
    "Buffered keys should submit the second Guess automatically"
  );
  await page.getByRole("button", { name: "タイトルへ戻る" }).click();
  await page.waitForURL(/#\/$/);

  // 初回案内は基本ルールを先に表示し、閉じた後で旧作の移行を提案する。
  const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const freshPage = await freshContext.newPage();
  try {
    await freshPage.addInitScript(() => {
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
      localStorage.setItem("tonyu-legacy-history", JSON.stringify({
        version: 1,
        1700000000: {
          startTime: 1700000000,
          endTime: 1700000010,
          gameMode: "normal",
          problemID: 1,
          guessWord: ["point"],
          complete: true,
        },
      }));
    });
    await freshPage.goto(baseUrl, { waitUntil: "networkidle" });
    const freshTutorial = freshPage.getByRole("dialog", { name: "基本ルール | DWORDle" });
    await freshTutorial.waitFor();
    assert.equal(
      await freshPage.getByRole("dialog", { name: "旧作のプレイ履歴が見つかりました" }).count(),
      0,
      "legacy import must wait until the first tutorial closes"
    );
    await freshTutorial.getByRole("button", { name: "わかった" }).click();
    const importDialog = freshPage.getByRole("dialog", { name: "旧作のプレイ履歴が見つかりました" });
    await importDialog.waitFor();
    await importDialog.getByRole("button", { name: "スキップ" }).click();

    await freshPage.getByRole("button", { name: "設定" }).click();
    await freshPage.waitForURL(/#\/settings$/);
    const lockedTheme = freshPage.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", { name: "???" });
    assert.equal(await lockedTheme.getAttribute("aria-disabled"), "true");
    assert.equal(await freshPage.getByRole("radio", { name: "Grand Finale" }).getAttribute("aria-disabled"), "true");

    const debugEntry = freshPage.locator(".debug-entry");
    for (let i = 0; i < 5; i++) await debugEntry.click();
    const secretDialog = freshPage.getByRole("dialog", { name: "シークレット" });
    await secretDialog.getByLabel("秘密のキーワード").fill("DWORDLER");
    await secretDialog.getByRole("button", { name: "入力" }).click();
    await freshPage.getByText("DEBUG ON", { exact: true }).waitFor();
    const debugPop = freshPage.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", { name: "ポップ" });
    assert.equal(await debugPop.getAttribute("aria-disabled"), "false", "debug mode should unlock the hidden theme");
    assert.equal(await freshPage.getByRole("radio", { name: "Grand Finale" }).getAttribute("aria-disabled"), "false", "debug mode should unlock hidden BGM");
    await debugPop.click();
    await freshPage.getByRole("radio", { name: "Grand Finale" }).click();
    await freshPage.getByRole("radio", { name: "English" }).click();
    const englishPop = freshPage.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Pop", exact: true });
    assert.equal(await englishPop.count(), 1, "the Pop theme should use its English name in the English UI");
    assert.equal(
      await freshPage.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "ポップ", exact: true }).count(),
      0,
      "the Japanese Pop theme name should not remain in the English UI"
    );

    await freshPage.evaluate(() => { location.hash = "#/achievements"; });
    await freshPage.waitForURL(/#\/achievements$/);
    await freshPage.locator("#screen-achievements .header .sub").filter({ hasText: `${ACHIEVEMENTS.length} / ${ACHIEVEMENTS.length}` }).waitFor();
    await freshPage.getByText("only the first play of the same puzzle number on the same day counts, regardless of mode", { exact: false }).waitFor();

    await freshPage.reload({ waitUntil: "networkidle" });
    await freshPage.locator("#screen-achievements .header .sub").filter({ hasText: `0 / ${ACHIEVEMENTS.length}` }).waitFor();
    await freshPage.evaluate(() => { location.hash = "#/settings"; });
    await freshPage.waitForURL(/#\/settings$/);
    assert.equal(await freshPage.locator(".debug-status").count(), 0, "reload should turn debug mode off");
    assert.equal(await freshPage.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", { name: "???" }).getAttribute("aria-disabled"), "true");
    assert.equal(await freshPage.locator("body.theme-classic").count(), 1, "debug-only theme selection must not persist");
    assert.equal(await freshPage.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.settings")).bgmTrack), "auto", "debug-only BGM selection must not persist");
  } finally {
    await freshContext.close();
  }

  console.log("UIスモーク + a11yテスト: OK");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
