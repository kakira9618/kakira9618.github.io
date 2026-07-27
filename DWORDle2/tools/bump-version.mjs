// DWORDle 2 のバージョン（js/config.js の APP_VERSION）を上げてコミット・タグ付け・push する。
//
// リポジトリ (kakira9618.github.io) は複数サイトの共用なので、
// タグは "dwordle2-v2.1.0" のようにプロジェクト名を接頭辞に付ける（他サイトと衝突させない）。
// 変更・コミット・差分参照はすべて DWORDle2/ 配下に限定する。
//
// 使い方:
//   node tools/bump-version.mjs --changes        前バージョン以降の変更を表示（上げ幅の判断用）
//   node tools/bump-version.mjs --notes          前バージョン以降のリリースノート（箇条書き）だけを表示
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
//     --range A..B    リリースノート / 変更表示の対象範囲（既定は「直近のタグ..HEAD」）
//                     公開済みバージョンのノートを作り直すとき用:
//                     --notes --range dwordle2-v2.0.0..dwordle2-v2.1.0
//
// リリースノートは各コミットの件名から作り、タグのメッセージにも書き込む。
// ビルド・テスト・開発スクリプトなど遊ぶ人から見えない変更は 1 行の
// 「安定性を向上」にまとめる（分類のルールは RELEASE_NOTE_RULES を参照）。
//
// AI への指示（「バージョンを上げて」と言われたとき）:
//   1. node tools/bump-version.mjs --changes で前バージョンからの変更を読む
//   2. 変更の内容から patch / minor / major を判断する
//      - patch: バグ修正・文言や見た目の微調整・内部整理のみ
//      - minor: 機能追加・遊べる内容やUIの拡張（後方互換）
//      - major: 保存データの非互換な変更、ゲーム体験の作り直し級の変更
//   3. node tools/bump-version.mjs <判断した種別> を実行する（この中で commit / tag / push まで行う）
//   4. 出力されたリリースノートを完了報告に載せる。件名そのままでは伝わらない行があれば
//      そこだけ言葉を補って報告する（スクリプトの出力は下書きとして扱ってよい）
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG_PREFIX = "dwordle2-v"; // 共用リポジトリなのでプロジェクト名で名前空間を分ける
const BUMP_KINDS = ["patch", "minor", "major"];

// リリースノートの分類ルール。効きが悪いと感じたらここだけ足す。
const RELEASE_NOTE_RULES = {
  // 件名から落とす接頭辞（コミット規約の名前空間）
  subjectPrefix: /^DWORDle ?2:\s*/,
  // バージョン運用そのもののコミット。ノートには出さない（内部改善にも数えない）
  noise: [
    /^バージョンを v?\d+\.\d+\.\d+ に更新$/,
    /ハッシュを更新$/,
    /ハッシュを反映$/,
    /^refresh source hash$/i,
  ],
  // このディレクトリ / ファイルだけを触ったコミットは「遊ぶ人から見えない」とみなす
  internalPaths: ["test/", "tools/", ".github/", "dist/"],
  internalFiles: ["package.json", "package-lock.json", "README.md", "CLAUDE.md", ".gitignore"],
  // 公開ファイルも触っているが中身は内部作業、と件名から分かるもの。
  // 普通の文章に紛れる語（「時刻に依存しない」など）を拾わないよう、狭めに書くこと。
  internalSubjects: [
    /テスト/,
    /リファクタ/,
    /開発用/,
    /ワークフロー/,
    /ビルド/,
    /(開発|ビルド|更新|検証)用?スクリプト/,
    /依存(関係|パッケージ)/,
    /\bdependenc/i,
    /^CI/,
  ],
  // 内部改善をまとめる 1 行
  internalBullet: "安定性を向上",
};

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

// ---- リリースノート ----

// コミット 1 件を "noise"（出さない）/ "internal"（安定性へ集約）/ "user"（そのまま載せる）に分ける。
// files はプロジェクト（DWORDle2/）からの相対パス。
export function classifyCommit({ subject, files = [] }) {
  const rules = RELEASE_NOTE_RULES;
  const title = subject.replace(rules.subjectPrefix, "").trim();
  if (rules.noise.some((pattern) => pattern.test(title))) return "noise";
  const isInternalFile = (file) =>
    rules.internalPaths.some((prefix) => file.startsWith(prefix)) || rules.internalFiles.includes(file);
  // 触ったのが内部ファイルだけなら、件名を問わず内部作業
  if (files.length > 0 && files.every(isInternalFile)) return "internal";
  if (rules.internalSubjects.some((pattern) => pattern.test(title))) return "internal";
  return "user";
}

// コミット列（古い順）から箇条書きを組み立てる。内部改善は最後の 1 行にまとめる。
export function buildReleaseNotes(commits) {
  const bullets = [];
  let internal = 0;
  for (const commit of commits) {
    const kind = classifyCommit(commit);
    if (kind === "noise") continue;
    if (kind === "internal") {
      internal += 1;
      continue;
    }
    const title = commit.subject.replace(RELEASE_NOTE_RULES.subjectPrefix, "").trim().replace(/[。.]$/, "");
    if (title && !bullets.includes(title)) bullets.push(title);
  }
  if (internal > 0) bullets.push(`${RELEASE_NOTE_RULES.internalBullet}（内部の改善 ${internal} 件）`);
  return { bullets, internalCount: internal };
}

