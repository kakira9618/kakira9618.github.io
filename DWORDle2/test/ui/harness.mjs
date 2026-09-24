// UI スモークの共通土台: 静的サーバ・ブラウザ・シード済みページ・共通ヘルパ。
// 各シナリオ（test/ui/*.mjs）はここから必要なものだけを使う。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { BACKUP } from "../../js/config.js?v=20260806-a";

const require = createRequire(import.meta.url);
export const axePath = require.resolve("axe-core/axe.min.js");
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 既定はソースをそのまま配信する。DWORDLE2_SERVE_ROOT=dist を渡すと
// ビルド成果物（minify 済み）を配信して同じテストを通す（npm run test:dist）。
export const serveRoot = path.resolve(projectRoot, process.env.DWORDLE2_SERVE_ROOT || ".");

// 計測（GA4）は本番ドメインでしか有効にならない（js/core/analytics.js の PRODUCTION_HOSTS）
export const PRODUCTION_HOST = "kakira9618.github.io";
export const PHONE = { width: 390, height: 844 };
// 1 つの操作待ちの上限。Playwright 既定の 30 秒だと失敗時に待ちすぎる
export const ACTION_TIMEOUT = 10000;

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

export async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      const relativePath = decodeURIComponent(requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1));
      let filePath = path.resolve(serveRoot, relativePath);
      if (!filePath.startsWith(`${serveRoot}${path.sep}`) && filePath !== path.join(serveRoot, "index.html")) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function launchBrowser(options = {}) {
  return chromium.launch({ headless: true, ...options });
}

// バックアップの送り先。本番の BACKUP.endpoint が未設定でも検証できるよう、
// シナリオは useTestBackupEndpoint でテスト用の URL を差し込む。
export const TEST_BACKUP_ENDPOINT = "https://dwordle2-backup.test.invalid";
const isBackupUrl = (url) =>
  url.href.startsWith(TEST_BACKUP_ENDPOINT) || (BACKUP.endpoint !== "" && url.href.startsWith(BACKUP.endpoint));

export async function useTestBackupEndpoint(page) {
  await page.evaluate(async (endpoint) => {
    (await import("./js/config.js?v=20260806-a")).BACKUP.endpoint = endpoint;
  }, TEST_BACKUP_ENDPOINT);
}

// 「遊び慣れたプレイヤー」の既定シード。段階解放と初回案内をすべて済ませ、音は切ってある。
// 値は JSON で保存する（js/core/store.js の loadJSON と同じ形）。
export const VETERAN = {
  "dwordle2.settings": {
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
  },
  "dwordle2.legacyImportPrompted": true,
  "dwordle2.tutorialSeen": true,
  "dwordle2.tutorialSeenUso": true,
  "dwordle2.helpSeen": true,
  "dwordle2.helpSeenUso": true,
  "dwordle2.playCount": 99,
  "dwordle2.extraShotUnlockSeen": true,
  "dwordle2.menuUnlockSeen": 99,
  "dwordle2.achievements.reconcileVersion": 99,
  "dwordle2.exportReminder": { snoozedAt: 4102444800000 }, // 書き出しの促しは 2100 年まで出さない
  "dwordle2.persistRequested": true,
};

// 設定だけ差し替えたいときの補助（VETERAN の settings に上書き）
export function settings(overrides) {
  return { ...VETERAN["dwordle2.settings"], ...overrides };
}

// 進行中ゲームのシード（#/game を直接開いてその問題を遊ぶ）
export function currentGame(problemID, { mode = "normal", startTime = 1_800_000_000, guessWord = [] } = {}) {
  return { version: "2.0.0", startTime, gameMode: mode, problemID, guessWord, usoResults: [] };
}

function serializeStorage(seed) {
  return Object.fromEntries(
    Object.entries(seed)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, JSON.stringify(value)])
  );
}

