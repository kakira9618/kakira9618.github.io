// プレイヤーカード画面（#/card）。名前を設定して、やり込み統計入りの
// カードを canvas に描き、PNG としてシェア / 保存できる。
// カードのデザインはテーマによらず共通（ダーク + ランク色のフレーム）。
// 通算 5 回プレイで解放（タイトルメニューの段階解放と同じ仕組み）。

import { el, clear } from "./dom.js";
import { registerScreen, navigate, redirect } from "./app.js?v=20260723-swup";
import { getHistory, countPlays } from "../core/records.js";
import { ACHIEVEMENTS, getUnlocked } from "../core/achievements.js?v=20260723-swup";
import { getSettings, HIDDEN_THEMES } from "../core/settings.js?v=20260723-swup";
import { BGM_TRACKS, currentBgmTrackId, playSfx } from "../audio/sound.js?v=20260723-swup";
import { loadJSON, saveJSON } from "../core/store.js";
import { isDebugMode } from "../core/debug.js";
import { toast } from "./toast.js?v=20260723-swup";
import { soundToggleButton } from "./sound-toggle.js?v=20260723-swup";
import { winBurst } from "../fx/effects.js?v=20260723-swup";
import { shouldReduceMotion } from "../core/motion.js?v=20260723-swup";
import { icon, iconSvg } from "./icons.js";
import { announce } from "./a11y.js?v=20260723-swup";
import { SHARE_URL } from "../config.js?v=20260723-swup";
import { tr } from "../core/i18n.js?v=20260723-swup";

// 解放しきい値（タイトルメニューの MENU_UNLOCKS と同じ値を参照させる）
export const CARD_UNLOCK_PLAYS = 5;

// 名前の最大文字数（カードの印字幅に収まる上限）
export const NAME_MAX_CHARS = 12;

// 昇格演出: カード着地アニメーションが落ち着いてから出すまでの時間と、演出の長さ
const PROMO_DELAY_MS = 1000;
const PROMO_OVERLAY_MS = 2600;

// スワイプ / ドラッグでカードが指の方向に傾く演出の強さ
const TILT_MAX_DEG = 30; // 傾きの最大角度
const TILT_GAIN = 60; // カード幅ぶんの移動で何度傾くか（半分のスワイプで最大に達する）

// ---- カードのレイアウト・配色定数（描画座標は幅 1200 x 高さ 675 基準の px）----
const CARD = {
  width: 1200,
  height: 675,
  scale: 2, // 保存画像は 2 倍（2400x1350）で描く
  radius: 34, // カード外形の角丸
  frameInset: 12, // 外周からランク色フレームまで
  frameWidth: 5,
  pad: 64, // フレーム内の左右余白
  bgTop: "#0a0e1f",
  bgBottom: "#161038",
  fg: "#eef4ff",
  dim: "#8b9bbd",
  logoGrad: ["#00d5ff", "#7c5cff"], // DWORDle 2 ロゴの文字グラデーション
  logoY: 100,
  logoSize: 46,
  logoTwoScale: 0.62, // 「2」の縮小率（タイトル画面の .logo .two と同じ）
  logoTwoRaise: 12, // 「2」を上付きにするための持ち上げ量
  logoTwoGap: 9, // 「DWORDle」と「2」の間隔
  kickerY: 143, // "PLAYER CARD" の行
  playerLabelY: 178, // "PLAYER | 初プレイ日" の行（左上のタイル装飾に寄せる）
  nameY: 234,
  nameSize: 64,
  titleY: 320, // 称号バッジの中心
  identityX: 280, // PLAYER 行・名前・称号バッジの左端（左のエンブレムのぶん字下げ）
  // ランクエンブレム(六角形 + リング + アイコン)。
  // 名前ブロックの左にアバターのように置き、ブロックの垂直中央に合わせる。
  // 中段の塊はヘッダや統計セルより深めの左余白をとる
  emblem: {
    cx: 172, // 中心 x
    cy: 259, // 中心 y
    hexR: 80, // 外側六角形の半径
    ringR: 61, // 内側リングの半径
    iconSize: 58,
    glowR: 130, // 背後のグロー半径
  },
  // 統計セル（4 列 x 2 行のパネル。お気に入りテーマ / BGM も 1 セルとして大きく見せる）
  // セル内はラベル上・値下の 2 段（左のアクセントバーは廃止）
  stats: {
    top: 428, // 1 行目セルの上端
    cellH: 82,
    gap: 12,
    valueSize: 36,
    textValueSize: 24, // テーマ名・曲名などテキスト値のセル（収まらなければさらに縮める）
    labelSize: 13,
    labelOffsetY: 22, // セル上端 → ラベル中心
    valueOffsetY: 56, // セル上端 → 値の中心
    cellFill: "rgba(255, 255, 255, 0.045)",
    cellStroke: "rgba(255, 255, 255, 0.09)",
  },
  footerDividerY: 622, // フッター上の細い区切り線
  footerY: 644, // URL・発行日（右寄せ）
  sinceSize: 17, // 初プレイ日（PLAYER ラベルの隣）の文字サイズ
  idEdgeX: 26, // プレイヤー ID の右端からの距離（縦書きで印字）
  idSize: 12,
  miniTileSize: 24, // 左上の装飾ミニタイル列（コーナーに密着させる）
  miniTileGap: 8,
  miniTileX: 42, // コーナーからの距離
  miniTileY: 42,
  miniTileColors: ["#00e68a", "#ffc233", "#3a4356", "#00e68a", "#ffc233"],
  // カテゴリバッジ棚（中段右側に右揃えで 5 列 x 2 行）。
  // 未獲得スロットは埋め込み用の跡（窪み）だけを描き、獲得すると色付きバッジが埋まる。
  badges: {
    cols: 5,
    slotR: 28, // スロット（跡）の半径
    gapX: 12,
    row1Cy: 248, // 1 行目の中心 y（名前の行に併走）
    row2Cy: 320, // 2 行目の中心 y（称号バッジと同じ高さ）
    iconSize: 26,
    contentGap: 24, // 棚の左端と名前・称号バッジの間に確保する余白
    socketFill: "rgba(0, 0, 0, 0.30)",
    socketStroke: "rgba(255, 255, 255, 0.16)",
    socketRing: "rgba(255, 255, 255, 0.20)", // 未獲得スロット内側の破線リング
    socketIcon: "#8b9bbd", // 未獲得スロットに透かすバッジシルエットの色
    socketIconAlpha: 0.32,
  },
};

