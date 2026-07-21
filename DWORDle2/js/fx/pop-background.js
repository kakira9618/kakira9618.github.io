// Pop テーマの水玉背景（2D canvas）。
// 格子状に並んだドットの半径が、画面をゆっくり横切る 2 つの波の合成に合わせて
// 伸び縮みする。その上を、盤面タイル風の 1x5 ラインが 5 本ほど、ゆっくり回転しながら
// 画面上から下へエンドレスに流れ落ちる（画面下へ抜けたら上から降り直す）。
// ラインは全て白（未判定）で現れ、バラバラの時差で 1 枚ずつ判定色にフリップし、
// その瞬間に控えめなパーティクルが散る。あくまで背景なので全体に薄く描く。
// 裏モード（DWORDlie）では配色を毒っ気のあるキャンディカラーに切り替える。
// pop 以外のテーマでは canvas を空にして描画ループも止める。
// 「演出を軽くする」時はアニメーションを止め、判定済みの静止したラインを 1 回だけ描く。

import { FX } from "../config.js?v=20260722-oldchrome-colormix";
import { getSettings, onSettingsChange } from "../core/settings.js?v=20260722-oldchrome-colormix";
import { onMotionPreferenceChange, shouldReduceMotion } from "../core/motion.js?v=20260722-oldchrome-colormix";

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
    lastFrameAt = 0;
    requestAnimationFrame(loop);
  } else if (!animate) {
    running = false;
    if (!ctx) return;
    if (active) {
      // 静止画では反転途中の姿やパーティクルを残さず、判定済みの状態で描く
      snapReveals();
      draw();
    } else {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }
}

let lastFrameAt = 0;

function loop(now = performance.now()) {
  if (!running) return;
  // rAF の間隔は環境依存（120Hz 端末では約 8ms）のため、実経過時間で進める。
  // タブ復帰などの長い空白は 0.1 秒に丸めて演出の飛びを防ぐ。
  const dt = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 0.1) : 1 / 60;
  lastFrameAt = now;
  t += dt;
  stepLines(dt);
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
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

export function randomTileLineScale(random = Math.random) {
  const [min, max] = FX.popBg.tiles.scale;
  return min + random() * (max - min);
}

let particles = [];

// ラインが完全に画面外へ出たと見なせる余白（回転を考慮したラインの半径ぶん）
function lineMargin() {
  const cfg = FX.popBg.tiles;
  const maxScale = cfg.scale[1];
  return (((cfg.tilesPerLine - 1) / 2) * cfg.pitchPx + cfg.sizePx) * maxScale;
}

// band(0..lineCount-1) ごとに横位置を散らして、ラインが一箇所に固まらないようにする
function bandX(band) {
  const n = FX.popBg.tiles.lineCount;
  return ((band + rand(0.15, 0.85)) / n) * innerWidth;
}

// 画面上端より上（y < 0）で生まれたラインは、
// 判定（色付け）の開始を「画面に入ってから」を起点に数える
function makeLine(band, y) {
  const cfg = FX.popBg.tiles;
  const vy = rand(cfg.fallSpeedPx[0], cfg.fallSpeedPx[1]);
  const enterDelay = Math.max(0, -y / vy);
  const line = {
    band,
    x: bandX(band),
    y,
    angle: rand(0, Math.PI * 2),
    scale: randomTileLineScale(),
    spin: rand(cfg.spinDegPerSec[0], cfg.spinDegPerSec[1]) * (Math.PI / 180) * (Math.random() < 0.5 ? -1 : 1),
    vy,
    // dir=+1: 白 → 判定色 / dir=-1: 判定色 → 白。flipAt を過ぎるとフリップが走る
    tiles: Array.from({ length: cfg.tilesPerLine }, () => ({ color: 1, flipAt: Infinity, dir: 1, burst: true })),
    mode: "toColor",
    nextPhaseAt: Infinity,
  };
  scheduleReveal(line, enterDelay + rand(cfg.revealStartSec[0], cfg.revealStartSec[1]));
  return line;
}

// 端から順番に、1 枚ずつ不揃いな時差をつけて判定していく（始まる端はラインごとにランダム）
function scheduleReveal(line, delay) {
  const cfg = FX.popBg.tiles;
  const order = Array.from({ length: cfg.tilesPerLine }, (_, k) => k);
  if (Math.random() < 0.5) order.reverse();
  let at = t + delay;
  for (const k of order) {
    const tile = line.tiles[k];
    tile.color = 1 + ((Math.random() * 3) | 0);
    tile.flipAt = at;
    tile.dir = 1;
    tile.burst = false;
    at += rand(cfg.revealGapSec[0], cfg.revealGapSec[1]);
  }
  line.mode = "toColor";
  line.nextPhaseAt = Math.max(...line.tiles.map((tile) => tile.flipAt)) + cfg.revealFlipSec;
}

// 判定色 → 白へ戻す。原作 DWORDle にちなみ、回転しながら色が抜けていく。
// 発火タイミングはラインごとにランダムで、戻りも端から順番に走る
function scheduleRevert(line) {
  const cfg = FX.popBg.tiles;
  const order = Array.from({ length: cfg.tilesPerLine }, (_, k) => k);
  if (Math.random() < 0.5) order.reverse();
  let at = t + rand(cfg.revertDelaySec[0], cfg.revertDelaySec[1]);
  for (const k of order) {
    const tile = line.tiles[k];
    tile.flipAt = at;
    tile.dir = -1;
    tile.burst = true; // 白に戻るときはパーティクルなし（背景なので控えめに）
    at += rand(cfg.revertGapSec[0], cfg.revertGapSec[1]);
  }
  line.mode = "toWhite";
  line.nextPhaseAt = Math.max(...line.tiles.map((tile) => tile.flipAt)) + cfg.revertSpinSec;
}

