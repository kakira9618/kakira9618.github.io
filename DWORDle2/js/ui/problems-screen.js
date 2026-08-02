// 攻略済み / 未了問題一覧モード。
// 数が多い (No.1-39999) ので、「レベル帯タブ → 100 問ブロック → 問題番号」の
// 2 段ドリルダウンで一覧・選択しやすくしている。
// ルート: #/problems

import { el, clear, fmtDateTime } from "./dom.js?v=20260803-a";
import { registerScreen, navigate, getAppMode, setAppMode } from "./app.js?v=20260803-a";
import { buildProblemStatus, MODES } from "../core/records.js?v=20260803-a";
import {
  LEVELS,
  PID,
  isDailyPID,
  isValidPID,
  numberPrefix,
  pidForNumber,
  pidLabel,
  pidRangeForLevel,
  problemNumber,
  todayPID,
} from "../core/problems.js?v=20260803-a";
import { playSfx } from "../audio/sound.js?v=20260803-a";
import { showModal } from "./modal.js?v=20260803-a";
import { confirmAndStart } from "./game-screen.js?v=20260803-a";
import { toast } from "./toast.js?v=20260803-a";
import { soundToggleButton } from "./sound-toggle.js?v=20260803-a";
import { icon } from "./icons.js?v=20260803-a";
import { localizedLevel, tr } from "../core/i18n.js?v=20260803-a";

const BLOCK_SIZE = 100;

// color-mix 非対応の旧 Chrome では、var() 入りのインライン color-mix が
// 「計算値時に無効」となり背景ごと消えるため、ヒートマップ色付けをやめて素の面に留める。
const SUPPORTS_COLOR_MIX = CSS.supports("color", "color-mix(in srgb, red 50%, white)");

let root = null;
let levelIdx = -1; // -1 は Daily、0 以上は LEVELS のインデックス
let classicSet = false; // true なら Cls.（旧出題）を並べる。Daily には無い区別
let blockStart = null; // ブロック表示中の先頭 No.（null なら ブロック一覧）
let statusFilter = "all"; // "all" | "cleared" | "failed" | "unplayed"
let dailyCalendarMonth = null; // year * 12 + month。null は今月
let dailySelectedPid = null; // カレンダーで選択中の日付（null は今日）
// 履歴が無い月も見られるように、カレンダーは今月の前後どちらへも辿れるようにする
// （未来の日付はプレイできないままで、眺めるだけ）
const DAILY_CALENDAR_MAX_MONTHS_BACK = 120;
const DAILY_CALENDAR_MAX_MONTHS_AHEAD = 120;

function build() {
  root = document.getElementById("screen-problems");
}

