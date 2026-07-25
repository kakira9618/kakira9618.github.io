// バージョン表示用のハッシュを求め、js/version.js と sw.js（Service Worker）を書き出す。
// - js/version.js: バージョン表示「v2.0.0 (a1b2c3d4)」の括弧部分
// - sw.js: 全資産の事前キャッシュリストとハッシュ入りキャッシュ名（PWA のオフライン対応）
//
// ハッシュは「DWORDle2 ディレクトリを最後に変更した Git コミット」の短縮ハッシュ。
// リポジトリ（kakira9618.github.io）は複数サイト共用なので、DWORDle2 配下のパスに
// 限定して git log を引く。表示された値をそのまま git show できるのが狙い。
//
// 使い方（コミットは自分自身のハッシュを含められないので、この順で回す）:
//   1. コードを変更してコミットする
//   2. node tools/make-source-hash.mjs（1 のコミットが記録される）
//   3. js/version.js と sw.js を次のコミットに含める（生成物だけの小さなコミットで良い）
//
// Git が使えない環境ではソース内容のハッシュ（従来方式）へ自動的に退避する。
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

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

// Git が無い / リポジトリ外のときの退避用。ソース内容そのものから求める。
async function computeContentHash() {
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

async function git(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout.trim();
}

// DWORDle2 ディレクトリを最後に変更したコミットの短縮ハッシュ
export async function computeVersionHash() {
  try {
    const hash = await git(["log", "-1", "--abbrev=8", "--format=%h", "--", "."]);
    if (/^[0-9a-f]{8,40}$/.test(hash)) return hash;
  } catch {
    // Git が無い・リポジトリではない・履歴が空 → 内容ハッシュへ退避する
  }
  return computeContentHash();
}

// 記録済みのハッシュが実在するコミットを指しているか（テストから使う）
export async function isKnownCommit(hash) {
  try {
    await git(["cat-file", "-e", `${hash}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// オフラインでの完全動作に必要な全資産（OGP 画像などページ機能に関係しないものは除く）
export async function listPrecacheAssets() {
  const assets = [
    "./",
    "index.html",
    "manifest.webmanifest",
    "favicon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-192.png",
    "icon-maskable-512.png",
  ];
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
// キャッシュ名はコミットのハッシュ入りで、デプロイのたびに新しいキャッシュへ入れ替わる。
const CACHE_NAME = "dwordle2-${sourceHash}";
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // GitHub Pages は max-age=600 なので、素の URL で取ると直近の訪問で残った
    // ブラウザ HTTP キャッシュの旧ファイルが新キャッシュに混入し、次のデプロイまで
    // 直らない。必ずサーバで再検証（If-Modified-Since）してから保存する。
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "no-cache" })));
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
  const sourceHash = await computeVersionHash();
  const body =
    "// 自動生成ファイル。tools/make-source-hash.mjs が書き出す（手で編集しない）。\n" +
    "// DWORDle2 ディレクトリを最後に変更した Git コミットの短縮ハッシュ。\n" +
    `export const SOURCE_HASH = "${sourceHash}";\n`;
  await writeFile(path.join(root, VERSION_FILE), body);
  const precache = await listPrecacheAssets();
  await writeFile(path.join(root, "sw.js"), swSource(sourceHash, precache));
  console.log(`js/version.js と sw.js を更新しました (${sourceHash}, precache ${precache.length} 件)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
