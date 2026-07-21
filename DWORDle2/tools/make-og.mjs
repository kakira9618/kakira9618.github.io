// tools/og.html を 1200x630 でスクリーンショットして og.png を更新する。
// 使い方: node tools/make-og.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(root, "tools", "og.html")}`, { waitUntil: "networkidle" });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(root, "og.png") });
await browser.close();
console.log("og.png を更新しました");