// 範囲内のコミットを、件名と変更ファイルの組で古い順に取り出す
async function readCommits(range, pathspec) {
  const separator = "\u001f"; // 件名に現れない制御文字を区切りに使う
  const raw = await git([
    "log",
    "--no-merges",
    "--reverse",
    `--format=${separator}%s`,
    "--name-only",
    "--relative", // ファイル名をプロジェクト基準（先頭の DWORDle2/ を除いた形）にそろえる
    range,
    "--",
    pathspec,
  ]);
  return raw
    .split(separator)
    .slice(1)
    .map((chunk) => {
      const [subject, ...rest] = chunk.split("\n");
      return { subject: subject.trim(), files: rest.map((line) => line.trim()).filter(Boolean) };
    });
}

// 対象範囲（既定は「直近のタグ..HEAD」）
async function resolveRange(explicit) {
  if (explicit) return explicit;
  const tag = await latestTag();
  return tag ? `${tag}..HEAD` : "HEAD";
}

async function releaseNotes(range, pathspec) {
  return buildReleaseNotes(await readCommits(range, pathspec));
}

function formatReleaseNotes(bullets) {
  return bullets.length > 0 ? bullets.map((bullet) => `- ${bullet}`).join("\n") : "- （記載する変更なし）";
}

async function showNotes(rangeOption) {
  const { pathspec } = await projectPaths();
  const sites = await readVersionSites();
  const range = await resolveRange(rangeOption);
  const { bullets } = await releaseNotes(range, pathspec);
  console.log(`--- リリースノート v${sites[0].version}（${range}）---`);
  console.log(formatReleaseNotes(bullets));
}

// 前バージョン（タグ）以降の DWORDle2 配下の変更を表示する
async function showChanges(rangeOption) {
  const { pathspec, label } = await projectPaths();
  const sites = await readVersionSites();
  const tag = await latestTag();
  console.log(`現在のバージョン: v${sites[0].version}`);
  console.log(`直近のタグ: ${tag ?? "（まだ無い）"}`);
  const range = await resolveRange(rangeOption);
  const diffRange = range.includes("..") ? [range] : [];
  const log = await git(["log", "--no-merges", "--format=%h %ad %s", "--date=short", range, "--", pathspec]);
  const stat = await git(["diff", "--stat", ...diffRange, "--", pathspec]);
  console.log(`\n--- ${range} のコミット (${label} 配下) ---`);
  console.log(log || "（変更なし）");
  console.log(`\n--- 差分の規模 ---`);
  console.log(stat || "（変更なし）");
  const { bullets } = await releaseNotes(range, pathspec);
  console.log(`\n--- リリースノート（下書き）---`);
  console.log(formatReleaseNotes(bullets));
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    push: true,
    tests: true,
    force: false,
    note: null,
    target: null,
    changes: false,
    notes: false,
    range: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--changes") opts.changes = true;
    else if (arg === "--notes") opts.notes = true;
    else if (arg === "--range") opts.range = argv[++i] ?? null;
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
  if (opts.changes) return showChanges(opts.range);
  if (opts.notes) return showNotes(opts.range);
  if (!opts.target) {
    console.error(
      "バージョンの種別 (patch / minor / major) か x.y.z を指定する。"
        + "--changes で変更内容を、--notes でリリースノートを確認できる。"
    );
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

  // ノートはバージョン更新のコミットを積む前に作る（この 2 コミット自体は載せない）
  const { bullets } = await releaseNotes(await resolveRange(opts.range), pathspec);
  const notesText = formatReleaseNotes(bullets);

  console.log(`v${current} -> v${next}（タグ ${tag} / ブランチ ${branch}）`);
  console.log(`\n--- リリースノート v${next} ---\n${notesText}\n`);
  if (opts.dryRun) {
    console.log("--dry-run なので以降は実行しない。実行予定:");
    for (const site of sites) console.log(`  書き換え: ${site.file}`);
    console.log(`  ${opts.tests ? "npm test" : "npm test はスキップ"}`);
    console.log(`  commit: バージョンを v${next} に更新`);
    console.log(`  node tools/make-source-hash.mjs → commit: バージョン表示のハッシュを更新`);
    console.log(`  tag: ${tag}（メッセージに上のリリースノートを入れる）`);
    console.log(`  ${opts.push ? `push: origin ${branch} と ${tag}` : "push はしない"}`);
    return;
  }

  for (const site of sites) {
    await writeFile(site.full, site.text.replace(site.pattern, `$1${next}$3`));
  }
  console.log(`書き換え: ${sites.map((s) => s.file).join(", ")}`);

  if (opts.tests) {
    console.log("npm test を実行中…");
    try {
      await run("npm", ["test"]);
    } catch (error) {
      // 書き換えたまま止まると作業ツリーが中途半端に汚れ、次の実行が
      // 「未コミットの変更がある」で弾かれる。元の内容へ戻してから投げ直す。
      for (const site of sites) await writeFile(site.full, site.text);
      console.error(`テストが失敗したので ${sites.map((s) => s.file).join(", ")} を元に戻した`);
      throw error;
    }
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

  // タグのメッセージにリリースノートを残す（git show <タグ> であとから読める）
  const message = [`DWORDle 2 v${next}`, notesText, opts.note].filter(Boolean).join("\n\n");
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
  console.log(`\n--- リリースノート v${next} ---\n${notesText}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`エラー: ${error.message}`);
    process.exit(1);
  }
}