function initLines() {
  const cfg = FX.popBg.tiles;
  const margin = lineMargin();
  const spread = cfg.spawnSpreadY * innerHeight;
  const loop = innerHeight + margin * 2 + spread;
  // 初期位相を周回全体（画面外の助走域も含む）に散らして、出現タイミング・y 座標が揃わないようにする
  lines = Array.from({ length: cfg.lineCount }, (_, i) =>
    makeLine(i, -margin - spread + ((i + rand(0.15, 0.85)) / cfg.lineCount) * loop)
  );
}

// 反転アニメの進行度（0 = 反転前、1 = 反転後）。長さは判定と白戻しで別
function flipProgress(tile) {
  const cfg = FX.popBg.tiles;
  const dur = tile.dir === 1 ? cfg.revealFlipSec : cfg.revertSpinSec;
  return Math.min(Math.max((t - tile.flipAt) / dur, 0), 1);
}

function snapReveals() {
  for (const line of lines) {
    for (const tile of line.tiles) {
      tile.flipAt = -Infinity;
      tile.dir = 1;
      tile.burst = true;
    }
  }
  particles = [];
}

function stepLines(dt) {
  const cfg = FX.popBg.tiles;
  const margin = lineMargin();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    line.y += line.vy * dt;
    line.angle += line.spin * dt;
    // 画面下へ抜けたら、同じ band の新しいライン（白）として上から降り直す（エンドレス）。
    // 生まれ直しの位置を上方向にランダムに離して、再登場のタイミングを散らす
    if (line.y > innerHeight + margin) {
      lines[i] = makeLine(line.band, -margin - rand(0, cfg.spawnSpreadY * innerHeight));
      continue;
    }
    // 判定 → 白戻し → また判定、を落ちている間ずっと繰り返す
    if (t >= line.nextPhaseAt) {
      if (line.mode === "toColor") scheduleRevert(line);
      else scheduleReveal(line, rand(cfg.revealStartSec[0], cfg.revealStartSec[1]));
    }
    // 判定色に切り替わる瞬間（フリップの折り返し）にパーティクルを 1 回だけ散らす
    line.tiles.forEach((tile, k) => {
      if (tile.burst || tile.dir !== 1 || t < tile.flipAt + cfg.revealFlipSec / 2) return;
      tile.burst = true;
      const off = (k - (cfg.tilesPerLine - 1) / 2) * cfg.pitchPx * line.scale;
      spawnParticles(line.x + Math.cos(line.angle) * off, line.y + Math.sin(line.angle) * off, tile.color, line.vy);
    });
  }
  stepParticles(dt);
}

function spawnParticles(x, y, colorIdx, inheritVy) {
  const p = FX.popBg.tiles.particle;
  for (let i = 0; i < p.count; i++) {
    const a = rand(0, Math.PI * 2);
    const speed = rand(p.speedPx[0], p.speedPx[1]);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed + inheritVy * 0.5,
      life: p.lifeSec,
      colorIdx,
    });
  }
}

function stepParticles(dt) {
  const p = FX.popBg.tiles.particle;
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += p.gravityPx * dt;
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
    ctx.scale(line.scale, line.scale);
    for (let k = 0; k < cfg.tilesPerLine; k++) {
      const tile = line.tiles[k];
      const x = (k - (cfg.tilesPerLine - 1) / 2) * cfg.pitchPx;
      const p = flipProgress(tile);
      if (tile.dir === 1) {
        // 判定: タイルの短辺を縮めて戻す疑似フリップ。折り返し（p=0.5）で白 → 判定色
        const sy = Math.abs(Math.cos(Math.PI * p));
        if (sy < 0.02) continue;
        const c = colors[(p >= 0.5 ? tile.color : 0) % colors.length];
        ctx.beginPath();
        ctx.roundRect(x - cfg.sizePx / 2, (-cfg.sizePx / 2) * sy, cfg.sizePx, cfg.sizePx * sy, cfg.cornerPx * sy);
        ctx.fillStyle = c.fill;
        ctx.fill();
        ctx.strokeStyle = c.stroke;
        ctx.stroke();
      } else {
        // 白戻し: 原作 DWORDle 風に、くるっと回転しながら色が抜けていく。
        // 白と判定色を単純に重ねると普段より濃く見えるので、α を按分したクロスフェードにする
        ctx.save();
        ctx.translate(x, 0);
        ctx.rotate(easeInOutCubic(p) * Math.PI * 2);
        const path = new Path2D();
        path.roundRect(-cfg.sizePx / 2, -cfg.sizePx / 2, cfg.sizePx, cfg.sizePx, cfg.cornerPx);
        if (p > 0) {
          const white = colors[0];
          ctx.globalAlpha = p;
          ctx.fillStyle = white.fill;
          ctx.fill(path);
          ctx.strokeStyle = white.stroke;
          ctx.stroke(path);
        }
        if (p < 1) {
          const c = colors[tile.color % colors.length];
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = c.fill;
          ctx.fill(path);
          ctx.strokeStyle = c.stroke;
          ctx.stroke(path);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
    ctx.restore();
  }
  drawParticles(colors);
}

function drawParticles(colors) {
  const p = FX.popBg.tiles.particle;
  for (const pt of particles) {
    ctx.globalAlpha = (pt.life / p.lifeSec) * p.alpha;
    ctx.fillStyle = colors[pt.colorIdx % colors.length].stroke;
    ctx.fillRect(pt.x - p.sizePx / 2, pt.y - p.sizePx / 2, p.sizePx, p.sizePx);
  }
  ctx.globalAlpha = 1;
}
