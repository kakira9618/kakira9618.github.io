// サイバーテーマの 3D 背景（Three.js）。
// 流れるネオングリッド + 地平線の発光 + 玉ボケ（大きく柔らかい光）+
// ゆっくり上昇する塵。すべて柔らかいスプライトで描き、きらめき（明滅）を付ける。
// classic テーマでは canvas ごと非表示になり、描画ループも止める。

import * as THREE from "three";
import { FX } from "../config.js";
import { getSettings, onSettingsChange } from "../core/settings.js";
import { onMotionPreferenceChange, shouldReduceMotion } from "../core/motion.js";

let renderer = null;
let scene = null;
let camera = null;
let grid1 = null;
let grid2 = null;
let horizon = null;
let bokeh = null; // { points, phases[] }
let dust = null; // { points, speeds[] }
let running = false;
let uso = false;
let t = 0;
let failureHandler = () => {};

// 柔らかい円形グラデーションのスプライトテクスチャ
function makeGlowTexture(size = 128, inner = 0.0) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let glowTex = null;

export function initBackground(onFailure = () => {}) {
  failureHandler = onFailure;
  const canvas = document.getElementById("bg3d");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070f, 0.016);

  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
  camera.position.set(0, 6.5, 26);
  camera.lookAt(0, 4, 0);

  glowTex = makeGlowTexture();

  const cfg = FX.bg;
  grid1 = new THREE.GridHelper(cfg.gridSize, cfg.gridDivisions, cfg.gridColor, cfg.gridColor);
  grid1.material.transparent = true;
  grid1.material.opacity = cfg.gridOpacity;
  grid1.position.y = -2;
  scene.add(grid1);
  grid2 = grid1.clone();
  grid2.position.z = -cfg.gridSize;
  scene.add(grid2);

  // 地平線の発光（大きなスプライトを横に潰して置く）
  horizon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: cfg.horizonColor,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  horizon.scale.set(340, 60, 1);
  horizon.position.set(0, -2, -120);
  scene.add(horizon);

  rebuildParticles();

  resize();
  addEventListener("resize", resize);

  applyTheme(getSettings().theme);
  onSettingsChange((s, key) => {
    if (key === "theme" || key === "reduceFx") applyTheme(s.theme);
  });
  onMotionPreferenceChange(() => applyTheme(getSettings().theme));
}

function disposeLayer(layer) {
  if (!layer) return;
  scene.remove(layer.points);
  layer.points.geometry.dispose();
  layer.points.material.dispose();
}

function rebuildParticles() {
  disposeLayer(bokeh);
  disposeLayer(dust);
  bokeh = null;
  dust = null;
  // 「演出を軽くする」= パーティクルを完全にオフ（グリッドと地平線は残す）
  if (shouldReduceMotion()) return;
  const cfg = FX.bg;
  const colors = (uso ? cfg.particleColorsUso : cfg.particleColors).map((c) => new THREE.Color(c));

  // ---- 玉ボケ層: 大きく柔らかい光を奥行きに散らす ----
  {
    const count = cfg.bokehCount;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 150;
      pos[i * 3 + 1] = 2 + Math.random() * 40;
      pos[i * 3 + 2] = -10 - Math.random() * 150;
      // 白を混ぜて上品に（彩度を落とす）
      const c = colors[i % colors.length].clone().lerp(new THREE.Color(0xffffff), 0.25 + Math.random() * 0.3);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      size[i] = cfg.bokehSize[0] + Math.random() * (cfg.bokehSize[1] - cfg.bokehSize[0]);
      phases[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    const mat = makeSpriteShaderMaterial(cfg.bokehOpacity);
    bokeh = { points: new THREE.Points(geo, mat), phases };
    scene.add(bokeh.points);
  }

  // ---- 塵層: 小さな光がゆっくり立ち上る ----
  {
    const count = cfg.dustCount;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 45;
      pos[i * 3 + 2] = -5 - Math.random() * 120;
      const c = colors[i % colors.length].clone().lerp(new THREE.Color(0xffffff), 0.5);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      size[i] = cfg.dustSize[0] + Math.random() * (cfg.dustSize[1] - cfg.dustSize[0]);
      speeds[i] = cfg.dustRise * (0.4 + Math.random());
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    const mat = makeSpriteShaderMaterial(cfg.dustOpacity);
    dust = { points: new THREE.Points(geo, mat), speeds };
    scene.add(dust.points);
  }
}

// サイズ属性つきの Points 用シェーダ（柔らかい円 + 距離減衰）
function makeSpriteShaderMaterial(opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: glowTex },
      opacity: { value: opacity },
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (240.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, opacity) * tex;
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function setBackgroundMood(usoMode) {
  uso = usoMode;
  if (!scene) return;
  const cfg = FX.bg;
  const gridColor = new THREE.Color(usoMode ? cfg.gridColorUso : cfg.gridColor);
  for (const g of [grid1, grid2]) g.material.color = gridColor;
  horizon.material.color = new THREE.Color(usoMode ? cfg.horizonColorUso : cfg.horizonColor);
  rebuildParticles();
}

function resize() {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

function applyTheme(theme) {
  try {
    const shouldRun = theme === "cyber" && !shouldReduceMotion();
    if (shouldRun && !running) {
      running = true;
      loop();
    } else if (!shouldRun) {
      running = false;
      renderer?.clear();
    }
    if (shouldRun) rebuildParticles(); // 設定・OS の動きの抑制変更を反映
  } catch (error) {
    running = false;
    failureHandler(error);
  }
}

function loop() {
  if (!running) return;
  try {
    t += 1 / 60;
    const cfg = FX.bg;
    const size = cfg.gridSize;
    const z = (t * cfg.scrollSpeed) % size;
    grid1.position.z = z;
    grid2.position.z = z - size;
    camera.position.x = Math.sin(t * 0.21) * cfg.cameraDrift;
    camera.position.y = 6.5 + Math.sin(t * 0.34) * 0.8;
    camera.lookAt(0, 4, -10);

    // 玉ボケ: ごくゆっくり漂い、明滅する
    if (bokeh) {
      bokeh.points.rotation.y = Math.sin(t * 0.03) * 0.05;
      bokeh.points.position.y = Math.sin(t * 0.12) * 0.8;
      bokeh.points.material.uniforms.opacity.value = cfg.bokehOpacity * (0.82 + 0.18 * Math.sin(t * 0.6));
    }
    // 塵: 上昇して上端で下へ戻る
    if (dust) {
      const pos = dust.points.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.array[i * 3 + 1] + dust.speeds[i] / 60;
        if (y > 46) y = 0;
        pos.array[i * 3 + 1] = y;
        pos.array[i * 3] += Math.sin(t * 0.5 + i) * 0.004; // 微かな横揺れ
      }
      pos.needsUpdate = true;
      dust.points.material.uniforms.opacity.value = cfg.dustOpacity * (0.75 + 0.25 * Math.sin(t * 1.1 + 1));
    }
    // 地平線の発光もわずかに呼吸させる
    horizon.material.opacity = 0.7 + 0.15 * Math.sin(t * 0.4);

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  } catch (error) {
    running = false;
    failureHandler(error);
  }
}
