// 公開用の成果物を dist/ に組み立てる（GitHub Actions の Pages デプロイが使う）。
//
// 方針は「ディレクトリ構成とファイル名をそのまま保ち、中身だけ minify する」。
// バンドルしないので import 文の指定（?v= のキャッシュバスター含む）は書き換わらず、
// importmap（three）・Web Worker・動的 import・sw.js の事前キャッシュ一覧が
// ソースのまま通用する。DevTools からはコメントの無い圧縮コードだけが見える。
//
// 使い方: node tools/build.mjs [--out <dir>]
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { listPrecacheAssets } from "./make-source-hash.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- 調整用の設定 ----------------------------------------------------------
const BUILD = {
  outDir: "dist", // 既定の出力先（--out で上書き）
  // 公開しないもの（開発用のファイル・生成物・参照用スナップショット）。
  // ここに挙げた以外はすべて公開する（新しい画像などを取りこぼさないため）。
  exclude: new Set([
    ".git",
    ".gitignore",
    ".DS_Store",
    "CLAUDE.md",
    "README.md",
    "dist",
    "node_modules",
    "package.json",
    "package-lock.json",
    "reference-orig-dwordle",
    "reference-orig-dwordlie",
    "test",
    "tools",
  ]),
  // minify せずそのままコピーする（配布物が既に最小化済み・ライセンス表記を残す）
  copyAsIs: (rel) => rel.startsWith("vendor/") || rel.endsWith(".min.js"),
  // esbuild の変換設定。sourcemap は出さない（公開したくないので）
  js: { loader: "js", format: "esm", minify: true, target: "es2022", legalComments: "none" },
  css: { loader: "css", minify: true, legalComments: "none" },
};
// ---------------------------------------------------------------------------

const outArg = process.argv.indexOf("--out");
const outDir = path.resolve(root, outArg === -1 ? BUILD.outDir : process.argv[outArg + 1]);

// 公開対象のファイルをリポジトリ相対パス（POSIX 区切り）で列挙する
async function listPublishedFiles(dir = root) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (BUILD.exclude.has(entry.name) || BUILD.exclude.has(rel)) continue;
    if (entry.isDirectory()) files.push(...(await listPublishedFiles(full)));
    else files.push(rel);
  }
  return files;
}

async function build() {
  if (path.resolve(outDir) === path.resolve(root)) throw new Error("出力先がプロジェクト直下になっている");
  await rm(outDir, { recursive: true, force: true });

  const files = await listPublishedFiles();
  const stats = { minified: 0, copied: 0, sourceBytes: 0, outBytes: 0 };

  for (const rel of files) {
    const from = path.join(root, rel);
    const to = path.join(outDir, rel);
    await mkdir(path.dirname(to), { recursive: true });
    const ext = path.extname(rel);
    const minifiable = !BUILD.copyAsIs(rel) && (ext === ".js" || ext === ".css");
    if (!minifiable) {
      await cp(from, to);
      stats.copied += 1;
      const size = (await stat(to)).size;
      stats.sourceBytes += size;
      stats.outBytes += size;
      continue;
    }
    const source = await readFile(from, "utf8");
    const options = ext === ".css" ? BUILD.css : BUILD.js;
    const result = await esbuild.transform(source, { ...options, sourcefile: rel });
    for (const warning of result.warnings) console.warn(`  warn ${rel}: ${warning.text}`);
    await writeFile(to, result.code);
    stats.minified += 1;
    stats.sourceBytes += Buffer.byteLength(source);
    stats.outBytes += Buffer.byteLength(result.code);
  }

  // sw.js の事前キャッシュ一覧に載っている資産が dist に揃っているか（欠けると
  // Service Worker のインストールが失敗し、オフライン動作が丸ごと壊れる）
  const missing = [];
  for (const asset of await listPrecacheAssets()) {
    if (asset === "./") continue;
    try {
      await stat(path.join(outDir, asset));
    } catch {
      missing.push(asset);
    }
  }
  if (missing.length) throw new Error(`sw.js の事前キャッシュ対象が dist にない: ${missing.join(", ")}`);

  const kb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`;
  console.log(
    `${path.relative(process.cwd(), outDir)} を生成しました ` +
      `(minify ${stats.minified} 件 / コピー ${stats.copied} 件, ${kb(stats.sourceBytes)} → ${kb(stats.outBytes)})`
  );
}

await build();