// ランク: 通算プレイ回数でフレーム色と称号が上がる。
// 実績を全解除すると MASTER（虹フレーム）になり、
// さらに通算 1000 プレイに到達すると最上位 KING（王）になる。
// 王の称号は多くプレイしている方のモードで決まる（同数なら DWORDle）。
const RANKS = [
  { min: 5, tier: 1, id: "BRONZE", frame: ["#f0a35e", "#9a5b2d"], accent: "#f0a35e", titleJa: "見習いWORDler", titleEn: "Apprentice WORDler", icon: "star" },
  { min: 25, tier: 2, id: "SILVER", frame: ["#eef3fa", "#8fa3b8"], accent: "#c9d6e8", titleJa: "一人前WORDler", titleEn: "Seasoned WORDler", icon: "shield" },
  { min: 75, tier: 3, id: "GOLD", frame: ["#ffe08a", "#d99a1b"], accent: "#ffd166", titleJa: "凄腕WORDler", titleEn: "Ace WORDler", icon: "swords" },
  { min: 200, tier: 4, id: "PLATINUM", frame: ["#c5fff2", "#4fc3d8"], accent: "#8ee9dd", titleJa: "達人WORDler", titleEn: "Master WORDler", icon: "flame" },
  { min: 500, tier: 5, id: "DIAMOND", frame: ["#b9e0ff", "#8a6bff"], accent: "#a8ccff", titleJa: "頂のWORDler", titleEn: "Peerless WORDler", icon: "gem" },
];
const RANK_MASTER = {
  tier: 6,
  id: "MASTER",
  frame: ["#ff5f8f", "#ffd166", "#00e68a", "#00d5ff", "#b45cff"],
  accent: "#ffd166",
  titleJa: "伝説のWORDler",
  titleEn: "Legendary WORDler",
  icon: "trophy",
};
// KING に必要な通算プレイ回数（実績全解除も必要）
export const KING_MIN_PLAYS = 1000;
const RANK_KING_NORMAL = {
  tier: 7,
  id: "KING",
  frame: ["#fff3c4", "#ffd166", "#00d5ff", "#ffd166", "#fff3c4"],
  accent: "#ffd166",
  titleJa: "DWORDleの王",
  titleEn: "DWORDle King",
  icon: "crown",
};
const RANK_KING_USO = {
  tier: 7,
  id: "KING",
  frame: ["#ffb1c8", "#ff2b5e", "#b45cff", "#ff2b5e", "#ffb1c8"],
  accent: "#ff5f8f",
  titleJa: "DWORDlieの王",
  titleEn: "DWORDlie King",
  icon: "mask",
};

// カテゴリバッジ: 実績の 1 カテゴリを全解除すると獲得できる。
// ACHIEVEMENT_CATEGORIES の 9 カテゴリ + 隠し実績（hidden）の計 10 個で、
// カード中段右側の棚にこの順（左上 → 右下）で並ぶ。
export const CATEGORY_BADGES = [
  { cat: "basic", icon: "footprints", color: "#8fd3ff" },
  { cat: "wins", icon: "trophy", color: "#ffd166" },
  { cat: "speed", icon: "bolt", color: "#7cf5ff" },
  { cat: "habit", icon: "calendar", color: "#88d8b8" },
  { cat: "volume", icon: "book", color: "#d8b88f" },
  { cat: "board", icon: "palette", color: "#ffb3de" },
  { cat: "modes", icon: "mask", color: "#ff5f8f" },
  { cat: "calendar", icon: "clock", color: "#9a8fff" },
  { cat: "misc", icon: "flask", color: "#66ffc2" },
  { cat: "hidden", icon: "ghost", color: "#c9a0ff" },
];

