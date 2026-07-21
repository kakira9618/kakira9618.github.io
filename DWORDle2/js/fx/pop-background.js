// Pop テーマの水玉背景（2D canvas）。
// 格子状に並んだドットの半径が、画面をゆっくり横切る 2 つの波の合成に合わせて
// 伸び縮みする。その上を、盤面タイル風の 1x5 ラインが 5 本ほど、ゆっくり回転しながら
// 画面上から下へエンドレスに流れ落ちる（画面下へ抜けたら上から降り直す）。
// 裏モード（DWORDlie）では配色を毒っ気のあるキャンディカラーに切り替える。
// pop 以外のテーマでは canvas を空にして描画ループも止める。
// 「演出を軽くする」時はアニメーションを止め、静止した水玉とラインを 1 回だけ描く。

import { FX } from "../config.js";
import { getSettings, onSettingsChange } from "../core/settings.js";
import { onMotionPreferenceChange, shouldReduceMotion } from "../core/motion.js";

let canvas = null;
let ctx = null;
let running = false;
let uso = false;
let t = 0;

let lines = [];

export function initPopBackground() {
  canvas = document.getElementById("bgPop");
  ctx = canvas?.getContext("2d") ?? null;
  if (!ctx) return;
  initLines();
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

let lastW = 0;
let lastH = 0;

function resize() {
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // ラインは画面比率に合わせて追従させる（モバイルのアドレスバー伸縮でも跳ばない）
  if (lastW > 0 && lastH > 0) {
    for (const line of lines) {
      line.x *= innerWidth / lastW;
      line.y *= innerHeight / lastH;
    }
  }
  lastW = innerWidth;
  lastH = innerHeight;
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
  stepLines(1 / 60);
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
  drawLines();
}

// ---- 盤面タイル風の 1x5 ライン ----

const rand = (min, max) => min + Math.random() * (max - min);

// ラインが完全に画面外へ出たと見なせる余白（回転を考慮したラインの半径ぶん）
function lineMargin() {
  const cfg = FX.popBg.tiles;
  return ((cfg.tilesPerLine - 1) / 2) * cfg.pitchPx + cfg.sizePx;
}

// band(0..lineCount-1) ごとに横位置を散らして、ラインが一箇所に固まらないようにする
function bandX(band) {
  const n = FX.popBg.tiles.lineCount;
  return ((band + rand(0.15, 0.85)) / n) * innerWidth;
}

function makeLine(band, y) {
  const cfg = FX.popBg.tiles;
  return {
    band,
    x: bandX(band),
    y,
    angle: rand(0, Math.PI * 2),
    spin: rand(cfg.spinDegPerSec[0], cfg.spinDegPerSec[1]) * (Math.PI / 180) * (Math.random() < 0.5 ? -1 : 1),
    vy: rand(cfg.fallSpeedPx[0], cfg.fallSpeedPx[1]),
    colors: Array.from({ length: cfg.tilesPerLine }, () => (Math.random() * 4) | 0),
  };
}

function initLines() {
  const cfg = FX.popBg.tiles;
  // 最初から画面全体に散らばった状態で開始する（上から順に降ってくるのを待たせない）
  lines = Array.from({ length: cfg.lineCount }, (_, i) =>
    makeLine(i, ((i + 0.5) / cfg.lineCount) * innerHeight + rand(-40, 40))
  );
}

function stepLines(dt) {
  const margin = lineMargin();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    line.y += line.vy * dt;
    line.angle += line.spin * dt;
    // 画面下へ抜けたら、同じ band の新しいラインとして上から降り直す（エンドレス）
    if (line.y > innerHeight + margin) {
      lines[i] = makeLine(line.band, -margin);
    }
  }
}

function drawLines() {
  const cfg = FX.popBg.tiles;
  const colors = uso ? cfg.colorsTileUso : cfg.colorsTile;
  ctx.lineWidth = cfg.strokeWidthPx;
  for (const line of lines) {
    ctx.save();
    ctx.translate(line.x, line.y);
    ctx.rotate(line.angle);
    for (let k = 0; k < cfg.tilesPerLine; k++) {
      const x = (k - (cfg.tilesPerLine - 1) / 2) * cfg.pitchPx;
      const c = colors[line.colors[k] % colors.length];
      ctx.beginPath();
      ctx.roundRect(x - cfg.sizePx / 2, -cfg.sizePx / 2, cfg.sizePx, cfg.sizePx, cfg.cornerPx);
      ctx.fillStyle = c.fill;
      ctx.fill();
      ctx.strokeStyle = c.stroke;
      ctx.stroke();
    }
    ctx.restore();
  }
}
