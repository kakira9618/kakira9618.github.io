// maskable アイコン（icon-maskable-*.png）を icon-*.png から生成する。
// maskable は Android のアダプティブアイコンとして任意の形（円・角丸・雫）に
// 切り抜かれるため、(1) 透過・角丸を残さず全面を背景色で塗りつぶし、
// (2) 図案をセーフゾーン内に収まるよう縮小して中央に置く、の 2 点が必須。
// 実行: node tools/make-maskable-icons.mjs（要 ImageMagick）
import { execFileSync } from "node:child_process";

// アイコンの地の色。透過部分と余白を同じ色で埋め、どこで切り抜かれても継ぎ目が出ないようにする。
const BACKGROUND = "#6aaa64";
// 図案の占める比率。maskable の推奨セーフゾーンは中央 80%。
const ART_RATIO = 0.78;
const SIZES = [192, 512];

for (const size of SIZES) {
  const art = Math.round(size * ART_RATIO);
  const source = `icon-${size}.png`;
  const output = `icon-maskable-${size}.png`;
  execFileSync("magick", [
    "-size", `${size}x${size}`,
    `xc:${BACKGROUND}`,
    "(", source, "-resize", `${art}x${art}`, ")",
    "-gravity", "center",
    "-composite",
    // アルファを落とし、アダプティブアイコン生成時に透過が悪さをしないようにする。
    "-alpha", "remove", "-alpha", "off",
    // 16bit で書き出されると無用に大きくなる上、古い環境で扱いが怪しいので 8bit に固定。
    "-depth", "8",
    output,
  ], { stdio: "inherit" });
  console.log(`${output}: ${size}x${size} (art ${art}px, bg ${BACKGROUND})`);
}
