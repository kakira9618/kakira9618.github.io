// DWORDle2 のソースコード（index.html + css/** + js/**、生成物 js/version.js を除く）から
// 短いハッシュを計算し、js/version.js と sw.js（Service Worker）を書き出す。
// - js/version.js: バージョン表示「v2.0.0 (a1b2c3d4)」の括弧部分
// - sw.js: 全資産の事前キャッシュリストとハッシュ入りキャッシュ名（PWA のオフライン対応）
// 使い方: node tools/make-source-hash.mjs（ソース変更後・コミット前に実行する）
// npm test がハッシュの鮮度を検証するので、更新を忘れるとテストが落ちる。
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = path.join("js", "version.js"); // 生成物。ハッシュの入力から除外する

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(full);
  }
  return files;
}

export async function computeSourceHash() {
  const targets = [path.join(root, "index.html")];
  for (const dir of ["css", "js"]) {
    targets.push(...(await listFiles(path.join(root, dir))));
  }
  const files = targets
    .map((full) => path.relative(root, full))
    .filter((rel) => rel !== VERSION_FILE)
    .sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(`${rel}\n`);
    hash.update(await readFile(path.join(root, rel)));
  }
  return hash.digest("hex").slice(0, 8);
}

// オフラインでの完全動作に必要な全資産（OGP 画像などページ機能に関係しないものは除く）
export async function listPrecacheAssets() {
  const assets = ["./", "index.html", "manifest.webmanifest", "favicon.png"];
  for (const dir of ["css", "js", "vendor"]) {
    assets.push(
      ...(await listFiles(path.join(root, dir))).map((full) => path.relative(root, full).split(path.sep).join("/"))
    );
  }
  return assets;
}

function swSource(sourceHash, precache) {
  return `// 自動生成ファイル。tools/make-source-hash.mjs が書き出す（手で編集しない）。
// DWORDle 2 の Service Worker。全資産をインストール時に事前キャッシュし、
// オフラインでも完全動作させる（キャッシュ優先 + ネットワークフォールバック）。
// キャッシュ名はソースハッシュ入りで、デプロイのたびに新しいキャッシュへ入れ替わる。
const CACHE_NAME = "dwordle2-${sourceHash}";
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// キャッシュ優先。?v= のキャッシュバスターはクエリを無視して照合する。
// キャッシュにない同一オリジンの GET はネットワークから取り、次回のために保存する。
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (request.mode === "navigate") {
        const fallback = await cache.match("index.html");
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
`;
}

async function main() {
  const sourceHash = await computeSourceHash();
  const body =
    "// 自動生成ファイル。tools/make-source-hash.mjs が書き出す（手で編集しない）。\n" +
    "// DWORDle2 のソースコード（index.html + css/** + js/**、このファイルを除く）のハッシュ。\n" +
    `export const SOURCE_HASH = "${sourceHash}";\n`;
  await writeFile(path.join(root, VERSION_FILE), body);
  const precache = await listPrecacheAssets();
  await writeFile(path.join(root, "sw.js"), swSource(sourceHash, precache));
  console.log(`js/version.js と sw.js を更新しました (${sourceHash}, precache ${precache.length} 件)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
