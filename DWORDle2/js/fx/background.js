// サイバーテーマの 3D 背景（Three.js）。
// 流れるネオングリッド + 地平線の発光 + 玉ボケ（大きく柔らかい光）+
// ゆっくり上昇する塵。すべて柔らかいスプライトで描き、きらめき（明滅）を付ける。
// さらに大きめの天体（リング付き惑星・月）・星雲・流れ星を置き、
// グリッドや天体の色相をごくゆっくり揺らして、じわじわ変わる空にする。
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
let planet = null; // リング付き惑星（Sprite）
let moon = null; // ゆっくり横断する月（Sprite）
let nebulae = []; // [{ sprite, baseX, baseY, speed, phase }]
let shootingStars = []; // [{ sprite, vx, vy, born }]
let nextShootingStarAt = 0;
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

// リング付き惑星のテクスチャ。光源は左上、リングは奥→球→手前の順で描く。
function makePlanetTexture(palette, size = 256) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.25;
  const ringTilt = -0.46;
  const ringRx = R * 1.9;
  const ringRy = R * 0.52;

  // 淡い光輪
  const halo = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 2.1);
  halo.addColorStop(0, "rgba(255,255,255,0.16)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);

  const strokeRing = (clipLower) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(ringTilt);
    if (clipLower) {
      g.beginPath();
      g.rect(-size / 2, 0, size, size / 2);
      g.clip();
    }
    for (const [scale, width, alpha] of [[1, R * 0.34, 0.85], [0.8, R * 0.1, 0.5]]) {
      g.beginPath();
      g.ellipse(0, 0, ringRx * scale, ringRy * scale, 0, 0, Math.PI * 2);
      g.globalAlpha = alpha;
      g.strokeStyle = palette.ring;
      g.lineWidth = width;
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
  };

  strokeRing(false); // 奥側（全周を薄く敷く）

  // 球体: 左上からの光
  const sphere = g.createRadialGradient(cx - R * 0.45, cy - R * 0.5, R * 0.1, cx, cy, R * 1.12);
  sphere.addColorStop(0, palette.light);
  sphere.addColorStop(0.55, palette.base);
  sphere.addColorStop(1, "rgba(0,0,0,0.9)");
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fillStyle = sphere;
  g.fill();

  // 縞模様（球にクリップして数本）
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = palette.band;
  for (const [yr, hr] of [[-0.45, 0.1], [-0.1, 0.16], [0.32, 0.12]]) {
    g.beginPath();
    g.ellipse(cx, cy + R * yr, R * 1.05, R * hr, -0.06, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  strokeRing(true); // 手前側（球の下半分の前を通る）

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// シンプルな影付きの月テクスチャ
function makeMoonTexture(size = 96) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const cx = size / 2;
  const R = size * 0.4;
  const grad = g.createRadialGradient(cx - R * 0.4, cx - R * 0.42, R * 0.1, cx, cx, R * 1.05);
  grad.addColorStop(0, "rgba(235,240,250,0.95)");
  grad.addColorStop(0.7, "rgba(150,165,195,0.85)");
  grad.addColorStop(1, "rgba(40,50,70,0.6)");
  g.beginPath();
  g.arc(cx, cx, R, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  // クレーター
  g.fillStyle = "rgba(90,105,135,0.35)";
  for (const [x, y, r] of [[0.62, 0.4, 0.1], [0.4, 0.62, 0.07], [0.55, 0.6, 0.05]]) {
    g.beginPath();
    g.arc(size * x, size * y, size * r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function spriteOf(texture, opacity = 1) {
  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false, // 遠景の天体はフォグで消さない
    })
  );
}

function buildSkyObjects() {
  const cfg = FX.bg;
  disposeSkyObjects();

  // 惑星
  planet = spriteOf(makePlanetTexture(uso ? cfg.planet.paletteUso : cfg.planet.palette), 0.9);
  planet.scale.set(cfg.planet.size, cfg.planet.size, 1);
  planet.position.set(...cfg.planet.pos);
  scene.add(planet);

  // 月
  moon = spriteOf(makeMoonTexture(), 0.8);
  moon.scale.set(cfg.moon.size, cfg.moon.size, 1);
  moon.position.set(0, cfg.moon.y, cfg.moon.z);
  scene.add(moon);

  // 星雲
  nebulae = [];
  const colors = uso ? cfg.nebula.colorsUso : cfg.nebula.colors;
  for (let i = 0; i < cfg.nebula.count; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: colors[i % colors.length],
        transparent: true,
        opacity: cfg.nebula.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    const scale = cfg.nebula.scale[0] + Math.random() * (cfg.nebula.scale[1] - cfg.nebula.scale[0]);
    sprite.scale.set(scale * (1.4 + Math.random() * 0.5), scale, 1);
    const baseX = (Math.random() - 0.5) * 240;
    const baseY = 28 + Math.random() * 45;
    sprite.position.set(baseX, baseY, -160 - Math.random() * 30);
    scene.add(sprite);
    nebulae.push({ sprite, baseX, baseY, speed: 0.6 + Math.random() * 0.8, phase: Math.random() * Math.PI * 2 });
  }
}

function disposeSkyObjects() {
  for (const obj of [planet, moon, ...nebulae.map((n) => n.sprite), ...shootingStars.map((s) => s.sprite)]) {
    if (!obj) continue;
    scene.remove(obj);
    obj.material.map?.dispose?.();
    obj.material.dispose();
  }
  planet = null;
  moon = null;
  nebulae = [];
  shootingStars = [];
}

// 流れ星を 1 つ発生させる（引き伸ばした glow スプライトを走らせる）
function spawnShootingStar() {
  const cfg = FX.bg.shootingStar;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: uso ? 0xffa088 : 0xcdefff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  );
  const angle = -0.5 - Math.random() * 0.5; // 右上から左下へ
  const dir = Math.random() < 0.5 ? 1 : -1; // 左右どちらからも流れる
  sprite.scale.set(cfg.length, 1.1, 1);
  sprite.material.rotation = dir > 0 ? angle : Math.PI - angle;
  sprite.position.set(dir * (30 + Math.random() * 90) * -1, 46 + Math.random() * 22, -110 - Math.random() * 40);
  scene.add(sprite);
  shootingStars.push({
    sprite,
    vx: Math.cos(angle) * cfg.speed * dir,
    vy: Math.sin(angle) * cfg.speed,
    born: t,
  });
}

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

  buildSkyObjects();
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
  buildSkyObjects();
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

    // ---- じわじわ変わる空 ----
    // グリッドと地平線の色相を長い周期でゆっくり揺らす
    const hueShift = Math.sin(t * cfg.hueDriftSpeed) * cfg.hueDriftAmp;
    const gridBase = new THREE.Color(uso ? cfg.gridColorUso : cfg.gridColor);
    gridBase.offsetHSL(hueShift, 0, 0);
    grid1.material.color.copy(gridBase);
    grid2.material.color.copy(gridBase);
    const horizonBase = new THREE.Color(uso ? cfg.horizonColorUso : cfg.horizonColor);
    horizonBase.offsetHSL(hueShift, 0, 0.01 * Math.sin(t * 0.09));
    horizon.material.color.copy(horizonBase);

    // 惑星: ごくゆっくり漂い、呼吸するように明滅し、わずかに傾きを変える
    if (planet) {
      const p = cfg.planet;
      planet.position.x = p.pos[0] + Math.sin(t * 0.017) * p.driftAmp;
      planet.position.y = p.pos[1] + Math.sin(t * 0.023 + 1.7) * p.driftAmp * 0.45;
      planet.material.rotation = Math.sin(t * 0.011) * 0.09;
      planet.material.opacity = 0.82 + 0.1 * Math.sin(t * 0.06);
      const tint = 0.94 + 0.06 * Math.sin(t * cfg.hueDriftSpeed * 1.4 + 0.8);
      planet.material.color.setRGB(tint, tint, 1);
    }

    // 月: 何分もかけて空を横断し、端まで行ったら反対側から戻る
    if (moon) {
      const m = cfg.moon;
      const progress = (t / m.crossSec + 0.42) % 1; // 起動直後から画面内に見える位相で始める
      moon.position.x = -m.span / 2 + progress * m.span;
      moon.position.y = m.y - Math.sin(progress * Math.PI) * -6;
      moon.material.opacity = 0.55 + 0.25 * Math.sin(progress * Math.PI);
    }

    // 星雲: 別々の周期で極めてゆっくり流れ、濃さも変える
    for (const n of nebulae) {
      n.sprite.position.x = n.baseX + Math.sin(t * 0.006 * n.speed + n.phase) * 30;
      n.sprite.position.y = n.baseY + Math.sin(t * 0.004 * n.speed + n.phase * 2) * 8;
      n.sprite.material.opacity = cfg.nebula.opacity * (0.65 + 0.35 * Math.sin(t * 0.05 * n.speed + n.phase));
    }

    // 流れ星: たまに発生して斜めに走り、素早く消える
    if (t >= nextShootingStarAt) {
      const sc = cfg.shootingStar;
      if (nextShootingStarAt > 0) spawnShootingStar();
      nextShootingStarAt = t + sc.minIntervalSec + Math.random() * (sc.maxIntervalSec - sc.minIntervalSec);
    }
    shootingStars = shootingStars.filter((star) => {
      const age = t - star.born;
      const life = cfg.shootingStar.lifeSec;
      if (age > life) {
        scene.remove(star.sprite);
        star.sprite.material.dispose();
        return false;
      }
      star.sprite.position.x += star.vx / 60;
      star.sprite.position.y += star.vy / 60;
      // 出現直後にすっと明るくなり、後半で尾を引いて消える
      star.sprite.material.opacity = age < life * 0.25 ? (age / (life * 0.25)) * 0.8 : 0.8 * (1 - (age - life * 0.25) / (life * 0.75));
      return true;
    });

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  } catch (error) {
    running = false;
    failureHandler(error);
  }
}
