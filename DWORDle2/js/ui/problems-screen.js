// 攻略済み / 未了問題一覧モード。
// 数が多い (No.1-39999) ので、「レベル帯タブ → 100 問ブロック → 問題番号」の
// 2 段ドリルダウンで一覧・選択しやすくしている。
// ルート: #/problems

import { el, clear, fmtDateTime } from "./dom.js";
import { registerScreen, navigate, getAppMode } from "./app.js?v=20260723-swup";
import { buildProblemStatus, MODES } from "../core/records.js";
import { LEVELS, isValidPID, pidLabel } from "../core/problems.js";
import { playSfx } from "../audio/sound.js?v=20260723-swup";
import { showModal } from "./modal.js?v=20260723-swup";
import { confirmAndStart } from "./game-screen.js?v=20260723-swup";
import { toast } from "./toast.js?v=20260723-swup";
import { soundToggleButton } from "./sound-toggle.js?v=20260723-swup";
import { icon } from "./icons.js";
import { localizedLevel, tr } from "../core/i18n.js?v=20260723-swup";

const BLOCK_SIZE = 100;

// color-mix 非対応の旧 Chrome では、var() 入りのインライン color-mix が
// 「計算値時に無効」となり背景ごと消えるため、ヒートマップ色付けをやめて素の面に留める。
const SUPPORTS_COLOR_MIX = CSS.supports("color", "color-mix(in srgb, red 50%, white)");

let root = null;
let levelIdx = 0; // LEVELS のインデックス
let blockStart = null; // ブロック表示中の先頭 No.（null なら ブロック一覧）
let statusFilter = "all"; // "all" | "cleared" | "failed" | "unplayed"

function build() {
  root = document.getElementById("screen-problems");
}

function statusOf(statusMap, pid) {
  const st = statusMap.get(pid);
  if (!st) return "unplayed";
  if (st.cleared > 0) return "cleared";
  return "failed";
}

function openProblemMenu(pid, statusMap) {
  const mode = getAppMode();
  const st = statusMap.get(pid);
  const historyItems = (st?.times ?? [])
    .slice()
    .reverse()
    .map((time) =>
      el(
        "button",
        {
          class: "btn",
          style: { width: "100%", justifyContent: "space-between" },
          onclick: () => navigate(`/result/${mode}/${time}`),
        },
        fmtDateTime(time),
        tr("結果を見る →", "View result →")
      )
    );
  showModal({
    title: pidLabel(pid),
    body: [
      el(
        "button",
        { class: "btn btn-primary", style: { width: "100%" }, onclick: () => { confirmAndStart(pid, mode); } },
        icon("play"),
        tr("この問題をプレイ", "Play this puzzle")
      ),
      historyItems.length
        ? el("div", { class: "hint", style: { marginTop: "6px" } }, tr("プレイ履歴:", "Play history:"))
        : el("p", { class: "hint" }, tr("この問題はまだプレイしていません。", "This puzzle has not been played yet.")),
      ...historyItems,
    ],
    actions: [{ label: tr("閉じる", "Close"), onClick: () => {} }],
  });
}

