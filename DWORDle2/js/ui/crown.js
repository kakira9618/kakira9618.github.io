// FINAL ANSWER で当てた答えに付ける立体王冠。
// 16 個の頂点を楕円軌道上へ等間隔に置き、前後の y 座標と交互の高さを持たせる。

import { shouldReduceMotion } from "../core/motion.js?v=20260723-fa";

export const CROWN_POINT_COUNT = 16;
const TAU = Math.PI * 2;
const ROTATION_MS = 5600;

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const full = value.length === 3
    ? value.split("").map((part) => part + part).join("")
    : value;
  const number = Number.parseInt(full, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function crownPoints(phase, centerX, centerY, size) {
  const radiusX = size * 0.44;
  const radiusY = size * 0.105;
  const bandHeight = size * 0.14;
  return Array.from({ length: CROWN_POINT_COUNT }, (_, index) => {
    const angle = phase + index * TAU / CROWN_POINT_COUNT;
    const depth = Math.sin(angle);
    const rimY = centerY + depth * radiusY;
    const spikeHeight = size * (index % 2 === 0 ? 0.36 : 0.21);
    return {
      angle,
      depth,
      x: centerX + Math.cos(angle) * radiusX,
      rimY,
      topY: rimY - spikeHeight,
      baseY: rimY + bandHeight,
    };
  });
}

function strokeConnection(ctx, from, to, fromKey, toKey, color, depth, width) {
  const alpha = 0.34 + (depth + 1) * 0.3;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width * (0.82 + (depth + 1) * 0.1);
  ctx.beginPath();
  ctx.moveTo(from.x, from[fromKey]);
  ctx.lineTo(to.x, to[toKey]);
  ctx.stroke();
}

// Canvas の保存画像と、結果画面のアニメーションで共通利用する。
export function drawCrown3D(ctx, centerX, centerY, size, phase = 0, color = "#ffd166") {
  const points = crownPoints(phase, centerX, centerY, size);
  const connections = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { point, next, depth: (point.depth + next.depth) / 2 };
  }).sort((a, b) => a.depth - b.depth);
  const orderedPoints = [...points].sort((a, b) => a.depth - b.depth);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = rgba(color, 0.56);
  ctx.shadowBlur = size * 0.12;

  // 奥側から描くことで、楕円軌道を回る頂点の前後関係を出す。
  for (const { point, next, depth } of connections) {
    strokeConnection(ctx, point, next, "baseY", "baseY", color, depth, size * 0.045);
    strokeConnection(ctx, point, next, "topY", "topY", color, depth, size * 0.055);
  }
  for (const point of orderedPoints) {
    strokeConnection(ctx, point, point, "topY", "baseY", color, point.depth, size * 0.045);
  }
  for (const point of orderedPoints) {
    const alpha = 0.46 + (point.depth + 1) * 0.26;
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(point.x, point.topY, size * 0.038, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
  return points;
}

export function createRotatingCrownCanvas(color = "#ffd166") {
  const logicalSize = 72;
  const pixelRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.className = "fa-crown";
  canvas.dataset.crownPoints = String(CROWN_POINT_COUNT);
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = Math.round(logicalSize * pixelRatio);
  canvas.height = Math.round(logicalSize * pixelRatio);
  const ctx = canvas.getContext("2d");
  ctx.scale(pixelRatio, pixelRatio);

  const render = (phase) => {
    ctx.clearRect(0, 0, logicalSize, logicalSize);
    drawCrown3D(ctx, logicalSize / 2, 46, 58, phase, color);
  };

  if (shouldReduceMotion()) {
    render(Math.PI / 9);
    return canvas;
  }

  const animate = (time) => {
    if (!canvas.isConnected) return;
    render((time % ROTATION_MS) / ROTATION_MS * TAU);
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
  return canvas;
}
