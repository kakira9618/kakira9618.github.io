// PWA のインストールアイコンを tools/app-icon.html から書き出す。
// 使い方: node tools/make-app-icons.mjs
//
//   icon-{192,512}.png          : purpose "any"。ランチャーが角丸などに整形する
//   icon-maskable-{192,512}.png : purpose "maskable"。Android のアダプティブアイコンとして
//                                 円・角丸・雫など任意の形に切り抜かれるため、
//                                 (1) 透過を残さず全面を地の色で塗り、
//                                 (2) 図案を中央 80% のセーフゾーンに収める。
//
// favicon.png / og-square.png（L 字の帯入り）はこのスクリプトの対象外。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [192, 512];
// purpose "any" もランチャーが角丸に整形するので、端から少し離しておく
const ANY_ART_SCALE = 0.94;
// maskable のセーフゾーン（中央 80%）に収まるよう図案を縮める倍率
const MASKABLE_ART_SCALE = 0.78;

const targets = SIZES.flatMap((size) => [
  { out: `icon-${size}.png`, size, artScale: ANY_ART_SCALE },
  { out: `icon-maskable-${size}.png`, size, artScale: MASKABLE_ART_SCALE },
]);

const browser = await chromium.launch({ headless: true });
for (const { out, size, artScale } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(root, "tools", "app-icon.html")}`, { waitUntil: "networkidle" });
  await page.evaluate((scale) => {
    document.documentElement.style.setProperty("--art-scale", String(scale));
  }, artScale);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(root, out), type: "png" });
  await page.close();
  console.log(`${out}: ${size}x${size} (art scale ${artScale})`);
}
await browser.close();