// 各バッジの獲得状態。カテゴリ内の実績をすべて解除していたら earned
export function categoryBadgeStates() {
  const unlocked = getUnlocked();
  return CATEGORY_BADGES.map((badge) => {
    const items = badge.cat === "hidden"
      ? ACHIEVEMENTS.filter((a) => a.hidden)
      : ACHIEVEMENTS.filter((a) => a.cat === badge.cat);
    return { ...badge, earned: items.length > 0 && items.every((a) => unlocked[a.id] !== undefined) };
  });
}

let root = null;
let cardCanvas = null; // 直近に描いたカード（シェア / 保存用）
let redrawTimer = 0;

function build() {
  root = document.getElementById("screen-card");
}

// ---- 統計の収集 ----

function collectStats() {
  const history = getHistory();
  // プレイした日付列（ローカル日付で重複除去、昇順）
  const days = Array.from(new Set(history.map((g) => new Date(g.startTime * 1000).toLocaleDateString())));
  days.sort((a, b) => new Date(a) - new Date(b));
  // 連続プレイ日数の最大（records.getStatistics と同じ「隣接日差が 2 日未満なら継続」）
  let maxStreak = 0;
  let streak = 0;
  for (let i = 0; i < days.length; i++) {
    const diff = i === 0 ? Infinity : (new Date(days[i]) - new Date(days[i - 1])) / 86400000;
    streak = diff < 2 ? streak + 1 : 1;
    maxStreak = Math.max(maxStreak, streak);
  }
  const plays = history.length;
  const wins = history.filter((g) => g.clear).length;
  const usoPlays = history.filter((g) => g.gameMode === "uso").length;
  const playSeconds = history.reduce((total, g) => total + Math.max(0, (g.endTime ?? g.startTime) - g.startTime), 0);
  return {
    plays,
    wins,
    winRate: plays ? Math.round((100 * wins) / plays) : 0,
    normalPlays: plays - usoPlays,
    usoPlays,
    playDays: days.length,
    maxStreak,
    playMinutes: Math.round(playSeconds / 60),
    achUnlocked: Object.keys(getUnlocked()).length,
    achTotal: ACHIEVEMENTS.length,
    firstPlay: history.length ? history[0].startTime : null,
  };
}

export function rankForStats(stats) {
  const allAchievements = stats.achTotal > 0 && stats.achUnlocked >= stats.achTotal;
  // 王: 実績全解除 + 通算 1000 プレイ。多い方のモードの王になる（同数は DWORDle）
  if (allAchievements && stats.plays >= KING_MIN_PLAYS) {
    return stats.usoPlays > stats.normalPlays ? RANK_KING_USO : RANK_KING_NORMAL;
  }
  if (allAchievements) return RANK_MASTER;
  let rank = RANKS[0];
  for (const r of RANKS) if (stats.plays >= r.min) rank = r;
  return rank;
}

function themeLabel(id) {
  if (id === "cyber") return tr("サイバー", "Cyber");
  if (id === "classic") return tr("クラシック", "Classic");
  const hidden = HIDDEN_THEMES.find((t) => t.id === id);
  return hidden ? tr(hidden.name, hidden.nameEn) : id;
}

// お気に入り BGM の表示名。「モード連動」は実際に再生される曲へ解決して表示する
function bgmLabel(id) {
  const actualId = id === "auto" ? currentBgmTrackId() : id;
  const track = BGM_TRACKS.find((t) => t.id === actualId) ?? BGM_TRACKS[0];
  return tr(track.name, track.nameEn ?? track.name);
}

// 総プレイ時間の表示（xx:yy = 時間:分）
const fmtPlayTime = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

// カード上の日付表示（ゼロ埋めなしの 2026/7/22 形式。初プレイ日・発行日で共通）
const fmtDateShort = (unixSec) => {
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

// プレイヤー ID: このブラウザで初めてカード機能に触れたときに乱数から一意に決め、
// 以後は固定（16 進数 8 桁・大文字）。カードの右端に小さく印字される。
export function getPlayerId() {
  let id = loadJSON("playerId", null);
  if (!/^[0-9A-F]{8}$/.test(id ?? "")) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    saveJSON("playerId", id);
  }
  return id;
}

