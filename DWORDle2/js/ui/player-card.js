// プレイヤーカード画面（#/card）。名前を設定して、やり込み統計入りの
// カードを canvas に描き、PNG としてシェア / 保存できる。
// カードのデザインはテーマによらず共通（ダーク + ランク色のフレーム）。
// 通算 5 回プレイで解放（タイトルメニューの段階解放と同じ仕組み）。

import { el, clear } from "./dom.js";
import { registerScreen, navigate, redirect } from "./app.js?v=20260722-player-card";
import { getHistory, countPlays, dailyClearStreak } from "../core/records.js";
import { ACHIEVEMENTS, getUnlocked } from "../core/achievements.js?v=20260722-player-card";
import { getSettings, HIDDEN_THEMES } from "../core/settings.js?v=20260722-player-card";
import { BGM_TRACKS, playSfx } from "../audio/sound.js?v=20260722-player-card";
import { loadJSON, saveJSON } from "../core/store.js";
import { isDebugMode } from "../core/debug.js";
import { toast } from "./toast.js?v=20260722-player-card";
import { soundToggleButton } from "./sound-toggle.js?v=20260722-player-card";
import { winBurst } from "../fx/effects.js?v=20260722-player-card";
import { shouldReduceMotion } from "../core/motion.js?v=20260722-player-card";
import { icon, iconSvg } from "./icons.js";
import { SHARE_URL } from "../config.js?v=20260722-player-card";
import { tr } from "../core/i18n.js?v=20260722-player-card";

// 解放しきい値（タイトルメニューの MENU_UNLOCKS と同じ値を参照させる）
export const CARD_UNLOCK_PLAYS = 5;

// 名前の最大文字数（カードの印字幅に収まる上限）
export const NAME_MAX_CHARS = 12;

// ---- カードのレイアウト・配色定数（描画座標は幅 1200 x 高さ 675 基準の px）----
const CARD = {
  width: 1200,
  height: 675,
  scale: 2, // 保存画像は 2 倍（2400x1350）で描く
  radius: 34, // カード外形の角丸
  frameInset: 12, // 外周からランク色フレームまで
  frameWidth: 5,
  pad: 76, // フレーム内の左右余白
  bgTop: "#0a0e1f",
  bgBottom: "#161038",
  fg: "#eef4ff",
  dim: "#8b9bbd",
  logoGrad: ["#00d5ff", "#7c5cff"], // DWORDle 2 ロゴの文字グラデーション
  logoY: 108,
  kickerY: 152, // "PLAYER CARD" の行
  nameY: 260,
  nameSize: 66,
  titleY: 330, // 称号バッジの中心
  dividerY: 384,
  statRows: [448, 545], // 統計 2 行の値の基準線
  statLabelGap: 38, // 値から下のラベルまで
  favoritesY: 632, // お気に入り・初プレイ行（左寄せ）と URL・発行日（右寄せ）
  footerY: 632,
  miniTileSize: 26, // 右上の装飾ミニタイル列

  miniTileGap: 8,
  miniTileColors: ["#00e68a", "#ffc233", "#3a4356", "#00e68a", "#ffc233"],
};

// ランク: 通算プレイ回数でフレーム色と称号が上がる。
// 実績を全解除すると最上位 MASTER（虹フレーム）になる。
const RANKS = [
  { min: 5, id: "BRONZE", frame: ["#f0a35e", "#9a5b2d"], accent: "#f0a35e", titleJa: "見習いWORDler", titleEn: "Apprentice WORDler", icon: "star" },
  { min: 25, id: "SILVER", frame: ["#eef3fa", "#8fa3b8"], accent: "#c9d6e8", titleJa: "一人前WORDler", titleEn: "Seasoned WORDler", icon: "shield" },
  { min: 75, id: "GOLD", frame: ["#ffe08a", "#d99a1b"], accent: "#ffd166", titleJa: "凄腕WORDler", titleEn: "Ace WORDler", icon: "swords" },
  { min: 200, id: "PLATINUM", frame: ["#c5fff2", "#4fc3d8"], accent: "#8ee9dd", titleJa: "達人WORDler", titleEn: "Master WORDler", icon: "flame" },
  { min: 500, id: "DIAMOND", frame: ["#b9e0ff", "#8a6bff"], accent: "#a8ccff", titleJa: "頂のWORDler", titleEn: "Peerless WORDler", icon: "crown" },
];
const RANK_MASTER = {
  id: "MASTER",
  frame: ["#ff5f8f", "#ffd166", "#00e68a", "#00d5ff", "#b45cff"],
  accent: "#ffd166",
  titleJa: "伝説のWORDler",
  titleEn: "Legendary WORDler",
  icon: "gem",
};

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
  return {
    plays,
    wins,
    winRate: plays ? Math.round((100 * wins) / plays) : 0,
    playDays: days.length,
    maxStreak,
    dailyStreak: dailyClearStreak(),
    achUnlocked: Object.keys(getUnlocked()).length,
    achTotal: ACHIEVEMENTS.length,
    firstPlay: history.length ? history[0].startTime : null,
  };
}

