// ブラウザを使わない整合チェック: バージョン表示・sw.js・公開画像
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./harness.mjs";

const read = (name) => readFile(path.join(projectRoot, name));

function pngSize(png, label) {
  const offset = png.indexOf(Buffer.from("IHDR"));
  assert.notEqual(offset, -1, `${label} should contain a PNG IHDR chunk`);
  return [png.readUInt32BE(offset + 4), png.readUInt32BE(offset + 8)];
}

// JPEG のサイズは SOF0/SOF2 マーカー（FFC0 / FFC2）に入っている
function jpegSize(jpg, label) {
  for (let i = 2; i < jpg.length - 9; i++) {
    if (jpg[i] === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2)) {
      return [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)];
    }
  }
  assert.fail(`${label} should be a JPEG with an SOF marker`);
}

export default [
  {
    // バージョン表示のハッシュ（DWORDle2 を最後に変更したコミット）と sw.js の整合
    name: "version-hash",
    page: false,
    async run() {
      const { computeVersionHash, isKnownCommit, listPrecacheAssets } = await import("../../tools/make-source-hash.mjs");
      const { SOURCE_HASH } = await import("../../js/version.js?v=20260806-a");
      assert.match(SOURCE_HASH, /^[0-9a-f]{7,40}$/, "the version hash should be a short hex hash");
      // コミット直後は HEAD が先へ進むので「最新と一致」は課さず、実在するコミットかだけ見る
      assert.ok(await isKnownCommit(SOURCE_HASH), `js/version.js のハッシュ ${SOURCE_HASH} が実在するコミットではない。node tools/make-source-hash.mjs で更新する`);
      const latest = await computeVersionHash();
      if (latest !== SOURCE_HASH) console.log(`  note: 表示ハッシュ ${SOURCE_HASH} / DWORDle2 の最新コミット ${latest}`);
      // PWA: sw.js（同じツールが生成）のキャッシュ名と事前キャッシュリストが実ファイルと完全一致すること。
      // 消したファイルが残っていると install の cache.addAll() が 404 で失敗し、SW が有効化されない。
      const swSource = await readFile(path.join(projectRoot, "sw.js"), "utf8");
      assert.ok(swSource.includes(`"dwordle2-${SOURCE_HASH}"`), "sw.js のキャッシュ名が古い。node tools/make-source-hash.mjs で更新する");
      const assets = await listPrecacheAssets();
      for (const asset of assets) {
        assert.ok(swSource.includes(`"${asset}"`), `sw.js の事前キャッシュに ${asset} がない。node tools/make-source-hash.mjs で更新する`);
      }
      const listed = JSON.parse(swSource.slice(swSource.indexOf("const PRECACHE = ") + "const PRECACHE = ".length, swSource.indexOf("];") + 1));
      const known = new Set(assets);
      assert.deepEqual(listed.filter((asset) => asset !== "./" && !known.has(asset)), [], "sw.js の事前キャッシュに実在しないファイルが残っている。node tools/make-source-hash.mjs で更新する");
    },
  },
  {
    // バージョン番号（APP_VERSION）の整合。上げ方は tools/bump-version.mjs 参照
    name: "app-version",
    page: false,
    async run() {
      const { APP_VERSION } = await import("../../js/config.js?v=20260806-a");
      const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
      assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, "APP_VERSION は x.y.z 形式であること");
      assert.equal(pkg.version, APP_VERSION, "package.json の version が APP_VERSION と揃っていない");
      const { latestReleasedVersion, compareVersions } = await import("../../tools/bump-version.mjs");
      const released = await latestReleasedVersion();
      if (released) {
        assert.ok(compareVersions(APP_VERSION, released) >= 0, `APP_VERSION ${APP_VERSION} が最新タグ v${released} より古い。node tools/bump-version.mjs で上げる`);
      }
    },
  },
  {
    // OGP 画像とアイコンの寸法。OGP は 300KB を超えるとプレビューを出さないクライアントがある
    name: "images",
    page: false,
    async run() {
      const og = await read("og.jpg");
      const square = await read("og-square.png");
      assert.deepEqual(jpegSize(og, "og.jpg"), [1200, 630]);
      assert.deepEqual(pngSize(square, "og-square.png"), [1200, 1200]);
      for (const [name, bytes] of [["og.jpg", og.length], ["og-square.png", square.length]]) {
        assert.ok(bytes <= 300 * 1024, `${name} が ${Math.round(bytes / 1024)}KB。OGP 画像は 300KB 以下に保つ（tools/make-og.mjs）`);
      }
      // Android Chrome の PWA インストールには 192 と 512 のアイコンが必須
      for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-192.png", 192], ["icon-maskable-512.png", 512]]) {
        assert.deepEqual(pngSize(await read(name), name), [size, size], `${name} size`);
      }
    },
  },
];
