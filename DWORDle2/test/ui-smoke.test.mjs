// UI スモーク + a11y テストのランナー。シナリオは test/ui/*.mjs に分かれている。
//
//   node test/ui-smoke.test.mjs                すべて実行（npm run test:ui）
//   node test/ui-smoke.test.mjs card history   ファイル名かシナリオ名に語を含むものだけ
//   node test/ui-smoke.test.mjs --list         一覧を出す
//   node test/ui-smoke.test.mjs --jobs 1       並列数（既定 2。時間計測が揺れるときは 1 に）
//
// 各シナリオは自分のブラウザコンテキスト（localStorage）を持ち、他に依存しない。
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, openPage, startServer, serveRoot, projectRoot } from "./ui/harness.mjs";

const scenarioDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const jobsIndex = args.indexOf("--jobs");
const DEFAULT_JOBS = 2;
const jobs = jobsIndex === -1 ? DEFAULT_JOBS : Math.max(1, Number(args[jobsIndex + 1]) || DEFAULT_JOBS);
const filters = args.filter((arg, index) => !arg.startsWith("--") && (jobsIndex === -1 || index !== jobsIndex + 1)).map((arg) => arg.toLowerCase());

const files = (await readdir(scenarioDir)).filter((name) => name.endsWith(".mjs") && name !== "harness.mjs").sort();
const scenarios = [];
for (const file of files) {
  const group = file.replace(/\.mjs$/, "");
  const mod = await import(path.join(scenarioDir, file));
  for (const scenario of mod.default) {
    const id = scenario.name === group ? group : `${group}/${scenario.name}`;
    if (filters.length && !filters.some((word) => id.toLowerCase().includes(word))) continue;
    scenarios.push({ ...scenario, id, group });
  }
}

if (listOnly) {
  for (const scenario of scenarios) console.log(scenario.id);
  process.exit(0);
}
if (scenarios.length === 0) {
  console.error(`該当するシナリオがない: ${filters.join(" ")}（--list で一覧）`);
  process.exit(1);
}
if (serveRoot !== projectRoot) console.log(`  note: 配信ルート ${path.relative(projectRoot, serveRoot)}`);

const server = await startServer();
const browser = await launchBrowser();
const failures = [];
const startedAt = Date.now();

async function runScenario(scenario) {
  const opened = [];
  const open = async (options) => {
    const handle = await openPage(browser, options);
    opened.push(handle);
    return handle;
  };
  const t = { browser, baseUrl: server.baseUrl, port: server.port, open };
  const began = Date.now();
  try {
    if (scenario.page !== false) {
      const { page, context, errors } = await open({ storage: scenario.storage, fresh: scenario.fresh, ...scenario.page });
      Object.assign(t, { page, context, errors });
    }
    await scenario.run(t);
    // どのページでも実行時エラー（例外・console.error）は出ていないこと
    if (!scenario.allowErrors) {
      const errors = opened.flatMap((handle) => handle.errors);
      if (errors.length) throw new Error(`Runtime errors:\n${errors.join("\n")}`);
    }
    console.log(`  ok   ${scenario.id} (${((Date.now() - began) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failures.push({ id: scenario.id, error });
    console.log(`  FAIL ${scenario.id} (${((Date.now() - began) / 1000).toFixed(1)}s)\n${indent(error.stack ?? String(error))}`);
  } finally {
    for (const handle of opened) await handle.context.close().catch(() => {});
  }
}

function indent(text) {
  return text.split("\n").map((line) => `       ${line}`).join("\n");
}

const queue = [...scenarios];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) await runScenario(queue.shift());
  })
);

await browser.close();
await server.close();

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
if (failures.length) {
  console.log(`\nUIスモーク: ${failures.length} / ${scenarios.length} 件失敗 (${elapsed}s)\n${failures.map((f) => `  - ${f.id}`).join("\n")}`);
  process.exit(1);
}
console.log(`UIスモーク + a11yテスト: OK (${scenarios.length} 件, ${elapsed}s)`);
