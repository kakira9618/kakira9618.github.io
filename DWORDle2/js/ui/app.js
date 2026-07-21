// 画面ルータとアプリ全体の状態（表モード/裏モード）。
//
// ルートはハッシュ形式:
//   #/            タイトル
//   #/game        プレイ中のゲーム
//   #/history     プレイ履歴一覧
//   #/problems    問題一覧
//   #/achievements 実績
//   #/settings    設定
//   #/result/<mode>/<startTime>   結果画面
//   #/analysis/<mode>/<startTime> 分析画面

import { loadJSON, saveJSON } from "../core/store.js";
import { setUsoMood } from "../audio/sound.js?v=20260722-lockfx-pace";
import { setBackgroundMood } from "../fx/effects.js?v=20260722-lockfx-pace";
import { setPopBackgroundMood } from "../fx/pop-background.js?v=20260722-lockfx-pace";
import { closeAllModals } from "./modal.js?v=20260722-lockfx-pace";

const screens = new Map(); // name -> { element, render(params) }
let currentName = null;

// ---- 表 / 裏モード ----
let appMode = loadJSON("lastPlayedMode", loadJSON("mode", "normal")); // "normal" | "uso"

export function getAppMode() {
  return appMode;
}

export function setAppMode(mode) {
  appMode = mode;
  saveJSON("mode", mode);
  document.body.classList.toggle("mode-uso", mode === "uso");
  document.body.classList.toggle("mode-normal", mode === "normal");
  setUsoMood(mode === "uso");
  setBackgroundMood(mode === "uso");
  setPopBackgroundMood(mode === "uso");
}

// モード切替を眺めただけの場合ではなく、実際に開始したゲームを次回の初期モードにする。
export function rememberPlayedMode(mode) {
  saveJSON("lastPlayedMode", mode);
}

// ---- 画面管理 ----

export function registerScreen(name, screen) {
  screens.set(name, screen);
}

export function navigate(path) {
  location.hash = path;
}

// render 中のガードで使うリダイレクト。履歴エントリを積み替えるので、
// 戻るボタンでリダイレクト元へ戻って往復ループになるのを防ぐ。
export function redirect(path) {
  location.replace(`#${path}`);
}

export function currentScreenName() {
  return currentName;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return { name: parts[0] || "title", args: parts.slice(1) };
}

function show(name, args) {
  const screen = screens.get(name) ?? screens.get("title");
  if (!screen) return;
  closeAllModals(); // 画面遷移したら開いていたモーダルは閉じる
  for (const [n, s] of screens) {
    s.element.classList.toggle("active", s === screen);
    if (s !== screen && n === currentName) s.onLeave?.();
  }
  currentName = name;
  screen.render(args);
}

export function startRouter() {
  addEventListener("hashchange", () => {
    const { name, args } = parseHash();
    show(name, args);
  });
  const { name, args } = parseHash();
  show(name, args);
}

// 初期化時に body クラスを同期
export function initAppMode() {
  setAppMode(appMode);
}
