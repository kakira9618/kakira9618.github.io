// PWA のインストールアイコンを tools/app-icon.html から書き出す。
// 使い方: node tools/make-app-icons.mjs
//
//   icon-{192,512}.png          : purpose "any"。ランチャーが角丸などに整形する
//   icon-maskable-{192,512}.png : purpose "maskable"。Android のアダプティブアイコンとして
//                                 円・角丸・雫など任意の形に切り抜かれるため、
//                                 (1) 透過を残さず全面を地の色で塗り、
//                                 (2) 図案を中央の円（直径 80%）に収める。
//
// D² は D と 2 を独立配置した図案なので、CSS の座標そのままだとインクが中央からずれる。
// 書き出した PNG を実測して寄せ直すが、外接矩形の中心で合わせると肩の 2 に引っ張られて
// D が左下に沈んで見える。逆にインクの重心（面積の中心＝ほぼ D の中心）で合わせると
// 右上に寄りすぎるので、その中間（光学的な中心）に合わせている。
// 円形に切り抜かれる Android のアダプティブアイコンでは、この偏りがそのまま出る。
//
// favicon.png / og-square.png（L 字の帯入り）はこのスクリプトの対象外。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [192, 512];
// purpose "any" もランチャーが角丸に整形するので、端から少し離しておく
const ANY_ART_SCALE = 0.88;
// maskable は円形に切り抜かれても余裕があるよう、セーフゾーンより一回り小さくする
const MASKABLE_ART_SCALE = 0.66;
// インク中心を合わせ込む反復回数と許容誤差（キャンバス比）
const CENTERING_PASSES = 4;
const CENTERING_TOLERANCE = 0.001;

const targets = SIZES.flatMap((size) => [
  { out: `icon-${size}.png`, size, artScale: ANY_ART_SCALE, safeRadius: null },
  { out: `icon-maskable-${size}.png`, size, artScale: MASKABLE_ART_SCALE, safeRadius: 0.4 },
]);

// PNG のインク（地の色と違う画素）の範囲を測る
async function measureInk(page, buffer) {
  return page.evaluate(async (dataUrl) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const background = [data[0], data[1], data[2]];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        const difference =
          Math.abs(data[index] - background[0]) +
          Math.abs(data[index + 1] - background[1]) +
          Math.abs(data[index + 2] - background[2]);
        if (difference <= 18) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    let sumX = 0;
    let sumY = 0;
    let inkPixels = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const index = (y * canvas.width + x) * 4;
        const difference =
          Math.abs(data[index] - background[0]) +
          Math.abs(data[index + 1] - background[1]) +
          Math.abs(data[index + 2] - background[2]);
        if (difference <= 18) continue;
        sumX += x;
        sumY += y;
        inkPixels++;
      }
    }
    const size = canvas.width;
    const boxX = (minX + maxX) / 2 / size;
    const boxY = (minY + maxY) / 2 / size;
    const massX = sumX / inkPixels / size;
    const massY = sumY / inkPixels / size;
    return {
      // 光学的な中心（外接矩形の中心と重心の中間）
      centerX: (boxX + massX) / 2,
      centerY: (boxY + massY) / 2,
      left: minX / size,
      top: minY / size,
      right: (maxX + 1) / size,
      bottom: (maxY + 1) / size,
      width: (maxX - minX + 1) / size,
      height: (maxY - minY + 1) / size,
    };
  }, `data:image/png;base64,${buffer.toString("base64")}`);
}

const browser = await chromium.launch({ headless: true });
for (const { out, size, artScale, safeRadius } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(root, "tools", "app-icon.html")}`, { waitUntil: "networkidle" });
  await page.evaluate((scale) => {
    document.documentElement.style.setProperty("--art-scale", String(scale));
  }, artScale);

  // インク中心が真ん中に来るまで、平行移動量を実測で詰める
  let shiftX = -0.0315;
  let shiftY = 0.0935;
  let ink = null;
  for (let pass = 0; pass < CENTERING_PASSES; pass++) {
    await page.evaluate(({ x, y }) => {
      document.documentElement.style.setProperty("--shift-x", `${x * 100}%`);
      document.documentElement.style.setProperty("--shift-y", `${y * 100}%`);
    }, { x: shiftX, y: shiftY });
    ink = await measureInk(page, await page.screenshot({ type: "png" }));
    const errorX = 0.5 - ink.centerX;
    const errorY = 0.5 - ink.centerY;
    if (Math.abs(errorX) <= CENTERING_TOLERANCE && Math.abs(errorY) <= CENTERING_TOLERANCE) break;
    shiftX += errorX;
    shiftY += errorY;
  }

  await page.screenshot({ path: path.join(root, out), type: "png" });
  await page.close();
  // 円形クロップの判定は、キャンバス中心からインク四隅までの最遠距離で見る
  const reach = Math.max(
    Math.hypot(Math.max(0.5 - ink.left, ink.right - 0.5), Math.max(0.5 - ink.top, ink.bottom - 0.5))
  );
  const fit = safeRadius === null ? "" : `, 円内 ${(reach / safeRadius * 100).toFixed(0)}%`;
  console.log(
    `${out}: ${size}x${size} (art ${artScale}, ink ${(ink.width * 100).toFixed(1)}x${(ink.height * 100).toFixed(1)}%` +
    `, 中心 ${(ink.centerX * 100).toFixed(2)}/${(ink.centerY * 100).toFixed(2)}%${fit})`
  );
  if (safeRadius !== null && reach > safeRadius) {
    throw new Error(`${out}: 図案が maskable のセーフゾーン（半径 ${safeRadius * 100}%）からはみ出している`);
  }
}
await browser.close();