function render() {
  if (!root) build();
  clear(root);
  const mode = getAppMode();
  const statusMap = buildProblemStatus(mode);
  const level = LEVELS[levelIdx];
  const [lo, hi] = level.range;

  const header = el(
    "div",
    { class: "header" },
    el("button", {
      class: "icon-btn",
      "aria-label": blockStart !== null ? tr("ブロック一覧へ戻る", "Back to puzzle blocks") : tr("タイトルへ戻る", "Back to title"),
      onclick: () => {
        playSfx("ui");
        if (blockStart !== null) {
          blockStart = null;
          render();
        } else {
          navigate("/");
        }
      },
    }, icon("arrowLeft")),
    el("h1", { class: "title" }, tr("問題一覧", "Puzzles")),
    el("span", { class: "spacer" }),
    el("span", { class: `mode-chip ${mode === "uso" ? "uso" : ""}` }, MODES[mode].title),
    soundToggleButton(),
    el(
      "button",
      {
        class: "icon-btn",
        title: tr("番号へジャンプ", "Jump to number"),
        "aria-label": tr("番号へジャンプ", "Jump to number"),
        onclick: jumpPrompt,
      },
      icon("search")
    )
  );

  // レベル帯タブ
  const levelSeg = el(
    "div",
    { class: "seg", style: { margin: "10px 12px 0" } },
    LEVELS.map((lv, i) =>
      el(
        "button",
        {
          class: i === levelIdx ? "active" : "",
          onclick: () => {
            playSfx("ui");
            levelIdx = i;
            blockStart = null;
            render();
          },
        },
        localizedLevel(lv).name
      )
    )
  );

  const body = el("div", { class: "list-screen-body" });

  // 帯全体の進捗
  let clearedCount = 0;
  let playedCount = 0;
  for (const [pid, st] of statusMap) {
    if (pid >= lo && pid <= hi) {
      playedCount++;
      if (st.cleared > 0) clearedCount++;
    }
  }
  body.append(
    el(
      "div",
      { class: "progress-note", style: { display: "flex", justifyContent: "space-between" } },
      el("span", {}, `No.${lo} - No.${hi} (${localizedLevel(level).desc})`),
      el(
        "span",
        {},
        tr(`クリア ${clearedCount} / プレイ ${playedCount}`, `Cleared ${clearedCount} / Played ${playedCount}`)
      )
    )
  );

  if (blockStart === null) {
    // ---- ブロック一覧（100 問単位）----
    const blocks = [];
    for (let s = lo; s <= hi; s += BLOCK_SIZE) {
      const e = Math.min(s + BLOCK_SIZE - 1, hi);
      let c = 0;
      let p = 0;
      for (let pid = s; pid <= e; pid++) {
        const st = statusMap.get(pid);
        if (st) {
          p++;
          if (st.cleared > 0) c++;
        }
      }
      const total = e - s + 1;
      const ratio = c / total;
      const complete = c === total; // ブロック内を全問クリア
      blocks.push(
        el(
          "button",
          {
            class: `block-cell ${complete ? "complete" : ""}`,
            "aria-label": complete
              ? tr(`問題 ${s} から ${e}、全問クリア`, `Puzzles ${s} to ${e}, all cleared`)
              : tr(`問題 ${s} から ${e}、クリア ${c}、プレイ ${p}`, `Puzzles ${s} to ${e}, ${c} cleared, ${p} played`),
            style: !complete && ratio > 0 && SUPPORTS_COLOR_MIX ? { background: `color-mix(in srgb, var(--tile-correct) ${Math.round(8 + ratio * 42)}%, var(--bg-panel))` } : {},
            onclick: () => {
              playSfx("ui");
              blockStart = s;
              render();
            },
          },
          el("div", { class: "bn" }, `${s}`),
          el("div", { class: "bp" }, complete ? `★${c}/${total}` : p > 0 ? `✓${c}/${p}` : "—")
        )
      );
    }
    body.append(el("div", { class: "block-grid" }, blocks));
  } else {
    // ---- ブロック内の問題番号一覧 ----
    const s = blockStart;
    const e = Math.min(s + BLOCK_SIZE - 1, hi);
    body.append(
      el(
        "div",
        { class: "seg" },
        [
          ["all", tr("全て", "All")],
          ["cleared", tr("クリア", "Cleared")],
          ["failed", tr("未クリア", "Failed")],
          ["unplayed", tr("未プレイ", "Unplayed")],
        ].map(([key, label]) =>
          el(
            "button",
            {
              class: key === statusFilter ? "active" : "",
              onclick: () => {
                statusFilter = key;
                render();
              },
            },
            label
          )
        )
      )
    );
    const cells = [];
    for (let pid = s; pid <= e; pid++) {
      const st = statusOf(statusMap, pid);
      if (statusFilter !== "all" && st !== statusFilter) continue;
      cells.push(
        el(
          "button",
          {
            class: `num-cell ${st === "unplayed" ? "" : st}`,
            "aria-label": tr(
              `問題 ${pid}、${st === "cleared" ? "クリア済み" : st === "failed" ? "未クリア" : "未プレイ"}`,
              `Puzzle ${pid}, ${st === "cleared" ? "cleared" : st === "failed" ? "failed" : "unplayed"}`
            ),
            onclick: () => openProblemMenu(pid, statusMap),
          },
          String(pid)
        )
      );
    }
    body.append(
      el("div", { class: "progress-note" }, tr(`ブロック No.${s} - No.${e}`, `Block No.${s} - No.${e}`)),
      cells.length
        ? el("div", { class: "num-grid" }, cells)
        : el("p", { class: "hint", style: { textAlign: "center" } }, tr("該当する問題がありません", "No matching puzzles"))
    );
  }

  root.append(header, levelSeg, body);
}

function jumpPrompt() {
  const input = el("input", {
    type: "number",
    placeholder: tr("問題番号 (例: 12345)", "Puzzle number (e.g. 12345)"),
    min: "1",
    max: "39999",
  });
  showModal({
    title: tr("番号へジャンプ", "Jump to number"),
    body: [
      input,
      el(
        "p",
        { class: "hint" },
        tr(
          "No.1-9999: やさしい / No.10000-19999: 極 / No.20000-39999: レベル別",
          "No.1–9999: Easy / No.10000–19999: Extreme / No.20000–39999: Level-based"
        )
      ),
    ],
    actions: [
      { label: tr("キャンセル", "Cancel"), onClick: () => {} },
      {
        label: tr("ジャンプ", "Jump"),
        primary: true,
        onClick: () => {
          const pid = parseInt(input.value, 10);
          if (!isValidPID(pid) || pid < 1 || pid > 39999) {
            toast(tr("1〜39999 の番号を入力してください", "Enter a number from 1 to 39999"));
            return false;
          }
          levelIdx = LEVELS.findIndex((lv) => pid >= lv.range[0] && pid <= lv.range[1]);
          blockStart = Math.floor((pid - LEVELS[levelIdx].range[0]) / BLOCK_SIZE) * BLOCK_SIZE + LEVELS[levelIdx].range[0];
          render();
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 50);
}

registerScreen("problems", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
