// 前面の 3D エフェクト層（Three.js）。
// - burstAt: タイル開示や勝利時のパーティクルバースト
// - flyInTiles: 新しい行のタイルが奥・画面外から 3D 回転しながら集合してくる演出
//
// カメラは「z=0 平面が CSS ピクセルと 1:1 で一致する」透視投影。
// これにより DOM 要素の位置へ正確に着地しつつ、translateZ / 回転に
// 本物の遠近感が付く。CSS 座標 (y 下向き) → ワールド座標は y を反転して使う。

import * as THREE from "three";
import { FX, UI } from "../config.js?v=20260722-review-fixes";
import { getSettings } from "../core/settings.js?v=20260722-review-fixes";
import { shouldReduceMotion } from "../core/motion.js?v=20260722-review-fixes";

let renderer = null;
let scene = null;
let camera = null;
let viewH = 0;
let particles = []; // { mesh(Points), born, life }
let flights = []; // { mesh, from, to, rot0, start, dur, onArrive, arrived }
let running = false;
let failureHandler = () => {};

export function initBursts(onFailure = () => {}) {
  failureHandler = onFailure;
  const canvas = document.getElementById("fx3d");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  // WebGL の初期クリア色は不透明黒。一度も render せずに clear() すると
  // 全画面が黒く塗られるため（pop テーマ → 戻る で発生）、透明を明示する。
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene();
  resize();
  addEventListener("resize", resize);
}

function resize() {
  if (!renderer) return;
  const w = innerWidth;
  const h = innerHeight;
  viewH = h;
  renderer.setSize(w, h, false);
  // fov から「z=0 で 1px = 1world」になるカメラ距離を求める
  const fov = 45;
  const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  camera = new THREE.PerspectiveCamera(fov, w / h, 10, dist * 5);
  camera.position.set(w / 2, h / 2, dist);
  camera.lookAt(w / 2, h / 2, 0);
}

// CSS 座標 → ワールド座標
const toWorldY = (cssY) => viewH - cssY;

function ensureLoop() {
  if (!running) {
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }
}

// ---- パーティクルバースト ----

// 中心 (cx, cy)（CSS ピクセル）から count 個の粒子を色 colorHex で放つ
export function burstAt(cx, cy, colorHex, count) {
  const s = getSettings();
  // classic は演出なし。pop は明るい背景に沈まないよう通常合成で描く。
  if ((s.theme !== "cyber" && s.theme !== "pop") || shouldReduceMotion(s)) return;
  const cfg = FX.burst;
  const n = count;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 2); // CSS 方向の速度 (y 下向き) で持つ
  for (let i = 0; i < n; i++) {
    pos[i * 3] = cx;
    pos[i * 3 + 1] = toWorldY(cy);
    pos[i * 3 + 2] = 0;
    const ang = Math.random() * Math.PI * 2;
    const spd = cfg.speed * (0.3 + Math.random() * 0.9);
    vel[i * 2] = Math.cos(ang) * spd;
    vel[i * 2 + 1] = Math.sin(ang) * spd - cfg.speed * 0.25; // やや上向き
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size: cfg.sizePx * (1 + Math.random() * 0.6),
    transparent: true,
    opacity: 1,
    blending: s.theme === "pop" ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.userData.vel = vel;
  scene.add(mesh);
  particles.push({ mesh, born: performance.now(), life: cfg.lifeMs });
  ensureLoop();
}

// DOM 要素の中心から放つ
export function burstAtElement(elem, colorHex, count) {
  const r = elem.getBoundingClientRect();
  burstAt(r.left + r.width / 2, r.top + r.height / 2, colorHex, count);
}

// 勝利演出: 画面中央上部で連続バースト
export function winBurst(colors) {
  const cfg = FX.burst;
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      try {
        burstAt(
          innerWidth * (0.25 + Math.random() * 0.5),
          innerHeight * (0.2 + Math.random() * 0.35),
          colors[i % colors.length],
          cfg.countWin / 4
        );
      } catch (error) {
        failureHandler(error);
      }
    }, i * 180);
  }
}

// ---- タイル集合演出 ----

