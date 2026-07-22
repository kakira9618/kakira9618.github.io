// サイバーテーマの 3D 背景（Three.js）。
// 流れるネオングリッド + 地平線の発光 + 蛍（強く光る芯とぼんやりした暈を持ち、
// 明滅しながら漂って軌跡を残す）+ ゆっくり上昇する塵。
// さらに空には大きくふわっとした光をいくつか浮かべ、
// グリッドや光の色相をごくゆっくり揺らして、じわじわ変わる空にする。
// classic テーマでは canvas ごと非表示になり、描画ループも止める。

import * as THREE from "three";
import { FX } from "../config.js?v=20260723-card-badges";
import { getSettings, onSettingsChange } from "../core/settings.js?v=20260723-card-badges";
import { onMotionPreferenceChange, shouldReduceMotion } from "../core/motion.js?v=20260723-card-badges";

let renderer = null;
let scene = null;
let camera = null;
let grid1 = null;
let grid2 = null;
let horizon = null;
let fireflies = null; // { points }（明滅・漂い・軌跡はシェーダ内で時間から計算する）
let dust = null; // { points, speeds[] }
let skyGlows = []; // [{ sprite, baseX, baseY, scale, speed, phase }]
let running = false;
let uso = false;
let t = 0;
let failureHandler = () => {};

// 柔らかい円形グラデーションのスプライトテクスチャ。
// canvas の放射グラデーションは 8bit かつ少数ストップの直線補間なので、
// ストップ位置で減衰の傾きが折れ、α が尽きる半径に段差が出て、
// 光の届く境界が円としてくっきり見えてしまう（マッハバンド）。
// half float の DataTexture に (1-r^2)^n を直接書き込み、量子化の段差なく
// 値も傾きも滑らかに 0 へ落とす（描画後の刻みは実測で最大 1 階調 = 8bit の下限）。
function makeGlowTexture(size = 128) {
  const falloffExp = 4; // 大きいほど光の裾が早く消える。4 で裾は半径の 8 割あたりに収まる
  const data = new Uint16Array(size * size * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const falloff = Math.max(0, 1 - (dx * dx + dy * dy));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = one;
      data[i + 3] = THREE.DataUtils.toHalfFloat(Math.pow(falloff, falloffExp));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 蛍用テクスチャ。小さく強い芯と、広くぼんやりした暈を 1 枚に描く
function makeFireflyTexture(size = 128) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.08, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.4)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let glowTex = null;
let fireflyTex = null;

// 空に浮かぶ大きくふわっとした光を並べる
function buildSkyObjects() {
  const cfg = FX.bg.skyGlow;
  disposeSkyObjects();

  const colors = uso ? cfg.colorsUso : cfg.colors;
  for (let i = 0; i < cfg.count; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: colors[i % colors.length],
        transparent: true,
        opacity: cfg.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false, // 遠景の光はフォグで消さない
      })
    );
    const scale = cfg.scale[0] + Math.random() * (cfg.scale[1] - cfg.scale[0]);
    const aspect = 1 + Math.random() * 0.3;
    sprite.scale.set(scale * aspect, scale, 1);
    const baseX = (Math.random() - 0.5) * 240;
    const baseY = 14 + Math.random() * 55;
    sprite.position.set(baseX, baseY, -130 - Math.random() * 50);
    scene.add(sprite);
    skyGlows.push({ sprite, baseX, baseY, scale, aspect, speed: 0.6 + Math.random() * 0.8, phase: Math.random() * Math.PI * 2 });
  }
}

function disposeSkyObjects() {
  for (const glow of skyGlows) {
    scene.remove(glow.sprite);
    glow.sprite.material.dispose();
  }
  skyGlows = [];
}

export function initBackground(onFailure = () => {}) {
  failureHandler = onFailure;
  const canvas = document.getElementById("bg3d");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  // 一度も render しないまま clear() すると WebGL 初期値の不透明黒で塗られるため、
  // 透明クリア色を明示する（fx/bursts.js と同じ対策）。
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070f, 0.016);

  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
  camera.position.set(0, 6.5, 26);
  camera.lookAt(0, 4, 0);

  glowTex = makeGlowTexture();
  fireflyTex = makeFireflyTexture();

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

  // モバイルで他アプリへ切り替えると GPU バッファが破棄され、復帰時に
  // 未初期化の VRAM（過去の画面の残骸）が出ることがある。描画ループ停止中は
  // 復帰・コンテキスト復元のたびに透明へ描き直す（ループ中は次フレームが上書きする）。
  canvas.addEventListener("webglcontextrestored", refreshSurface);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshSurface();
  });
  addEventListener("pageshow", refreshSurface);

  applyTheme(getSettings().theme);
  onSettingsChange((s, key) => {
    if (key === "theme" || key === "reduceFx") applyTheme(s.theme);
  });
  onMotionPreferenceChange(() => applyTheme(getSettings().theme));
}

