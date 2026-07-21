// Pop テーマの水玉背景（2D canvas）。
// 格子状に並んだドットの半径が、画面をゆっくり横切る 2 つの波の合成に合わせて
// 伸び縮みする。裏モード（DWORDlie）では配色を毒っ気のあるキャンディカラーに切り替える。
// pop 以外のテーマでは canvas を空にして描画ループも止める。
// 「演出を軽くする」時は波を止め、位相 0 の静止した水玉を 1 回だけ描く。

import { FX } from "../config.js";
import { getSettings, onSettingsChange } from "../core/settings.js";
import { onMotionPreferenceChange, shouldReduceMotion } from "../core/motion.js";

let canvas = null;
let ctx = null;
let running = false;
let uso = false;
let t = 0;

export function initPopBackground() {
  canvas = document.getElementById("bgPop");
  ctx = canvas?.getContext("2d") ?? null;
  if (!ctx) return;
  resize();
  addEventListener("resize", resize);
  applyTheme(getSettings().theme);
  onSettingsChange((s, key) => {
    if (key === "theme" || key === "reduceFx") applyTheme(s.theme);
  });
  onMotionPreferenceChange(() => applyTheme(getSettings().theme));
}

export function setPopBackgroundMood(usoMode) {
  uso = usoMode;
  // 静止描画中（演出を軽くする）でも配色の切り替えは即反映する
  if (ctx && !running && isPopActive()) draw();
}

function isPopActive() {
  return getSettings().theme === "pop";
}

function resize() {
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!running && isPopActive()) draw();
}

function applyTheme(theme) {
  const active = theme === "pop";
  const animate = active && !shouldReduceMotion();
  if (animate && !running) {
    running = true;
    requestAnimationFrame(loop);
  } else if (!animate) {
    running = false;
    if (!ctx) return;
    if (active) draw();
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
}

function loop() {
  if (!running) return;
  t += 1 / 60;
  draw();
  requestAnimationFrame(loop);
}

// 進行方向 angleDeg の平面波の、点 (x, y)・時刻 time における位相
function wavePhase(x, y, wave, time) {
  const a = (wave.angleDeg * Math.PI) / 180;
  const k = (Math.PI * 2) / wave.wavelengthPx;
  return (x * Math.cos(a) + y * Math.sin(a)) * k - time * wave.speed;
}

function draw() {
  const cfg = FX.popBg;
  const w = innerWidth;
  const h = innerHeight;
  ctx.clearRect(0, 0, w, h);
  const colors = uso ? cfg.colorsUso : cfg.colors;
  // fill の回数を色数までに抑えるため、同色のドットは 1 つの Path2D にまとめる
  const paths = colors.map(() => new Path2D());
  const time = shouldReduceMotion() ? 0 : t;
  const norm = 1 + cfg.wave2Mix; // 2 波の合成を [-1, 1] に収める
  // 格子全体をゆっくり斜めに流す。間隔で折り返すので継ぎ目は出ない
  const sa = (cfg.scroll.angleDeg * Math.PI) / 180;
  const wrap = (v) => ((v % cfg.spacing) + cfg.spacing) % cfg.spacing;
  const ox = wrap(time * cfg.scroll.speedPx * Math.cos(sa));
  const oy = wrap(time * cfg.scroll.speedPx * Math.sin(sa));
  const cols = Math.ceil(w / cfg.spacing) + 1;
  const rows = Math.ceil(h / cfg.spacing) + 1;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i - 0.5) * cfg.spacing + ox;
      const y = (j - 0.5) * cfg.spacing + oy;
      const wave =
        (Math.sin(wavePhase(x, y, cfg.wave1, time)) + cfg.wave2Mix * Math.sin(wavePhase(x, y, cfg.wave2, time))) / norm;
      const r = cfg.baseRadius * (1 + cfg.waveAmp * wave);
      const path = paths[(i + j) % paths.length];
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  colors.forEach((color, c) => {
    ctx.fillStyle = color;
    ctx.fill(paths[c]);
  });
}
