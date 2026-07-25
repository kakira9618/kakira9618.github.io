// DWORDle 2 のバージョン（js/config.js の APP_VERSION）を上げてコミット・タグ付け・push する。
//
// リポジトリ (kakira9618.github.io) は複数サイトの共用なので、
// タグは "dwordle2-v2.1.0" のようにプロジェクト名を接頭辞に付ける（他サイトと衝突させない）。
// 変更・コミット・差分参照はすべて DWORDle2/ 配下に限定する。
//
// 使い方:
//   node tools/bump-version.mjs --changes        前バージョン以降の変更を表示（上げ幅の判断用）
//   node tools/bump-version.mjs patch            2.0.0 -> 2.0.1
//   node tools/bump-version.mjs minor            2.0.0 -> 2.1.0
//   node tools/bump-version.mjs major            2.0.0 -> 3.0.0
//   node tools/bump-version.mjs 2.3.0            バージョンを直接指定（手動運用）
//
//   オプション:
//     --dry-run       何もせず、実行予定の内容だけ表示する
//     --no-push       コミットとタグまで作り、push はしない
//     --skip-tests    npm test を省略する（普段は付けない）
//     --force         現在より小さい / 同じバージョンでも許可する（手動の切り戻し用）
//     --note "..."    タグのメッセージに追記する一行
//
// AI への指示（「バージョンを上げて」と言われたとき）:
//   1. node tools/bump-version.mjs --changes で前バージョンからの変更を読む
//   2. 変更の内容から patch / minor / major を判断する
//      - patch: バグ修正・文言や見た目の微調整・内部整理のみ
//      - minor: 機能追加・遊べる内容やUIの拡張（後方互換）
//      - major: 保存データの非互換な変更、ゲーム体験の作り直し級の変更
//   3. node tools/bump-version.mjs <判断した種別> を実行する（この中で commit / tag / push まで行う）
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG_PREFIX = "dwordle2-v"; // 共用リポジトリなのでプロジェクト名で名前空間を分ける
const BUMP_KINDS = ["patch", "minor", "major"];

// バージョンが書かれているファイル（ここを増やせば追随する）
const VERSION_SITES = [
  {
    file: path.join("js", "config.js"),
    pattern: /(export const APP_VERSION = ")(\d+\.\d+\.\d+)(")/,
  },
  {
    file: "package.json",
    pattern: /("version":\s*")(\d+\.\d+\.\d+)(")/,
  },
];

async function git(args, opts = {}) {
  const { stdout } = await execFileAsync("git", args, { cwd: root, ...opts });
  return stdout.trim();
}

async function run(cmd, args) {
  await execFileAsync(cmd, args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
}

// git のパス制限は cwd（= DWORDle2）基準の "." で行う。
// 表示用にリポジトリルートからの相対パスも返す。
async function projectPaths() {
  const top = await git(["rev-parse", "--show-toplevel"]);
  const rel = path.relative(top, root).split(path.sep).join("/");
  return { pathspec: ".", label: rel === "" ? "." : `${rel}/` };
}

async function readVersionSites() {
  const sites = [];
  for (const site of VERSION_SITES) {
    const full = path.join(root, site.file);
    const text = await readFile(full, "utf8");
    const match = text.match(site.pattern);
    if (!match) throw new Error(`${site.file} からバージョンを読めなかった`);
    sites.push({ ...site, full, text, version: match[2] });
  }
  const [head, ...rest] = sites;
  for (const site of rest) {
    if (site.version !== head.version) {
      throw new Error(
        `バージョンが揃っていない: ${head.file}=${head.version} / ${site.file}=${site.version}。先に手で揃える`
      );
    }
  }
  return sites;
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`バージョンの形式が不正: ${version}（x.y.z で指定する）`);
  return match.slice(1).map(Number);
}

export function compareVersions(a, b) {
  const [x, y, z] = parseVersion(a);
  const [p, q, r] = parseVersion(b);
  return x - p || y - q || z - r;
}

