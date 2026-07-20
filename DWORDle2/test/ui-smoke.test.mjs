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

  const tutorial = page.getByRole("dialog", { name: "最初に 2 つの大事なルール" });
  await tutorial.waitFor();
  assert.equal(await tutorial.evaluate((node) => node.contains(document.activeElement)), true, "Tutorial should receive focus");
  await page.getByRole("button", { name: "わかった" }).click();
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
  const solvedCard = page.locator(".turn-card").filter({ hasText: "正解！" });
  assert.equal(await solvedCard.getByText("もっと絞れたかもしれない単語").count(), 0, "Winning Guess should not show suggestions");
  await assertNoSeriousA11yViolations("Analysis screen");

  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  assert.equal(viewport.includes("user-scalable=no"), false, "Pinch zoom must remain available");
  assert.equal(runtimeErrors.length, 0, `Runtime errors:\n${runtimeErrors.join("\n")}`);
  console.log("UIスモーク + a11yテスト: OK");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
