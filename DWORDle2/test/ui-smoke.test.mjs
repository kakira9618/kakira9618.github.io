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
// バージョン表示のソースハッシュが最新か（ソース変更後の tools/make-source-hash.mjs 実行忘れを検出）
{
  const { computeSourceHash } = await import("../tools/make-source-hash.mjs");
  const { SOURCE_HASH } = await import("../js/version.js");
  assert.equal(
    SOURCE_HASH,
    await computeSourceHash(),
    "js/version.js のソースハッシュが古い。node tools/make-source-hash.mjs で更新する"
  );
  assert.match(SOURCE_HASH, /^[0-9a-f]{8}$/, "the source hash should be 8 hex digits");
  // PWA: sw.js（同じツールが生成）もキャッシュ名と事前キャッシュリストが最新であること
  const swSource = await readFile(path.join(projectRoot, "sw.js"), "utf8");
  assert.ok(
    swSource.includes(`"dwordle2-${SOURCE_HASH}"`),
    "sw.js のキャッシュ名が古い。node tools/make-source-hash.mjs で更新する"
  );
  const { listPrecacheAssets } = await import("../tools/make-source-hash.mjs");
  for (const asset of await listPrecacheAssets()) {
    assert.ok(swSource.includes(`"${asset}"`), `sw.js の事前キャッシュに ${asset} がない。node tools/make-source-hash.mjs で更新する`);
  }
}

// X の Summary カード用の正方形版（twitter:image が参照する）
const ogSquarePng = await readFile(path.join(projectRoot, "og-square.png"));
const squareIhdrOffset = ogSquarePng.indexOf(Buffer.from("IHDR"));
assert.notEqual(squareIhdrOffset, -1, "square OGP image should contain a PNG IHDR chunk");
assert.equal(ogSquarePng.readUInt32BE(squareIhdrOffset + 4), 1200, "square OGP image width should be 1200px");
assert.equal(ogSquarePng.readUInt32BE(squareIhdrOffset + 8), 1200, "square OGP image height should be 1200px");

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
  // タイトルメニューの段階解放を全開放した状態で UI を検証する
  localStorage.setItem("dwordle2.playCount", "99");
  localStorage.setItem("dwordle2.menuUnlockSeen", "99");
}, { unlockedAchievements: unlocked });
await page.addInitScript({ path: axePath });

async function assertNoSeriousA11yViolations(stage) {
  // meta-viewport ルール（ズーム禁止の検出）は除外する。
  // ズーム全面禁止はユーザーの明示要望による製品判断（2026-07-22）。
  const result = await page.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      rules: { "meta-viewport": { enabled: false }, "meta-viewport-large": { enabled: false } },
    })
  );
  const violations = result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  const details = violations
    .map((violation) => `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => `  ${node.target.join(" ")}: ${node.failureSummary}`).join("\n")}`)
    .join("\n");
  assert.equal(violations.length, 0, `${stage} has serious accessibility violations:\n${details}`);
}