// ---- カード描画 ----

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function frameGradient(ctx, rank) {
  const grad = ctx.createLinearGradient(0, 0, CARD.width, CARD.height);
  const colors = rank.frame;
  colors.forEach((c, i) => grad.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
  return grad;
}

async function loadIconImage(name, sizePx, color) {
  const svg = iconSvg(name, sizePx, color);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

// name と現在の記録からカード canvas を描いて返す
export async function renderPlayerCardCanvas(name) {
  const stats = collectStats();
  const rank = rankForStats(stats);
  const settings = getSettings();
  const W = CARD.width;
  const H = CARD.height;

  const cv = document.createElement("canvas");
  cv.width = W * CARD.scale;
  cv.height = H * CARD.scale;
  const ctx = cv.getContext("2d");
  ctx.scale(CARD.scale, CARD.scale);

  // ---- 背景 ----
  const bg = ctx.createLinearGradient(0, 0, W * 0.35, H);
  bg.addColorStop(0, CARD.bgTop);
  bg.addColorStop(1, CARD.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // うっすらドット格子（テーマ非依存の共通装飾）
  ctx.fillStyle = "rgba(139, 155, 189, 0.07)";
  for (let x = 24; x < W; x += 36) {
    for (let y = 24; y < H; y += 36) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // ランク色のソフトグロー（左上と右下）
  for (const [gx, gy, gr, color, alpha] of [
    [W * 0.12, H * 0.1, 420, rank.accent, 0.16],
    [W * 0.92, H * 0.95, 480, "#7c5cff", 0.14],
  ]) {
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---- ランク色フレーム ----
  const fi = CARD.frameInset;
  ctx.strokeStyle = frameGradient(ctx, rank);
  ctx.lineWidth = CARD.frameWidth;
  roundRect(ctx, fi, fi, W - fi * 2, H - fi * 2, CARD.radius);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  roundRect(ctx, fi + 7, fi + 7, W - (fi + 7) * 2, H - (fi + 7) * 2, CARD.radius - 8);
  ctx.stroke();

  const left = CARD.pad;
  const right = W - CARD.pad;

  // ---- ヘッダ: 判定タイル装飾（左上コーナーに密着）+ ロゴ / PLAYER CARD（右上・光沢なし）----
  ctx.textBaseline = "middle";
  const tiles = CARD.miniTileColors;
  tiles.forEach((color, i) => {
    ctx.fillStyle = color;
    roundRect(ctx, CARD.miniTileX + i * (CARD.miniTileSize + CARD.miniTileGap), CARD.miniTileY, CARD.miniTileSize, CARD.miniTileSize, 6);
    ctx.fill();
  });

  // タイトル画面のロゴに合わせ、「2」は小さめ + 上付きで右肩に置く（全体は右揃え）
  ctx.textAlign = "left";
  const logoMainFont = `900 ${CARD.logoSize}px "Avenir Next", "Helvetica Neue", sans-serif`;
  const logoTwoFont = `900 ${Math.round(CARD.logoSize * CARD.logoTwoScale)}px "Avenir Next", "Helvetica Neue", sans-serif`;
  ctx.font = logoMainFont;
  const logoMainW = ctx.measureText("DWORDle").width;
  ctx.font = logoTwoFont;
  const logoTwoW = ctx.measureText("2").width;
  const logoW = logoMainW + CARD.logoTwoGap + logoTwoW;
  const logoX = right - logoW;
  const logoGrad = ctx.createLinearGradient(logoX, 0, logoX + logoW, 0);
  logoGrad.addColorStop(0, CARD.logoGrad[0]);
  logoGrad.addColorStop(1, CARD.logoGrad[1]);
  ctx.fillStyle = logoGrad;
  ctx.font = logoMainFont;
  ctx.fillText("DWORDle", logoX, CARD.logoY);
  ctx.font = logoTwoFont;
  ctx.fillText("2", logoX + logoMainW + CARD.logoTwoGap, CARD.logoY - CARD.logoTwoRaise);

  ctx.font = '700 19px "Avenir Next", sans-serif';
  ctx.fillStyle = CARD.dim;
  const kickerText = "P L A Y E R   C A R D";
  const kickerW = [...kickerText].reduce((total, ch) => total + ctx.measureText(ch).width + 1.5, -1.5);
  drawSpaced(ctx, kickerText, right - kickerW, CARD.kickerY);

  // ---- 右側: 大型ランクエンブレム（グロー + 六角形 + リング + アイコン + ランクピル）----
  const em = CARD.emblem;
  const emblemGlow = ctx.createRadialGradient(em.cx, em.cy, 0, em.cx, em.cy, em.glowR);
  emblemGlow.addColorStop(0, rank.accent);
  emblemGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = emblemGlow;
  ctx.fillRect(em.cx - em.glowR, em.cy - em.glowR, em.glowR * 2, em.glowR * 2);
  ctx.restore();

  // 六角形（頂点を上に）。ランクのグラデーションで縁取る
  const hexPath = (r) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 3;
      const px = em.cx + Math.cos(a) * r;
      const py = em.cy + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  hexPath(em.hexR);
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  ctx.fill();
  ctx.strokeStyle = frameGradient(ctx, rank);
  ctx.lineWidth = 3;
  hexPath(em.hexR);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  hexPath(em.hexR - 8);
  ctx.stroke();

  // 内側リングとアイコン
  ctx.beginPath();
  ctx.arc(em.cx, em.cy, em.ringR, 0, Math.PI * 2);
  ctx.strokeStyle = rank.accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  try {
    const img = await loadIconImage(rank.icon, em.iconSize, rank.accent);
    ctx.shadowColor = rank.accent;
    ctx.shadowBlur = 24;
    ctx.drawImage(img, em.cx - em.iconSize / 2, em.cy - em.iconSize / 2, em.iconSize, em.iconSize);
    ctx.shadowBlur = 0;
  } catch {
    // アイコン画像が作れない環境でもカード本体は成立させる
  }

  // ---- エンブレムの右: 「PLAYER | 初プレイ日」 + 名前 + 称号バッジ ----
  const ix = CARD.identityX;
  const bd = CARD.badges;
  const badgesLeft = right - (bd.cols * bd.slotR * 2 + (bd.cols - 1) * bd.gapX); // バッジ棚の左端
  const nameMaxW = badgesLeft - bd.contentGap - ix; // バッジ棚に被らない幅
  ctx.textAlign = "left";
  ctx.font = '700 15px "Avenir Next", sans-serif';
  ctx.fillStyle = CARD.dim;
  const playerLabel = "P L A Y E R";
  const playerLabelW = [...playerLabel].reduce((total, ch) => total + ctx.measureText(ch).width + 1.5, -1.5);
  drawSpaced(ctx, playerLabel, ix, CARD.playerLabelY);
  if (stats.firstPlay) {
    const sepX = ix + playerLabelW + 16;
    ctx.fillStyle = "rgba(139, 155, 189, 0.55)";
    ctx.fillRect(sepX, CARD.playerLabelY - 8, 1.5, 16);
    ctx.font = `700 ${CARD.sinceSize}px "Avenir Next", sans-serif`;
    ctx.fillStyle = CARD.fg;
    ctx.fillText(
      tr(`${fmtDateShort(stats.firstPlay)}〜`, `Since ${fmtDateShort(stats.firstPlay)}`),
      sepX + 16,
      CARD.playerLabelY + 1
    );
  }

  const displayName = name || "PLAYER";
  let nameSize = CARD.nameSize;
  do {
    ctx.font = `900 ${nameSize}px "Avenir Next", "Helvetica Neue", sans-serif`;
    nameSize -= 2;
  } while (ctx.measureText(displayName).width > nameMaxW && nameSize > 24);
  ctx.shadowColor = "rgba(124, 92, 255, 0.55)";
  ctx.shadowBlur = 26;
  ctx.fillStyle = CARD.fg;
  ctx.fillText(displayName, ix, CARD.nameY);
  ctx.shadowBlur = 0;

  // ---- ランク + 称号の一体バッジ ----
  // 左セグメントはランク色で塗って「GOLD RANK」、右セグメントにアイコン + 称号。
  const titleText = tr(rank.titleJa, rank.titleEn);
  const rankText = `${rank.id} RANK`;
  const badgeH = 56;
  const badgeTop = CARD.titleY - badgeH / 2;
  ctx.font = '800 21px "Avenir Next", sans-serif';
  const rankSegW = ctx.measureText(rankText).width + 46;
  const badgeIcon = 32;
  // 称号もバッジ棚に被らない幅まで縮める（長い英語称号向け）
  let titleSize = 28;
  ctx.font = `800 ${titleSize}px "Avenir Next", sans-serif`;
  let titleW = ctx.measureText(titleText).width;
  while (rankSegW + badgeIcon + titleW + 58 > nameMaxW && titleSize > 20) {
    titleSize -= 1;
    ctx.font = `800 ${titleSize}px "Avenir Next", sans-serif`;
    titleW = ctx.measureText(titleText).width;
  }
  const badgeW = rankSegW + badgeIcon + titleW + 58;
  // 土台とランク色セグメント（角丸の内側だけ塗るためクリップする）
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, ix, badgeTop, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.save();
  roundRect(ctx, ix, badgeTop, badgeW, badgeH, badgeH / 2);
  ctx.clip();
  const segGrad = ctx.createLinearGradient(ix, 0, ix + rankSegW, 0);
  rank.frame.forEach((c, i) => segGrad.addColorStop(rank.frame.length === 1 ? 0 : i / (rank.frame.length - 1), c));
  ctx.fillStyle = segGrad;
  ctx.fillRect(ix, badgeTop, rankSegW, badgeH);
  ctx.restore();
  ctx.strokeStyle = rank.accent;
  ctx.lineWidth = 2;
  roundRect(ctx, ix, badgeTop, badgeW, badgeH, badgeH / 2);
  ctx.stroke();
  // ランク名（塗りセグメントの上に暗色で）
  ctx.font = '800 21px "Avenir Next", sans-serif';
  ctx.fillStyle = "#101228";
  ctx.textAlign = "center";
  ctx.fillText(rankText, ix + rankSegW / 2, CARD.titleY + 1);
  // 称号（アイコン + テキスト）
  try {
    const img = await loadIconImage(rank.icon, badgeIcon, rank.accent);
    ctx.drawImage(img, ix + rankSegW + 18, CARD.titleY - badgeIcon / 2, badgeIcon, badgeIcon);
  } catch {
    // アイコン画像が作れない環境でもカード本体は成立させる
  }
  ctx.textAlign = "left";
  ctx.font = `800 ${titleSize}px "Avenir Next", sans-serif`;
  ctx.fillStyle = rank.accent;
  ctx.fillText(titleText, ix + rankSegW + 18 + badgeIcon + 12, CARD.titleY + 1);

  // ---- カテゴリバッジ棚（中段右側に 5 列 x 2 行。見出しは置かない）----
  // 全スロットに埋め込み用の跡（窪み）を描き、獲得済みカテゴリだけ色付きバッジを埋める。
  const badgeStates = categoryBadgeStates();
  for (let i = 0; i < badgeStates.length; i++) {
    const badge = badgeStates[i];
    const col = i % bd.cols;
    const cx = right - bd.slotR - (bd.cols - 1 - col) * (bd.slotR * 2 + bd.gapX);
    const cy = i < bd.cols ? bd.row1Cy : bd.row2Cy;
    // 台座（跡）。獲得済みバッジもこの窪みに埋め込まれる
    ctx.beginPath();
    ctx.arc(cx, cy, bd.slotR, 0, Math.PI * 2);
    ctx.fillStyle = bd.socketFill;
    ctx.fill();
    ctx.strokeStyle = bd.socketStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!badge.earned) {
      // 未獲得: 破線リング + 埋まる予定のバッジのシルエットで「予定地」を示す
      ctx.beginPath();
      ctx.arc(cx, cy, bd.slotR - 6.5, 0, Math.PI * 2);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = bd.socketRing;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      try {
        const img = await loadIconImage(badge.icon, bd.iconSize, bd.socketIcon);
        ctx.save();
        ctx.globalAlpha = bd.socketIconAlpha;
        ctx.drawImage(img, cx - bd.iconSize / 2, cy - bd.iconSize / 2, bd.iconSize, bd.iconSize);
        ctx.restore();
      } catch {
        // アイコン画像が作れない環境でもカード本体は成立させる
      }
      continue;
    }
    // 獲得済み: カテゴリ色のグロー + 面 + リング + アイコン
    const badgeGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, bd.slotR * 1.6);
    badgeGlow.addColorStop(0, badge.color);
    badgeGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = badgeGlow;
    ctx.fillRect(cx - bd.slotR * 1.6, cy - bd.slotR * 1.6, bd.slotR * 3.2, bd.slotR * 3.2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, bd.slotR - 1, 0, Math.PI * 2);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = badge.color;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, bd.slotR - 1, 0, Math.PI * 2);
    ctx.strokeStyle = badge.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, bd.slotR - 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
    try {
      const img = await loadIconImage(badge.icon, bd.iconSize, badge.color);
      ctx.shadowColor = badge.color;
      ctx.shadowBlur = 12;
      ctx.drawImage(img, cx - bd.iconSize / 2, cy - bd.iconSize / 2, bd.iconSize, bd.iconSize);
      ctx.shadowBlur = 0;
    } catch {
      // アイコン画像が作れない環境でもカード本体は成立させる
    }
  }

  // ---- 統計パネル（4 列 x 2 行のセル。テーマ / BGM もここで大きく見せる）----
  const st = CARD.stats;
  const cells = [
    [String(stats.plays), tr("総プレイ回数", "Total plays")],
    [`${stats.winRate}%`, tr("勝率", "Win rate")],
    [String(stats.playDays), tr("プレイ日数", "Days played")],
    [String(stats.maxStreak), "Max Streak"],
    [`${stats.achUnlocked}/${stats.achTotal}`, tr("実績", "Achievements")],
    [fmtPlayTime(stats.playMinutes), tr("総プレイ時間", "Play time")],
    [themeLabel(settings.theme), tr("お気に入りテーマ", "Favorite theme"), true],
    [bgmLabel(settings.bgmTrack), tr("お気に入りBGM", "Favorite BGM"), true],
  ];
  const cellW = (right - left - st.gap * 3) / 4;
  cells.forEach(([value, label, isText], i) => {
    const x = left + (i % 4) * (cellW + st.gap);
    const y = st.top + Math.floor(i / 4) * (st.cellH + st.gap);
    ctx.fillStyle = st.cellFill;
    roundRect(ctx, x, y, cellW, st.cellH, 14);
    ctx.fill();
    ctx.strokeStyle = st.cellStroke;
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, cellW, st.cellH, 14);
    ctx.stroke();
    // ラベル上・値下の 2 段組（ダッシュボード風）
    ctx.textAlign = "left";
    ctx.font = `600 ${st.labelSize}px "Avenir Next", sans-serif`;
    ctx.fillStyle = CARD.dim;
    ctx.fillText(label, x + 20, y + st.labelOffsetY);
    // テキスト値（テーマ名・曲名）は数値より小さく始め、収まるまで縮める
    let valueSize = isText ? st.textValueSize : st.valueSize;
    ctx.font = `800 ${valueSize}px "Avenir Next", sans-serif`;
    while (isText && valueSize > 15 && ctx.measureText(value).width > cellW - 40) {
      valueSize -= 1;
      ctx.font = `800 ${valueSize}px "Avenir Next", sans-serif`;
    }
    ctx.fillStyle = CARD.fg;
    ctx.fillText(value, x + 20, y + st.valueOffsetY);
  });

  // ---- フッター: 細い区切り線 + URL / 発行日（右寄せ。初プレイ日は PLAYER 行へ移動）----
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(left, CARD.footerDividerY, right - left, 1);
  ctx.font = '600 17px "Avenir Next", sans-serif';
  ctx.fillStyle = CARD.dim;
  ctx.textAlign = "right";
  ctx.fillText(
    `${SHARE_URL.replace(/^https:\/\//, "")}   ・   ${fmtDateShort(Math.floor(Date.now() / 1000))}`,
    right,
    CARD.footerY
  );

  // ---- プレイヤー ID（右端に縦書きで小さく印字）----
  ctx.save();
  ctx.translate(W - CARD.idEdgeX, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `600 ${CARD.idSize}px "SF Mono", "Menlo", "Consolas", monospace`;
  ctx.fillStyle = "rgba(139, 155, 189, 0.8)";
  ctx.textAlign = "left";
  const idText = `ID ${getPlayerId()}`;
  const idWidth = [...idText].reduce((total, ch) => total + ctx.measureText(ch).width + 1.5, -1.5);
  drawSpaced(ctx, idText, -idWidth / 2, 0);
  ctx.restore();

  return cv;
}

// 文字間を空けた見出し（letterSpacing 未対応環境でも同じ見た目にするため 1 文字ずつ置く）
function drawSpaced(ctx, text, x, y) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + 1.5;
  }
}

