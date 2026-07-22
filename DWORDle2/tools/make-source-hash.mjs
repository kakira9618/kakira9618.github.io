// DWORDle2 のソースコード（index.html + css/** + js/**、生成物 js/version.js を除く）から
// 短いハッシュを計算し、js/version.js に書き出す。
// タイトル画面・設定画面のバージョン表示「v2.0.0 (a1b2c3d4)」の括弧部分になる。
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

async function main() {
  const sourceHash = await computeSourceHash();
  const body =
    "// 自動生成ファイル。tools/make-source-hash.mjs が書き出す（手で編集しない）。\n" +
    "// DWORDle2 のソースコード（index.html + css/** + js/**、このファイルを除く）のハッシュ。\n" +
    `export const SOURCE_HASH = "${sourceHash}";\n`;
  await writeFile(path.join(root, VERSION_FILE), body);
  console.log(`js/version.js を更新しました (${sourceHash})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
