// Service Worker の更新フローを実ブラウザで検証する E2E スクリプト。
// GitHub Pages 相当（Cache-Control: max-age=600）の静的サーバでサイトの一時コピーを配信し、
// 「初回訪問 → デプロイ（ソース変更 + make-source-hash）→ 再訪問」を再現して、
//   1) 新しい事前キャッシュに HTTP キャッシュ経由の旧ファイルが混入しないこと
//   2) 扉絵の表示中に更新が届いたら自動リロードでそのまま最新版になること
//   3) プレイ開始後に更新が届いたらリロードせずトーストで知らせること
// を確認する。使い方: node tools/verify-sw-update.mjs（npm test とは独立の手動検証）
import { spawnSync } from "node:child_process";
import http from "node:http";
import { appendFile, cp, mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8963;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

// GitHub Pages と同じく max-age=600 + Last-Modified 再検証で配信する（毎回ディスクから読む）
function serve(siteRoot) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        if (pathname.endsWith("/")) pathname += "index.html";
        const file = path.join(siteRoot, pathname);
        const info = await stat(file);
        const lastModified = info.mtime.toUTCString();
        const headers = { "Cache-Control": "public, max-age=600", "Last-Modified": lastModified };
        if (req.headers["if-modified-since"] === lastModified) {
          res.writeHead(304, headers);
          res.end();
          return;
        }
        res.writeHead(200, {
          ...headers,
          "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        });
        res.end(await readFile(file));
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function readSourceHash(siteRoot) {
  const source = await readFile(path.join(siteRoot, "js", "version.js"), "utf8");
  return source.match(/SOURCE_HASH = "([0-9a-f]+)"/)[1];
}

// ページ内から見えている js/version.js のハッシュ。リロード直後は実行コンテキストが
// 破棄されて evaluate が失敗するので、その間は null を返して呼び出し側で再試行する。
async function pageSourceHash(page) {
  try {
    const text = await page.evaluate(() => fetch("js/version.js").then((res) => res.text()));
    return text.match(/SOURCE_HASH = "([0-9a-f]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // sw.js が全資産を素の URL で取るため、サイト一式を一時ディレクトリへコピーして配信する
  const siteRoot = await mkdtemp(path.join(os.tmpdir(), "dwordle2-sw-verify-"));
  for (const entry of ["index.html", "manifest.webmanifest", "favicon.png", "sw.js", "css", "js", "vendor", "tools"]) {
    await cp(path.join(root, entry), path.join(siteRoot, entry), { recursive: true });
  }
  const server = await serve(siteRoot);
  const browser = await chromium.launch();
  const failures = [];
  try {
    const page = await browser.newPage();
    const baseUrl = `http://127.0.0.1:${PORT}/?sw=1`; // localhost は ?sw=1 のときだけ SW を登録する

    // 初回訪問: SW が install（事前キャッシュ）を終えるまで待つ
    const oldHash = await readSourceHash(siteRoot);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => navigator.serviceWorker.ready);
    console.log(`初回訪問: v=${oldHash} を事前キャッシュ済み`);

    // デプロイを再現: ソースを変更してハッシュ類を再生成する。
    // Last-Modified は秒単位なので、同一秒の更新が 304 に化けないよう 1 秒あける。
    await wait(1100);
    await appendFile(path.join(siteRoot, "js", "config.js"), `\n// deploy marker ${Date.now()}\n`);
    const regen = spawnSync("node", [path.join("tools", "make-source-hash.mjs")], { cwd: siteRoot });
    if (regen.status !== 0) throw new Error(`make-source-hash に失敗: ${regen.stderr}`);
    const newHash = await readSourceHash(siteRoot);
    console.log(`デプロイ再現: v=${newHash} を配信開始`);

    // 再訪問: ページ自体は旧キャッシュから即表示されるが、裏で新 SW が入り、
    // 扉絵の間に自動リロードして最新版へ切り替わるはず
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => { window.__beforeAutoReload = true; }).catch(() => {});
    const deadline = Date.now() + 20000;
    let reloaded = false;
    let visibleHash = null;
    while (Date.now() < deadline) {
      reloaded = !(await page.evaluate(() => Boolean(window.__beforeAutoReload)).catch(() => true));
      visibleHash = await pageSourceHash(page);
      if (reloaded && visibleHash === newHash) break;
      await wait(400);
    }
    const swState = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        installing: Boolean(registration?.installing),
        waiting: Boolean(registration?.waiting),
        active: registration?.active?.state ?? null,
        cacheKeys: await caches.keys(),
      };
    }).catch((error) => ({ error: String(error) }));
    console.log(`SW 状態: ${JSON.stringify(swState)}`);

    if (!reloaded) {
      failures.push("再訪問しても自動リロードが起きない（更新がユーザー操作なしで反映されない）");
    }
    if (visibleHash !== newHash) {
      failures.push(`ページから見える版が古いまま: ${visibleHash}（期待: ${newHash}）`);
    }

    // 新キャッシュの中身がデプロイ後の内容か（HTTP キャッシュの旧ファイル混入がないか）
    const cachedHash = await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const res = await cache.match("js/version.js");
      const text = res ? await res.text() : "";
      return text.match(/SOURCE_HASH = "([0-9a-f]+)"/)?.[1] ?? null;
    }, `dwordle2-${newHash}`);
    if (cachedHash !== newHash) {
      failures.push(`新キャッシュ dwordle2-${newHash} に旧内容が混入: 中身は v=${cachedHash}`);
    }

    if (failures.length === 0) {
      console.log(`扉絵中の更新: OK（自動リロードで v=${newHash} に更新・キャッシュ混入なし）`);
    }

    // プレイ開始後（扉絵を抜けた後）の更新は、勝手にリロードせずトーストで知らせる
    await page.locator("#entry-gate .entry-gate-muted").click();
    await page.locator("#entry-gate").waitFor({ state: "detached" });
    await wait(1100);
    await appendFile(path.join(siteRoot, "js", "config.js"), `\n// deploy marker ${Date.now()}\n`);
    const regen2 = spawnSync("node", [path.join("tools", "make-source-hash.mjs")], { cwd: siteRoot });
    if (regen2.status !== 0) throw new Error(`make-source-hash に失敗: ${regen2.stderr}`);
    await page.evaluate(() => { window.__beforeAutoReload = true; });
    // 前面復帰・定期チェック相当の明示的な更新確認を起こす
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration.update()));
    try {
      await page.locator("#toast-layer .toast").waitFor({ timeout: 20000 });
      const toastText = await page.locator("#toast-layer .toast").textContent();
      console.log(`プレイ中の更新トースト: 「${toastText}」`);
    } catch {
      failures.push("プレイ開始後の更新でトーストが表示されない");
    }
    if (!(await page.evaluate(() => Boolean(window.__beforeAutoReload)).catch(() => false))) {
      failures.push("プレイ開始後の更新で勝手にリロードされた");
    }

    if (failures.length > 0) {
      console.error("SW 更新フロー検証: NG");
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log("SW 更新フロー検証: OK");
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await main();
