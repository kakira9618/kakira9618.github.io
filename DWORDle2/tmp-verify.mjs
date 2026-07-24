import { chromium } from "playwright";
import { spawn } from "node:child_process";
const srv = spawn("python3", ["-m", "http.server", "8743"], { cwd: "/Users/kakira/kakira9618.github.io/DWORDle2" });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({ headless: true });
const day = 86400;
const now = Math.floor(Date.now() / 1000);
const hist = [0,1,2,3,4].map((i) => ({
  gameMode: "normal", clear: true, guessWord: ["AAAAA","BBBBB","CCCCC"],
  problemID: 1000 + i, startTime: now - i * day, endTime: now - i * day + 60,
}));
const stale = hist.map((g) => ({ ...g, startTime: g.startTime - 10 * day, endTime: g.endTime - 10 * day }));
for (const locale of ["ja-JP", "en-US", "en-GB", "de-DE", "fr-FR"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
  const page = await ctx.newPage();
  await page.addInitScript((h) => localStorage.setItem("dwordle2.history", JSON.stringify(h)), hist);
  await page.goto("http://localhost:8743/");
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const m = await import("/js/core/records.js");
    return m.getStatistics("normal");
  });
  console.log(locale, "streak", JSON.stringify({ cur: r.currentStreak, max: r.maxStreak }));
  await ctx.close();
}
// 途切れ検知
{
  const ctx = await browser.newContext({ locale: "ja-JP" });
  const page = await ctx.newPage();
  await page.addInitScript((h) => localStorage.setItem("dwordle2.history", JSON.stringify(h)), stale);
  await page.goto("http://localhost:8743/");
  await page.waitForTimeout(1200);
  const r = await page.evaluate(async () => (await import("/js/core/records.js")).getStatistics("normal"));
  console.log("10日前まで5連続 ->", JSON.stringify({ cur: r.currentStreak, max: r.maxStreak }));
  await ctx.close();
}
// three.js のロード有無
for (const theme of ["classic", "pop", "cyber"]) {
  const ctx = await browser.newContext({ locale: "ja-JP" });
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: t })), theme);
  const reqs = [];
  page.on("request", (q) => { if (/three/.test(q.url())) reqs.push(q.url().split("/").pop()); });
  await page.goto("http://localhost:8743/");
  await page.waitForTimeout(2500);
  console.log("theme", theme, "-> three:", reqs.length ? reqs.join(",") : "なし");
  await ctx.close();
}
await browser.close();
srv.kill();