// Cls.（旧出題）を選んでいるときに、実績の対象外であることを添える
function classicNote() {
  return el(
    "p",
    { class: "hint problem-set-note" },
    tr(
      "Cls. は原作 DWORDle 互換の旧出題です。2026-08-01 以降のプレイは実績の対象になりません（通算プレイ日数・連続プレイは数えます）。",
      "Cls. puzzles use the original DWORDle generator. Plays on or after 2026-08-01 do not count toward achievements (play days and play streaks still count)."
    )
  );
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
          style: { width: "100%" },
          onclick: () => navigate(`/result/${mode}/${time}`),
        },
        tr(`${fmtDateTime(time)} のプレイ`, `Play on ${fmtDateTime(time)}`)
      )
    );
  showModal({
    // 履歴が長いと「閉じる」まで遠いので、右上の × でも閉じられるようにする
    closeButton: true,
    title: pidLabel(pid),
    body: [
      el(
        "button",
        { class: "btn btn-primary", style: { width: "100%" }, onclick: () => { confirmAndStart(pid, mode); } },
        icon("play"),
        tr("この問題をプレイ", "Play this puzzle")
      ),
      classicSet ? classicNote() : null,
      historyItems.length
        ? el("div", { class: "hint", style: { marginTop: "6px" } }, tr("プレイ履歴:", "Play history:"))
        : el("p", { class: "hint" }, tr("この問題はまだプレイしていません。", "This puzzle has not been played yet.")),
      ...historyItems,
    ].filter(Boolean),
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
  // 履歴が無い月も見られるように、遡行の下限は履歴とは無関係に決める
  const earliestMonth = Math.min(
    currentMonth - DAILY_CALENDAR_MAX_MONTHS_BACK,
    ...playedDailyMonths
  );
  const latestMonth = currentMonth + DAILY_CALENDAR_MAX_MONTHS_AHEAD;
  if (
    dailyCalendarMonth === null
    || dailyCalendarMonth < earliestMonth
    || dailyCalendarMonth > latestMonth
  ) {
    dailyCalendarMonth = currentMonth;
  }
  // 選択中の日付。未選択なら今日。未来の日付も（プレイはできないが）選んで眺められる
  const selectedPid = dailySelectedPid ?? todayPid;
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
    const selected = pid === selectedPid;
    const dayLabel = tr(
      `${year}年${month + 1}月${day}日${today ? "、今日" : ""}、${future ? "まだ出題前" : label}`,
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}${today ? ", today" : ""}, ${future ? "not available yet" : label}`
    );
    cells.push(
      el(
        "button",
        {
          class: `daily-calendar-day ${status} ${doubleClear ? "double-clear" : ""} ${today ? "today" : ""} ${future ? "future" : ""} ${selected ? "selected" : ""}`,
          "aria-label": dayLabel,
          "aria-pressed": String(selected),
          onclick: () => {
            playSfx("ui");
            // ダイアログではなくカレンダー直下に内容を展開する
            dailySelectedPid = pid;
            render();
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
          disabled: dailyCalendarMonth >= latestMonth,
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
    el("div", { class: "daily-calendar-grid" }, cells),
    dailyDetail(selectedPid, statusMap, todayPid)
  );
}

// 選択した日の内容。以前はダイアログで出していたものをカレンダー直下へ展開する。
function dailyDetail(pid, statusMap, todayPid) {
  const mode = getAppMode();
  const date = dailyDateFromPid(pid);
  const isToday = pid === todayPid;
  const isFuture = pid > todayPid;
  const { status, doubleClear, label } = dailyStatus(statusMap, pid);
  const heading = date
    ? tr(
        `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      )
    : pidLabel(pid);
  const plays = (statusMap.get(pid)?.times ?? []).slice().reverse();
  return el(
    "div",
    { class: "daily-detail", "aria-live": "polite" },
    el(
      "div",
      { class: "daily-detail-head" },
      el("span", { class: "daily-detail-date" }, heading),
      isToday ? el("span", { class: "daily-detail-today" }, tr("今日", "Today")) : null,
      el("span", { class: "spacer" }),
      el(
        "span",
        { class: `daily-detail-status ${isFuture ? "future" : doubleClear ? "double-clear" : status}` },
        isFuture ? tr("出題前", "Not yet") : label
      )
    ),
    // 未来の日付は眺めるだけ。プレイ導線が無い理由をここで示す
    isFuture
      ? el(
          "div",
          { class: "hint daily-detail-future" },
          tr("この日の問題は、その日になったらプレイできます", "This puzzle unlocks on that day")
        )
      : null,
    // 説明文は置かず、今日のプレイ導線と過去のプレイ結果へのリンクだけを並べる
    isToday
      ? el(
          "button",
          { class: "btn btn-primary daily-detail-play", onclick: () => { playSfx("ui"); confirmAndStart(pid, mode); } },
          icon("play"),
          tr("この問題をプレイ", "Play this puzzle")
        )
      : null,
    plays.length
      ? el(
          "div",
          { class: "daily-detail-plays" },
          ...plays.map((time) =>
            el(
              "button",
              { class: "btn", onclick: () => { playSfx("ui"); navigate(`/result/${mode}/${time}`); } },
              tr(`${fmtDateTime(time)} のプレイ`, `Play on ${fmtDateTime(time)}`)
            )
          )
        )
      : null
  );
}