// タイルの見た目（角丸 + ネオン枠 + 半透明フィル + 入力文字）を作る。
// setText() で飛行中のテクスチャも更新し、DOM タイルへの着地まで文字を保つ。
function makeTileFace(w, h, edgeColor, fillColor, initialText = "") {
  const dpr = 2;
  const cv = document.createElement("canvas");
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const draw = (text) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = 8;
    const inset = 2;
    g.beginPath();
    g.roundRect(inset, inset, w - inset * 2, h - inset * 2, r);
    g.fillStyle = fillColor;
    g.fill();
    g.shadowColor = edgeColor;
    g.shadowBlur = 6;
    g.lineWidth = 2;
    g.strokeStyle = edgeColor;
    g.stroke();
    if (text) {
      g.shadowBlur = 4;
      g.shadowColor = "rgba(0, 0, 0, 0.7)";
      g.fillStyle = "#e8f6ff";
      g.font = `800 ${Math.round(h * 0.52)}px "Avenir Next", "Helvetica Neue", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(text).toUpperCase(), w / 2, h / 2 + 1);
    }
    tex.needsUpdate = true;
  };
  draw(initialText);
  return { texture: tex, setText: draw };
}

/**
 * DOM タイル (targetElements) の現在位置へ、
 * 3D 空間の奥・外側からタイル面が回転しながら飛来する。
 * 飛行中は各フレームで位置を取り直し、盤面スクロールにも追従する。
 * 各タイルが着地した瞬間に onArrive(i) を呼ぶ。全着地で resolve。
 * cyber テーマ以外・パーティクルオフ時は何もせず即 resolve する。
 */
export function flyInTiles(targetElements, isUso, initialTexts = [], scrollContainer = null) {
  const s = getSettings();
  if (s.theme !== "cyber" || shouldReduceMotion(s) || targetElements.length === 0) {
    return { skipped: true, promise: Promise.resolve(), onArrive: null };
  }
  const rects = targetElements.map((element) => element.getBoundingClientRect());
  const g = FX.gather;
  const edge = isUso ? g.edgeUso : g.edgeNormal;
  const w = rects[0].width;
  const h = rects[0].height;
  const geo = new THREE.PlaneGeometry(w, h);

  let arriveCb = null;
  const flightGroup = [];
  const now = performance.now();
  const diag = Math.max(innerWidth, innerHeight);
  const scrollRect = scrollContainer?.getBoundingClientRect();
  const scrollTracking = scrollContainer
    ? {
        element: scrollContainer,
        left: scrollContainer.scrollLeft,
        top: scrollContainer.scrollTop,
        viewportLeft: scrollRect.left,
        viewportTop: scrollRect.top,
      }
    : null;

  rects.forEach((rect, i) => {
    const face = makeTileFace(w, h, edge, g.faceFill, initialTexts[i] ?? "");
    const mat = new THREE.MeshBasicMaterial({
      map: face.texture,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const tx = rect.left + rect.width / 2;
    const ty = toWorldY(rect.top + rect.height / 2);
    // 開始位置: ターゲットから見て外側のランダム方向 + 奥（or 少し手前）
    const ang = Math.random() * Math.PI * 2;
    const dist = diag * (g.startDist[0] + Math.random() * (g.startDist[1] - g.startDist[0]));
    const from = new THREE.Vector3(
      tx + Math.cos(ang) * dist,
      ty + Math.sin(ang) * dist * 0.7,
      g.depthRange[0] + Math.random() * (g.depthRange[1] - g.depthRange[0])
    );
    const rot0 = new THREE.Euler(
      (Math.random() - 0.5) * 2 * THREE.MathUtils.degToRad(g.maxTiltDeg),
      (Math.random() - 0.5) * 2 * THREE.MathUtils.degToRad(g.maxTiltDeg),
      (Math.random() - 0.5) * 2 * THREE.MathUtils.degToRad(g.maxTiltDeg)
    );
    mesh.position.copy(from);
    mesh.rotation.copy(rot0);
    scene.add(mesh);
    flightGroup.push({
      mesh,
      from,
      to: new THREE.Vector3(tx, ty, 0),
      rot0,
      start: now + i * g.staggerMs,
      dur: g.durationMs,
      index: i,
      arrived: false,
      face,
      targetElement: targetElements[i],
      targetCssX: rect.left + rect.width / 2,
      targetCssY: rect.top + rect.height / 2,
    });
  });

  let resolveAll;
  const promise = new Promise((r) => (resolveAll = r));
  flights.push({
    group: flightGroup,
    geo,
    onArrive: (i) => arriveCb?.(i),
    resolveAll,
    scrollTracking,
  });
  ensureLoop();
  return {
    skipped: false,
    promise,
    set onArrive(fn) {
      arriveCb = fn;
    },
    setText(index, text) {
      const tile = flightGroup[index];
      if (tile && !tile.arrived) tile.face.setText(text);
    },
  };
}

function disposeFlight(flight) {
  for (const tile of flight.group) {
    if (tile.mesh.parent) scene.remove(tile.mesh);
    tile.mesh.material.dispose();
    tile.face.texture.dispose();
  }
  flight.geo.dispose();
  flight.resolveAll();
}

// ゲーム画面を離れた時など、進行中の集合タイルを即座に消す。
export function cancelTileFlights() {
  const pending = flights;
  flights = [];
  pending.forEach(disposeFlight);
  if (renderer && particles.length === 0) {
    try {
      renderer.clear();
    } catch {
      // WebGL 障害時も DOM タイルの復帰処理を優先する。
    }
  }
}

export function activeTileFlightCount() {
  return flights.length;
}

// ---- 描画ループ ----

let lastTime = 0;
function loop(now) {
  try {
    renderFrame(now);
  } catch (error) {
    running = false;
    cancelTileFlights();
    failureHandler(error);
  }
}

function renderFrame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const cfg = FX.burst;

  // パーティクル更新
  particles = particles.filter((p) => {
    const age = now - p.born;
    if (age > p.life) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      return false;
    }
    const pos = p.mesh.geometry.attributes.position;
    const vel = p.mesh.userData.vel;
    for (let i = 0; i < pos.count; i++) {
      vel[i * 2 + 1] += cfg.gravity * dt; // CSS 方向 (下向き) に重力
      pos.array[i * 3] += vel[i * 2] * dt;
      pos.array[i * 3 + 1] -= vel[i * 2 + 1] * dt; // ワールドは y 反転
    }
    pos.needsUpdate = true;
    p.mesh.material.opacity = 1 - age / p.life;
    return true;
  });

  // タイル飛来更新
  flights = flights.filter((flight) => {
    let allDone = true;
    let trackedScrollX = 0;
    let trackedScrollY = 0;
    if (flight.scrollTracking) {
      const tracking = flight.scrollTracking;
      const currentRect = tracking.element.getBoundingClientRect();
      trackedScrollX =
        tracking.left - tracking.element.scrollLeft + currentRect.left - tracking.viewportLeft;
      trackedScrollY =
        tracking.top - tracking.element.scrollTop + currentRect.top - tracking.viewportTop;
    }
    for (const f of flight.group) {
      if (f.arrived) continue;
      const targetRect = flight.scrollTracking ? null : f.targetElement.getBoundingClientRect();
      const nextX = flight.scrollTracking
        ? f.targetCssX + trackedScrollX
        : targetRect.left + targetRect.width / 2;
      const nextCssY = flight.scrollTracking
        ? f.targetCssY + trackedScrollY
        : targetRect.top + targetRect.height / 2;
      const nextY = toWorldY(nextCssY);
      const dx = nextX - f.to.x;
      const dy = nextY - f.to.y;
      // 集合先だけでなく飛行経路全体を移動し、スクロール操作へ即時追従させる。
      f.from.x += dx;
      f.from.y += dy;
      f.to.set(nextX, nextY, 0);
      const t = (now - f.start) / f.dur;
      if (t < 0) {
        allDone = false;
        continue; // stagger 待ち
      }
      if (t >= 1) {
        f.arrived = true;
        scene.remove(f.mesh);
        f.mesh.material.dispose();
        flight.onArrive(f.index);
        continue;
      }
      allDone = false;
      // 減速カーブ: 序盤に大きく動き、終盤にゆっくり収まる（動きが見える）
      const p = 1 - Math.pow(1 - t, 2.6);
      f.mesh.position.lerpVectors(f.from, f.to, p);
      f.mesh.rotation.set(f.rot0.x * (1 - p), f.rot0.y * (1 - p), f.rot0.z * (1 - p));
      f.mesh.material.opacity = Math.min(1, t * 2.2);
    }
    if (allDone) {
      disposeFlight(flight);
      return false;
    }
    return true;
  });

  renderer.render(scene, camera);
  if (particles.length > 0 || flights.length > 0) {
    requestAnimationFrame(loop);
  } else {
    running = false;
    renderer.clear();
  }
}

// タイル状態 → バースト色（現在のテーマの判定色と合わせる）
export function colorForState(state) {
  const colors = UI.tileColors[getSettings().theme] ?? UI.tileColors.cyber;
  const hex = { unused: colors.unused, used: colors.used, correct: colors.correct }[state] ?? "#ffffff";
  return new THREE.Color(hex).getHex();
}