// エントリーゲート（扉絵）はすべてのロードで最初に表示される。「開始」で通過する
async function passGate(target) {
  const start = target.locator("#entry-gate .entry-gate-start");
  await start.waitFor();
  await start.click();
  await target.locator("#entry-gate").waitFor({ state: "detached" });
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  // 扉絵: ロゴ・音の説明・「開始 / 音無しで開始」の 2 択が表示され、通過するまで本来の画面は始まらない
  // （メッセージと 2 択は音設定にかかわらず固定。このページは音オフ設定でシード済み）
  await page.locator("#entry-gate .entry-gate-start").waitFor();
  await page.locator("#entry-gate .app-version").waitFor(); // 扉絵でもバージョンが分かる
  await page.getByText("このゲームは音が出ます", { exact: false }).waitFor();
  await page.locator("#entry-gate .entry-gate-muted").waitFor();
  assert.equal(
    await page.locator("#entry-gate .entry-gate-credit a").getAttribute("href"),
    "https://x.com/kakira9618",
    "the entry gate should credit the author with a link to X"
  );
  await assertNoSeriousA11yViolations("Entry gate");
  // 扉絵の間はボタン以外をタップしても音声は解錠されない（開始ボタンだけが解錠する）
  await page.mouse.click(30, 200);
  assert.equal(
    await page.evaluate(async () => {
      const mod = await import("./js/audio/sound.js?v=20260723-swup");
      return mod.audioNeedsRecovery();
    }),
    true,
    "audio must stay locked while the entry gate is open"
  );
  await passGate(page);
  // 「開始」は音オフ設定からでも音を復帰する（音無しのまま入るのは「音無しで開始」の役割）
  assert.deepEqual(
    await page.evaluate(async () => {
      const s = (await import("./js/core/settings.js?v=20260723-swup")).getSettings();
      return { bgm: s.bgm, sfx: s.sfx };
    }),
    { bgm: true, sfx: true },
    "the Start button should restore sound even when settings were muted"
  );

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
    const assetPaths = ["/favicon.png", "/og.png", "/og-square.png", "/manifest.webmanifest"];
    const statuses = await Promise.all(assetPaths.map(async (assetPath) => (await fetch(assetPath)).status));
    const manifestJson = await (await fetch("/manifest.webmanifest")).json();
    const icons = manifestJson.icons ?? [];
    const iconStatuses = await Promise.all(
      icons.map(async (icon) => (await fetch(new URL(icon.src, location.href))).status)
    );
    return {
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      ogDescription: document.querySelector('meta[property="og:description"]')?.content,
      twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
      twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
      twitterDescription: document.querySelector('meta[name="twitter:description"]')?.content,
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      iconSizes: icons.flatMap((icon) => String(icon.sizes ?? "").split(/\s+/)),
      iconStatuses,
      statuses,
    };
  });
  assert.equal(publicEntry.ogImage, "https://kakira9618.github.io/DWORDle2/og.png");
  assert.equal(publicEntry.ogDescription, "答えは2つ。盤面は1つ。新感覚Wordle！");
  assert.equal(publicEntry.twitterCard, "summary_large_image");
  assert.equal(publicEntry.twitterImage, "https://kakira9618.github.io/DWORDle2/og-square.png", "X には Summary で見切れない正方形版を渡す");
  assert.equal(publicEntry.twitterDescription, "答えは2つ。盤面は1つ。新感覚Wordle！");
  assert.equal(publicEntry.manifest, "manifest.webmanifest");
  assert.deepEqual(publicEntry.statuses, [200, 200, 200, 200], "Public metadata assets should be served");
  // Android Chrome の PWA インストール（WebAPK 生成）には 192x192 と 512x512 の
  // アイコンが必須。欠けると「ホーム画面に追加」を押してもサイレントに失敗する。
  assert.ok(publicEntry.iconSizes.includes("192x192"), "manifest に 192x192 アイコンが必要");
  assert.ok(publicEntry.iconSizes.includes("512x512"), "manifest に 512x512 アイコンが必要");
  assert.ok(
    publicEntry.iconStatuses.length > 0 && publicEntry.iconStatuses.every((status) => status === 200),
    "manifest の全アイコンが配信されること"
  );

  // ハイコントラスト配色: 設定 ON で全テーマの判定色が 緑→オレンジ / 黄→青 に置き換わる
  const normalTileCorrect = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--tile-correct").trim());
  await page.evaluate(async () => {
    const mod = await import("./js/core/settings.js?v=20260723-swup");
    mod.setSetting("highContrast", true);
  });
  assert.ok(
    await page.evaluate(() => document.body.classList.contains("high-contrast")),
    "enabling high contrast should add the body class"
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--tile-correct").trim()),
    "#f5793a",
    "high contrast should replace green with orange"
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--tile-used").trim()),
    "#85c0f9",
    "high contrast should replace yellow with blue"
  );
  await page.evaluate(async () => {
    const mod = await import("./js/core/settings.js?v=20260723-swup");
    mod.setSetting("highContrast", false);
  });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--tile-correct").trim()),
    normalTileCorrect,
    "disabling high contrast should restore the theme colors"
  );

  await page.evaluate(() => {
    localStorage.setItem("dwordle2.current.normal", JSON.stringify({
      startTime: 1_700_000_000,
      gameMode: "normal",
      problemID: 20260722,
      guessWord: ["about", "other", "pouch"],
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await passGate(page);
  const continueButton = page.getByRole("button", { name: /つづきから.*Daily 2026-07-22・3手/ });
  await continueButton.waitFor();
  assert.deepEqual(
    await continueButton.locator(".continue-label > span").allTextContents(),
    ["つづきから", "（Daily 2026-07-22・3手）"],
    "the Continue label and progress details should render on separate lines"
  );
  await page.evaluate(() => localStorage.removeItem("dwordle2.current.normal"));
  await page.reload({ waitUntil: "networkidle" });
  await passGate(page);
  await page.getByRole("button", { name: "設定" }).click();
  await page.waitForURL(/#\/settings$/);
  const switches = page.getByRole("switch");
  await switches.first().waitFor();
  assert.equal(await switches.count(), 5, "All settings switches should expose the switch role");
  for (const label of ["ハイコントラスト配色", "キーボードヒント", "演出を軽くする", "効果音", "BGM"]) {
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
    const { setAppMode } = await import("./js/ui/app.js?v=20260723-swup");
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
  // モーダルは左右中央に出る（幅の狭い端末で右寄りに開いていた回帰の検知）
  {
    const modalBox = await usoPopHelp.boundingBox();
    const leftGap = modalBox.x;
    const rightGap = 390 - (modalBox.x + modalBox.width);
    assert.ok(
      Math.abs(leftGap - rightGap) <= 2,
      `the help dialog should be horizontally centered: leftGap=${leftGap}, rightGap=${rightGap}`
    );
  }
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
  assert.equal(await usoPopHelp.locator(".modal-close").count(), 0, "help dialog should not have a top-right close button");
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby]');
    return dialog?.textContent.includes("DWORDlie 遊び方") && dialog.scrollTop === 0 && document.activeElement === dialog;
  });
  await usoPopHelp.evaluate((dialog) => {
    dialog.style.height = "120px";
    dialog.style.maxHeight = "120px";
    dialog.scrollTop = dialog.scrollHeight;
  });
  assert.ok(await usoPopHelp.evaluate((dialog) => dialog.scrollTop > 0), "help dialog should be scrollable for the reopen test");
  await usoPopHelp.getByRole("button", { name: "閉じる" }).click();
  await usoPopHelp.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "遊び方" }).click();
  const reopenedUsoHelp = page.getByRole("dialog", { name: "DWORDlie 遊び方" });
  await reopenedUsoHelp.waitFor();
  await reopenedUsoHelp.evaluate((dialog) => {
    dialog.style.height = "120px";
    dialog.style.maxHeight = "120px";
  });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby]');
    return dialog?.textContent.includes("DWORDlie 遊び方") && dialog.scrollTop === 0 && document.activeElement === dialog;
  });
  assert.equal(await reopenedUsoHelp.evaluate((dialog) => dialog.scrollTop), 0, "reopened help dialog should always start at the top");
  await reopenedUsoHelp.getByRole("button", { name: "閉じる" }).click();
  await reopenedUsoHelp.waitFor({ state: "detached" });
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
    const { setAppMode } = await import("./js/ui/app.js?v=20260723-swup");
    setAppMode("normal");
  });
  await page.locator("body.theme-pop.mode-normal").waitFor();
  await page.evaluate(async () => {
    const { showHelpModal } = await import("./js/ui/help.js?v=20260723-swup");
    showHelpModal("normal");
  });
  const popHelp = page.getByRole("dialog", { name: "DWORDle 遊び方" });
  await popHelp.waitFor();
  await popHelp.getByText(/ルールはほぼ Wordle と同じですが/).waitFor();
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
  // 文字選択はゲーム UI 全体で無効・読み物（モーダル本文）だけ許可
  const selectionModes = await popHelp.evaluate((dialog) => ({
    body: getComputedStyle(document.body).userSelect,
    modalBody: getComputedStyle(dialog.querySelector(".modal-body")).userSelect,
    actionButton: getComputedStyle(dialog.querySelector(".modal-actions button")).userSelect,
  }));
  assert.equal(selectionModes.body, "none", "long-press text selection should be disabled app-wide");
  assert.equal(selectionModes.modalBody, "text", "modal body content should stay selectable for accessibility");
  assert.equal(selectionModes.actionButton, "none", "buttons inside modals should not be selectable");
  await popHelp.locator(".modal-actions").getByRole("button", { name: "閉じる" }).click();
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

  // キーボード折りたたみ: トグルで画面下へ畳まれ、再度押すと展開する
  const kbdBefore = await page.evaluate(() => document.getElementById("keyboard").getBoundingClientRect().height);
  assert.ok(kbdBefore > 100, "the keyboard should be expanded by default");
  await page.locator("#kbd-toggle").click();
  await page.waitForTimeout(450);
  assert.ok(
    await page.evaluate(() => document.getElementById("screen-game").classList.contains("kbd-collapsed")),
    "the toggle should mark the game screen as keyboard-collapsed"
  );
  const kbdCollapsed = await page.evaluate(() => document.getElementById("keyboard").getBoundingClientRect().height);
  assert.ok(kbdCollapsed < 5, `the keyboard should fold away (height: ${kbdCollapsed})`);
  await page.locator("#kbd-toggle").click();
  await page.waitForTimeout(450);
  const kbdRestored = await page.evaluate(() => document.getElementById("keyboard").getBoundingClientRect().height);
  assert.ok(kbdRestored > 100, "the keyboard should expand again");

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
      && guessedFlagGap >= 15
      && guessedFlagBox.width <= 23.5,
    `The guessed-answer flag should sit to the right of the tile row: ${JSON.stringify({ guessedFlagBox, guessedLastTileBox })}`
  );
  assert.match(
    await guessedAnswerRow.getAttribute("aria-label"),
    /あなたが当てた答え/,
    "The flag meaning should also be exposed to assistive technology"
  );
  const savedImageFlagPixels = await page.evaluate(async ({ guessedWord }) => {
    const settings = await import("./js/core/settings.js?v=20260723-swup");
    const { renderResultCanvas } = await import("./js/ui/snapshot.js?v=20260723-swup");
    settings.setSetting("theme", "cyber");
    const canvas = renderResultCanvas(
      {
        gameMode: "normal",
        problemID: 1,
        startTime: 1,
        clear: true,
        guessWord: [guessedWord],
      },
      { ans1: guessedWord, ans2: guessedWord === "claim" ? "spare" : "claim" },
      [Array(5).fill("correct")]
    );
    const context = canvas.getContext("2d");
    const countFlagPixels = (x, y, width, height) => {
      const pixels = context.getImageData(x * 2, y * 2, width * 2, height * 2).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 210 && pixels[i + 1] > 220 && pixels[i + 2] > 225) count++;
      }
      return count;
    };
    const counts = {
      rightOfTiles: countFlagPixels(515, 306, 42, 45),
      oldLeftPosition: countFlagPixels(126, 306, 32, 45),
    };
    settings.setSetting("theme", "classic");
    return counts;
  }, { guessedWord: answer });
  assert.ok(
    savedImageFlagPixels.rightOfTiles > 50 && savedImageFlagPixels.oldLeftPosition < 10,
    `The saved-image flag should sit to the right of its answer row: ${JSON.stringify(savedImageFlagPixels)}`
  );
  assert.equal(await page.locator(".amark").count(), 0, "The old textual answer marker should be removed");
  await assertNoSeriousA11yViolations("Result screen");

  await page.getByRole("button", { name: "もう一度", exact: true }).click();
  const replayDialog = page.getByRole("dialog", { name: "プレイ済みの問題" });
  await replayDialog.getByText(
    "この問題は本日プレイ済みです。今回のプレイは、プレイ数・勝利数などのカウント系実績に加算されず、隠し実績の判定対象にもなりません。",
    { exact: false }
  ).waitFor();
  await replayDialog.getByRole("button", { name: "キャンセル" }).click();

  // ハイコントラスト配色ではシェア文字列の絵文字も 🟧 / 🟦 になる（灰は ⬜ のまま）
  await page.evaluate(async () => {
    const mod = await import("./js/core/settings.js?v=20260723-swup");
    mod.setSetting("highContrast", true);
    navigator.clipboard.writeText = (text) => {
      window.__copiedShareText = text;
      return Promise.resolve();
    };
  });
  await page.getByRole("button", { name: "コピー", exact: true }).click();
  const hcShareText = await page.evaluate(() => window.__copiedShareText);
  assert.ok(hcShareText.includes("🟧"), `high-contrast share text should use the orange emoji: ${hcShareText}`);
  assert.ok(!hcShareText.includes("🟩") && !hcShareText.includes("🟨"), "high-contrast share text must not contain green/yellow emojis");
  await page.evaluate(async () => {
    const mod = await import("./js/core/settings.js?v=20260723-swup");
    mod.setSetting("highContrast", false);
  });

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
  await page.getByText("同じ日に同じ問題 No. を複数回プレイした場合、モードを問わず最初の 1 回だけを対象にします", { exact: false }).waitFor();
  await assertNoSeriousA11yViolations("Achievements screen");

  // ハッシュだけが違う同一ドキュメント遷移なのでリロードは起きず、扉絵も出ない
  await page.goto(resultUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "分析" }).click();
  await page.getByText("正解！").waitFor({ timeout: 30000 });
  const analysisSummary = await page.getByText(/答えの組は .* 通り/).textContent();
  assert.match(analysisSummary, /答えの組は 27,730 通り/, "Analysis should display unordered answer pairs");
  const solvedCard = page.locator(".turn-card").filter({ hasText: "正解！" });
  assert.equal(await solvedCard.getByText("もっと絞れたかもしれない単語").count(), 0, "Winning Guess should not show suggestions");
  await assertNoSeriousA11yViolations("Analysis screen");

  // ズームは全面禁止（ユーザーの明示要望による製品判断。2026-07-22）
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  assert.equal(viewport.includes("user-scalable=no"), true, "Zoom must be fully disabled by request");
  assert.equal(viewport.includes("maximum-scale=1"), true, "Zoom must be fully disabled by request");
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).touchAction),
    "pan-x pan-y",
    "touch-action must block pinch zoom app-wide"
  );
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
    localStorage.setItem("dwordle2.playCount", "99");
    localStorage.setItem("dwordle2.menuUnlockSeen", "99");
  });
  await shortPage.goto(baseUrl, { waitUntil: "networkidle" });
  await passGate(shortPage);
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
    (await import("./js/fx/effects.js?v=20260723-swup")).activeTileFlightCount()
  );
  assert.ok(flightsBeforeLeave > 0, "Tile gather animation should be active before leaving the game");
  await shortPage.getByRole("button", { name: "タイトルへ戻る" }).click();
  await shortPage.waitForURL(/#\/$/);
  const flightsAfterLeave = await shortPage.evaluate(async () =>
    (await import("./js/fx/effects.js?v=20260723-swup")).activeTileFlightCount()
  );
  assert.equal(flightsAfterLeave, 0, "Tile gather animation should be removed when leaving the game");
  await shortPage.close();

  const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.addInitScript(() => {
    localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "cyber", sfx: false, bgm: false, language: "ja" }));
    localStorage.setItem("dwordle2.legacyImportPrompted", "true");
    localStorage.setItem("dwordle2.tutorialSeen", "true");
    localStorage.setItem("dwordle2.playCount", "99");
    localStorage.setItem("dwordle2.menuUnlockSeen", "99");
  });
  await fallbackPage.route("**/vendor/three.module.min.js", (route) => route.abort("failed"));
  await fallbackPage.goto(baseUrl, { waitUntil: "networkidle" });
  await passGate(fallbackPage);
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
    localStorage.setItem("dwordle2.playCount", "99");
    localStorage.setItem("dwordle2.menuUnlockSeen", "99");
  });
  await reducedPage.goto(baseUrl, { waitUntil: "networkidle" });
  await passGate(reducedPage);
  await reducedPage.locator("body.reduce-motion").waitFor();
  await reducedPage.getByRole("button", { name: "番号を指定" }).click();
  const reducedDialog = reducedPage.getByRole("dialog", { name: "番号を指定してプレイ" });
  await reducedDialog.locator('input[type="number"]').fill("1");
  await reducedDialog.getByRole("button", { name: "スタート" }).click();
  await reducedPage.locator("#screen-game.active .row").last().waitFor();
  const reducedFlights = await reducedPage.evaluate(async () =>
    (await import("./js/fx/effects.js?v=20260723-swup")).activeTileFlightCount()
  );
  assert.equal(reducedFlights, 0, "Reduced motion should suppress tile gather flights");
  await reducedContext.close();

  await page.evaluate(async () => {
    const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260723-swup");
    bgmUnlockCelebration([{ id: "queue-test-a", name: "Queue Test A", desc: "First unlock" }]);
    bgmUnlockCelebration([{ id: "queue-test-b", name: "Queue Test B", desc: "Second unlock" }]);
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

  // 2 曲以上の同時解放（履歴インポート等）は 1 枚のまとめカードで報告する
  await page.evaluate(async () => {
    const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260723-swup");
    bgmUnlockCelebration([
      { id: "multi-a", name: "Multi Track A", desc: "" },
      { id: "multi-b", name: "Multi Track B", desc: "" },
      { id: "multi-c", name: "Multi Track C", desc: "" },
    ]);
  });
  const bgmMultiUnlock = page.getByRole("dialog", { name: "BGM を 3 曲解放！" });
  await bgmMultiUnlock.waitFor({ timeout: 1600 });
  assert.equal(await page.locator(".bgm-unlock").count(), 1, "Multiple BGM unlocks should merge into one card");
  await bgmMultiUnlock.getByText("Multi Track A").waitFor();
  await bgmMultiUnlock.getByText("Multi Track C").waitFor();
  await bgmMultiUnlock.getByRole("button", { name: "OK" }).click();
  await page.locator(".bgm-unlock").waitFor({ state: "detached" });

  // 実績解放セレブレーション: 単発は大型カード、3 個以上は 1 枚にまとめる
  await page.evaluate(async () => {
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260723-swup");
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
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260723-swup");
    achievementCelebration([
      { id: "smoke-a", icon: "star", color: "#ffd166", name: "実績A", desc: "" },
      { id: "smoke-b", icon: "gem", color: "#7ee8ff", name: "実績B", desc: "" },
      { id: "smoke-c", icon: "flame", color: "#ff9a5c", name: "実績C", desc: "" },
    ]);
  });
  const multiUnlock = page.getByRole("dialog", { name: /実績を 3 個解除/ });
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
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260723-swup");
    achievementCelebration(
      Array.from({ length: 9 }, (_, i) => ({ id: `smoke-many-${i}`, icon: "star", color: "#ffd166", name: `実績${i + 1}`, desc: "" }))
    );
  });
  const manyUnlock = page.getByRole("dialog", { name: /実績を 9 個解除/ });
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
  // プレイヤーカードのデータも全データ削除で消えることを確認するため事前に置く
  await page.evaluate(() => {
    localStorage.setItem("dwordle2.playerCard", JSON.stringify({ name: "テスト", issuedAt: 1, seenRankTier: 1 }));
    localStorage.setItem("dwordle2.playerId", JSON.stringify("0123ABCD"));
  });
  await page.getByRole("button", { name: "全データ削除" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "全データ削除" });
  await deleteDialog.getByText("旧作 DWORDle / DWORDlie のデータは削除されません。").waitFor();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    deleteDialog.getByRole("button", { name: "OK" }).click(),
  ]);
  assert.match(page.url(), /#\/$/, "Deleting all data should reload at the title route");
  await passGate(page); // 全データ削除はページを再読み込みするので扉絵から始まる
  await page.locator("#screen-title.active").waitFor();
  const cardLeftovers = await page.evaluate(() => [
    localStorage.getItem("dwordle2.playerCard"),
    localStorage.getItem("dwordle2.playerId"),
  ]);
  assert.deepEqual(cardLeftovers, [null, null], "Deleting all data must also remove the player card name and player ID");

  // 判定オープン中の先行入力: 次の 1 行分をバッファし、オープン完了後に自動で確定する
  await page.getByRole("dialog", { name: "基本ルール | DWORDle" }).getByRole("button", { name: "わかった" }).click();
  await page.evaluate(async () => {
    const { setSetting } = await import("./js/core/settings.js?v=20260723-swup");
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
    await passGate(freshPage);
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

    // タイトルメニューの段階解放: 0 プレイでは基本項目以外がロックされている
    await freshPage.getByRole("button", { name: "本日の問題", exact: true }).waitFor();
    const lockedRandom = freshPage.getByRole("button", { name: "ランダム（難しさを選択）（あと1回プレイで解放）", exact: true });
    await lockedRandom.waitFor();
    assert.equal(
      await freshPage.getByRole("button", { name: "ランダム（難しさを選択）", exact: true }).count(),
      0,
      "Random play must be locked before any play"
    );
    // 施錠中の項目は aria-disabled で、タップしても拒否リアクションだけで実行されない
    // （aria-disabled は Playwright の actionability 待ちに掛かるため force で実クリックする）
    assert.equal(await lockedRandom.getAttribute("aria-disabled"), "true");
    await lockedRandom.click({ force: true });
    assert.equal(
      await freshPage.getByRole("dialog", { name: "ランダムにプレイ（難しさを選択）" }).count(),
      0,
      "a locked menu item must not run its action when tapped"
    );
    await freshPage.getByRole("button", { name: "裏モード（あと2回プレイで解放）", exact: true }).waitFor();
    assert.equal(
      await freshPage.getByRole("button", { name: "裏モードへ", exact: true }).count(),
      0,
      "the DWORDlie toggle must be locked before two plays"
    );
    await freshPage.getByRole("button", { name: "プレイ履歴（あと1回プレイで解放）", exact: true }).waitFor();

    await freshPage.getByRole("button", { name: "設定" }).click();
    await freshPage.waitForURL(/#\/settings$/);
    const lockedTheme = freshPage.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", { name: "???" });
    assert.equal(await lockedTheme.getAttribute("aria-disabled"), "true");
    assert.equal(await freshPage.getByRole("radio", { name: "Grand Finale" }).getAttribute("aria-disabled"), "true");

    const debugEntry = freshPage.locator(".debug-entry");
    for (let i = 0; i < 5; i++) await debugEntry.click();
    const secretDialog = freshPage.getByRole("dialog", { name: "シークレット" });
    const secretInput = secretDialog.getByLabel("秘密のキーワード");
    await secretInput.fill("WRONG");
    await secretInput.press("Enter");
    assert.equal(
      await freshPage.locator("#toast-layer .toast").filter({ hasText: "キーワードが違います" }).count(),
      1,
      "an incorrect secret submitted with Enter should show one verdict"
    );
    await secretInput.fill("DWORDLER");
    await secretInput.press("Enter");
    await freshPage.getByText("DEBUG ON", { exact: true }).waitFor();
    assert.equal(
      await freshPage.locator("#toast-layer .toast").filter({ hasText: "DEBUG ON：実績と隠し要素を一時的に全開放しました" }).count(),
      1,
      "a correct secret submitted with Enter should show one verdict"
    );
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
    await freshPage.getByText("only consider the first play of the same puzzle number on the same day, regardless of mode", { exact: false }).waitFor();

    await freshPage.reload({ waitUntil: "networkidle" });
    await passGate(freshPage);
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

  // DWORDlie 解放の瞬間（seenPlays 1 → plays 2）はモーダルで案内し、そのまま裏モードへ切り替えられる
  const usoUnlockContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const usoUnlockPage = await usoUnlockContext.newPage();
  try {
    await usoUnlockPage.addInitScript(() => {
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.tutorialSeenUso", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "2");
      localStorage.setItem("dwordle2.menuUnlockSeen", "1");
    });
    await usoUnlockPage.goto(baseUrl, { waitUntil: "networkidle" });
    await passGate(usoUnlockPage);
    const usoUnlockDialog = usoUnlockPage.getByRole("dialog", { name: "裏モード解放！" });
    await usoUnlockDialog.waitFor();
    await usoUnlockDialog.getByText("判定は必ず嘘").waitFor();

    // モーダル中は切り替えボタンの複製が暗幕の上に重なり、矢印が場所を指す
    const spotlight = usoUnlockPage.locator(".unlock-spotlight");
    await spotlight.waitFor();
    assert.equal(await usoUnlockPage.locator(".unlock-arrow").count(), 1, "the guide arrow should point at the toggle");
    const toggleBox = await usoUnlockPage.getByRole("button", { name: "裏モードへ" }).boundingBox();
    const spotlightBox = await spotlight.boundingBox();
    assert.ok(
      toggleBox && spotlightBox
        && Math.abs(toggleBox.x - spotlightBox.x) <= 1
        && Math.abs(toggleBox.y - spotlightBox.y) <= 1,
      `the spotlight must overlay the real toggle button: ${JSON.stringify({ toggleBox, spotlightBox })}`
    );

    await usoUnlockDialog.getByRole("button", { name: "DWORDlie で遊ぶ" }).click();
    await usoUnlockPage.locator(".logo").filter({ hasText: "DWORDlie" }).waitFor();
    await spotlight.waitFor({ state: "detached" });
    assert.equal(await usoUnlockPage.locator(".unlock-arrow").count(), 0, "closing the modal must remove the guide arrow");

    // 案内は解放の描画 1 回きり。リロード後は出ない
    await usoUnlockPage.reload({ waitUntil: "networkidle" });
    await passGate(usoUnlockPage);
    await usoUnlockPage.waitForTimeout(1800);
    assert.equal(
      await usoUnlockPage.getByRole("dialog", { name: "裏モード解放！" }).count(),
      0,
      "the DWORDlie unlock modal must appear only once"
    );
  } finally {
    await usoUnlockContext.close();
  }

  // 履歴インポートは機能の鍵（メニュー段階解放）に影響しない。
  // 「実績も解除する」チェックが ON のままでも、鍵は実プレイ回数のみで開く。
  const importLockContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const importLockPage = await importLockContext.newPage();
  try {
    await importLockPage.addInitScript(() => {
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("tonyu-legacy-history", JSON.stringify({
        version: 1,
        1700000100: { startTime: 1700000100, endTime: 1700000130, gameMode: "normal", problemID: 2, guessWord: ["point"], complete: true },
        1700000200: { startTime: 1700000200, endTime: 1700000230, gameMode: "normal", problemID: 3, guessWord: ["about"], complete: true },
      }));
    });
    await importLockPage.goto(baseUrl, { waitUntil: "networkidle" });
    await passGate(importLockPage);
    const importLockDialog = importLockPage.getByRole("dialog", { name: "旧作のプレイ履歴が見つかりました" });
    await importLockDialog.waitFor();
    assert.equal(
      await importLockDialog.getByRole("checkbox").isChecked(),
      true,
      "the achievements checkbox should default to ON"
    );
    await importLockDialog.getByRole("button", { name: "インポート" }).click();
    await importLockPage.locator("#toast-layer .toast").filter({ hasText: "件のプレイ履歴をマージしました" }).waitFor();

    // 2 件インポートしても、メニューの鍵は 1 つも開かない
    await importLockPage.getByRole("button", { name: "ランダム（難しさを選択）（あと1回プレイで解放）", exact: true }).waitFor();
    await importLockPage.getByRole("button", { name: "裏モード（あと2回プレイで解放）", exact: true }).waitFor();
    assert.equal(
      await importLockPage.getByRole("dialog", { name: "裏モード解放！" }).count(),
      0,
      "importing history must not open the DWORDlie unlock modal"
    );
    assert.equal(
      await importLockPage.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.playCount") ?? "null")),
      0,
      "imported records must not increase the menu unlock play count"
    );
  } finally {
    await importLockContext.close();
  }

  // プレイヤーカード: 5 プレイ未満はロック（メニュー施錠 + 直接 URL はタイトルへ戻す）
  const cardLockContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const cardLockPage = await cardLockContext.newPage();
  try {
    await cardLockPage.addInitScript(() => {
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "4");
      localStorage.setItem("dwordle2.menuUnlockSeen", "4");
    });
    await cardLockPage.goto(baseUrl, { waitUntil: "networkidle" });
    await passGate(cardLockPage);
    await cardLockPage.getByRole("button", { name: "プレイヤーカード（あと1回プレイで解放）", exact: true }).waitFor();
    await cardLockPage.evaluate(() => { location.hash = "#/card"; });
    await cardLockPage.waitForURL(/#\/$/);
    assert.equal(
      await cardLockPage.locator("#screen-title.active").count(),
      1,
      "navigating to #/card before 5 plays must redirect to the title"
    );
  } finally {
    await cardLockContext.close();
  }

  // プレイヤーカード: 5 プレイで解放。名前を保存してカードを発行し、canvas に描かれる
  const cardContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const cardPage = await cardContext.newPage();
  try {
    await cardPage.addInitScript(() => {
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "5");
      localStorage.setItem("dwordle2.menuUnlockSeen", "5");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
      // 履歴の初期シードは初回ロードのみ（リロード後にテスト側で増やした履歴を上書きしない）
      if (!localStorage.getItem("dwordle2.history")) {
        const games = [];
        for (let i = 0; i < 6; i++) {
          games.push({
            gameMode: "normal",
            problemID: 200 + i,
            startTime: 1750000000 + i * 86400,
            endTime: 1750000300 + i * 86400,
            guessWord: ["about", "crane"],
            clear: i % 2 === 0,
          });
        }
        localStorage.setItem("dwordle2.history", JSON.stringify(games));
      }
    });
    await cardPage.goto(baseUrl, { waitUntil: "networkidle" });
    await passGate(cardPage);
    await cardPage.getByRole("button", { name: "プレイヤーカード", exact: true }).click();
    await cardPage.waitForURL(/#\/card$/);
    await cardPage.evaluate(async () => {
      const { setSetting } = await import("./js/core/settings.js?v=20260723-swup");
      setSetting("theme", "pop");
    });
    await cardPage.locator("body.theme-pop.mode-normal").waitFor();
    const popNameInputStyle = await cardPage.getByLabel("プレイヤー名").evaluate((input) => {
      const style = getComputedStyle(input);
      return { background: style.backgroundColor, color: style.color, border: style.borderColor };
    });
    assert.deepEqual(popNameInputStyle, {
      background: "rgb(255, 255, 255)",
      color: "rgb(74, 53, 80)",
      border: "rgba(255, 79, 158, 0.58)",
    }, "Pop DWORDle player-name input should look editable rather than disabled");
    // シェア / 保存ボタンは発行前には見えない（[hidden] が display: flex に負ける退行の防止）
    await cardPage.getByRole("button", { name: "カードを発行" }).waitFor();
    assert.equal(
      await cardPage.getByRole("button", { name: "画像をシェア" }).isVisible(),
      false,
      "the share/save buttons must stay hidden until the card is issued"
    );
    await cardPage.getByLabel("プレイヤー名").fill("テスト太郎");
    await cardPage.getByRole("button", { name: "カードを発行" }).click();
    const cardCanvas = cardPage.locator(".player-card-canvas");
    await cardCanvas.waitFor();
    const painted = await cardCanvas.evaluate((canvas) => {
      const probe = canvas.getContext("2d");
      const { data } = probe.getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Set();
      for (let i = 0; i < data.length; i += 4096) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
      return { width: canvas.width, height: canvas.height, colorCount: colors.size };
    });
    assert.equal(painted.width, 2400, "the card image should be rendered at 2x width");
    assert.equal(painted.height, 1350, "the card image should be rendered at 2x height");
    assert.ok(painted.colorCount > 4, `the card should actually be painted (sampled colors: ${painted.colorCount})`);
    await cardPage.getByRole("button", { name: "画像をシェア" }).waitFor();
    await cardPage.getByRole("button", { name: "画像を保存" }).waitFor();

    // 画像を保存: Blob URL 経由で実際にダウンロードが発生する（iOS Safari 対策の退行防止）
    const [cardDownload] = await Promise.all([
      cardPage.waitForEvent("download"),
      cardPage.getByRole("button", { name: "画像を保存" }).click(),
    ]);
    assert.match(cardDownload.suggestedFilename(), /^DWORDle2_player_card_\d+\.png$/);
    assert.match(cardDownload.url(), /^blob:/, "the card image must be saved via a Blob URL, not a data: URL");

    // プレイヤー ID は 16 進 8 桁で発番され、以後固定される
    const playerId = await cardPage.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.playerId")));
    assert.match(playerId, /^[0-9A-F]{8}$/, "the player ID must be 8 uppercase hex digits");

    // カード画面は横スクロールしない（3D アニメのはみ出しは hidden で封じる）
    assert.equal(
      await cardPage.evaluate(() => getComputedStyle(document.querySelector("#screen-card .list-screen-body")).overflowX),
      "hidden",
      "the card screen body must not be horizontally scrollable"
    );

    // 名前は保存され、再訪問時はカードが自動表示される
    await cardPage.reload({ waitUntil: "networkidle" });
    await passGate(cardPage);
    await cardPage.evaluate(() => { location.hash = "#/card"; });
    await cardPage.waitForURL(/#\/card$/);
    await cardPage.locator(".player-card-canvas").waitFor();
    assert.equal(
      await cardPage.getByLabel("プレイヤー名").inputValue(),
      "テスト太郎",
      "the player name must persist across reloads"
    );
    assert.equal(
      await cardPage.getByRole("button", { name: "カードを発行" }).count(),
      0,
      "an already issued card should be shown without the issue button"
    );
    assert.equal(
      await cardPage.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.playerId"))),
      playerId,
      "the player ID must persist across reloads"
    );

    // 称号ラダー: 最上位は王（実績全解除 + 1000 プレイ）。多い方のモードの王になり、
    // 同数なら DWORDle。1000 未満は伝説のまま、実績未コンプはプレイ数ランクのまま。
    const ranks = await cardPage.evaluate(async () => {
      const mod = await import("./js/ui/player-card.js?v=20260723-swup");
      const pick = (stats) => {
        const rank = mod.rankForStats(stats);
        return `${rank.id}:${rank.titleJa}`;
      };
      const ach = { achUnlocked: 10, achTotal: 10 };
      const noAch = { achUnlocked: 9, achTotal: 10 };
      return {
        apprentice: (() => {
          const rank = mod.rankForStats({ ...noAch, plays: 5, normalPlays: 5, usoPlays: 0 });
          return `${rank.id}:${rank.titleJa}:${rank.titleSize}`;
        })(),
        kingNormal: pick({ ...ach, plays: 1000, normalPlays: 600, usoPlays: 400 }),
        kingUso: pick({ ...ach, plays: 1000, normalPlays: 400, usoPlays: 600 }),
        kingTie: pick({ ...ach, plays: 1000, normalPlays: 500, usoPlays: 500 }),
        masterBelowKingPlays: pick({ ...ach, plays: 999, normalPlays: 999, usoPlays: 0 }),
        diamondWithoutAllAchievements: pick({ ...noAch, plays: 1500, normalPlays: 0, usoPlays: 1500 }),
      };
    });
    assert.equal(ranks.apprentice, "BRONZE:見習いDWORDler:26", "the apprentice card title should use DWORDler at a slightly smaller size");
    assert.equal(ranks.kingNormal, "KING:DWORDleの王", "mostly-DWORDle players should become the DWORDle king");
    assert.equal(ranks.kingUso, "KING:DWORDlieの王", "mostly-DWORDlie players should become the DWORDlie king");
    assert.equal(ranks.kingTie, "KING:DWORDleの王", "an even split should crown the DWORDle king");
    assert.equal(ranks.masterBelowKingPlays, "MASTER:伝説のWORDler", "under 1000 plays should stay MASTER even with all achievements");
    assert.equal(ranks.diamondWithoutAllAchievements, "DIAMOND:頂のWORDler", "the king requires every achievement, not just plays");

    // 昇格演出: 前回カードを見たときよりランクが上がっていたら RANK UP 演出が 1 回だけ出る
    await cardPage.evaluate(() => {
      const games = JSON.parse(localStorage.getItem("dwordle2.history"));
      for (let i = 0; i < 90; i++) {
        games.push({
          gameMode: "normal",
          problemID: 5000 + i,
          startTime: 1751000000 + i * 86400,
          endTime: 1751000300 + i * 86400,
          guessWord: ["about", "crane"],
          clear: true,
        });
      }
      localStorage.setItem("dwordle2.history", JSON.stringify(games));
    });
    await cardPage.reload({ waitUntil: "networkidle" });
    await passGate(cardPage);
    await cardPage.evaluate(() => { location.hash = "#/card"; });
    await cardPage.waitForURL(/#\/card$/);
    await cardPage.locator(".rank-up-overlay").waitFor();
    await cardPage.locator(".rank-up-overlay .rank-up-name").filter({ hasText: "GOLD RANK" }).waitFor();
    // 一度見た昇格は次の表示では繰り返さない
    await cardPage.reload({ waitUntil: "networkidle" });
    await passGate(cardPage);
    await cardPage.evaluate(() => { location.hash = "#/card"; });
    await cardPage.waitForURL(/#\/card$/);
    await cardPage.locator(".player-card-canvas").waitFor();
    await cardPage.waitForTimeout(1500);
    assert.equal(await cardPage.locator(".rank-up-overlay").count(), 0, "the rank-up celebration must play only once per promotion");

    // カテゴリバッジ: 実績 9 カテゴリ + 隠しの計 10 個。この時点では実績未解除なのですべて未獲得
    const badgeInfo = await cardPage.evaluate(async () => {
      const [cardMod, achMod] = await Promise.all([
        import("./js/ui/player-card.js?v=20260723-swup"),
        import("./js/core/achievements.js?v=20260723-swup"),
      ]);
      const states = cardMod.categoryBadgeStates();
      return {
        cats: states.map((b) => b.cat),
        expectedCats: [...achMod.ACHIEVEMENT_CATEGORIES.map((c) => c.id), "hidden"],
        earned: states.filter((b) => b.earned).map((b) => b.cat),
      };
    });
    assert.equal(badgeInfo.cats.length, 10, "there must be exactly 10 category badges");
    assert.deepEqual(badgeInfo.cats, badgeInfo.expectedCats, "badges must cover every achievement category plus hidden");
    assert.deepEqual(badgeInfo.earned, [], "no badge should be earned before unlocking achievements");

    // 実績を全解除すると 10 個すべて獲得になる
    await cardPage.evaluate(async () => {
      const mod = await import("./js/core/achievements.js?v=20260723-swup");
      const all = {};
      for (const a of mod.ACHIEVEMENTS) all[a.id] = 1750000000;
      localStorage.setItem("dwordle2.achievements", JSON.stringify(all));
    });
    await cardPage.reload({ waitUntil: "networkidle" });
    await passGate(cardPage);
    await cardPage.evaluate(() => { location.hash = "#/card"; });
    await cardPage.waitForURL(/#\/card$/);
    await cardPage.locator(".player-card-canvas").waitFor();
    const earnedAll = await cardPage.evaluate(async () => {
      const mod = await import("./js/ui/player-card.js?v=20260723-swup");
      return mod.categoryBadgeStates().every((b) => b.earned);
    });
    assert.ok(earnedAll, "unlocking every achievement must earn all 10 category badges");
  } finally {
    await cardContext.close();
  }

  // 履歴から別モードの記録を開いたときは、その記録のモードの配色で表示し、離れたら戻す。
  // あわせて行動ログ（画面滞在・クリック）が記録されることも確認する。
  const moodContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
  const moodPage = await moodContext.newPage();
  try {
    await moodPage.addInitScript(() => {
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "99");
      localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
      localStorage.setItem("dwordle2.mode", JSON.stringify("normal"));
      localStorage.setItem("dwordle2.lastPlayedMode", JSON.stringify("normal"));
      localStorage.setItem("dwordle2.history", JSON.stringify([
        { gameMode: "uso", problemID: 300, startTime: 1750000000, endTime: 1750000300, guessWord: ["about", "crane"], clear: true },
      ]));
    });
    await moodPage.goto(baseUrl, { waitUntil: "networkidle" });
    await passGate(moodPage);
    assert.equal(
      await moodPage.evaluate(() => document.body.classList.contains("mode-normal")),
      true,
      "the app should start in DWORDle mode"
    );
    await moodPage.evaluate(() => { location.hash = "#/result/uso/1750000000"; });
    await moodPage.waitForFunction(() => document.body.classList.contains("mode-uso"));
    await moodPage.evaluate(() => { location.hash = "#/analysis/uso/1750000000"; });
    await moodPage.waitForFunction(() => document.body.classList.contains("mode-uso"));
    await moodPage.evaluate(() => { location.hash = "#/history"; });
    await moodPage.waitForFunction(
      () => document.body.classList.contains("mode-normal") && !document.body.classList.contains("mode-uso"),
      undefined,
      { timeout: 5000 }
    );

    // 行動ログ: クリックと画面滞在が localStorage に集計される
    await moodPage.getByRole("button", { name: "タイトルへ戻る" }).click();
    await moodPage.waitForURL(/#\/$/);
    const activity = await moodPage.evaluate(() => {
      window.dispatchEvent(new Event("pagehide")); // 保留中のログを書き出させる
      return JSON.parse(localStorage.getItem("dwordle2.activity"));
    });
    assert.ok(activity, "the activity log should be persisted");
    assert.ok(activity.screens?.history?.visits >= 1, "screen visits should be tracked");
    assert.ok(
      Object.keys(activity.counters).some((key) => key.startsWith("click:")),
      "button clicks should be tracked"
    );
    assert.ok(
      Object.keys(activity.counters).some((key) => key.startsWith("screen:")),
      "screen transitions should be tracked"
    );
    // お気に入り集計: 使用中テーマの累計使用時間が積まれている（このページのテーマは cyber）
    assert.ok(
      activity.usage?.themes?.cyber > 0,
      `theme usage time should be tracked (usage: ${JSON.stringify(activity.usage)})`
    );
    assert.equal(
      await moodPage.evaluate(async () => {
        const mod = await import("./js/core/activity.js?v=20260723-swup");
        return mod.favoriteThemeId();
      }),
      "cyber",
      "the favorite theme should be the most-used theme"
    );
  } finally {
    await moodContext.close();
  }

  // 扉絵は前回選択していたモード（プレイの有無は問わない）のテーマで表示し、
  // 「開始」でそのままそのモードへ直行する
  {
    const usoGatePage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    await usoGatePage.addInitScript(() => {
      localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "cyber", sfx: false, bgm: false, language: "ja" }));
      localStorage.setItem("dwordle2.mode", JSON.stringify("uso"));
      localStorage.setItem("dwordle2.lastPlayedMode", JSON.stringify("normal")); // 旧仕様の保存値より選択を優先する
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.tutorialSeenUso", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "99");
      localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
    });
    await usoGatePage.goto(baseUrl, { waitUntil: "networkidle" });
    await usoGatePage.locator("#entry-gate .entry-gate-start").waitFor();
    assert.equal(
      await usoGatePage.evaluate(() => document.body.classList.contains("mode-uso")),
      true,
      "the entry gate should use the DWORDlie theme when DWORDlie was selected last"
    );
    assert.match(
      await usoGatePage.locator("#entry-gate .logo").textContent(),
      /DWORDlie/,
      "the entry gate logo should read DWORDlie"
    );
    await passGate(usoGatePage);
    await usoGatePage.locator("#screen-title.active").waitFor();
    assert.match(
      await usoGatePage.locator("#screen-title .logo").textContent(),
      /DWORDlie/,
      "starting from the gate should land directly in DWORDlie"
    );
    await usoGatePage.close();
  }

  // 「音無しで開始」は音オン設定でも音を止めたまま入る（2 択は常に表示される）
  {
    const mutedStartPage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    await mutedStartPage.addInitScript(() => {
      localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "classic", sfx: true, bgm: true, language: "ja" }));
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "99");
      localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
    });
    await mutedStartPage.goto(baseUrl, { waitUntil: "networkidle" });
    await mutedStartPage.getByText("このゲームは音が出ます", { exact: false }).waitFor();
    await mutedStartPage.locator("#entry-gate .entry-gate-muted").click();
    await mutedStartPage.locator("#entry-gate").waitFor({ state: "detached" });
    assert.deepEqual(
      await mutedStartPage.evaluate(async () => {
        const s = (await import("./js/core/settings.js?v=20260723-swup")).getSettings();
        return { bgm: s.bgm, sfx: s.sfx };
      }),
      { bgm: false, sfx: false },
      "Start muted should mute all sounds"
    );
    await mutedStartPage.close();
  }

  // 言語 3 択: ラベルは言語設定にかかわらず固定で、狭い端末でもテーマと同幅で崩れない
  {
    const narrowPage = await browser.newPage({ viewport: { width: 320, height: 700 }, locale: "en-US" });
    await narrowPage.addInitScript(() => {
      localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "classic", sfx: false, bgm: false, language: "en" }));
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "99");
      localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
    });
    await narrowPage.goto(`${baseUrl}#/settings`, { waitUntil: "networkidle" });
    await passGate(narrowPage);
    const languageSeg = narrowPage.getByRole("radiogroup", { name: "Language" });
    await languageSeg.waitFor();
    assert.deepEqual(
      await languageSeg.getByRole("radio").allTextContents(),
      ["日本語", "English", "System"],
      "language choices should keep fixed labels regardless of the UI language"
    );
    await narrowPage.getByText("Set the UI language", { exact: true }).waitFor();
    const languageBox = await languageSeg.boundingBox();
    const themeBox = await narrowPage.getByRole("radiogroup", { name: "Theme" }).boundingBox();
    assert.ok(
      Math.abs(languageBox.width - themeBox.width) <= 1,
      `the language segment should match the theme segment width: ${languageBox.width} vs ${themeBox.width}`
    );
    assert.ok(
      languageBox.x >= 0 && languageBox.x + languageBox.width <= 320,
      `the language segment should fit a narrow phone viewport: ${JSON.stringify(languageBox)}`
    );
    await narrowPage.close();
  }

  // Android は Roboto 細字へのフォールバックを避け、sans-serif-medium へ寄せる
  {
    const androidPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      locale: "ja-JP",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    });
    await androidPage.goto(baseUrl, { waitUntil: "networkidle" });
    await androidPage.locator("#entry-gate .entry-gate-start").waitFor();
    assert.equal(
      await androidPage.evaluate(() => document.body.classList.contains("android-font")),
      true,
      "Android should get the android-font body class"
    );
    assert.match(
      await androidPage.evaluate(() => getComputedStyle(document.body).fontFamily),
      /sans-serif-medium/,
      "Android should prefer the medium-weight system font"
    );
    await androidPage.close();
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("android-font")),
      false,
      "non-Android browsers should keep the default font stack"
    );
  }

  // PWA: Service Worker が全資産を事前キャッシュし、オフラインでも起動・遷移できる
  {
    const swContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    const swPage = await swContext.newPage();
    await swPage.addInitScript(() => {
      localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "cyber", sfx: false, bgm: false, language: "ja" }));
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.playCount", "99");
      localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
    });
    // localhost では ?sw=1 のときだけ登録する（通常のテストページに SW が入り込まないように）
    await swPage.goto(`${baseUrl}?sw=1`, { waitUntil: "networkidle" });
    await swPage.evaluate(() => navigator.serviceWorker.ready); // install（事前キャッシュ）完了まで待つ
    await swContext.setOffline(true);
    await swPage.reload({ waitUntil: "load" });
    await swPage.locator("#entry-gate .entry-gate-start").waitFor();
    await swPage.locator("#entry-gate .entry-gate-start").click();
    await swPage.locator("#entry-gate").waitFor({ state: "detached" });
    await swPage.locator("#screen-title.active .logo").waitFor();
    assert.equal(
      await swPage.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      true,
      "the offline page should be controlled by the service worker"
    );
    // オフラインでも画面遷移（設定）まで動く
    await swPage.getByRole("button", { name: "設定" }).click();
    await swPage.waitForURL(/#\/settings$/);
    await swPage.getByRole("switch", { name: "BGM" }).waitFor();
    await swContext.setOffline(false);
    await swContext.close();
  }

  // 言語のシステム連動: 設定が未保存（既定 system）なら navigator.language に従う
  {
    const sysJa = await browser.newPage({ locale: "ja-JP" });
    await sysJa.goto(baseUrl, { waitUntil: "networkidle" });
    await sysJa.getByRole("button", { name: "開始", exact: true }).waitFor();
    assert.equal(await sysJa.evaluate(() => document.documentElement.lang), "ja", "a Japanese browser should get the Japanese UI by default");
    await sysJa.close();
    const sysEn = await browser.newPage({ locale: "en-US" });
    await sysEn.goto(baseUrl, { waitUntil: "networkidle" });
    await sysEn.getByRole("button", { name: "Start", exact: true }).waitFor();
    assert.equal(await sysEn.evaluate(() => document.documentElement.lang), "en", "a non-Japanese browser should get the English UI by default");
    await sysEn.close();
  }

  console.log("UIスモーク + a11yテスト: OK");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
