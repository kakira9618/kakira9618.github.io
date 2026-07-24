// 攻略済み / 未了問題一覧モード。
// 数が多い (No.1-39999) ので、「レベル帯タブ → 100 問ブロック → 問題番号」の
// 2 段ドリルダウンで一覧・選択しやすくしている。
// ルート: #/problems

import { el, clear, fmtDateTime } from "./dom.js";
import { registerScreen, navigate, getAppMode } from "./app.js?v=20260723-fa";
import { buildProblemStatus, MODES } from "../core/records.js";
import { LEVELS, isDailyPID, isValidPID, pidLabel, todayPID } from "../core/problems.js";
import { playSfx } from "../audio/sound.js?v=20260723-fa";
import { showModal } from "./modal.js?v=20260723-fa";
import { confirmAndStart } from "./game-screen.js?v=20260723-fa";
import { toast } from "./toast.js?v=20260723-fa";
import { soundToggleButton } from "./sound-toggle.js?v=20260723-fa";
import { icon } from "./icons.js";
import { localizedLevel, tr } from "../core/i18n.js?v=20260723-fa";

const BLOCK_SIZE = 100;

// color-mix 非対応の旧 Chrome では、var() 入りのインライン color-mix が
// 「計算値時に無効」となり背景ごと消えるため、ヒートマップ色付けをやめて素の面に留める。
const SUPPORTS_COLOR_MIX = CSS.supports("color", "color-mix(in srgb, red 50%, white)");

let root = null;
let levelIdx = -1; // -1 は Daily、0 以上は LEVELS のインデックス
let blockStart = null; // ブロック表示中の先頭 No.（null なら ブロック一覧）
let statusFilter = "all"; // "all" | "cleared" | "failed" | "unplayed"
let dailyCalendarMonth = null; // year * 12 + month。null は今月

function build() {
  root = document.getElementById("screen-problems");
}

function statusOf(statusMap, pid) {
  const st = statusMap.get(pid);
  if (!st) return "unplayed";
  if (st.cleared > 0) return "cleared";
  return "failed";
}

function openProblemMenu(pid, statusMap, { allowPlay = true } = {}) {
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
          style: { width: "100%" },
          onclick: () => navigate(`/result/${mode}/${time}`),
        },
        tr(`${fmtDateTime(time)} のプレイ`, `Play on ${fmtDateTime(time)}`)
      )
    );
  showModal({
    title: pidLabel(pid),
    body: [
      allowPlay
        ? el(
            "button",
            { class: "btn btn-primary", style: { width: "100%" }, onclick: () => { confirmAndStart(pid, mode); } },
            icon("play"),
            tr("この問題をプレイ", "Play this puzzle")
          )
        : el(
            "p",
            { class: "hint daily-history-only" },
            tr(
              "過去のDailyはプレイできません。プレイ履歴のみ確認できます。",
              "Past Daily puzzles cannot be played. You can only view their play history."
            )
          ),
      historyItems.length
        ? el("div", { class: "hint", style: { marginTop: "6px" } }, tr("プレイ履歴:", "Play history:"))
        : el("p", { class: "hint" }, tr("この問題はまだプレイしていません。", "This puzzle has not been played yet.")),
      ...historyItems,
    ],
    actions: [{ label: tr("閉じる", "Close"), onClick: () => {} }],
  });
}