function refreshSurface() {
  if (!renderer || running) return;
  try {
    renderer.setClearColor(0x000000, 0); // コンテキスト復元で GL 状態が初期化された場合に備える
    renderer.clear();
  } catch (error) {
    failureHandler(error);
  }
}

function disposeLayer(layer) {
  if (!layer) return;
  scene.remove(layer.points);
  layer.points.geometry.dispose();
  layer.points.material.dispose();
}

function rebuildParticles() {
  disposeLayer(fireflies);
  disposeLayer(dust);
  fireflies = null;
  dust = null;
  // 「演出を軽くする」= パーティクルを完全にオフ（グリッドと地平線は残す）
  if (shouldReduceMotion()) return;
  const cfg = FX.bg;
  const colors = (uso ? cfg.particleColorsUso : cfg.particleColors).map((c) => new THREE.Color(c));

  // ---- 蛍層: 明滅しながら漂う光。頭 1 点 + 過去位置をたどる軌跡の点で 1 匹を描く ----
  {
    const ff = cfg.firefly;
    const perFly = 1 + ff.trailPoints; // 頭 + 軌跡
    const count = ff.count * perFly;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const wander = new Float32Array(count * 3); // 漂いの振幅
    const freq = new Float32Array(count * 3); // 漂いの角速度
    const phase = new Float32Array(count * 3); // 漂いの位相
    const blink = new Float32Array(count * 2); // [明滅速度, 明滅位相]
    const trail = new Float32Array(count); // 0 = 頭、1..N = 軌跡
    const rand = (range) => range[0] + Math.random() * (range[1] - range[0]);
    for (let i = 0; i < ff.count; i++) {
      // 2 乗で手前に寄せ、蛍が小さな点にならないようにする
      const base = [(Math.random() - 0.5) * 120, 2 + Math.random() * 26, -10 - Math.random() * Math.random() * 90];
      // 芯を白く見せるぶん、暈の色はやや濃いめに残す
      const c = colors[i % colors.length].clone().lerp(new THREE.Color(0xffffff), 0.15 + Math.random() * 0.2);
      const s = rand(ff.size);
      const w = [rand(ff.wanderRadius), rand(ff.wanderRadius) * 0.55, rand(ff.wanderRadius) * 0.7];
      const f = [rand(ff.wanderSpeed), rand(ff.wanderSpeed), rand(ff.wanderSpeed)];
      const p = [Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2];
      const b = [rand(ff.blinkSpeed), Math.random()];
      for (let k = 0; k < perFly; k++) {
        const j = i * perFly + k;
        pos.set(base, j * 3);
        col.set([c.r, c.g, c.b], j * 3);
        size[j] = s;
        wander.set(w, j * 3);
        freq.set(f, j * 3);
        phase.set(p, j * 3);
        blink.set(b, j * 2);
        trail[j] = k;
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aWander", new THREE.BufferAttribute(wander, 3));
    geo.setAttribute("aFreq", new THREE.BufferAttribute(freq, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 3));
    geo.setAttribute("aBlink", new THREE.BufferAttribute(blink, 2));
    geo.setAttribute("aTrail", new THREE.BufferAttribute(trail, 1));
    fireflies = { points: new THREE.Points(geo, makeFireflyMaterial()) };
    fireflies.points.frustumCulled = false; // 位置はシェーダで動かすため元の境界では判定できない
    scene.add(fireflies.points);
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

// 蛍用の Points シェーダ。位置（漂い）・明滅・軌跡の減衰をすべて時間から解析的に
// 計算する。軌跡の点は「少し過去の時刻」で同じ式を評価するだけで頭の跡をたどる。
function makeFireflyMaterial() {
  const ff = FX.bg.firefly;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: fireflyTex },
      uTime: { value: 0 },
      uOpacity: { value: ff.opacity },
      uBaseGlow: { value: ff.baseGlow },
      uTrailDt: { value: ff.trailSpacingSec },
      uTrailPoints: { value: ff.trailPoints },
      uTrailSize: { value: ff.trailSize },
      uTrailGlow: { value: ff.trailGlow },
    },
    vertexShader: `
      attribute float size;
      attribute vec3 aWander;
      attribute vec3 aFreq;
      attribute vec3 aPhase;
      attribute vec2 aBlink;
      attribute float aTrail;
      uniform float uTime;
      uniform float uBaseGlow;
      uniform float uTrailDt;
      uniform float uTrailPoints;
      uniform float uTrailSize;
      uniform float uTrailGlow;
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        vColor = color;
        // 軌跡の点ほど過去の時刻で評価する
        float t = uTime - aTrail * uTrailDt;
        vec3 p = position + vec3(
          sin(t * aFreq.x + aPhase.x) * aWander.x,
          sin(t * aFreq.y + aPhase.y) * aWander.y,
          sin(t * aFreq.z + aPhase.z) * aWander.z
        );
        // 副振動で単純な楕円軌道になるのを崩す
        p.x += sin(t * aFreq.y * 1.7 + aPhase.z) * aWander.x * 0.35;
        p.y += sin(t * aFreq.z * 2.3 + aPhase.x) * aWander.y * 0.3;

        // 蛍の明滅: すっと立ち上がり、ゆっくり減衰して、しばらくぼんやりする
        float cyc = fract(t * aBlink.x + aBlink.y);
        float flare = smoothstep(0.0, 0.07, cyc) * pow(1.0 - smoothstep(0.10, 0.62, cyc), 1.5);
        float glow = mix(uBaseGlow, 1.0, flare);

        float isTrail = step(0.5, aTrail);
        float k = aTrail / max(uTrailPoints, 1.0);
        vGlow = glow * mix(1.0, uTrailGlow * (1.0 - k), isTrail);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float sizeScale = mix(0.85 + 0.45 * flare, uTrailSize * (1.0 - 0.5 * k), isTrail);
        gl_PointSize = size * sizeScale * (240.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        // 中心の芯は白く飛ばし、暈は蛍の色を残す
        float core = smoothstep(0.35, 0.95, tex.a);
        vec3 col = mix(vColor, vec3(1.0), core * 0.8);
        gl_FragColor = vec4(col, vGlow * uOpacity * tex.a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
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
      lastFrameAt = 0;
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

let lastFrameAt = 0;

function loop(now = performance.now()) {
  if (!running) return;
  try {
    // rAF の間隔は環境依存（120Hz 端末では約 8ms）のため、実経過時間で進める。
    // タブ復帰などの長い空白は 0.1 秒に丸めて演出の飛びを防ぐ。
    const dt = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 0.1) : 1 / 60;
    lastFrameAt = now;
    t += dt;
    const cfg = FX.bg;
    const size = cfg.gridSize;
    const z = (t * cfg.scrollSpeed) % size;
    grid1.position.z = z;
    grid2.position.z = z - size;
    camera.position.x = Math.sin(t * 0.21) * cfg.cameraDrift;
    camera.position.y = 6.5 + Math.sin(t * 0.34) * 0.8;
    camera.lookAt(0, 4, -10);

    // 蛍: 漂い・明滅・軌跡はすべてシェーダ内で時間から計算する
    if (fireflies) {
      fireflies.points.material.uniforms.uTime.value = t;
    }
    // 塵: 上昇して上端で下へ戻る
    if (dust) {
      const pos = dust.points.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.array[i * 3 + 1] + dust.speeds[i] * dt;
        if (y > 46) y = 0;
        pos.array[i * 3 + 1] = y;
        pos.array[i * 3] += Math.sin(t * 0.5 + i) * 0.24 * dt; // 微かな横揺れ（60fps 時 0.004/frame 相当）
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

    // 空の大きな光: 別々の周期でゆっくり漂い、呼吸するように明滅・伸縮する
    for (const glow of skyGlows) {
      glow.sprite.position.x = glow.baseX + Math.sin(t * 0.006 * glow.speed + glow.phase) * 30;
      glow.sprite.position.y = glow.baseY + Math.sin(t * 0.004 * glow.speed + glow.phase * 2) * 8;
      glow.sprite.material.opacity = cfg.skyGlow.opacity * (0.6 + 0.4 * Math.sin(t * 0.08 * glow.speed + glow.phase));
      const breath = 1 + 0.08 * Math.sin(t * 0.05 * glow.speed + glow.phase * 3);
      glow.sprite.scale.set(glow.scale * glow.aspect * breath, glow.scale * breath, 1);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  } catch (error) {
    running = false;
    failureHandler(error);
  }
}