function render() {
  if (!root) build();
  clear(root);
  const mode = getAppMode();
  const statusMap = buildProblemStatus(mode);
  const level = levelIdx >= 0 ? LEVELS[levelIdx] : null;
  const [lo, hi] = level ? pidRangeForLevel(level, classicSet) : [null, null];

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
    ),
    // タイトル画面と同じく、右上のボタンで DWORDle / DWORDlie を切り替えられるようにする
    el(
      "button",
      {
        class: "icon-btn",
        title: mode === "uso" ? tr("表モードへ", "Switch to DWORDle") : tr("裏モードへ", "Switch to DWORDlie"),
        "aria-label": mode === "uso" ? tr("表モードへ", "Switch to DWORDle") : tr("裏モードへ", "Switch to DWORDlie"),
        style: mode === "uso" ? { boxShadow: "0 0 12px rgba(255,43,94,0.8)", color: "#ff5f8f" } : {},
        onclick: () => {
          playSfx("swoosh");
          setAppMode(mode === "uso" ? "normal" : "uso");
          render();
        },
      },
      icon(mode === "uso" ? "mask" : "moon")
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

  // 出題セットの切り替え。デイリーは日付で決まるので出さない。
  const setSeg = el(
    "div",
    { class: "seg problem-set-tabs" },
    [
      [false, tr("新出題", "New"), "No."],
      [true, tr("旧出題", "Classic"), "Cls."],
    ].map(([value, label, prefix]) =>
      el(
        "button",
        {
          class: classicSet === value ? "active" : "",
          onclick: () => {
            playSfx("ui");
            classicSet = value;
            blockStart = null;
            render();
          },
        },
        el("span", { class: "problem-set-name" }, label),
        el("span", { class: "problem-set-prefix" }, prefix)
      )
    )
  );

  const body = el("div", { class: "list-screen-body" });
  body.append(levelSeg);
  if (levelIdx === -1) {
    body.append(dailyCalendar(statusMap));
    root.append(header, body);
    return;
  }
  body.append(setSeg);
  if (classicSet) body.append(classicNote());

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
      el("span", {}, `${numberPrefix(classicSet)}${problemNumber(lo)} - ${numberPrefix(classicSet)}${problemNumber(hi)}`),
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
              ? tr(`問題 ${problemNumber(s)} から ${problemNumber(e)}、全問クリア`, `Puzzles ${problemNumber(s)} to ${problemNumber(e)}, all cleared`)
              : tr(`問題 ${problemNumber(s)} から ${problemNumber(e)}、クリア ${c}、プレイ ${p}`, `Puzzles ${problemNumber(s)} to ${problemNumber(e)}, ${c} cleared, ${p} played`),
            style: !complete && ratio > 0 && SUPPORTS_COLOR_MIX ? { background: `color-mix(in srgb, var(--tile-correct) ${Math.round(8 + ratio * 42)}%, var(--bg-panel))` } : {},
            onclick: () => {
              playSfx("ui");
              blockStart = s;
              render();
            },
          },
          el("div", { class: "bn" }, `${problemNumber(s)}`),
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
              `問題 ${pidLabel(pid)}、${doubleClear ? "DOUBLE CLEAR済み" : st === "cleared" ? "クリア済み" : st === "failed" ? "未クリア" : "未プレイ"}`,
              `Puzzle ${pidLabel(pid)}, ${doubleClear ? "DOUBLE CLEAR" : st === "cleared" ? "cleared" : st === "failed" ? "failed" : "unplayed"}`
            ),
            onclick: () => openProblemMenu(pid, statusMap),
          },
          String(problemNumber(pid))
        )
      );
    }
    body.append(
      el(
        "div",
        { class: "progress-note problem-block-head" },
        tr(
          `ブロック ${numberPrefix(classicSet)}${problemNumber(s)} - ${numberPrefix(classicSet)}${problemNumber(e)}`,
          `Block ${numberPrefix(classicSet)}${problemNumber(s)} - ${numberPrefix(classicSet)}${problemNumber(e)}`
        )
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
          `1-9999: やさしい / 10000-19999: 極 / 20000-39999: レベル別（いま開いているのは ${numberPrefix(classicSet)} の一覧です）`,
          `1–9999: Easy / 10000–19999: Extreme / 20000–39999: Level-based (currently viewing the ${numberPrefix(classicSet)} set)`
        )
      ),
    ],
    actions: [
      { label: tr("キャンセル", "Cancel"), onClick: () => {} },
      {
        label: tr("ジャンプ", "Jump"),
        primary: true,
        onClick: () => {
          const number = parseInt(input.value, 10);
          const pid = pidForNumber(number, classicSet);
          if (!Number.isInteger(number) || number < PID.EASY_MIN || number > PID.NUMBER_MAX || !isValidPID(pid)) {
            toast(tr("1〜39999 の番号を入力してください", "Enter a number from 1 to 39999"));
            return false;
          }
          levelIdx = LEVELS.findIndex((lv) => number >= lv.range[0] && number <= lv.range[1]);
          const [lo] = pidRangeForLevel(LEVELS[levelIdx], classicSet);
          blockStart = Math.floor((pid - lo) / BLOCK_SIZE) * BLOCK_SIZE + lo;
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
  onLeave() {
    // レベル帯（カテゴリ）とその配下の絞り込みは持ち越さず、次に開いたときは必ず Daily から始める
    levelIdx = -1;
    classicSet = false;
    blockStart = null;
    statusFilter = "all";
    dailyCalendarMonth = null;
    dailySelectedPid = null;
  },
});
