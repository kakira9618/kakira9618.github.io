// 本番を何度も読み込み直して、ロゴの実効ウェイト・描画幅がばらつくかを見る。
// 幅が広い＝細い字（ウェイトが効いていない）ことが多いので、幅を指標にする。
import { chromium } from "playwright";

const target = process.argv[2] ?? "https://kakira9618.github.io/DWORDle2/";
const runs = Number(process.argv[3] ?? 8);
const browser = await chromium.launch();

for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.locator(".logo").waitFor();
  // 描画直後と、少し待った後の 2 点で測る
  const early = await page.locator(".logo").evaluate((el) => {
    const s = getComputedStyle(el);
    return { w: Math.round(el.getBoundingClientRect().width), weight: s.fontWeight, family: s.fontFamily.split(",")[0] };
  });
  await page.waitForTimeout(1800);
  const late = await page.locator(".logo").evaluate((el) => {
    const s = getComputedStyle(el);
    return { w: Math.round(el.getBoundingClientRect().width), weight: s.fontWeight, family: s.fontFamily.split(",")[0] };
  });
  console.log(`#${i + 1} 直後: ${early.w}px w${early.weight} ${early.family} / 1.8s後: ${late.w}px w${late.weight} ${late.family}`);
  await context.close();
}
await browser.close();