export function rankForStats(stats) {
  if (stats.achTotal > 0 && stats.achUnlocked >= stats.achTotal) return RANK_MASTER;
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

function bgmLabel(id) {
  const track = BGM_TRACKS.find((t) => t.id === id) ?? BGM_TRACKS[0];
  return tr(track.name, track.nameEn ?? track.name);
}

const fmtDate = (unixSec) => {
  const d = new Date(unixSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
};

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

  // 斜めの光の帯
  ctx.save();
  ctx.translate(W * 0.62, 0);
  ctx.rotate(Math.PI / 10);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0, -H, 150, H * 3);
  ctx.fillRect(220, -H, 60, H * 3);
  ctx.restore();

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

  // ---- ヘッダ: ロゴ + PLAYER CARD + ランクピル + 装飾タイル ----
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = '900 46px "Avenir Next", "Helvetica Neue", sans-serif';
  const logoText = "DWORDle 2";
  const logoW = ctx.measureText(logoText).width;
  const logoGrad = ctx.createLinearGradient(left, 0, left + logoW, 0);
  logoGrad.addColorStop(0, CARD.logoGrad[0]);
  logoGrad.addColorStop(1, CARD.logoGrad[1]);
  ctx.shadowColor = CARD.logoGrad[0];
  ctx.shadowBlur = 22;
  ctx.fillStyle = logoGrad;
  ctx.fillText(logoText, left, CARD.logoY);
  ctx.shadowBlur = 0;

  ctx.font = '700 19px "Avenir Next", sans-serif';
  ctx.fillStyle = CARD.dim;
  drawSpaced(ctx, "P L A Y E R   C A R D", left, CARD.kickerY);

  // ランクピル（右上）
  ctx.font = '800 24px "Avenir Next", sans-serif';
  const rankText = `${rank.id} RANK`;
  const rankW = ctx.measureText(rankText).width;
  const pillH = 46;
  const pillW = rankW + 56;
  const pillX = right - pillW;
  const pillY = CARD.logoY - pillH / 2;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.strokeStyle = frameGradient(ctx, rank);
  ctx.lineWidth = 2.5;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.stroke();
  ctx.fillStyle = rank.accent;
  ctx.textAlign = "center";
  ctx.fillText(rankText, pillX + pillW / 2, CARD.logoY + 1);

  // 判定タイル風の装飾（ランクピルの下）
  const tiles = CARD.miniTileColors;
  const tilesW = tiles.length * CARD.miniTileSize + (tiles.length - 1) * CARD.miniTileGap;
  tiles.forEach((color, i) => {
    ctx.fillStyle = color;
    roundRect(ctx, right - tilesW + i * (CARD.miniTileSize + CARD.miniTileGap), CARD.kickerY + 8, CARD.miniTileSize, CARD.miniTileSize, 6);
    ctx.fill();
  });

  // ---- 名前 ----
  ctx.textAlign = "left";
  const displayName = name || "PLAYER";
  let nameSize = CARD.nameSize;
  do {
    ctx.font = `900 ${nameSize}px "Avenir Next", "Helvetica Neue", sans-serif`;
    nameSize -= 2;
  } while (ctx.measureText(displayName).width > W - CARD.pad * 2 && nameSize > 24);
  ctx.shadowColor = "rgba(124, 92, 255, 0.55)";
  ctx.shadowBlur = 26;
  ctx.fillStyle = CARD.fg;
  ctx.fillText(displayName, left, CARD.nameY);
  ctx.shadowBlur = 0;

  // ---- 称号バッジ ----
  const titleText = tr(rank.titleJa, rank.titleEn);
  ctx.font = '800 28px "Avenir Next", sans-serif';
  const titleW = ctx.measureText(titleText).width;
  const badgeIcon = 34;
  const badgeH = 56;
  const badgeW = badgeIcon + titleW + 62;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, left, CARD.titleY - badgeH / 2, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.strokeStyle = rank.accent;
  ctx.lineWidth = 2;
  roundRect(ctx, left, CARD.titleY - badgeH / 2, badgeW, badgeH, badgeH / 2);
  ctx.stroke();
  try {
    const img = await loadIconImage(rank.icon, badgeIcon, rank.accent);
    ctx.drawImage(img, left + 20, CARD.titleY - badgeIcon / 2, badgeIcon, badgeIcon);
  } catch {
    // アイコン画像が作れない環境でもカード本体は成立させる
  }
  ctx.fillStyle = rank.accent;
  ctx.fillText(titleText, left + badgeIcon + 34, CARD.titleY + 1);

  // ---- 区切り線 ----
  const divider = ctx.createLinearGradient(left, 0, right, 0);
  divider.addColorStop(0, rank.accent);
  divider.addColorStop(1, "rgba(255,255,255,0.06)");
  ctx.fillStyle = divider;
  ctx.fillRect(left, CARD.dividerY, right - left, 2);

  // ---- 統計グリッド（3 列 x 2 行）----
  const cells = [
    [String(stats.plays), tr("総プレイ", "Total plays")],
    [`${stats.winRate}%`, tr("勝率", "Win rate")],
    [String(stats.playDays), tr("プレイ日数", "Days played")],
    [String(stats.maxStreak), tr("MAXストリーク", "Max streak")],
    [`${stats.achUnlocked}/${stats.achTotal}`, tr("実績", "Achievements")],
    [String(stats.dailyStreak), tr("デイリー連続クリア", "Daily streak")],
  ];
  const colW = (right - left) / 3;
  cells.forEach(([value, label], i) => {
    const cx = left + (i % 3) * colW + colW / 2;
    const cy = CARD.statRows[Math.floor(i / 3)];
    ctx.textAlign = "center";
    ctx.font = '800 46px "Avenir Next", sans-serif';
    ctx.fillStyle = CARD.fg;
    ctx.fillText(value, cx, cy);
    ctx.font = '600 17px "Avenir Next", sans-serif';
    ctx.fillStyle = CARD.dim;
    ctx.fillText(label, cx, cy + CARD.statLabelGap);
  });
  // 列の区切り（細線）
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let i = 1; i < 3; i++) {
    ctx.fillRect(left + colW * i, CARD.statRows[0] - 40, 1, CARD.statRows[1] - CARD.statRows[0] + 66);
  }

  // ---- フッター: お気に入り / Member since / URL ----
  ctx.textAlign = "left";
  ctx.font = '600 18px "Avenir Next", sans-serif';
  ctx.fillStyle = CARD.dim;
  const favorites = tr(
    `テーマ: ${themeLabel(settings.theme)} ／ BGM: ${bgmLabel(settings.bgmTrack)}`,
    `Theme: ${themeLabel(settings.theme)} / BGM: ${bgmLabel(settings.bgmTrack)}`
  );
  const since = stats.firstPlay ? tr(`初プレイ ${fmtDate(stats.firstPlay)}`, `Since ${fmtDate(stats.firstPlay)}`) : "";
  ctx.fillText(`${favorites}${since ? `   ・   ${since}` : ""}`, left, CARD.favoritesY);
  ctx.textAlign = "right";
  ctx.fillText(
    `${SHARE_URL.replace(/^https:\/\//, "")}   ・   ${fmtDate(Math.floor(Date.now() / 1000))}`,
    right,
    CARD.footerY
  );

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

