import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { Logic } from "../js/core/logic.js";
import { ACHIEVEMENTS } from "../js/core/achievements.js";
import { pidLabel, todayPID } from "../js/core/problems.js";

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
for (const [filename, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-192.png", 192], ["icon-maskable-512.png", 512]]) {
  const png = await readFile(path.join(projectRoot, filename));
  const offset = png.indexOf(Buffer.from("IHDR"));
  assert.notEqual(offset, -1, `${filename} should contain a PNG IHDR chunk`);
  assert.equal(png.readUInt32BE(offset + 4), size, `${filename} width`);
  assert.equal(png.readUInt32BE(offset + 8), size, `${filename} height`);
}

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
  localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
  const iconSafeAreas = await page.evaluate(async () => {
    const measure = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const background = [...pixels.slice(0, 3)];
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const index = (y * canvas.width + x) * 4;
            const difference =
              Math.abs(pixels[index] - background[0]) +
              Math.abs(pixels[index + 1] - background[1]) +
              Math.abs(pixels[index + 2] - background[2]);
            if (difference <= 18) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        resolve({ src, minX, minY, right: canvas.width - 1 - maxX, bottom: canvas.height - 1 - maxY });
      };
      image.onerror = reject;
      image.src = src;
    });
    return Promise.all([measure("icon-512.png"), measure("icon-maskable-512.png")]);
  });
  for (const safeArea of iconSafeAreas) {
    assert.ok(
      Math.min(safeArea.minX, safeArea.minY, safeArea.right, safeArea.bottom) >= 70,
      `PWA icon artwork should stay inside a safe margin: ${JSON.stringify(safeArea)}`
    );
  }
  // 扉絵: ロゴ・音の説明・「開始 / 音無しで開始」の 2 択が表示され、通過するまで本来の画面は始まらない
  // （メッセージと 2 択は音設定にかかわらず固定。このページは音オフ設定でシード済み）
  await page.locator("#entry-gate .entry-gate-start").waitFor();
  await page.locator("#entry-gate .app-version").waitFor(); // 扉絵でもバージョンが分かる
  await page.getByText("このゲームは音が出ます", { exact: true }).waitFor();
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
      const mod = await import("./js/audio/sound.js?v=20260723-fa");
      return mod.audioNeedsRecovery();
    }),
    true,
    "audio must stay locked while the entry gate is open"
  );
  await passGate(page);
  // 「開始」は音オフ設定からでも音を復帰する（音無しのまま入るのは「音無しで開始」の役割）
  assert.deepEqual(
    await page.evaluate(async () => {
      const s = (await import("./js/core/settings.js?v=20260723-fa")).getSettings();
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
  await page.getByText("判定は必ず嘘。15手以内に見抜け。", { exact: true }).waitFor();
  assert.equal(await page.getByText(/答えは 2 つ。判定は必ず嘘/).count(), 0, "The DWORDlie menu tagline should stay concise");
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
  await page.getByText("答えは2つ、盤面は1つ。10手で片方を当てろ。", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("答えが 2 つある Wordle。10 手以内に「どちらか」を当てろ。", { exact: true }).count(),
    0
  );
  const randomButton = page.getByRole("button", { name: "ランダム（難しさを選択）", exact: true });
  await page.getByRole("button", { name: "本日の問題", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "デイリー問題", exact: true }).count(), 0);
  await randomButton.waitFor();
  await randomButton.click();
  const randomDialog = page.getByRole("dialog", { name: "ランダム（難しさを選択）" });
  await randomDialog.waitFor();
  await randomDialog.getByText("Lv.4 難しい", { exact: false }).waitFor();
  assert.equal(await randomDialog.getByText(/むずかしい/).count(), 0, "the title difficulty picker should use 難しい");
  const randomLevelColumns = await randomDialog.locator(".random-level-option").evaluateAll((buttons) => ({
    names: buttons.map((button) => button.querySelector(".random-level-name").getBoundingClientRect().x),
    descriptions: buttons.map((button) => button.querySelector(".random-level-desc").getBoundingClientRect().x),
    nameOverflows: buttons.map((button) => {
      const name = button.querySelector(".random-level-name");
      return name.scrollWidth > name.clientWidth + 1;
    }),
  }));
  assert.ok(
    Math.max(...randomLevelColumns.names) - Math.min(...randomLevelColumns.names) <= 1
      && Math.max(...randomLevelColumns.descriptions) - Math.min(...randomLevelColumns.descriptions) <= 1
      && randomLevelColumns.nameOverflows.every((overflow) => !overflow),
    `random difficulty columns should align across every level: ${JSON.stringify(randomLevelColumns)}`
  );
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
      title: document.title,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content,
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      ogDescription: document.querySelector('meta[property="og:description"]')?.content,
      twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
      twitterTitle: document.querySelector('meta[name="twitter:title"]')?.content,
      twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
      twitterDescription: document.querySelector('meta[name="twitter:description"]')?.content,
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      iconSizes: icons.flatMap((icon) => String(icon.sizes ?? "").split(/\s+/)),
      iconStatuses,
      statuses,
    };
  });
  assert.equal(publicEntry.title, "DWORDle | 新感覚Wordle");
  assert.equal(publicEntry.ogTitle, "DWORDle | 新感覚Wordle");
  assert.equal(publicEntry.ogImage, "https://kakira9618.github.io/DWORDle2/og.png");
  assert.equal(publicEntry.ogDescription, "答えは2つ。盤面は1つ。新感覚Wordle！");
  assert.equal(publicEntry.twitterCard, "summary_large_image");
  assert.equal(publicEntry.twitterTitle, "DWORDle | 新感覚Wordle");
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
    const mod = await import("./js/core/settings.js?v=20260723-fa");
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
    const mod = await import("./js/core/settings.js?v=20260723-fa");
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
  const settingsTabs = page.getByRole("tab");
  await settingsTabs.first().waitFor();
  assert.deepEqual(await settingsTabs.allTextContents(), ["表示", "ゲーム", "サウンド", "データ"]);
  assert.equal(await page.getByRole("tab", { name: "表示" }).getAttribute("aria-selected"), "true");
  const switches = page.getByRole("switch");
  await switches.first().waitFor();
  assert.equal(await switches.count(), 3, "The Display tab should expose its three switches");
  for (const label of ["ハイコントラスト配色", "キーボードヒント", "演出を軽くする"]) {
    await page.getByRole("switch", { name: label }).waitFor();
  }
  for (const copy of ["UIの言語を設定", "UIや背景のテーマを設定", "3D効果やアニメーションを抑えます"]) {
    await page.getByText(copy, { exact: true }).waitFor();
  }
  const displayRowBorders = await page.locator("#settings-panel-display > .setting-row").evaluateAll((rows) =>
    rows.map((row) => getComputedStyle(row).borderBottomStyle)
  );
  assert.deepEqual(
    displayRowBorders,
    ["solid", "solid", "solid", "solid", "none"],
    "Settings should keep separators only between items, not below the final item"
  );
  assert.equal(await page.getByText("低スペック端末向け", { exact: false }).count(), 0);
  await page.getByRole("tab", { name: "ゲーム" }).click();
  assert.equal(await switches.count(), 1, "The Gameplay tab should expose only EXTRA SHOT");
  await page.getByRole("switch", { name: "EXTRA SHOT" }).waitFor();
  await page.getByRole("tab", { name: "表示" }).click();

  // 隠しテーマ「ポップ」: 実績「三色盛り」解放済みなので選択でき、body クラスに反映される
  await page.getByRole("radio", { name: "ポップ", exact: true }).click();
  await page.locator("body.theme-pop").waitFor();
  await page.getByRole("tab", { name: "サウンド" }).click();
  assert.equal(await switches.count(), 2, "The Sound tab should expose the SFX and BGM switches");
  for (const label of ["効果音", "BGM"]) await page.getByRole("switch", { name: label }).waitFor();
  const bgmPickerMetrics = await page.locator(".bgm-picker").evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));
  assert.equal(bgmPickerMetrics.clientHeight, 320, "BGM picker should have a fixed 320px inner viewport");
  assert.ok(bgmPickerMetrics.scrollHeight > bgmPickerMetrics.clientHeight, "BGM choices should scroll inside their picker");
  assert.equal(bgmPickerMetrics.overflowY, "auto");
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
  const normalPopFlag = await page.evaluate(async () => {
    const marker = document.createElement("span");
    marker.className = "guess-flag";
    document.body.append(marker);
    const screenColor = getComputedStyle(marker).color;
    marker.remove();

    const { renderResultCanvas } = await import("./js/ui/snapshot.js?v=20260723-fa");
    const canvas = renderResultCanvas(
      {
        gameMode: "normal",
        problemID: 1,
        startTime: 1,
        clear: true,
        guessWord: ["point"],
      },
      { ans1: "point", ans2: "touch" },
      [Array(5).fill("correct")]
    );
    const pixels = canvas.getContext("2d").getImageData(515 * 2, 220 * 2, 42 * 2, 45 * 2).data;
    let savedBlackPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 30 && pixels[i + 1] < 30 && pixels[i + 2] < 30) savedBlackPixels++;
    }
    return { screenColor, savedBlackPixels };
  });
  assert.equal(normalPopFlag.screenColor, "rgb(0, 0, 0)", "The Pop on-screen flag should be black");
  assert.ok(normalPopFlag.savedBlackPixels > 50, "The Pop saved-image flag should also be black");

  await page.evaluate(async () => {
    const { setAppMode } = await import("./js/ui/app.js?v=20260723-fa");
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
  await page.getByRole("tab", { name: "データ" }).click();
  await page.getByRole("button", { name: "履歴をインポート（移行）" }).waitFor();
  assert.equal(await page.getByRole("tabpanel").count(), 1, "Only the selected settings category should be exposed");
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
    const { setAppMode } = await import("./js/ui/app.js?v=20260723-fa");
    setAppMode("normal");
  });
  await page.locator("body.theme-pop.mode-normal").waitFor();
  await page.evaluate(async () => {
    const { showHelpModal } = await import("./js/ui/help.js?v=20260723-fa");
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
  await page.getByRole("tab", { name: "表示" }).click();
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
  const puzzleNumberInput = puzzleDialog.getByRole("spinbutton", { name: "問題番号" });
  await puzzleNumberInput.fill("1");
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
      && guessedFlagGap >= 19
      && guessedFlagBox.width <= 23.5,
    `The guessed-answer flag should sit to the right of the tile row: ${JSON.stringify({ guessedFlagBox, guessedLastTileBox })}`
  );
  assert.match(
    await guessedAnswerRow.getAttribute("aria-label"),
    /あなたが当てた答え/,
    "The flag meaning should also be exposed to assistive technology"
  );
  const savedImageFlagPixels = await page.evaluate(async ({ guessedWord }) => {
    const settings = await import("./js/core/settings.js?v=20260723-fa");
    const { renderResultCanvas } = await import("./js/ui/snapshot.js?v=20260723-fa");
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
      rightOfTiles: countFlagPixels(515, 220, 42, 45),
      oldLeftPosition: countFlagPixels(126, 220, 32, 45),
    };
    settings.setSetting("theme", "classic");
    return counts;
  }, { guessedWord: answer });
  assert.ok(
    savedImageFlagPixels.rightOfTiles > 50 && savedImageFlagPixels.oldLeftPosition < 10,
    `The saved-image flag should sit to the right of its answer row: ${JSON.stringify(savedImageFlagPixels)}`
  );
  assert.equal(await page.locator(".amark").count(), 0, "The old textual answer marker should be removed");
  const titleAction = page.getByRole("button", { name: "タイトルへ", exact: true });
  await titleAction.waitFor();
  assert.equal(await titleAction.evaluate((button) => button.classList.contains("btn-ghost")), false);
  assert.equal(await titleAction.evaluate((button) => button.classList.contains("btn")), true);
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
    const mod = await import("./js/core/settings.js?v=20260723-fa");
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
    const mod = await import("./js/core/settings.js?v=20260723-fa");
    mod.setSetting("highContrast", false);
  });

  // 結果フィルターで EXTRA SHOT 成功（DOUBLE CLEAR）だけを抽出できる。
  await page.evaluate(async () => {
    const [{ Logic: BrowserLogic }, records] = await Promise.all([
      import("./js/core/logic.js"),
      import("./js/core/records.js"),
    ]);
    const pid = 2;
    const logic = new BrowserLogic(pid);
    const startTime = Math.max(
      Math.floor(Date.now() / 1000) - 10,
      ...records.getHistory().map((record) => record.startTime + 1)
    );
    records.addFinishedGame({
      version: "2.0.0",
      startTime,
      endTime: startTime + 20,
      gameMode: "normal",
      problemID: pid,
      guessWord: [logic.ans1],
      usoResults: [],
      extraShot: { word: logic.ans2, success: true },
    });
  });
  await page.evaluate(() => { location.hash = "#/history"; });
  await page.waitForURL(/#\/history$/);
  const historyModeTabs = page.locator("#screen-history > .seg");
  for (const modeLabel of ["すべて", "DWORDle", "DWORDlie"]) {
    await historyModeTabs.getByRole("button", { name: modeLabel, exact: true }).click();
    await page.locator("#screen-history .history-controls-summary").waitFor();
    assert.equal(
      await page.locator("#screen-history .history-controls").count(),
      1,
      `Filters & sorting should be available in ${modeLabel}`
    );
  }
  await historyModeTabs.getByRole("button", { name: "すべて", exact: true }).click();
  await page.locator("#screen-history .history-controls-summary").click();
  const historyFilterLayout = await page.locator("#screen-history .history-controls").evaluate((controls) => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
    };
    const dates = [...controls.querySelectorAll('input[type="date"]')].map(box);
    const guesses = [...controls.querySelectorAll('.history-guess-range input[type="number"]')].map(box);
    const separator = box(controls.querySelector(".history-range-separator"));
    const card = box(controls);
    return { dates, guesses, separator, card };
  });
  assert.ok(
    historyFilterLayout.dates[0].bottom <= historyFilterLayout.dates[1].top,
    `Date fields should stack without overlap on mobile: ${JSON.stringify(historyFilterLayout)}`
  );
  for (const field of [...historyFilterLayout.dates, ...historyFilterLayout.guesses]) {
    assert.ok(
      field.left >= historyFilterLayout.card.left && field.right <= historyFilterLayout.card.right,
      `History filter fields must stay inside the card: ${JSON.stringify(historyFilterLayout)}`
    );
  }
  assert.ok(
    historyFilterLayout.guesses[0].right <= historyFilterLayout.separator.left &&
      historyFilterLayout.separator.right <= historyFilterLayout.guesses[1].left,
    `The Guess range separator should stay between its inputs: ${JSON.stringify(historyFilterLayout)}`
  );
  assert.ok(
    historyFilterLayout.separator.top >= historyFilterLayout.guesses[0].top &&
      historyFilterLayout.separator.bottom <= historyFilterLayout.guesses[0].bottom,
    `The Guess range separator should remain vertically centered: ${JSON.stringify(historyFilterLayout)}`
  );
  const historyResultFilter = page.getByLabel("結果", { exact: true });
  assert.ok(
    (await historyResultFilter.locator("option").allTextContents()).includes("DOUBLE CLEAR"),
    "the result filter should include DOUBLE CLEAR"
  );
  await historyResultFilter.selectOption("double");
  const doubleClearHistoryItems = page.locator("#screen-history .history-item");
  await doubleClearHistoryItems.first().waitFor();
  assert.equal(await doubleClearHistoryItems.count(), 1, "DOUBLE CLEAR should isolate successful EXTRA SHOT records");
  assert.match(
    await doubleClearHistoryItems.first().getAttribute("aria-label"),
    /ダブルクリア/,
    "the filtered record should be a DOUBLE CLEAR"
  );
  await page.getByLabel("結果", { exact: true }).selectOption("all");
  const historyOverflowLayout = await page.locator("#screen-history .list-screen-body").evaluate(async (body) => {
    const controls = body.querySelector(".history-controls");
    const item = body.querySelector(".history-item");
    const controlsHeightBefore = controls.getBoundingClientRect().height;
    const clones = Array.from({ length: 30 }, () => {
      const clone = item.cloneNode(true);
      clone.tabIndex = -1;
      clone.setAttribute("aria-hidden", "true");
      body.append(clone);
      return clone;
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const result = {
      controlsHeightBefore,
      controlsHeightAfter: controls.getBoundingClientRect().height,
      controlsFlexShrink: getComputedStyle(controls).flexShrink,
      scrollable: body.scrollHeight > body.clientHeight,
    };
    clones.forEach((clone) => clone.remove());
    return result;
  });
  assert.equal(
    historyOverflowLayout.controlsFlexShrink,
    "0",
    `History controls must not shrink when the list overflows: ${JSON.stringify(historyOverflowLayout)}`
  );
  assert.ok(
    historyOverflowLayout.controlsHeightAfter >= historyOverflowLayout.controlsHeightBefore - 1,
    `History controls must retain their height when many entries are shown: ${JSON.stringify(historyOverflowLayout)}`
  );
  assert.ok(
    historyOverflowLayout.scrollable,
    `The history body should scroll instead of collapsing its controls: ${JSON.stringify(historyOverflowLayout)}`
  );
  const historyItem = page.locator("button.history-item").first();
  await historyItem.waitFor();
  await assertNoSeriousA11yViolations("History screen");
  await historyItem.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/#\/result\/normal\/\d+$/);

  const historicalDailyDate = new Date();
  historicalDailyDate.setDate(15);
  historicalDailyDate.setMonth(historicalDailyDate.getMonth() - 1);
  const historicalDailyPid =
    historicalDailyDate.getFullYear() * 10000
    + (historicalDailyDate.getMonth() + 1) * 100
    + historicalDailyDate.getDate();
  await page.evaluate(async ({ pid }) => {
    const [{ Logic }, records] = await Promise.all([
      import("./js/core/logic.js"),
      import("./js/core/records.js"),
    ]);
    const logic = new Logic(pid);
    records.addFinishedGame({
      version: "2.0.0",
      startTime: Math.floor(Date.now() / 1000) - 86400 * 40,
      endTime: Math.floor(Date.now() / 1000) - 86400 * 40 + 60,
      gameMode: "normal",
      problemID: pid,
      guessWord: [logic.ans1],
      usoResults: [],
    });
  }, { pid: historicalDailyPid });
  await page.evaluate(() => { location.hash = "#/problems"; });
  await page.waitForURL(/#\/problems$/);
  const dailyCalendar = page.locator(".daily-calendar-card");
  const levelTabs = page.locator(".problem-level-tabs");
  await dailyCalendar.waitFor();
  assert.deepEqual(
    await levelTabs.getByRole("button").allTextContents(),
    ["Daily", "やさしい", "ふつう", "やや難", "難しい", "マニア", "極"],
    "Daily should be the first puzzle category and the hard label should use kanji"
  );
  assert.equal(
    await levelTabs.getByRole("button", { name: "Daily", exact: true }).evaluate((button) => button.classList.contains("active")),
    true,
    "Daily should be selected by default"
  );
  assert.equal(
    await levelTabs.getByRole("button").first().evaluate((button) => Number.parseFloat(getComputedStyle(button).fontSize) <= 11),
    true,
    "the seven category labels should use a compact font size"
  );
  const dailyCalendarBox = await dailyCalendar.boundingBox();
  const levelTabsBox = await levelTabs.boundingBox();
  assert.ok(
    dailyCalendarBox.y >= levelTabsBox.y + levelTabsBox.height,
    "the expanded Daily calendar should appear directly below the category tabs"
  );
  assert.equal(
    await page.locator("#daily-calendar-details, .daily-calendar-toggle").count(),
    0,
    "the Daily calendar should be shown directly without collapse controls"
  );
  const todayDaily = page.locator("button.daily-calendar-day.today");
  assert.match(await todayDaily.getAttribute("aria-label"), /今日、未プレイ$/, "today's Daily puzzle should be visible in the calendar");
  assert.equal(
    await page.locator("#screen-problems .problem-double-legend").count(),
    0,
    "the puzzle list should not show a standalone DOUBLE CLEAR legend"
  );
  await page.getByRole("button", { name: "前の月" }).click();
  await page.getByText(
    `${historicalDailyDate.getFullYear()}年${historicalDailyDate.getMonth() + 1}月`,
    { exact: true }
  ).waitFor();
  const historicalDailyDay = page.getByRole("button", {
    name: `${historicalDailyDate.getFullYear()}年${historicalDailyDate.getMonth() + 1}月${historicalDailyDate.getDate()}日、クリア済み`,
  });
  await historicalDailyDay.waitFor();
  await historicalDailyDay.click();
  const historicalDailyDialog = page.getByRole("dialog", { name: pidLabel(historicalDailyPid) });
  await historicalDailyDialog.waitFor();
  assert.equal(
    await historicalDailyDialog.getByRole("button", { name: "この問題をプレイ" }).count(),
    0,
    "past Daily history must not offer replay"
  );
  await historicalDailyDialog.getByText(
    "過去のDailyはプレイできません。プレイ履歴のみ確認できます。",
    { exact: true }
  ).waitFor();
  assert.equal(
    await historicalDailyDialog.getByRole("button", { name: /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2} のプレイ$/ }).count(),
    1,
    "past Daily results should use the date-time play label and remain viewable"
  );
  await historicalDailyDialog.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("button", { name: "次の月" }).click();
  const futureDailyDays = page.locator(".daily-calendar-day.future");
  assert.ok(await futureDailyDays.count() > 0, "the current calendar should include future dates");
  assert.equal(
    await futureDailyDays.evaluateAll((days) => days.every((day) => day.disabled)),
    true,
    "future Daily dates must all be disabled"
  );
  await todayDaily.click();
  const dailyDialog = page.getByRole("dialog", { name: pidLabel(todayPID()) });
  await dailyDialog.waitFor();
  await dailyDialog.getByRole("button", { name: "閉じる" }).click();

  // 今日のDailyをDWORDleだけでプレイ済みなら、DWORDlie側は「未プレイ」のまま。
  // 開始時は矛盾した「プレイ済み」ではなく、別モードでの当日プレイだと明示する。
  await page.evaluate(async ({ pid }) => {
    const [{ Logic: BrowserLogic }, records, app] = await Promise.all([
      import("./js/core/logic.js"),
      import("./js/core/records.js"),
      import("./js/ui/app.js?v=20260723-fa"),
    ]);
    const logic = new BrowserLogic(pid);
    const startTime = Math.floor(Date.now() / 1000) - 30;
    records.addFinishedGame({
      version: "2.0.0",
      startTime,
      endTime: startTime + 20,
      gameMode: "normal",
      problemID: pid,
      guessWord: [logic.ans1],
      usoResults: [],
    });
    app.setAppMode("uso");
    location.hash = "#/";
  }, { pid: todayPID() });
  await page.waitForURL(/#\/$/);
  await page.evaluate(() => { location.hash = "#/problems"; });
  await page.waitForURL(/#\/problems$/);
  const usoTodayDaily = page.locator("button.daily-calendar-day.today");
  assert.match(
    await usoTodayDaily.getAttribute("aria-label"),
    /今日、未プレイ$/,
    "Daily status should remain mode-specific after playing only DWORDle"
  );
  await usoTodayDaily.click();
  const usoDailyDialog = page.getByRole("dialog", { name: pidLabel(todayPID()) });
  await usoDailyDialog.getByText("この問題はまだプレイしていません。", { exact: true }).waitFor();
  await usoDailyDialog.getByRole("button", { name: "この問題をプレイ" }).click();
  const crossModeDailyDialog = page.getByRole("dialog", { name: "別モードで本日プレイ済み" });
  await crossModeDailyDialog.getByText(
    `${pidLabel(todayPID())} は本日 DWORDle でプレイ済みですが、DWORDlie ではまだプレイしていません。`,
    { exact: false }
  ).waitFor();
  await crossModeDailyDialog.getByRole("button", { name: "キャンセル" }).click();
  await usoDailyDialog.getByRole("button", { name: "閉じる" }).click();
  await page.evaluate(async () => {
    const app = await import("./js/ui/app.js?v=20260723-fa");
    app.setAppMode("normal");
    location.hash = "#/";
  });
  await page.waitForURL(/#\/$/);
  await page.evaluate(() => { location.hash = "#/problems"; });
  await page.waitForURL(/#\/problems$/);

  await page.locator(".problem-level-tabs").getByRole("button", { name: "やさしい", exact: true }).click();
  const block = page.locator("button.block-cell").first();
  await block.waitFor();
  await assertNoSeriousA11yViolations("Problems screen");
  await page.locator("#screen-problems").getByRole("button", { name: "番号へジャンプ" }).click();
  const jumpDialog = page.getByRole("dialog", { name: "番号へジャンプ" });
  await jumpDialog.getByRole("spinbutton", { name: "問題番号" }).waitFor();
  await assertNoSeriousA11yViolations("Jump-to-puzzle dialog");
  await jumpDialog.getByRole("button", { name: "キャンセル" }).click();
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
  assert.deepEqual(
    await page.locator(".analysis-terms li b").allTextContents(),
    ["期待情報量", "獲得情報量"],
    "Analysis term definitions should explain expected information before information gained"
  );
  assert.deepEqual(
    await page.locator(".turn-card").first().locator(".bar-label").allTextContents(),
    ["残り候補", "期待情報量", "獲得情報量"],
    "Turn bars should show expected information before information gained"
  );
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

  // EXTRA SHOT 中の戻る操作: 確認後に棄権し、元のゲームだけを通常クリアとして記録する
  {
    const pid = 321;
    const logic = new Logic(pid);
    const startTime = 1_800_000_000;
    const forfeitPage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    await forfeitPage.addInitScript(
      ({ unlockedAchievements, puzzleId, startedAt }) => {
        localStorage.setItem("dwordle2.settings", JSON.stringify({
          theme: "cyber",
          sfx: false,
          bgm: false,
          language: "ja",
          keyboardHints: true,
          reduceFx: true,
          extraShot: true,
        }));
        localStorage.setItem("dwordle2.mode", JSON.stringify("normal"));
        localStorage.setItem("dwordle2.current.normal", JSON.stringify({
          version: "2.0.0",
          startTime: startedAt,
          gameMode: "normal",
          problemID: puzzleId,
          guessWord: [],
          usoResults: [],
        }));
        localStorage.setItem("dwordle2.history", "[]");
        localStorage.setItem("dwordle2.achievements", JSON.stringify(unlockedAchievements));
        localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
        localStorage.setItem("dwordle2.legacyImportPrompted", "true");
        localStorage.setItem("dwordle2.tutorialSeen", "true");
        localStorage.setItem("dwordle2.playCount", "99");
        localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
        localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      },
      { unlockedAchievements: unlocked, puzzleId: pid, startedAt: startTime }
    );
    await forfeitPage.goto(`${baseUrl}#/game`, { waitUntil: "networkidle" });
    await passGate(forfeitPage);
    await forfeitPage.locator("#screen-game.active .row").last().waitFor();
    await forfeitPage.keyboard.type(logic.ans1);
    await forfeitPage.keyboard.press("Enter");
    await forfeitPage.locator("#screen-game.active .fa-row").waitFor({ timeout: 8000 });

    await forfeitPage.getByRole("button", { name: "タイトルへ戻る" }).click();
    const forfeitDialog = forfeitPage.getByRole("dialog", { name: "EXTRA SHOTを棄権しますか？" });
    await forfeitDialog.getByText("棄権すると通常クリアとして履歴に記録されます。", { exact: false }).waitFor();
    await forfeitDialog.getByRole("button", { name: "キャンセル" }).click();
    await forfeitDialog.waitFor({ state: "detached" });
    assert.match(forfeitPage.url(), /#\/game$/, "Cancelling the forfeit should keep EXTRA SHOT open");
    assert.equal(await forfeitPage.locator("#screen-game.active .fa-row").count(), 1);

    await forfeitPage.getByRole("button", { name: "タイトルへ戻る" }).click();
    await forfeitPage.getByRole("dialog", { name: "EXTRA SHOTを棄権しますか？" })
      .getByRole("button", { name: "OK", exact: true })
      .click();
    await forfeitPage.waitForURL(/#\/$/);
    const forfeited = await forfeitPage.evaluate(() => {
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
    assert.deepEqual(forfeited, {
      historyLength: 1,
      clear: true,
      guesses: [logic.ans1],
      hasExtraShot: false,
      current: null,
      playCount: 100,
    }, "Forfeiting EXTRA SHOT should settle one ordinary clear");
    assert.equal(await forfeitPage.getByText("つづきから", { exact: true }).count(), 0);
    await forfeitPage.close();
  }

  // EXTRA SHOT 成功: 最後の 1 枚だけ溜め、結果・保存画像を通常盤面の下へ表示する
  {
    const pid = 322;
    const logic = new Logic(pid);
    const successPage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    await successPage.addInitScript(
      ({ unlockedAchievements, puzzleId }) => {
        localStorage.setItem("dwordle2.settings", JSON.stringify({
          theme: "cyber",
          sfx: false,
          bgm: false,
          language: "ja",
          keyboardHints: true,
          reduceFx: false,
          extraShot: true,
        }));
        localStorage.setItem("dwordle2.mode", JSON.stringify("normal"));
        localStorage.setItem("dwordle2.current.normal", JSON.stringify({
          version: "2.0.0",
          startTime: 1_800_000_100,
          gameMode: "normal",
          problemID: puzzleId,
          guessWord: [],
          usoResults: [],
        }));
        localStorage.setItem("dwordle2.history", "[]");
        localStorage.setItem("dwordle2.achievements", JSON.stringify(unlockedAchievements));
        localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
        localStorage.setItem("dwordle2.legacyImportPrompted", "true");
        localStorage.setItem("dwordle2.tutorialSeen", "true");
        localStorage.setItem("dwordle2.playCount", "99");
        localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
        localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      },
      { unlockedAchievements: unlocked, puzzleId: pid }
    );
    await successPage.goto(`${baseUrl}#/game`, { waitUntil: "networkidle" });
    await passGate(successPage);
    await successPage.locator("#screen-game.active .row").last().waitFor();
    await successPage.keyboard.type(logic.ans1);
    await successPage.keyboard.press("Enter");
    const finalRow = successPage.locator("#screen-game.active .fa-row");
    await finalRow.waitFor({ timeout: 8000 });
    const finalHeader = await successPage.locator("#screen-game .header").evaluate((header) => {
      const counter = header.querySelector(".fa-counter");
      const title = header.querySelector(".title");
      const counterStyle = getComputedStyle(counter);
      return {
        counterLines: [...counter.children].map((child) => child.textContent),
        counterWidth: counter.getBoundingClientRect().width,
        counterFontSize: Number.parseFloat(counterStyle.fontSize),
        counterAlign: counterStyle.textAlign,
        title: title.textContent,
        titleClipped: title.scrollWidth > title.clientWidth + 1,
      };
    });
    assert.deepEqual(finalHeader.counterLines, ["EXTRA", "SHOT"]);
    assert.ok(
      finalHeader.counterWidth <= 43 && finalHeader.counterFontSize <= 9 && finalHeader.counterAlign === "center",
      `EXTRA SHOT header label should stay compact and centered: ${JSON.stringify(finalHeader)}`
    );
    assert.equal(finalHeader.title, "DWORDle");
    assert.equal(finalHeader.titleClipped, false, "The compact EXTRA SHOT counter should leave the game title visible");
    await successPage.evaluate(() => {
      const tiles = [...document.querySelectorAll("#screen-game.active .fa-row .tile")];
      window.__extraShotRevealTimes = Array(tiles.length).fill(null);
      const startedAt = performance.now();
      tiles.forEach((tile, index) => {
        const observer = new MutationObserver(() => {
          if (window.__extraShotRevealTimes[index] !== null || !/state-/.test(tile.className)) return;
          window.__extraShotRevealTimes[index] = performance.now() - startedAt;
          observer.disconnect();
        });
        observer.observe(tile, { attributes: true, attributeFilter: ["class"] });
      });
    });
    await successPage.keyboard.type(logic.ans2);
    await successPage.keyboard.press("Enter");
    await successPage.locator("#screen-game.active .fa-row.fa-charging").waitFor();
    assert.equal(
      await successPage.locator("#screen-game.active #board-scroll").evaluate((board) => board.classList.contains("extra-shot-skippable")),
      false,
      "The first play of a puzzle must keep the full EXTRA SHOT reveal"
    );
    await successPage.waitForFunction(
      () => window.__extraShotRevealTimes?.every(Number.isFinite),
      null,
      { timeout: 10000 }
    );
    const revealTimes = await successPage.evaluate(() => window.__extraShotRevealTimes);
    const earlyGaps = revealTimes.slice(1, 4).map((time, index) => time - revealTimes[index]);
    const finalGap = revealTimes[4] - revealTimes[3];
    assert.equal(
      await successPage.evaluate(async () => (await import("./js/config.js?v=20260723-fa")).FX.extraShot.lastTilePauseMs),
      720,
      "The final tile pause should be twice the former 360ms pause"
    );
    assert.ok(
      finalGap >= Math.max(...earlyGaps) + 550,
      `The fifth EXTRA SHOT tile should open after an extra pause: ${JSON.stringify({ revealTimes, earlyGaps, finalGap })}`
    );

    await successPage.waitForURL(/#\/result\/normal\/\d+$/, { timeout: 12000 });
    await successPage.getByText("DOUBLE CLEAR!", { exact: true }).waitFor();
    const resultOrder = await successPage.locator("#screen-result .list-screen-body").evaluate((body) => {
      const grid = body.querySelector(".result-grid");
      const finalCard = body.querySelector(".fa-result");
      return [...body.children].indexOf(grid) < [...body.children].indexOf(finalCard);
    });
    assert.equal(resultOrder, true, "EXTRA SHOT should appear below the ordinary Guess grid");
    const crown = successPage.locator(".answer-row .fa-crown");
    assert.equal(await crown.count(), 1);
    assert.equal(await crown.evaluate((node) => node.tagName), "CANVAS");
    assert.equal(await crown.getAttribute("data-crown-points"), "16");
    assert.equal(await crown.getAttribute("data-crown-verticals"), "8");
    assert.equal(await successPage.locator(".answer-row .fa-star").count(), 0, "The old EXTRA SHOT star should be removed");
    const crownGeometry = await successPage.evaluate(async () => {
      const { CROWN_POINT_COUNT, CROWN_VALLEY_COUNT, crownPoints } = await import("./js/ui/crown.js?v=20260723-fa");
      const points = crownPoints(0, 0, 0, 40);
      const gaps = points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        return (next.angle - point.angle + Math.PI * 2) % (Math.PI * 2);
      });
      return {
        count: CROWN_POINT_COUNT,
        verticalCount: CROWN_VALLEY_COUNT,
        gapSpread: Math.max(...gaps) - Math.min(...gaps),
        rimYCount: new Set(points.map((point) => point.rimY.toFixed(3))).size,
        spikeHeightCount: new Set(points.map((point) => (point.rimY - point.topY).toFixed(3))).size,
      };
    });
    assert.equal(crownGeometry.count, 16);
    assert.equal(crownGeometry.verticalCount, 8, "Only the eight crown valleys should have vertical lines");
    assert.ok(crownGeometry.gapSpread < 1e-10, "Crown points should be equally spaced by phase");
    assert.ok(crownGeometry.rimYCount >= 5, "Crown points should occupy different y positions on an ellipse");
    assert.equal(crownGeometry.spikeHeightCount, 2, "Crown points should alternate between two zigzag heights");
    await successPage.waitForTimeout(80);
    const crownFrameOne = await crown.evaluate((node) => node.toDataURL());
    await successPage.waitForTimeout(180);
    const crownFrameTwo = await crown.evaluate((node) => node.toDataURL());
    assert.notEqual(crownFrameOne, crownFrameTwo, "The 3D crown should rotate on the result screen");
    const markerCenters = await successPage.locator(".answers-grid").evaluate((answers) => {
      const flagPole = answers.querySelector(".guess-flag-pole").getBoundingClientRect();
      const crownCanvas = answers.querySelector(".fa-crown").getBoundingClientRect();
      const answerTiles = answers.querySelectorAll(".answer-row:first-child .rcell");
      const lastTile = answerTiles[answerTiles.length - 1].getBoundingClientRect();
      return {
        flagPole: flagPole.x + flagPole.width / 2,
        crown: crownCanvas.x + crownCanvas.width / 2,
        crownMargin: crownCanvas.x + crownCanvas.width / 2 - lastTile.right,
      };
    });
    assert.ok(
      Math.abs(markerCenters.flagPole - markerCenters.crown) <= 0.5,
      `The flag pole and crown should share the same x center: ${JSON.stringify(markerCenters)}`
    );
    assert.ok(
      markerCenters.crownMargin >= 24,
      `Result markers should leave a clear margin to the right of the tiles: ${JSON.stringify(markerCenters)}`
    );
    const doubleTitleStyle = await successPage.locator(".result-title.double").evaluate((node) => {
      const style = getComputedStyle(node);
      const keyframes = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find((rule) => rule.type === CSSRule.KEYFRAMES_RULE && rule.name === "faTitleShine");
      return {
        background: style.backgroundImage,
        backgroundSize: style.backgroundSize,
        animation: style.animationName,
        duration: style.animationDuration,
        timing: style.animationTimingFunction,
        keyframePositions: [...keyframes.cssRules].map((rule) => `${rule.keyText}:${rule.style.backgroundPosition}`),
      };
    });
    assert.match(doubleTitleStyle.background, /^linear-gradient/);
    assert.doesNotMatch(doubleTitleStyle.background, /repeating-linear-gradient/);
    assert.equal(doubleTitleStyle.backgroundSize, "220% 100%");
    assert.equal(doubleTitleStyle.animation, "faTitleShine");
    assert.equal(doubleTitleStyle.duration, "18s");
    assert.equal(doubleTitleStyle.timing, "linear");
    assert.deepEqual(
      doubleTitleStyle.keyframePositions,
      ["0%:150% 0px", "100%:-750% 0px"],
      "DOUBLE CLEAR shine should keep its original speed while travelling far beyond the title"
    );

    const snapshotExtraShot = await successPage.evaluate(async () => {
      const history = JSON.parse(localStorage.getItem("dwordle2.history") || "[]");
      const record = history[0];
      const { Logic } = await import("./js/core/logic.js");
      const { renderResultCanvas } = await import("./js/ui/snapshot.js?v=20260723-fa");
      const settings = await import("./js/core/settings.js?v=20260723-fa");
      const gameLogic = new Logic(record.problemID);
      const displayRows = record.guessWord.map((word) => gameLogic.queryWord(word));
      const textCalls = [];
      const originalFillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
        textCalls.push({ text: String(text), x, y, fillStyle: this.fillStyle });
        return originalFillText.call(this, text, x, y, ...args);
      };
      try {
        const measureOrder = (calls, classic = false) => {
          const answerIndex = calls.findIndex((call) => classic ? call.text.startsWith("Answer:") : call.text === "Word 1");
          const finalIndex = calls.findIndex((call) => call.text === "EXTRA SHOT");
          const guessIndex = classic
            ? answerIndex + 1
            : calls.findIndex((call, index) => index > calls.findIndex((item) => item.text === "Word 2") + 5 && call.text.length === 1);
          return {
            answerY: calls[answerIndex]?.y,
            guessY: calls[guessIndex]?.y,
            finalY: calls[finalIndex]?.y,
          };
        };

        const canvas = renderResultCanvas(record, gameLogic, displayRows);
        const cyberCalls = [...textCalls];
        const withoutFinal = { ...record };
        delete withoutFinal.extraShot;
        textCalls.length = 0;
        const ordinaryCanvas = renderResultCanvas(withoutFinal, gameLogic, displayRows);
        const pixels = canvas.getContext("2d").getImageData(500 * 2, 275 * 2, 70 * 2, 75 * 2).data;
        let goldCrownPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 230 && pixels[i + 1] > 170 && pixels[i + 1] < 240 && pixels[i + 2] < 150) {
            goldCrownPixels++;
          }
        }
        textCalls.length = 0;
        settings.setSetting("theme", "classic");
        const classicCanvas = renderResultCanvas(record, gameLogic, displayRows);
        const classicCalls = [...textCalls];
        textCalls.length = 0;
        const classicOrdinaryCanvas = renderResultCanvas(withoutFinal, gameLogic, displayRows);

        textCalls.length = 0;
        settings.setSetting("theme", "pop");
        renderResultCanvas(record, gameLogic, displayRows);
        const popDoubleClear = textCalls.find((call) => call.text === "DOUBLE CLEAR!");
        const popExtraShot = textCalls.find((call) => call.text === "EXTRA SHOT");
        settings.setSetting("theme", "cyber");
        return {
          cyberHeight: canvas.height,
          ordinaryHeight: ordinaryCanvas.height,
          classicHeight: classicCanvas.height,
          classicOrdinaryHeight: classicOrdinaryCanvas.height,
          cyberOrder: measureOrder(cyberCalls),
          classicOrder: measureOrder(classicCalls, true),
          popDoubleClearColor: popDoubleClear?.fillStyle,
          popExtraShotColor: popExtraShot?.fillStyle,
          goldCrownPixels,
          savedResult: record.extraShot?.result,
        };
      } finally {
        CanvasRenderingContext2D.prototype.fillText = originalFillText;
      }
    });
    assert.ok(
      snapshotExtraShot.cyberHeight > snapshotExtraShot.ordinaryHeight
        && snapshotExtraShot.classicHeight > snapshotExtraShot.classicOrdinaryHeight,
      `EXTRA SHOT should extend saved images: ${JSON.stringify(snapshotExtraShot)}`
    );
    assert.ok(
      snapshotExtraShot.cyberOrder.answerY < snapshotExtraShot.cyberOrder.guessY
        && snapshotExtraShot.cyberOrder.guessY < snapshotExtraShot.cyberOrder.finalY,
      `Cyber saved image should order Answer, Guess history, EXTRA SHOT: ${JSON.stringify(snapshotExtraShot.cyberOrder)}`
    );
    assert.ok(
      snapshotExtraShot.classicOrder.answerY < snapshotExtraShot.classicOrder.guessY
        && snapshotExtraShot.classicOrder.guessY < snapshotExtraShot.classicOrder.finalY,
      `Classic saved image should order Answer, Guess history, EXTRA SHOT: ${JSON.stringify(snapshotExtraShot.classicOrder)}`
    );
    assert.equal(snapshotExtraShot.popDoubleClearColor, "#713600");
    assert.equal(snapshotExtraShot.popExtraShotColor, "#713600");
    assert.deepEqual(snapshotExtraShot.savedResult, Array(5).fill("correct"), "EXTRA SHOT feedback should be saved with the record");
    assert.ok(snapshotExtraShot.goldCrownPixels > 20, "The saved image should draw a gold crown for the other answer");
    await successPage.evaluate(async () => {
      (await import("./js/ui/toast.js?v=20260723-fa")).extraShotUnlockCelebration();
    });
    const finalUnlockDialog = successPage.getByRole("dialog", { name: "EXTRA SHOT" });
    await finalUnlockDialog.waitFor();
    const finalUnlockCopy = await finalUnlockDialog.textContent();
    assert.doesNotMatch(finalUnlockCopy, /[ー―]{2}/, "EXTRA SHOT unlock copy should not use a double dash");
    await finalUnlockDialog.getByRole("button", { name: "あとで" }).click();
    await successPage.evaluate(() => { location.hash = "#/problems"; });
    await successPage.waitForURL(/#\/problems$/);
    await successPage.locator(".problem-level-tabs").getByRole("button", { name: "やさしい", exact: true }).click();
    await successPage.getByRole("button", { name: /問題 301 から 400/ }).click();
    const doubleClearCell = successPage.getByRole("button", { name: "問題 322、DOUBLE CLEAR済み" });
    await doubleClearCell.waitFor();
    assert.equal(await doubleClearCell.evaluate((cell) => cell.classList.contains("double-clear")), true);
    const doubleClearCellStyle = await doubleClearCell.evaluate((cell) => {
      const style = getComputedStyle(cell);
      return { background: style.backgroundImage, border: style.borderColor };
    });
    assert.match(doubleClearCellStyle.background, /linear-gradient/);
    assert.notEqual(doubleClearCellStyle.border, "rgb(106, 170, 100)", "DOUBLE CLEAR should not use the ordinary clear color");
    await successPage.close();
  }

  // 2 周目以降は判定演出をタップでスキップ可能。両回答を参照して全緑でも、
  // もう一方の答えそのものではない場合は専用メッセージを表示する。
  {
    const pid = 1; // point / touch に対して pouch が「答えではない全緑」になる
    const logic = new Logic(pid);
    assert.deepEqual([logic.ans1, logic.ans2], ["point", "touch"]);
    assert.deepEqual(logic.queryWord("pouch"), Array(5).fill("correct"));
    const repeatPage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    await repeatPage.addInitScript(
      ({ puzzleId, answer, priorAnswer }) => {
        localStorage.setItem("dwordle2.settings", JSON.stringify({
          theme: "classic",
          sfx: false,
          bgm: false,
          language: "ja",
          keyboardHints: true,
          reduceFx: false,
          extraShot: true,
        }));
        localStorage.setItem("dwordle2.mode", JSON.stringify("normal"));
        localStorage.setItem("dwordle2.current.normal", JSON.stringify({
          version: "2.0.0",
          startTime: 1_800_000_200,
          gameMode: "normal",
          problemID: puzzleId,
          guessWord: [],
          usoResults: [],
        }));
        localStorage.setItem("dwordle2.history", JSON.stringify([{
          version: "2.0.0",
          startTime: 1_799_999_000,
          endTime: 1_799_999_060,
          gameMode: "normal",
          problemID: puzzleId,
          guessWord: [priorAnswer],
          clear: true,
        }]));
        localStorage.setItem("dwordle2.achievements", "{}");
        localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
        localStorage.setItem("dwordle2.legacyImportPrompted", "true");
        localStorage.setItem("dwordle2.tutorialSeen", "true");
        localStorage.setItem("dwordle2.playCount", "99");
        localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
        localStorage.setItem("dwordle2.menuUnlockSeen", "99");
        localStorage.setItem("dwordle2.__smokeAnswer", answer);
      },
      { puzzleId: pid, answer: logic.ans1, priorAnswer: logic.ans2 }
    );
    await repeatPage.goto(`${baseUrl}#/game`, { waitUntil: "networkidle" });
    await passGate(repeatPage);
    await repeatPage.locator("#screen-game.active .row").last().waitFor();
    await repeatPage.keyboard.type(logic.ans1);
    await repeatPage.keyboard.press("Enter");
    const repeatExtraRow = repeatPage.locator("#screen-game.active .fa-row");
    await repeatExtraRow.waitFor({ timeout: 8000 });
    await repeatPage.keyboard.type("pouch");
    await repeatPage.keyboard.press("Enter");
    await repeatExtraRow.locator(".tile").first().waitFor();
    await repeatPage.locator("#screen-game.active #board-scroll.extra-shot-skippable .fa-row.fa-charging").waitFor();
    assert.equal(
      await repeatPage.getByText("タップで判定をスキップ", { exact: true }).count(),
      0,
      "The board should not show explanatory skip text"
    );
    const skipStartedAt = Date.now();
    // EXTRA SHOT 行ではなく通常盤面をタップしても、盤面領域全体のスキップが働く。
    await repeatPage.locator("#screen-game.active #board .row").first().click();
    await repeatPage.waitForFunction(
      () => document.querySelectorAll("#screen-game.active .fa-row .tile.state-correct").length === 5,
      null,
      { timeout: 1000 }
    );
    assert.ok(Date.now() - skipStartedAt < 800, "A repeat-play tap should skip the EXTRA SHOT reveal immediately");
    await repeatPage.waitForURL(/#\/result\/normal\/\d+$/, { timeout: 8000 });
    await repeatPage.getByText("全部緑。でも、もう一つの答えそのものではなかった！", { exact: true }).waitFor();
    const savedMiss = await repeatPage.evaluate(() => {
      const history = JSON.parse(localStorage.getItem("dwordle2.history") || "[]");
      return history.at(-1)?.extraShot;
    });
    assert.deepEqual(savedMiss, { word: "pouch", success: false, result: Array(5).fill("correct") });
    await repeatPage.close();
  }

  // DWORDlie の EXTRA SHOT も通常判定と同じく両回答を参照し、表示する全マスで嘘を貫く。
  // 先頭 4 枚が緑ではないので、5 枚目直前の追加のタメは入れない。
  {
    const pid = 323;
    const logic = new Logic(pid);
    const usoPage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    await usoPage.addInitScript(({ puzzleId }) => {
      localStorage.setItem("dwordle2.settings", JSON.stringify({
        theme: "classic",
        sfx: false,
        bgm: false,
        language: "ja",
        keyboardHints: true,
        reduceFx: false,
        extraShot: true,
      }));
      localStorage.setItem("dwordle2.mode", JSON.stringify("uso"));
      localStorage.setItem("dwordle2.current.uso", JSON.stringify({
        version: "2.0.0",
        startTime: 1_800_000_300,
        gameMode: "uso",
        problemID: puzzleId,
        guessWord: [],
        usoResults: [],
      }));
      localStorage.setItem("dwordle2.history", "[]");
      localStorage.setItem("dwordle2.achievements", "{}");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
      localStorage.setItem("dwordle2.legacyImportPrompted", "true");
      localStorage.setItem("dwordle2.tutorialSeen", "true");
      localStorage.setItem("dwordle2.tutorialSeenUso", "true");
      localStorage.setItem("dwordle2.playCount", "99");
      localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
      localStorage.setItem("dwordle2.menuUnlockSeen", "99");
    }, { puzzleId: pid });
    await usoPage.goto(`${baseUrl}#/game`, { waitUntil: "networkidle" });
    await passGate(usoPage);
    await usoPage.locator("#screen-game.active .row").last().waitFor();
    await usoPage.keyboard.type(logic.ans1);
    await usoPage.keyboard.press("Enter");
    await usoPage.locator("#screen-game.active .fa-row").waitFor({ timeout: 8000 });
    await usoPage.evaluate(() => {
      const tiles = [...document.querySelectorAll("#screen-game.active .fa-row .tile")];
      window.__usoExtraShotRevealTimes = Array(tiles.length).fill(null);
      const startedAt = performance.now();
      tiles.forEach((tile, index) => {
        const observer = new MutationObserver(() => {
          if (window.__usoExtraShotRevealTimes[index] !== null || !/state-/.test(tile.className)) return;
          window.__usoExtraShotRevealTimes[index] = performance.now() - startedAt;
          observer.disconnect();
        });
        observer.observe(tile, { attributes: true, attributeFilter: ["class"] });
      });
    });
    await usoPage.keyboard.type(logic.ans2);
    await usoPage.keyboard.press("Enter");
    await usoPage.waitForFunction(
      () => window.__usoExtraShotRevealTimes?.every(Number.isFinite),
      null,
      { timeout: 10000 }
    );
    const usoRevealTimes = await usoPage.evaluate(() => window.__usoExtraShotRevealTimes);
    const usoEarlyGaps = usoRevealTimes.slice(1, 4).map((time, index) => time - usoRevealTimes[index]);
    const usoFinalGap = usoRevealTimes[4] - usoRevealTimes[3];
    assert.ok(
      usoFinalGap <= Math.max(...usoEarlyGaps) + 250,
      `The fifth EXTRA SHOT tile should not pause unless the first four are correct: ${JSON.stringify({
        revealTimes: usoRevealTimes,
        earlyGaps: usoEarlyGaps,
        finalGap: usoFinalGap,
      })}`
    );
    await usoPage.waitForURL(/#\/result\/uso\/\d+$/, { timeout: 10000 });
    const usoExtra = await usoPage.evaluate(() => {
      const record = JSON.parse(localStorage.getItem("dwordle2.history") || "[]")[0];
      return {
        attempt: record.extraShot,
        tileStates: [...document.querySelectorAll("#screen-result .fa-result .rcell")].map((tile) =>
          [...tile.classList].find((name) => ["unused", "used", "correct"].includes(name))
        ),
      };
    });
    assert.equal(usoExtra.attempt.success, true);
    assert.ok(
      usoExtra.attempt.result.every((state) => state !== "correct"),
      `Every DWORDlie EXTRA SHOT tile should lie about the all-correct true result: ${JSON.stringify(usoExtra)}`
    );
    assert.deepEqual(usoExtra.tileStates, usoExtra.attempt.result, "The result screen should replay the saved lies exactly");
    await usoPage.close();
  }

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
    localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
    (await import("./js/fx/effects.js?v=20260723-fa")).activeTileFlightCount()
  );
  assert.ok(flightsBeforeLeave > 0, "Tile gather animation should be active before leaving the game");
  await shortPage.getByRole("button", { name: "タイトルへ戻る" }).click();
  await shortPage.waitForURL(/#\/$/);
  const flightsAfterLeave = await shortPage.evaluate(async () =>
    (await import("./js/fx/effects.js?v=20260723-fa")).activeTileFlightCount()
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
    localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
    localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
    (await import("./js/fx/effects.js?v=20260723-fa")).activeTileFlightCount()
  );
  assert.equal(reducedFlights, 0, "Reduced motion should suppress tile gather flights");
  await reducedContext.close();

  await page.evaluate(async () => {
    const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260723-fa");
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
    const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260723-fa");
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
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260723-fa");
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
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260723-fa");
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
    const { achievementCelebration } = await import("./js/ui/toast.js?v=20260723-fa");
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
  await page.getByRole("tab", { name: "データ" }).click();
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
    const { setSetting } = await import("./js/core/settings.js?v=20260723-fa");
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
      await freshPage.getByRole("dialog", { name: "ランダム（難しさを選択）" }).count(),
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
    await freshPage.getByRole("tab", { name: "サウンド" }).click();
    assert.equal(await freshPage.getByRole("radio", { name: "Grand Finale" }).getAttribute("aria-disabled"), "true");
    await freshPage.getByRole("tab", { name: "表示" }).click();

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
    await debugPop.click();
    await freshPage.getByRole("tab", { name: "サウンド" }).click();
    assert.equal(await freshPage.getByRole("radio", { name: "Grand Finale" }).getAttribute("aria-disabled"), "false", "debug mode should unlock hidden BGM");
    await freshPage.getByRole("radio", { name: "Grand Finale" }).click();
    await freshPage.getByRole("tab", { name: "表示" }).click();
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
  const cardContext = await browser.newContext({
    viewport: { width: 393, height: 786 },
    locale: "ja-JP",
    userAgent: "Mozilla/5.0 (Linux; Android 12; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
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
      const { setSetting } = await import("./js/core/settings.js?v=20260723-fa");
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
    const androidCardEffects = await cardPage.locator(".player-card-wrap").evaluate((wrap) => {
      const wrapStyle = getComputedStyle(wrap);
      const shineStyle = getComputedStyle(wrap, "::after");
      const tiltStyle = getComputedStyle(wrap.parentElement);
      return {
        classes: [...wrap.classList],
        wrapAnimations: wrapStyle.animationName.split(",").map((name) => name.trim()),
        shineAnimation: shineStyle.animationName,
        shineLayer: shineStyle.zIndex,
        tiltTouchAction: tiltStyle.touchAction,
        tiltWillChange: tiltStyle.willChange,
      };
    });
    assert.ok(androidCardEffects.classes.includes("motion") && androidCardEffects.classes.includes("deal"));
    assert.ok(androidCardEffects.wrapAnimations.includes("playerCardDeal"));
    assert.ok(androidCardEffects.wrapAnimations.includes("playerCardFloat"));
    assert.equal(androidCardEffects.shineAnimation, "playerCardShine");
    assert.equal(androidCardEffects.shineLayer, "1");
    assert.equal(androidCardEffects.tiltTouchAction, "none");
    assert.equal(androidCardEffects.tiltWillChange, "transform");
    const cardLayoutAtOneX = await cardPage.locator(".player-card-stage").evaluate((stage) => {
      const canvas = stage.querySelector(".player-card-canvas");
      return {
        stageWidth: stage.offsetWidth,
        stageHeight: stage.offsetHeight,
        cardWidth: canvas.offsetWidth,
        cardHeight: canvas.offsetHeight,
      };
    });

    // Pixel 3 / Chrome 相当の実タッチで、触れた瞬間から tilt が反映される。
    const tiltBox = await cardPage.locator(".player-card-tilt").boundingBox();
    const cdp = await cardContext.newCDPSession(cardPage);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: tiltBox.x + tiltBox.width * 0.8, y: tiltBox.y + tiltBox.height * 0.25 }],
    });
    await cardPage.waitForTimeout(60);
    const activeTouchTilt = await cardPage.locator(".player-card-tilt").evaluate((tilt) => ({
      active: tilt.classList.contains("tilting"),
      transform: getComputedStyle(tilt).transform,
    }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(activeTouchTilt.active, true);
    assert.notEqual(activeTouchTilt.transform, "none", "Android touch should visibly tilt the player card");

    // モード切替ボタンは置かず、ダブルタップで拡大へ入り、ピンチで連続倍率を変える。
    assert.equal(await cardPage.getByRole("button", { name: "拡大", exact: true }).count(), 0);
    await cardPage.waitForTimeout(360);
    const tapX = tiltBox.x + tiltBox.width * 0.55;
    const tapY = tiltBox.y + tiltBox.height * 0.5;
    for (let i = 0; i < 2; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: tapX, y: tapY }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cardPage.waitForTimeout(70);
    }
    const zoomBeforePinch = await cardPage.locator(".player-card-stage.is-zoomed").evaluate((stage) => {
      const tilt = stage.querySelector(".player-card-tilt");
      return {
        scale: new DOMMatrix(getComputedStyle(tilt).transform).a,
        wrapAnimation: getComputedStyle(stage.querySelector(".player-card-wrap")).animationName,
      };
    });
    assert.ok(
      zoomBeforePinch.scale > 2.8 && zoomBeforePinch.scale < 3.2,
      `Double-tap should zoom the card to 3x: ${JSON.stringify(zoomBeforePinch)}`
    );
    assert.equal(zoomBeforePinch.wrapAnimation, "none", "Zoom should keep the enlarged card still for reading");

    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 0, x: tapX - 28, y: tapY },
        { id: 1, x: tapX + 28, y: tapY },
      ],
    });
    const activePinchTransition = await cardPage.locator(".player-card-tilt").evaluate(
      (tilt) => getComputedStyle(tilt).transitionDuration
    );
    assert.equal(activePinchTransition, "0s", "active pinch gestures should not use lagging CSS interpolation");
    await cardPage.evaluate(() => {
      const tilt = document.querySelector(".player-card-tilt");
      window.__pinchStyleMutationCount = 0;
      window.__pinchStyleObserver = new MutationObserver((records) => {
        window.__pinchStyleMutationCount += records.length;
      });
      window.__pinchStyleObserver.observe(tilt, { attributes: true, attributeFilter: ["style"] });
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 0, x: tapX - 58, y: tapY },
        { id: 1, x: tapX + 58, y: tapY },
      ],
    });
    await cardPage.waitForTimeout(80);
    const pinchFrameResult = await cardPage.locator(".player-card-tilt").evaluate((tilt) => {
      window.__pinchStyleObserver.disconnect();
      const result = {
        scale: new DOMMatrix(getComputedStyle(tilt).transform).a,
        styleMutations: window.__pinchStyleMutationCount,
      };
      delete window.__pinchStyleObserver;
      delete window.__pinchStyleMutationCount;
      return result;
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok(
      pinchFrameResult.scale > zoomBeforePinch.scale + 0.5,
      `Pinch should continuously increase the card scale: ${JSON.stringify({ zoomBeforePinch, pinchFrameResult })}`
    );
    assert.equal(
      pinchFrameResult.styleMutations,
      1,
      "two pointer updates in one frame should produce one transform write"
    );

    // 拡大中の再ダブルタップで等倍 Tilt に戻る。
    await cardPage.evaluate(() => {
      const stage = document.querySelector(".player-card-stage");
      const tilt = stage.querySelector(".player-card-tilt");
      window.__zoomResetFirstPaintScale = null;
      window.__zoomResetObserver = new MutationObserver(() => {
        if (stage.classList.contains("is-zoomed")) return;
        requestAnimationFrame(() => {
          window.__zoomResetFirstPaintScale = new DOMMatrix(getComputedStyle(tilt).transform).a;
          window.__zoomResetObserver.disconnect();
        });
      });
      window.__zoomResetObserver.observe(stage, { attributes: true, attributeFilter: ["class"] });
    });
    await cardPage.waitForTimeout(360);
    for (let i = 0; i < 2; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: tapX, y: tapY }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cardPage.waitForTimeout(70);
    }
    await cardPage.waitForFunction(() => Number.isFinite(window.__zoomResetFirstPaintScale));
    const zoomResetFirstPaintScale = await cardPage.evaluate(() => {
      const scale = window.__zoomResetFirstPaintScale;
      delete window.__zoomResetFirstPaintScale;
      delete window.__zoomResetObserver;
      return scale;
    });
    assert.ok(
      zoomResetFirstPaintScale > 0.99 && zoomResetFirstPaintScale < 1.01,
      `removing the zoom viewport must not expose an enlarged card for one frame: ${zoomResetFirstPaintScale}`
    );
    assert.equal(await cardPage.locator(".player-card-stage.is-zoomed").count(), 0);
    assert.equal(
      await cardPage.locator(".player-card-tilt").evaluate((tilt) => tilt.style.transform),
      "",
      "a second double-tap should return to the normal Tilt state"
    );
    const animationAfterZoomReset = await cardPage.locator(".player-card-wrap").evaluate((wrap) => ({
      deal: wrap.classList.contains("deal"),
      names: getComputedStyle(wrap).animationName.split(",").map((name) => name.trim()),
    }));
    assert.equal(animationAfterZoomReset.deal, false, "returning to 1x must not replay the card deal animation");
    assert.deepEqual(
      animationAfterZoomReset.names,
      ["playerCardFloat"],
      "returning to 1x should resume only the normal floating animation"
    );
    const cardLayoutAfterZoomReset = await cardPage.locator(".player-card-stage").evaluate((stage) => {
      const canvas = stage.querySelector(".player-card-canvas");
      return {
        stageWidth: stage.offsetWidth,
        stageHeight: stage.offsetHeight,
        cardWidth: canvas.offsetWidth,
        cardHeight: canvas.offsetHeight,
      };
    });
    assert.deepEqual(
      cardLayoutAfterZoomReset,
      cardLayoutAtOneX,
      "returning to 1x must preserve the exact card and stage layout size"
    );
    assert.equal(
      await cardPage.locator(".player-card-view-hint").count(),
      0,
      "the player-card screen should not show gesture instructions"
    );

    const playerCardTilt = cardPage.locator(".player-card-tilt");

    // スマホはダブルタップを経由しなくても、等倍から直接ピンチアウト／インできる。
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 0, x: tapX - 25, y: tapY },
        { id: 1, x: tapX + 25, y: tapY },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 0, x: tapX - 55, y: tapY },
        { id: 1, x: tapX + 55, y: tapY },
      ],
    });
    await cardPage.waitForTimeout(80);
    const directPinchScale = await playerCardTilt.evaluate(
      (tilt) => new DOMMatrix(getComputedStyle(tilt).transform).a
    );
    assert.ok(directPinchScale > 2, `Direct pinch-out should zoom from 1x: ${directPinchScale}`);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 0, x: tapX - 18, y: tapY },
        { id: 1, x: tapX + 18, y: tapY },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(
      await cardPage.locator(".player-card-stage.is-zoomed").count(),
      0,
      "pinching back to 1x should restore the normal Tilt state"
    );

    // PC のマウス操作でも、ダブルクリックで 3 倍 → ドラッグでパン → 再ダブルクリックで等倍。
    const playerCardStageBox = await cardPage.locator(".player-card-stage").boundingBox();
    const desktopCenter = {
      x: playerCardStageBox.x + playerCardStageBox.width / 2,
      y: playerCardStageBox.y + playerCardStageBox.height / 2,
    };
    await cardPage.mouse.dblclick(desktopCenter.x, desktopCenter.y);
    await cardPage.waitForTimeout(80);
    const desktopZoomStart = await playerCardTilt.evaluate((tilt) => {
      const matrix = new DOMMatrix(getComputedStyle(tilt).transform);
      return { scale: matrix.a, x: matrix.e, y: matrix.f };
    });
    assert.ok(
      desktopZoomStart.scale > 2.8 && desktopZoomStart.scale < 3.2,
      `Desktop double-click should zoom the card to 3x: ${JSON.stringify(desktopZoomStart)}`
    );
    await cardPage.mouse.move(desktopCenter.x, desktopCenter.y);
    await cardPage.mouse.down();
    await cardPage.mouse.move(desktopCenter.x + 42, desktopCenter.y + 24, { steps: 4 });
    await cardPage.mouse.up();
    const desktopZoomPanned = await playerCardTilt.evaluate((tilt) => {
      const matrix = new DOMMatrix(getComputedStyle(tilt).transform);
      return { x: matrix.e, y: matrix.f };
    });
    assert.ok(
      Math.abs(desktopZoomPanned.x - desktopZoomStart.x) > 10
        || Math.abs(desktopZoomPanned.y - desktopZoomStart.y) > 10,
      `Desktop drag should pan the zoomed card: ${JSON.stringify({ desktopZoomStart, desktopZoomPanned })}`
    );
    await cardPage.mouse.dblclick(desktopCenter.x, desktopCenter.y);
    await cardPage.waitForFunction(() => !document.querySelector(".player-card-stage")?.classList.contains("is-zoomed"));
    assert.equal(await cardPage.locator(".player-card-stage.is-zoomed").count(), 0);

    // Android の自動補完などで input が再発火して静かに再描画されても、
    // 常時の浮遊・きらめきは失われない。
    await cardPage.getByLabel("プレイヤー名").dispatchEvent("input");
    await cardPage.locator(".player-card-wrap.motion:not(.deal)").waitFor();
    const redrawnEffects = await cardPage.locator(".player-card-wrap.motion:not(.deal)").evaluate((wrap) => ({
      floatAnimation: getComputedStyle(wrap).animationName,
      shineAnimation: getComputedStyle(wrap, "::after").animationName,
    }));
    assert.equal(redrawnEffects.floatAnimation, "playerCardFloat");
    assert.equal(redrawnEffects.shineAnimation, "playerCardShine");
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
      const mod = await import("./js/ui/player-card.js?v=20260723-fa");
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
        import("./js/ui/player-card.js?v=20260723-fa"),
        import("./js/core/achievements.js?v=20260723-fa"),
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
      const mod = await import("./js/core/achievements.js?v=20260723-fa");
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
      const mod = await import("./js/ui/player-card.js?v=20260723-fa");
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
      localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
        const mod = await import("./js/core/activity.js?v=20260723-fa");
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
      localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
      localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
      localStorage.setItem("dwordle2.menuUnlockSeen", "99");
      localStorage.setItem("dwordle2.achievements.reconcileVersion", "99");
    });
    await mutedStartPage.goto(baseUrl, { waitUntil: "networkidle" });
    await mutedStartPage.getByText("このゲームは音が出ます", { exact: true }).waitFor();
    await mutedStartPage.locator("#entry-gate .entry-gate-muted").click();
    await mutedStartPage.locator("#entry-gate").waitFor({ state: "detached" });
    assert.deepEqual(
      await mutedStartPage.evaluate(async () => {
        const s = (await import("./js/core/settings.js?v=20260723-fa")).getSettings();
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
      localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
      localStorage.setItem("dwordle2.extraShotUnlockSeen", "true");
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
    await swPage.getByRole("tab", { name: "サウンド" }).click();
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