function dailyDateFromPid(pid) {
  if (!isDailyPID(pid)) return null;
  const value = String(pid);
  if (!/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

function dailyPidForDate(year, month, day) {
  return year * 10000 + (month + 1) * 100 + day;
}

function dailyStatus(statusMap, pid) {
  const status = statusOf(statusMap, pid);
  const doubleClear = (statusMap.get(pid)?.doubleClears ?? 0) > 0;
  const label = doubleClear
    ? "DOUBLE CLEAR"
    : status === "cleared"
      ? tr("クリア済み", "Cleared")
      : status === "failed"
        ? tr("未クリア", "Failed")
        : tr("未プレイ", "Unplayed");
  return { status, doubleClear, label };
}

function dailyCalendar(statusMap) {
  const now = new Date();
  const todayPid = todayPID(now);
  const currentMonth = now.getFullYear() * 12 + now.getMonth();
  const playedDailyMonths = [...statusMap.keys()]
    .map(dailyDateFromPid)
    .filter(Boolean)
    .map((date) => date.getFullYear() * 12 + date.getMonth());
  const earliestMonth = playedDailyMonths.length ? Math.min(...playedDailyMonths) : currentMonth;
  if (
    dailyCalendarMonth === null
    || dailyCalendarMonth < earliestMonth
    || dailyCalendarMonth > currentMonth
  ) {
    dailyCalendarMonth = currentMonth;
  }
  const year = Math.floor(dailyCalendarMonth / 12);
  const month = dailyCalendarMonth % 12;
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push(el("span", { class: "daily-calendar-day empty", "aria-hidden": "true" }));
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const pid = dailyPidForDate(year, month, day);
    const { status, doubleClear, label } = dailyStatus(statusMap, pid);
    const today = pid === todayPid;
    const future = pid > todayPid;
    const interactive = today || status !== "unplayed";
    const dayLabel = tr(
      `${year}年${month + 1}月${day}日${today ? "、今日" : ""}、${label}`,
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}${today ? ", today" : ""}, ${label}`
    );
    cells.push(
      el(
        "button",
        {
          class: `daily-calendar-day ${status} ${doubleClear ? "double-clear" : ""} ${today ? "today" : ""} ${future ? "future" : ""}`,
          "aria-label": dayLabel,
          disabled: future || !interactive,
          onclick: () => {
            playSfx("ui");
            openProblemMenu(pid, statusMap, { allowPlay: today });
          },
        },
        el("span", { class: "daily-calendar-number" }, String(day)),
        el(
          "span",
          { class: "daily-calendar-mark", "aria-hidden": "true" },
          doubleClear ? "★" : status === "cleared" ? "✓" : status === "failed" ? "!" : today ? "●" : ""
        )
      )
    );
  }
  while (cells.length % 7 !== 0) {
    cells.push(el("span", { class: "daily-calendar-day empty", "aria-hidden": "true" }));
  }
  return el(
    "section",
    { class: "card daily-calendar-card", "aria-label": tr("Daily プレイ履歴", "Daily play history") },
    el(
      "div",
      { class: "daily-calendar-nav" },
      el(
        "button",
        {
          class: "icon-btn",
          disabled: dailyCalendarMonth <= earliestMonth,
          "aria-label": tr("前の月", "Previous month"),
          onclick: () => {
            playSfx("ui");
            dailyCalendarMonth--;
            render();
          },
        },
        icon("arrowLeft", 17)
      ),
      el(
        "span",
        { class: "daily-calendar-month", "aria-live": "polite" },
        tr(`${year}年${month + 1}月`, `${year}-${String(month + 1).padStart(2, "0")}`)
      ),
      el(
        "button",
        {
          class: "icon-btn daily-calendar-next",
          disabled: dailyCalendarMonth >= currentMonth,
          "aria-label": tr("次の月", "Next month"),
          onclick: () => {
            playSfx("ui");
            dailyCalendarMonth++;
            render();
          },
        },
        icon("arrowLeft", 17)
      )
    ),
    el(
      "div",
      { class: "daily-calendar-weekdays", "aria-hidden": "true" },
      tr(["日", "月", "火", "水", "木", "金", "土"], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
        .map((label) => el("span", {}, label))
    ),
    el("div", { class: "daily-calendar-grid" }, cells)
  );
}

function render() {
  if (!root) build();
  clear(root);
  const mode = getAppMode();
  const statusMap = buildProblemStatus(mode);
  const level = levelIdx >= 0 ? LEVELS[levelIdx] : null;
  const [lo, hi] = level?.range ?? [null, null];

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
    { class: "seg problem-level-tabs" },
    [
      el(
        "button",
        {
          class: levelIdx === -1 ? "active" : "",
          onclick: () => {
            playSfx("ui");
            levelIdx = -1;
            blockStart = null;
            render();
          },
        },
        "Daily"
      ),
      ...LEVELS.map((lv, i) =>
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
      ),
    ]
  );

  const body = el("div", { class: "list-screen-body" });
  body.append(levelSeg);
  if (levelIdx === -1) {
    body.append(dailyCalendar(statusMap));
    root.append(header, body);
    return;
  }

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
      el("span", {}, `No.${lo} - No.${hi}`),
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
      const doubleClear = (statusMap.get(pid)?.doubleClears ?? 0) > 0;
      if (statusFilter !== "all" && st !== statusFilter) continue;
      cells.push(
        el(
          "button",
          {
            class: `num-cell ${st === "unplayed" ? "" : st} ${doubleClear ? "double-clear" : ""}`,
            "aria-label": tr(
              `問題 ${pid}、${doubleClear ? "DOUBLE CLEAR済み" : st === "cleared" ? "クリア済み" : st === "failed" ? "未クリア" : "未プレイ"}`,
              `Puzzle ${pid}, ${doubleClear ? "DOUBLE CLEAR" : st === "cleared" ? "cleared" : st === "failed" ? "failed" : "unplayed"}`
            ),
            onclick: () => openProblemMenu(pid, statusMap),
          },
          String(pid)
        )
      );
    }
    body.append(
      el(
        "div",
        { class: "progress-note problem-block-head" },
        tr(`ブロック No.${s} - No.${e}`, `Block No.${s} - No.${e}`)
      ),
      cells.length
        ? el("div", { class: "num-grid" }, cells)
        : el("p", { class: "hint", style: { textAlign: "center" } }, tr("該当する問題がありません", "No matching puzzles"))
    );
  }

  root.append(header, body);
}

function jumpPrompt() {
  const input = el("input", {
    type: "number",
    placeholder: tr("問題番号 (例: 12345)", "Puzzle number (e.g. 12345)"),
    min: "1",
    max: "39999",
    "aria-label": tr("問題番号", "Puzzle number"),
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
