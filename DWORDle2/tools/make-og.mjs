// tools/og.html を 1200x630 で、tools/og-square.html を 1200x1200 でスクリーンショットして
// og.png / og-square.png を更新する。正方形版は X の Summary カード（twitter:image）用。
// 使い方: node tools/make-og.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  { html: "og.html", out: "og.png", width: 1200, height: 630 },
  { html: "og-square.html", out: "og-square.png", width: 1200, height: 1200 },
];

const browser = await chromium.launch({ headless: true });
for (const { html, out, width, height } of targets) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(root, "tools", html)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(root, out) });
  await page.close();
  console.log(`${out} を更新しました`);
}
await browser.close();
