// Three.js を遅延ロードするエフェクト窓口。
// WebGL / Three.js が利用できない環境でも、ゲーム本体はクラシック表示で続行する。

import { UI } from "../config.js";
import { getSettings, setSetting } from "../core/settings.js";

let background = null;
let bursts = null;
let initPromise = null;
let unavailable = false;
let usoMood = false;

function skippedFlight() {
  return { skipped: true, promise: Promise.resolve(), onArrive: null };
}

function fallBackToClassic(error) {
  if (unavailable) return;
  unavailable = true;
  try {
    bursts?.cancelTileFlights();
  } catch {
    // 描画基盤の故障時は後始末にも失敗しうるため、そのまま非表示化する。
  }
  console.warn("Three.js effects unavailable; continuing in Classic mode.", error);
  if (getSettings().theme !== "classic") setSetting("theme", "classic");
}

export function initEffects() {
  if (initPromise) return initPromise;
  initPromise = Promise.all([
    import("./background.js?v=20260721-runtime"),
    import("./bursts.js?v=20260721-runtime"),
  ])
    .then(([backgroundModule, burstsModule]) => {
      backgroundModule.initBackground(fallBackToClassic);
      burstsModule.initBursts(fallBackToClassic);
      background = backgroundModule;
      bursts = burstsModule;
      background.setBackgroundMood(usoMood);
      return true;
    })
    .catch((error) => {
      fallBackToClassic(error);
      return false;
    });
  return initPromise;
}

export function setBackgroundMood(isUso) {
  usoMood = isUso;
  if (!background || unavailable) return;
  try {
    background.setBackgroundMood(isUso);
  } catch (error) {
    fallBackToClassic(error);
  }
}

function runBurstEffect(name, args) {
  if (!bursts || unavailable) return undefined;
  try {
    return bursts[name](...args);
  } catch (error) {
    fallBackToClassic(error);
    return undefined;
  }
}

export function burstAtElement(...args) {
  runBurstEffect("burstAtElement", args);
}

export function winBurst(...args) {
  runBurstEffect("winBurst", args);
}

export function flyInTiles(...args) {
  return runBurstEffect("flyInTiles", args) ?? skippedFlight();
}

export function cancelTileFlights() {
  runBurstEffect("cancelTileFlights", []);
}

export function activeTileFlightCount() {
  return runBurstEffect("activeTileFlightCount", []) ?? 0;
}

export function colorForState(state) {
  const colors = UI.tileColors.cyber;
  const hex = { unused: colors.unused, used: colors.used, correct: colors.correct }[state] ?? "#ffffff";
  return Number.parseInt(hex.slice(1), 16);
}
