// プレイ結果のスクリーンショット機能。
// 画面のキャプチャではなく、必要事項（タイトル・No.・盤面・答え・URL）だけを
// canvas に再レンダリングして PNG としてダウンロードする。
// 見た目は現在のテーマ（cyber / classic）に合わせる。

import { SHARE_URL, tileColorsFor } from "../config.js?v=20260723-fa";
import { MODES } from "../core/records.js";
import { pidLabel } from "../core/problems.js";
import { CELL, queryWordSingle } from "../core/logic.js";
import { getSettings } from "../core/settings.js?v=20260723-fa";
import { drawCrown3D } from "./crown.js?v=20260723-fa";

// レイアウト定数（すべて基準幅 720px に対する px）
const SS = {
  width: 720,
  pad: 44,
  titleSize: 44,
  metaSize: 20,
  resultSize: 52,
  tile: 52,
  tileGap: 8,
  tileRadius: 10,
  footerSize: 18,
  doubleClearColor: "#ffd166", // FINAL ANSWER 成功（DOUBLE CLEAR!）のタイトル色
};

const THEME_STYLES = {
  cyber: {
    bgTop: "#070a16",
    bgBottom: "#0b1226",
    fg: "#e8f6ff",
    dim: "#7d92b5",
    accent: "#00d5ff",
    accentUso: "#ff2b5e",
    clear: "#00e68a",
    over: "#ff6a6a",
    finalAccent: "#ffd166",
    tileBorder: "rgba(120,150,200,0.35)",
    glow: true,
  },
  classic: {
    bgTop: "#202020",
    bgBottom: "#202020",
    fg: "#f2f2f2",
    dim: "#9a9a9a",
    accent: "#f2f2f2",
    accentUso: "#c83c3c",
    clear: "#6aaa64",
    over: "#d84343",
    finalAccent: "#ffd166",
    tileBorder: "#555",
    glow: false,
  },
  pop: {
    bgTop: "#fff7fb",
    bgBottom: "#ffeaf3",
    fg: "#3a2b3c",
    dim: "#9c8aa3",
    accent: "#ff4f9e",
    accentUso: "#e0426a",
    clear: "#2dbd6e",
    over: "#e0426a",
    finalAccent: "#713600",
    tileBorder: "rgba(255, 79, 158, 0.35)",
    glow: false,
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGuessFlag(ctx, x, y, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r * 0.66);
  ctx.moveTo(x - r / 4, y + r * 0.66);
  ctx.lineTo(x + r / 4, y + r * 0.66);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y - r / 2);
  ctx.moveTo(x, y);
  ctx.lineTo(x + r, y - r / 2);
  ctx.stroke();
  ctx.restore();
}

function finalAnswerInfo(record, logic) {
  const attempt = record.finalAnswer;
  const lastWord = record.guessWord[record.guessWord.length - 1];
  const target = attempt && lastWord ? logic.otherAnswer(lastWord) : null;
  if (!attempt?.word || !target) return null;
  return {
    ...attempt,
    target,
    result: queryWordSingle(attempt.word, target),
  };
}