function bumpVersion(current, kind) {
  const [major, minor, patch] = parseVersion(current);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// 既存タグのうち最新のもの（無ければ null）
export async function latestTag() {
  try {
    const out = await git(["tag", "--list", `${TAG_PREFIX}*`, "--sort=-v:refname"]);
    if (!out) return null;
    return out.split("\n")[0];
  } catch {
    return null; // Git が無い / リポジトリ外
  }
}

// 最新タグのバージョン部分（無ければ null）。テストから使う
export async function latestReleasedVersion() {
  const tag = await latestTag();
  return tag ? tag.slice(TAG_PREFIX.length) : null;
}

// 前バージョン（タグ）以降の DWORDle2 配下の変更を表示する
async function showChanges() {
  const { pathspec, label } = await projectPaths();
  const sites = await readVersionSites();
  const tag = await latestTag();
  console.log(`現在のバージョン: v${sites[0].version}`);
  console.log(`直近のタグ: ${tag ?? "（まだ無い）"}`);
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const log = await git(["log", "--no-merges", "--format=%h %ad %s", "--date=short", range, "--", pathspec]);
  const stat = await git(["diff", "--stat", ...(tag ? [`${tag}..HEAD`] : []), "--", pathspec]);
  console.log(`\n--- ${range} のコミット (${label} 配下) ---`);
  console.log(log || "（変更なし）");
  console.log(`\n--- 差分の規模 ---`);
  console.log(stat || "（変更なし）");
}

function parseArgs(argv) {
  const opts = { dryRun: false, push: true, tests: true, force: false, note: null, target: null, changes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--changes") opts.changes = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-push") opts.push = false;
    else if (arg === "--skip-tests") opts.tests = false;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--note") opts.note = argv[++i] ?? null;
    else if (arg.startsWith("--")) throw new Error(`不明なオプション: ${arg}`);
    else if (opts.target === null) opts.target = arg;
    else throw new Error(`引数が多すぎる: ${arg}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.changes) return showChanges();
  if (!opts.target) {
    console.error("バージョンの種別 (patch / minor / major) か x.y.z を指定する。--changes で変更内容を確認できる。");
    process.exitCode = 1;
    return;
  }

  const { pathspec, label } = await projectPaths();
  const sites = await readVersionSites();
  const current = sites[0].version;
  const next = BUMP_KINDS.includes(opts.target) ? bumpVersion(current, opts.target) : opts.target;
  parseVersion(next);
  const tag = `${TAG_PREFIX}${next}`;

  if (!opts.force && compareVersions(next, current) <= 0) {
    throw new Error(`v${next} は現在の v${current} より新しくない（意図的なら --force）`);
  }
  const existing = await git(["tag", "--list", tag]);
  if (existing) throw new Error(`タグ ${tag} は既にある`);

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = await git(["status", "--porcelain", "--", pathspec]);
  if (dirty && !opts.dryRun) throw new Error(`${label} に未コミットの変更がある。先にコミットする:\n${dirty}`);
  if (dirty) console.log(`注意: ${label} に未コミットの変更がある（本番実行はここで止まる）:\n${dirty}`);

  console.log(`v${current} -> v${next}（タグ ${tag} / ブランチ ${branch}）`);
  if (opts.dryRun) {
    console.log("--dry-run なので以降は実行しない。実行予定:");
    for (const site of sites) console.log(`  書き換え: ${site.file}`);
    console.log(`  ${opts.tests ? "npm test" : "npm test はスキップ"}`);
    console.log(`  commit: バージョンを v${next} に更新`);
    console.log(`  node tools/make-source-hash.mjs → commit: バージョン表示のハッシュを更新`);
    console.log(`  tag: ${tag}`);
    console.log(`  ${opts.push ? `push: origin ${branch} と ${tag}` : "push はしない"}`);
    return;
  }

  for (const site of sites) {
    await writeFile(site.full, site.text.replace(site.pattern, `$1${next}$3`));
  }
  console.log(`書き換え: ${sites.map((s) => s.file).join(", ")}`);

  if (opts.tests) {
    console.log("npm test を実行中…");
    await run("npm", ["test"]);
    console.log("テスト: OK");
  }

  await git(["add", "--", ...sites.map((s) => s.file)]);
  await git(["commit", "-m", `バージョンを v${next} に更新`]);

  // ハッシュ表示とプリキャッシュ（Service Worker）を、いま作ったコミットに合わせて更新する
  await run("node", [path.join("tools", "make-source-hash.mjs")]);
  const generated = await git(["status", "--porcelain", "--", "js/version.js", "sw.js"]);
  if (generated) {
    await git(["add", "--", "js/version.js", "sw.js"]);
    await git(["commit", "-m", "バージョン表示のハッシュを更新"]);
  }

  const message = opts.note ? `DWORDle 2 v${next}\n\n${opts.note}` : `DWORDle 2 v${next}`;
  await git(["tag", "-a", tag, "-m", message]);
  console.log(`タグを作成: ${tag}`);

  if (opts.push) {
    await git(["push", "origin", branch]);
    await git(["push", "origin", tag]);
    console.log(`push 済み: origin ${branch} / ${tag}`);
  } else {
    console.log(`push はしていない。あとで: git push origin ${branch} && git push origin ${tag}`);
  }
  console.log(`完了: v${next}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`エラー: ${error.message}`);
    process.exit(1);
  }
}
