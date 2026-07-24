// tools/og.html を 1200x630 の JPEG（og.jpg）で、tools/og-square.html を 1200x1200 の
// PNG（og-square.png）で書き出す。
// 使い方: node tools/make-og.mjs
//
// 形式を使い分けているのは、絵の性質でファイルサイズが大きく変わるため:
//   - og.jpg        : ネオンのグラデーションが主体。PNG（可逆）だと 423KB まで膨らむのに対し、
//                     JPEG 品質 90 なら 90KB で、暗部 PSNR 40.5dB とバンディングも出ない。
//                     og:image はシェアやクロールのたびに転送されるので軽さがそのまま効く。
//   - og-square.png : ベタ塗り 4 色のアイコン。JPEG だと輪郭にリンギングが出るうえ
//                     かえって大きくなるので PNG が最適（23KB）。
// 目安として OGP 画像は 100〜300KB に収める（WhatsApp は 300KB 超だとプレビューを出さない）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// og.jpg は og:image（横長カード）用、og-square.png は twitter:image（X の Summary カード）用。
const targets = [
  { html: "og.html", out: "og.jpg", width: 1200, height: 630, type: "jpeg", quality: 90 },
  { html: "og-square.html", out: "og-square.png", width: 1200, height: 1200, type: "png" },
];

const browser = await chromium.launch({ headless: true });
for (const { html, out, width, height, type, quality } of targets) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(root, "tools", html)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(root, out),
    type,
    ...(type === "jpeg" ? { quality } : {}),
  });
  await page.close();
  console.log(`${out} を更新しました`);
}
await browser.close();