function downloadCard(cv) {
  const a = document.createElement("a");
  a.href = cv.toDataURL("image/png");
  a.download = `DWORDle2_player_card_${Date.now()}.png`;
  a.click();
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
          text: `${tr("私の DWORDle 2 プレイヤーカード！ #DWORDle2", "My DWORDle 2 player card! #DWORDle2")}\n${SHARE_URL}`,
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
  }
  // 画像付きシェアが使えない環境では保存に切り替える
  downloadCard(cv);
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

async function drawInto(stage, name, { deal }) {
  const cv = await renderPlayerCardCanvas(name);
  cardCanvas = cv;
  cv.className = "player-card-canvas";
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", tr("プレイヤーカード画像", "Player card image"));
  const wrap = el("div", { class: `player-card-wrap ${deal && !shouldReduceMotion() ? "deal" : ""}` }, cv);
  clear(stage).append(wrap);
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
      { class: "btn", onclick: () => { if (cardCanvas) { downloadCard(cardCanvas); toast(tr("画像を保存しました", "Image saved")); } } },
      icon("download"),
      tr("画像を保存", "Save image")
    )
  );

  const issue = async (isFirst) => {
    const name = sanitizeName(nameInput.value);
    saveJSON("playerCard", { name, issuedAt: Math.floor(Date.now() / 1000) });
    await drawInto(stage, name, { deal: true });
    actions.hidden = false;
    if (isFirst) {
      playSfx("achievementBig");
      winBurst([0x00d5ff, 0xffd166, 0xb45cff]);
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