// クラシックテーマ: 原作 GameResult のスクリーンショットを再現する。
// #202020 の無地背景に盤面をそのまま描き、下に "Answer: XXX, YYY" を白字で置くだけ。
function renderClassicCanvas(record, logic, displayRows) {
  const tileColors = tileColorsFor("classic", getSettings().highContrast);
  const faInfo = finalAnswerInfo(record, logic);
  const rows = record.guessWord.length;
  const gridH = rows * (SS.tile + SS.tileGap);
  const height = SS.pad + gridH + 104 + (faInfo ? 138 : 0);

  const scale = 2;
  const cv = document.createElement("canvas");
  cv.width = SS.width * scale;
  cv.height = height * scale;
  const ctx = cv.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#202020";
  ctx.fillRect(0, 0, SS.width, height);

  const centerX = SS.width / 2;
  const gridW = 5 * SS.tile + 4 * SS.tileGap;
  const gx0 = centerX - gridW / 2;
  let y = SS.pad + 13;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 答え → 入力履歴 → FINAL ANSWER の順に並べる。
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 26px "Helvetica Neue", "Avenir Next", sans-serif`;
  ctx.fillText(`Answer: ${logic.ans1.toUpperCase()}, ${logic.ans2.toUpperCase()}`, centerX, y);
  y += 33;

  ctx.font = `800 ${SS.tile * 0.5}px "Helvetica Neue", "Avenir Next", sans-serif`;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 5; i++) {
      const s = displayRows[r][i];
      const x = gx0 + i * (SS.tile + SS.tileGap);
      ctx.fillStyle = s === CELL.CORRECT ? tileColors.correct : s === CELL.USED ? tileColors.used : tileColors.unused;
      roundRect(ctx, x, y, SS.tile, SS.tile, 5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(record.guessWord[r][i].toUpperCase(), x + SS.tile / 2, y + SS.tile / 2 + 1);
    }
    y += SS.tile + SS.tileGap;
  }

  if (faInfo) {
    y += 30;
    ctx.fillStyle = faInfo.success ? SS.doubleClearColor : "#9a9a9a";
    ctx.font = `900 16px "Helvetica Neue", "Avenir Next", sans-serif`;
    ctx.fillText("FINAL ANSWER", centerX, y);
    y += 22;
    ctx.font = `800 ${SS.tile * 0.5}px "Helvetica Neue", "Avenir Next", sans-serif`;
    for (let i = 0; i < 5; i++) {
      const stateName = faInfo.result[i];
      const x = gx0 + i * (SS.tile + SS.tileGap);
      ctx.fillStyle =
        stateName === CELL.CORRECT ? tileColors.correct :
          stateName === CELL.USED ? tileColors.used : tileColors.unused;
      roundRect(ctx, x, y, SS.tile, SS.tile, 5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(faInfo.word[i].toUpperCase(), x + SS.tile / 2, y + SS.tile / 2 + 1);
    }
    if (faInfo.success) {
      const flagCenterX = gx0 + gridW + 27.5;
      drawCrown3D(ctx, flagCenterX, y + SS.tile / 2 + 5, 34, Math.PI / 9, SS.doubleClearColor);
    }
  }

  return cv;
}

// record + logic + 表示用判定から PNG canvas を作る
export function renderResultCanvas(record, logic, displayRows) {
  const { theme, highContrast } = getSettings();
  if (theme === "classic") return renderClassicCanvas(record, logic, displayRows);
  const st = THEME_STYLES[theme] ?? THEME_STYLES.cyber;
  const tileColors = tileColorsFor(theme, highContrast);
  const isUso = record.gameMode === "uso";
  const accent = isUso ? st.accentUso : st.accent;
  const flagColor = theme === "pop" && !isUso ? "#000000" : st.fg;
  const cleared = record.clear;
  const faInfo = finalAnswerInfo(record, logic);
  const maxGuess = MODES[record.gameMode].maxGuess;

  const rows = record.guessWord.length;
  const gridH = rows * (SS.tile + SS.tileGap);
  // ヘッダ部(タイトル+メタ+CLEAR表示) ≈ 220px、答え 2 行 + フッタ ≈ 190px
  const height = 220 + gridH + 190 + (faInfo ? 142 : 0);

  const scale = 2; // Retina 向けに 2 倍で描く
  const cv = document.createElement("canvas");
  cv.width = SS.width * scale;
  cv.height = height * scale;
  const ctx = cv.getContext("2d");
  ctx.scale(scale, scale);

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, st.bgTop);
  bg.addColorStop(1, st.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SS.width, height);
  if (st.glow) {
    // うっすらグリッド線
    ctx.strokeStyle = "rgba(0,213,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= SS.width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SS.width, y);
      ctx.stroke();
    }
  }

  const centerX = SS.width / 2;
  let y = SS.pad + SS.titleSize / 2;

  // タイトル
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${SS.titleSize}px "Avenir Next", "Helvetica Neue", sans-serif`;
  if (st.glow) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = 26;
  }
  ctx.fillStyle = accent;
  ctx.fillText(`${MODES[record.gameMode].title} 2`, centerX, y);
  ctx.shadowBlur = 0;

  // メタ情報
  y += SS.titleSize / 2 + 24;
  ctx.font = `600 ${SS.metaSize}px "Avenir Next", sans-serif`;
  ctx.fillStyle = st.dim;
  const d = new Date(record.startTime * 1000);
  const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  const countText = cleared ? `${rows}/${maxGuess}` : `X/${maxGuess}`;
  ctx.fillText(`${pidLabel(record.problemID)}   ${dateStr}   ${countText}`, centerX, y);

  // DOUBLE CLEAR! / GAME CLEAR / GAME OVER（DOUBLE CLEAR は金色で目立たせる）
  y += 52;
  const doubleClear = Boolean(faInfo?.success);
  ctx.font = `900 ${SS.resultSize}px "Avenir Next", sans-serif`;
  ctx.fillStyle = doubleClear ? st.finalAccent : cleared ? st.clear : st.over;
  if (st.glow || (doubleClear && theme !== "pop")) {
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 30;
  }
  ctx.fillText(doubleClear ? "DOUBLE CLEAR!" : cleared ? "GAME CLEAR" : "GAME OVER", centerX, y);
  ctx.shadowBlur = 0;

  // 答え → 入力履歴 → FINAL ANSWER の順に並べる。
  y += 56;
  const gridW = 5 * SS.tile + 4 * SS.tileGap;
  const gx0 = centerX - gridW / 2;
  const lastWord = record.guessWord[rows - 1];
  const ax0 = gx0;
  const flagX = ax0 + gridW + 20;
  const flagCenterX = flagX + 7.5;
  for (const [label, word] of [["Word 1", logic.ans1], ["Word 2", logic.ans2]]) {
    if (cleared && word === lastWord) drawGuessFlag(ctx, flagX, y + SS.tile / 2, 20, flagColor);
    if (doubleClear && word === faInfo.target) {
      drawCrown3D(ctx, flagCenterX, y + SS.tile / 2 + 5, 34, Math.PI / 9, st.finalAccent);
    }
    ctx.font = `600 16px "Avenir Next", sans-serif`;
    ctx.fillStyle = st.dim;
    ctx.textAlign = "right";
    ctx.fillText(label, ax0 - 14, y + SS.tile / 2);
    ctx.textAlign = "center";
    ctx.font = `800 ${SS.tile * 0.5}px "Avenir Next", sans-serif`;
    for (let i = 0; i < 5; i++) {
      const x = ax0 + i * (SS.tile + SS.tileGap);
      ctx.fillStyle = "rgba(127,127,127,0.16)";
      roundRect(ctx, x, y, SS.tile, SS.tile, SS.tileRadius);
      ctx.fill();
      ctx.strokeStyle = st.tileBorder;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, y, SS.tile, SS.tile, SS.tileRadius);
      ctx.stroke();
      ctx.fillStyle = st.fg;
      ctx.fillText(word[i].toUpperCase(), x + SS.tile / 2, y + SS.tile / 2 + 1);
    }
    y += SS.tile + 10;
  }

  y += 26;
  ctx.font = `800 ${SS.tile * 0.5}px "Avenir Next", sans-serif`;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 5; i++) {
      const s = displayRows[r][i];
      const x = gx0 + i * (SS.tile + SS.tileGap);
      const color = s === CELL.CORRECT ? tileColors.correct : s === CELL.USED ? tileColors.used : tileColors.unused;
      if (st.glow && s === CELL.CORRECT) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
      }
      ctx.fillStyle = color;
      roundRect(ctx, x, y, SS.tile, SS.tile, SS.tileRadius);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme === "cyber" && s !== CELL.UNUSED ? "#04120b" : "#ffffff";
      ctx.fillText(record.guessWord[r][i].toUpperCase(), x + SS.tile / 2, y + SS.tile / 2 + 1);
    }
    y += SS.tile + SS.tileGap;
  }

  // FINAL ANSWER は入力履歴の下に、結果画面と同じ独立カードで描く。
  if (faInfo) {
    const cardX = ax0 - 24;
    const cardY = y + 8;
    const cardW = gridW + 48;
    const cardH = 120;
    ctx.fillStyle = "rgba(127,127,127,0.1)";
    roundRect(ctx, cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.strokeStyle = faInfo.success ? st.finalAccent : st.tileBorder;
    ctx.lineWidth = 1.5;
    roundRect(ctx, cardX, cardY, cardW, cardH, 12);
    ctx.stroke();

    ctx.fillStyle = faInfo.success ? st.finalAccent : st.dim;
    ctx.font = `900 16px "Avenir Next", sans-serif`;
    ctx.fillText("FINAL ANSWER", centerX, cardY + 18);
    const rowY = cardY + 34;
    ctx.font = `800 ${SS.tile * 0.5}px "Avenir Next", sans-serif`;
    for (let i = 0; i < 5; i++) {
      const stateName = faInfo.result[i];
      const x = ax0 + i * (SS.tile + SS.tileGap);
      ctx.fillStyle =
        stateName === CELL.CORRECT ? tileColors.correct :
          stateName === CELL.USED ? tileColors.used : tileColors.unused;
      roundRect(ctx, x, rowY, SS.tile, SS.tile, SS.tileRadius);
      ctx.fill();
      ctx.fillStyle = theme === "cyber" && stateName !== CELL.UNUSED ? "#04120b" : "#ffffff";
      ctx.fillText(faInfo.word[i].toUpperCase(), x + SS.tile / 2, rowY + SS.tile / 2 + 1);
    }
    ctx.fillStyle = st.dim;
    ctx.font = `600 14px "Avenir Next", sans-serif`;
    ctx.fillText(
      faInfo.success ? "The other answer, found in one shot!" : "The other answer slipped away.",
      centerX,
      cardY + 104
    );
  }

  // フッター (URL)
  ctx.font = `600 ${SS.footerSize}px "Avenir Next", sans-serif`;
  ctx.fillStyle = st.dim;
  ctx.fillText(SHARE_URL.replace(/^https:\/\//, ""), centerX, height - 30);

  return cv;
}

// iOS Safari は data: URL + download 属性の保存を無視することがあるため、
// Blob URL + DOM に追加した a 要素で保存する（履歴エクスポートと同じ方式）
export async function downloadResultPNG(record, logic, displayRows) {
  const cv = renderResultCanvas(record, logic, displayRows);
  const blob = await new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  const url = blob ? URL.createObjectURL(blob) : cv.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  const name = record.gameMode === "uso" ? "DWORDlie2" : "DWORDle2";
  a.download = `${name}_${record.problemID}_${record.startTime}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
}