// シード済みの新しいコンテキストとページを開く。
//   storage: localStorage の上書き（VETERAN に重ねる。null を渡したキーは書かない）
//   fresh:   true なら VETERAN を使わず storage だけを書く（初回起動の再現）
//   axe:     axe-core を注入する（既定 true）
//   それ以外は browser.newContext のオプション（viewport / locale / hasTouch など）
export async function openPage(browser, { storage = {}, fresh = false, axe = true, ...contextOptions } = {}) {
  const context = await browser.newContext({ viewport: PHONE, locale: "ja-JP", ...contextOptions });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  // シードは最初のロードだけ。リロードのたびに撒き直すと、アプリが保存した値
  //（既読フラグ・発行済みカードなど）が消えて「リロード後も残る」系の検証が嘘になる
  const seed = serializeStorage(fresh ? storage : { ...VETERAN, ...storage });
  await context.addInitScript((entries) => {
    if (sessionStorage.getItem("__uiSmokeSeeded")) return;
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    sessionStorage.setItem("__uiSmokeSeeded", "1");
  }, seed);
  if (axe) await context.addInitScript({ path: axePath });
  // リモートバックアップは外へ出さない（検証するシナリオは page.route で上書きする）
  await context.route(isBackupUrl, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"ok":true}' })
  );
  return { page, context, errors };
}

// エントリーゲート（扉絵）はすべてのロードで最初に表示される。「開始」で通過する
export async function passGate(page) {
  const start = page.locator("#entry-gate .entry-gate-start");
  await start.waitFor();
  await start.click();
  await page.locator("#entry-gate").waitFor({ state: "detached" });
}

// ページを開いて扉絵を通過する
export async function openApp(page, baseUrl, { hash = "", gate = true } = {}) {
  await page.goto(`${baseUrl}${hash}`, { waitUntil: "load" });
  if (gate) await passGate(page);
}

// ハッシュ遷移（同一ドキュメントなのでリロードも扉絵も起きない）
export async function goHash(page, hash) {
  await page.evaluate((target) => { location.hash = target; }, hash);
  await page.waitForURL(new RegExp(`${hash.replace(/[/$]/g, "\\$&")}$`));
}

export async function assertNoSeriousA11yViolations(page, stage) {
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ["violations"] }));
  const violations = result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  const details = violations
    .map((violation) => `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => `  ${node.target.join(" ")}: ${node.failureSummary}`).join("\n")}`)
    .join("\n");
  assert.equal(violations.length, 0, `${stage} has serious accessibility violations:\n${details}`);
}

// テーマ切替直後は transition で数フレーム旧テーマの文字色が残る。axe が過渡状態を拾わないよう、
// 要素の文字色が 150ms 変わらなくなるまで待つ
export async function waitForColorSettle(page, selector) {
  await page.waitForFunction((target) => {
    const color = getComputedStyle(document.querySelector(target)).color;
    const now = performance.now();
    const prev = window.__colorSettle;
    const since = prev?.color === color ? prev.since : now;
    window.__colorSettle = { color, since };
    return now - since >= 150;
  }, selector, { polling: 50 });
  await page.evaluate(() => { delete window.__colorSettle; });
}

// 解放カードの初期フォーカスは表示直後の requestAnimationFrame で入るので、移るまで待つ
export async function waitForDialogFocus(page, selector) {
  await page
    .waitForFunction((target) => document.querySelector(target)?.contains(document.activeElement) === true, selector, { timeout: 2000 })
    .catch(() => {});
}

// 番号指定ダイアログから問題を始める
export async function startPuzzle(page, number) {
  await page.getByRole("button", { name: "番号を指定" }).click();
  const dialog = page.getByRole("dialog", { name: "番号を指定してプレイ" });
  await dialog.getByRole("spinbutton", { name: "問題番号" }).fill(String(number));
  await dialog.getByRole("button", { name: "スタート" }).click();
  await page.waitForURL(/#\/game$/);
  await page.locator("#screen-game.active .row").last().waitFor();
}

export async function typeGuess(page, word) {
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}

export function toast(page, text) {
  return page.locator("#toast-layer .toast").filter({ hasText: text });
}