// ---- シェア / 保存 ----

// iOS Safari は data: URL + download 属性の保存を無視することがあるため、
// Blob URL + DOM に追加した a 要素で保存する（履歴エクスポートと同じ方式）
async function downloadCard(cv) {
  const blob = await new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  const url = blob ? URL.createObjectURL(blob) : cv.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `DWORDle2_player_card_${Date.now()}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareCard(cv) {
  const blob = await new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  if (blob && navigator.canShare) {
    const file = new File([blob], "dwordle2-player-card.png", { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "DWORDle 2",
          text: `${tr("DWORDle 2 のプレイヤーカードを発行しました！ #DWORDle2", "My DWORDle 2 player card! #DWORDle2")}\n${SHARE_URL}`,
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
  }
  // 画像付きシェアが使えない環境では保存に切り替える
  await downloadCard(cv);
  toast(tr("画像を保存しました。SNS に添付してシェアしてください", "Image saved. Attach it to share on social media"));
}

// ---- 画面 ----

function getSavedCard() {
  return loadJSON("playerCard", null);
}

function sanitizeName(raw) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, NAME_MAX_CHARS);
}

// ランクアップ演出: カード着地後にフラッシュ + RANK UP スタンプ + 広がるリング + バースト。
// reduce-motion 時はトーストと効果音だけにする。
function celebratePromotion(stage, rank) {
  const message = tr(`ランクアップ！ ${rank.id} RANK ─ ${rank.titleJa}`, `Rank up! ${rank.id} RANK — ${rank.titleEn}`);
  if (shouldReduceMotion()) {
    playSfx("achievementBig");
    toast(message);
    return;
  }
  setTimeout(() => {
    const wrap = stage.querySelector(".player-card-wrap");
    if (!wrap?.isConnected) return; // 演出前に画面を離れていたら出さない
    playSfx("achievementBig");
    winBurst([Number.parseInt(rank.accent.slice(1), 16), 0xffd166, 0xffffff]);
    announce(message);
    const overlay = el(
      "div",
      { class: "rank-up-overlay", "aria-hidden": "true", style: { "--rank-accent": rank.accent } },
      el("span", { class: "rank-up-ring" }),
      el(
        "div",
        { class: "rank-up-text" },
        el("span", { class: "rank-up-kicker" }, "RANK UP!"),
        el("span", { class: "rank-up-name" }, `${rank.id} RANK`),
        el("span", { class: "rank-up-title" }, tr(rank.titleJa, rank.titleEn))
      )
    );
    wrap.append(overlay);
    setTimeout(() => overlay.remove(), PROMO_OVERLAY_MS);
  }, PROMO_DELAY_MS);
}

// スワイプ / ドラッグで指の方向にカードが少し傾く（カードらしさの提示）。
// 指を離すと CSS transition でゆっくり水平に戻る。
function attachCardTilt(tiltEl) {
  const clampDeg = (v) => Math.min(TILT_MAX_DEG, Math.max(-TILT_MAX_DEG, v));
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  tiltEl.addEventListener("pointerdown", (event) => {
    if (shouldReduceMotion()) return;
    event.preventDefault(); // ドラッグで周囲のテキストが選択状態になるのを防ぐ
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    tiltEl.classList.add("tilting");
    tiltEl.setPointerCapture?.(pointerId);
  });
  tiltEl.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const rect = tiltEl.getBoundingClientRect();
    const ry = clampDeg(((event.clientX - startX) / rect.width) * TILT_GAIN);
    const rx = clampDeg(((startY - event.clientY) / rect.height) * TILT_GAIN);
    tiltEl.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  });
  const release = (event) => {
    if (pointerId === null || pointerId !== event.pointerId) return;
    pointerId = null;
    tiltEl.classList.remove("tilting");
    tiltEl.style.transform = "";
  };
  tiltEl.addEventListener("pointerup", release);
  tiltEl.addEventListener("pointercancel", release);
}

async function drawInto(stage, name, { deal }) {
  const cv = await renderPlayerCardCanvas(name);
  cardCanvas = cv;
  cv.className = "player-card-canvas";
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", tr("プレイヤーカード画像", "Player card image"));
  const wrap = el("div", { class: `player-card-wrap ${deal && !shouldReduceMotion() ? "deal" : ""}` }, cv);
  const tilt = el("div", { class: "player-card-tilt" }, wrap);
  attachCardTilt(tilt);
  clear(stage).append(tilt);
}

function render() {
  if (!root) build();
  clear(root);
  // 段階解放前は直接 URL で来てもタイトルへ戻す
  if (!isDebugMode() && countPlays() < CARD_UNLOCK_PLAYS) {
    redirect("/");
    return;
  }

  const saved = getSavedCard();
  const nameInput = el("input", {
    type: "text",
    class: "player-card-name-input",
    maxlength: String(NAME_MAX_CHARS),
    value: saved?.name ?? "",
    placeholder: tr("なまえ（12文字まで）", "Name (max 12 chars)"),
    "aria-label": tr("プレイヤー名", "Player name"),
  });

  const header = el(
    "div",
    { class: "header" },
    el(
      "button",
      { class: "icon-btn", "aria-label": tr("タイトルへ戻る", "Back to title"), onclick: () => { playSfx("ui"); navigate("/"); } },
      icon("arrowLeft")
    ),
    el("h1", { class: "title" }, tr("プレイヤーカード", "Player Card")),
    el("span", { class: "spacer" }),
    soundToggleButton()
  );

  const stage = el("div", { class: "player-card-stage" });
  const actions = el(
    "div",
    { class: "result-actions player-card-actions", hidden: true },
    el(
      "button",
      { class: "btn btn-primary", onclick: () => { if (cardCanvas) void shareCard(cardCanvas); } },
      icon("share"),
      tr("画像をシェア", "Share image")
    ),
    el(
      "button",
      { class: "btn", onclick: () => { if (cardCanvas) { void downloadCard(cardCanvas).then(() => toast(tr("画像を保存しました", "Image saved"))); } } },
      icon("download"),
      tr("画像を保存", "Save image")
    )
  );

  const issue = async (isFirst) => {
    const name = sanitizeName(nameInput.value);
    const prev = getSavedCard();
    const rank = rankForStats(collectStats());
    saveJSON("playerCard", { ...prev, name, issuedAt: Math.floor(Date.now() / 1000), seenRankTier: rank.tier });
    await drawInto(stage, name, { deal: true });
    actions.hidden = false;
    if (isFirst) {
      playSfx("achievementBig");
      winBurst([0x00d5ff, 0xffd166, 0xb45cff]);
    } else if (typeof prev?.seenRankTier === "number" && rank.tier > prev.seenRankTier) {
      // 前回カードを見たときよりランクが上がっていたら昇格演出
      celebratePromotion(stage, rank);
    }
  };

  const issueButton = el(
    "button",
    { class: "btn btn-primary player-card-issue", onclick: () => { void issue(true); issueButton.remove(); } },
    icon("sparkle"),
    tr("カードを発行", "Issue card")
  );

  // 名前の編集は即保存して静かに描き直す（発行演出は繰り返さない）
  nameInput.addEventListener("input", () => {
    if (actions.hidden) return; // 未発行のうちは発行ボタンで確定する
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      const name = sanitizeName(nameInput.value);
      saveJSON("playerCard", { ...getSavedCard(), name });
      void drawInto(stage, name, { deal: false });
    }, 350);
  });

  const body = el(
    "div",
    { class: "list-screen-body", tabindex: "0", role: "region", "aria-label": tr("プレイヤーカード", "Player Card") },
    el(
      "div",
      { class: "card player-card-form" },
      el("label", { class: "player-card-name-label" }, tr("名前", "Name"), nameInput),
      el("p", { class: "hint" }, tr("名前はこの端末にだけ保存されます", "Your name is saved only on this device"))
    ),
    stage,
    actions,
    saved ? null : issueButton
  );

  root.append(header, body);

  // 発行済みなら画面に入るたびにお披露目アニメーション付きで表示する
  if (saved) {
    void issue(false);
  }
}

registerScreen("card", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
