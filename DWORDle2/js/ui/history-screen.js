// プレイ履歴閲覧モード。最近のプレイ一覧 → タップで結果画面へ。
// ルート: #/history

import { el, clear, fmtDateTime } from "./dom.js?v=20260803-b";
import { registerScreen, navigate } from "./app.js?v=20260803-b";
import { getRecentGames, getStatistics, MODES, getExtraShot } from "../core/records.js?v=20260803-b";
import { Logic, CELL } from "../core/logic.js?v=20260803-b";
import { pidLabel } from "../core/problems.js?v=20260803-b";
import { playSfx } from "../audio/sound.js?v=20260803-b";
import { showModal } from "./modal.js?v=20260803-b";
import { soundToggleButton } from "./sound-toggle.js?v=20260803-b";
import { icon } from "./icons.js?v=20260803-b";
import { currentLanguage, tr } from "../core/i18n.js?v=20260803-b";
import { rowAriaLabel } from "./a11y.js?v=20260803-b";

let root = null;
let filter = "all"; // "all" | "normal" | "uso"
let filtersExpanded = false;
// 検索条件の変更ではリストだけを描き直す（下の update / renderList 参照）。
// 全体を作り直すと、入力中の欄が DOM ごと消えて iOS のネイティブ日付 UI が閉じてしまう。
let listEl = null;
let matchCountEl = null;
let activeCountEl = null;
const PAGE_SIZE = 50;
let page = 1;
let filters = {
  dateFrom: "",
  dateTo: "",
  result: "all", // "all" | "win" | "lose" | "discarded" | "double"
  guessesMin: "",
  guessesMax: "",
  sort: "date-desc",
};

function build() {
  root = document.getElementById("screen-history");
}

function miniGrid(record) {
  const logic = new Logic(record.problemID);
  const results =
    record.gameMode === "uso" && record.usoResults?.length === record.guessWord.length
      ? record.usoResults
      : record.guessWord.map((w) => logic.queryWord(w));
  const cells = [];
  const recentResults = results.slice(-6);
  for (const row of recentResults) { // 直近 6 行まで表示
    for (const s of row) {
      cells.push(el("i", { class: s === CELL.CORRECT ? "correct" : s === CELL.USED ? "used" : "", "aria-hidden": "true" }));
    }
  }
  const labels = recentResults.map((states, index) => rowAriaLabel(record.guessWord.slice(-6)[index], states));
  return el("div", { class: "mini-grid", role: "img", "aria-label": labels.join("。") }, cells);
}

function showStats() {
  // barBase: バーの時差アニメの通し番号の起点（表→裏へと連続して波打たせる）
  const statBlock = (mode, barBase) => {
    const s = getStatistics(mode);
    const winPct = s.count ? Math.round((100 * s.win) / s.count) : 0;
    const maxGuess = MODES[mode].maxGuess;
    const maxFreq = Math.max(1, ...Object.values(s.hist));
    return el(
      "div",
      { class: "card", style: { display: "flex", flexDirection: "column", gap: "8px" } },
      el("div", { style: { fontWeight: "800" } }, MODES[mode].title),
      el(
        "div",
        { class: "stat-metrics" },
        el("div", {}, el("b", {}, s.count), el("div", { class: "hint" }, "Played")),
        el("div", {}, el("b", {}, winPct), el("div", { class: "hint" }, "Win %")),
        el("div", {}, el("b", {}, s.currentStreak), el("div", { class: "hint" }, "Current Streak")),
        el("div", {}, el("b", {}, s.maxStreak), el("div", { class: "hint" }, "Max Streak")),
        // EXTRA SHOT 成功数。モード未解放・未成功の人には出さない（ネタバレ防止）
        s.doubleClear > 0
          ? el("div", { class: "stat-double" }, el("b", {}, s.doubleClear), el("div", { class: "hint" }, "Double Clear"))
          : null
      ),
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "3px" } },
        Array.from({ length: maxGuess }, (_, i) => {
          const n = s.hist[i + 1] ?? 0;
          return el(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" } },
            el("span", { style: { width: "18px", textAlign: "right", color: "var(--fg-dim)" } }, i + 1),
            el("div", {
              class: "bar-grow",
              style: {
                height: "10px",
                width: `${Math.max(3, (100 * n) / maxFreq)}%`,
                background: "var(--tile-correct)",
                borderRadius: "3px",
                "--bar-index": barBase + i,
              },
            }),
            el("span", { class: "hint" }, n)
          );
        })
      )
    );
  };
  showModal({
    title: tr("統計", "Statistics"),
    body: [statBlock("normal", 0), statBlock("uso", MODES.normal.maxGuess)],
    actions: [{ label: tr("閉じる", "Close"), primary: true, onClick: () => {} }],
  });
}

function selectControl(label, value, options, onChange, id = null) {
  const select = el(
    "select",
    { id, "aria-label": label, onchange: (event) => onChange(event.target.value) },
    options.map(([key, text]) => el("option", { value: key }, text))
  );
  select.value = value;
  return select;
}

// 入力欄は <label> の中に入れず、label[for] で結び付ける。
// iOS Safari は label に内包した input[type=date] をタップすると、ネイティブの日付 UI を
// 出した直後に label 経由の二重の活性化が届き、ピッカーが即閉じて意図しない日付が入る。
function filterField(className, id, labelText, control) {
  return el("div", { class: `history-filter-field ${className}` }, el("label", { for: id }, labelText), control);
}

function historyControls() {
  // 条件を変えても検索条件カードは作り直さない。iOS Safari は空の日付欄をタップした瞬間に
  // 今日の日付を確定して change を投げるため、ここで全体を作り直すと
  // 「ピッカーが一瞬で閉じて今日の日付が入る」状態になる。
  const update = (key, value) => {
    filters = { ...filters, [key]: value };
    page = 1;
    renderList();
  };
  const guessInput = (key, label, placeholder) =>
    el("input", {
      type: "number",
      min: "1",
      max: "15",
      inputmode: "numeric",
      value: filters[key],
      placeholder,
      "aria-label": label,
      onchange: (event) => update(key, event.target.value),
    });
  activeCountEl = el("span", { class: "history-active-count" });
  matchCountEl = el("span", { class: "history-match-count" });

  return el(
    "details",
    {
      class: "card history-controls",
      open: filtersExpanded,
      ontoggle: (event) => {
        filtersExpanded = event.currentTarget.open;
      },
    },
    el(
      "summary",
      { class: "history-controls-summary" },
      icon("search", 17),
      el("span", { class: "history-controls-title" }, tr("検索条件・並べ替え", "Filters & sorting")),
      activeCountEl,
      el("span", { class: "spacer" }),
      matchCountEl
    ),
    el(
      "div",
      { class: "history-control-body" },
      el(
        "div",
        { class: "history-filter-grid" },
        filterField(
          "history-date-field",
          "history-date-from",
          tr("開始日", "Start date"),
          el("input", {
            type: "date",
            id: "history-date-from",
            value: filters.dateFrom,
            onchange: (event) => update("dateFrom", event.target.value),
          })
        ),
        filterField(
          "history-date-field",
          "history-date-to",
          tr("終了日", "End date"),
          el("input", {
            type: "date",
            id: "history-date-to",
            value: filters.dateTo,
            onchange: (event) => update("dateTo", event.target.value),
          })
        ),
        filterField(
          "history-result-field",
          "history-result",
          tr("結果", "Result"),
          selectControl(
            tr("結果", "Result"),
            filters.result,
            [
              ["all", tr("すべて", "All")],
              ["win", tr("成功", "Win")],
              ["lose", tr("失敗", "Loss")],
              ["discarded", tr("破棄", "Discarded")],
              ["double", "DOUBLE CLEAR"],
            ],
            (value) => update("result", value),
            "history-result"
          )
        ),
        el(
          "fieldset",
          { class: "history-filter-field history-guesses-field" },
          el("legend", {}, tr("手数", "Guesses")),
          el(
            "div",
            { class: "history-guess-range" },
            guessInput("guessesMin", tr("最小手数", "Minimum Guesses"), tr("最小", "Min")),
            el("span", { class: "history-range-separator", "aria-hidden": "true" }, "〜"),
            guessInput("guessesMax", tr("最大手数", "Maximum Guesses"), tr("最大", "Max"))
          )
        ),
        filterField(
          "sort",
          "history-sort",
          tr("並べ替え", "Sort"),
          selectControl(
            tr("並べ替え", "Sort"),
            filters.sort,
            [
              ["date-desc", tr("日付（新しい順）", "Date (newest)")],
              ["date-asc", tr("日付（古い順）", "Date (oldest)")],
              ["guesses-asc", tr("手数（少ない順）", "Guesses (fewest)")],
              ["guesses-desc", tr("手数（多い順）", "Guesses (most)")],
            ],
            (value) => update("sort", value),
            "history-sort"
          )
        )
      ),
      el(
        "div",
        { class: "history-control-foot" },
        el(
          "button",
          {
            class: "btn btn-ghost history-reset",
            onclick: () => {
              // 入力欄の表示値も戻す必要があるので、ここだけは全体を描き直す
              // （このボタンを押せる時点でネイティブの日付 UI は開いていない）
              filters = { dateFrom: "", dateTo: "", result: "all", guessesMin: "", guessesMax: "", sort: "date-desc" };
              page = 1;
              render();
            },
          },
          tr("条件をクリア", "Clear filters")
        )
      )
    )
  );
}

function filteredGames() {
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() / 1000 : -Infinity;
  const to = filters.dateTo
    ? new Date(`${filters.dateTo}T00:00:00`).getTime() / 1000 + 86400
    : Infinity;
  const minGuesses = filters.guessesMin ? Number(filters.guessesMin) : -Infinity;
  const maxGuesses = filters.guessesMax ? Number(filters.guessesMax) : Infinity;
  const games = getRecentGames(filter === "all" ? null : filter).filter((game) => {
    if (game.startTime < from || game.startTime >= to) return false;
    if (filters.result === "win" && !game.clear) return false;
    if (filters.result === "lose" && (game.clear || game.discarded)) return false;
    if (filters.result === "discarded" && !game.discarded) return false;
    if (filters.result === "double" && !(game.clear && getExtraShot(game)?.success)) return false;
    return game.guessWord.length >= minGuesses && game.guessWord.length <= maxGuesses;
  });

  const direction = filters.sort.endsWith("asc") ? 1 : -1;
  const byGuesses = filters.sort.startsWith("guesses");
  games.sort((a, b) => {
    const primary = byGuesses ? a.guessWord.length - b.guessWord.length : a.startTime - b.startTime;
    if (primary !== 0) return primary * direction;
    return (b.startTime - a.startTime) || (b.problemID - a.problemID);
  });
  return games;
}

function pagination(totalPages, total) {
  if (total === 0) return null;
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, page * PAGE_SIZE);
  const go = (next) => {
    page = Math.min(totalPages, Math.max(1, next));
    renderList(); // 検索条件カードは保ったままリストだけ差し替える
    root.querySelector(".list-screen-body")?.scrollTo({ top: 0 });
  };
  return el(
    "nav",
    { class: "history-pagination", "aria-label": tr("履歴ページ", "History pages") },
    el(
      "button",
      {
        class: "btn",
        disabled: page === 1,
        "aria-label": tr("最初のページ", "First page"),
        onclick: () => go(1),
        title: tr("最初のページ", "First page"),
      },
      "«"
    ),
    el("button", { class: "btn", disabled: page === 1, "aria-label": tr("前のページ", "Previous page"), onclick: () => go(page - 1) }, "‹"),
    el(
      "span",
      { class: "history-page-status" },
      `${first.toLocaleString(currentLanguage())}${currentLanguage() === "en" ? "–" : "〜"}${last.toLocaleString(currentLanguage())} / ${total.toLocaleString(currentLanguage())} (${page} / ${totalPages})`
    ),
    el("button", { class: "btn", disabled: page === totalPages, "aria-label": tr("次のページ", "Next page"), onclick: () => go(page + 1) }, "›"),
    el(
      "button",
      {
        class: "btn",
        disabled: page === totalPages,
        "aria-label": tr("最後のページ", "Last page"),
        onclick: () => go(totalPages),
        title: tr("最後のページ", "Last page"),
      },
      "»"
    )
  );
}

function render() {
  if (!root) build();
  clear(root);

  const header = el(
    "div",
    { class: "header" },
    el(
      "button",
      { class: "icon-btn", "aria-label": tr("タイトルへ戻る", "Back to title"), onclick: () => { playSfx("ui"); navigate("/"); } },
      icon("arrowLeft")
    ),
    el("h1", { class: "title" }, tr("プレイ履歴", "Play History")),
    el("span", { class: "spacer" }),
    soundToggleButton(),
    el(
      "button",
      { class: "icon-btn", title: tr("統計", "Statistics"), "aria-label": tr("統計", "Statistics"), onclick: showStats },
      icon("chart")
    )
  );

  const seg = el(
    "div",
    { class: "seg", style: { margin: "10px 12px 0" } },
    [
      ["all", tr("すべて", "All")],
      ["normal", "DWORDle"],
      ["uso", "DWORDlie"],
    ].map(([key, label]) =>
      el(
        "button",
        {
          class: key === filter ? "active" : "",
          onclick: () => {
            playSfx("ui"); // 問題一覧のカテゴリ選択と同じ音
            filter = key;
            page = 1;
            render();
          },
        },
        label
      )
    )
  );

  const body = el("div", { class: "list-screen-body" });
  body.append(historyControls());
  listEl = el("div", { class: "history-list" });
  body.append(listEl);
  root.append(header, seg, body);
  renderList();
}

// 検索条件カードはそのままに、結果リストと件数表示だけを描き直す。
function renderList() {
  if (!listEl) return;
  const games = filteredGames();
  const totalPages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  page = Math.min(page, totalPages);
  const visibleGames = games.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeCount = [
    filters.dateFrom,
    filters.dateTo,
    filters.result !== "all",
    filters.guessesMin,
    filters.guessesMax,
    filters.sort !== "date-desc",
  ].filter(Boolean).length;
  activeCountEl.textContent = activeCount ? tr(`${activeCount} 条件`, `${activeCount} active`) : "";
  activeCountEl.hidden = activeCount === 0;
  matchCountEl.textContent = tr(
    `該当 ${games.length.toLocaleString()} 件`,
    `${games.length.toLocaleString("en-US")} matching`
  );
  const body = listEl;
  clear(body);
  if (games.length === 0) {
    body.append(el("p", { class: "hint", style: { textAlign: "center", marginTop: "40px" } },
      getRecentGames().length === 0
        ? tr("まだプレイ履歴がありません。", "No play history yet.")
        : tr("条件に一致する履歴がありません。", "No history matches these filters."),
      el("br"),
      getRecentGames().length === 0
        ? tr("履歴のインポート（移行）は「設定」からできます。", "You can import (migrate) history in Settings.")
        : tr("フィルタ条件を変更してください。", "Try changing the filters.")));
  }
  for (const g of visibleGames) {
    const maxGuess = MODES[g.gameMode].maxGuess;
    const discarded = Boolean(g.discarded);
    const doubleClear = Boolean(getExtraShot(g)?.success); // EXTRA SHOT 成功は金バッジ + 星
    const resultJa = discarded ? "破棄" : g.clear ? (doubleClear ? "ダブルクリア" : "成功") : "失敗";
    const resultEn = discarded ? "discarded" : g.clear ? (doubleClear ? "double clear" : "win") : "loss";
    body.append(
      el(
        "button",
        {
          class: "card tappable history-item",
          "aria-label": tr(
            `${pidLabel(g.problemID)}、${MODES[g.gameMode].title}、${resultJa}、${g.guessWord.length} 手`,
            `${pidLabel(g.problemID)}, ${MODES[g.gameMode].title}, ${resultEn}, ${g.guessWord.length} Guesses`
          ),
          onclick: () => {
            playSfx("ui");
            navigate(`/result/${g.gameMode}/${g.startTime}`);
          },
        },
        el(
          "div",
          { class: `badge ${discarded ? "discarded" : g.clear ? "win" : "lose"}${doubleClear ? " double" : ""}` },
          discarded ? icon("trash", 20) : g.clear ? `${g.guessWord.length}` : "X",
          doubleClear ? el("span", { class: "badge-star", "aria-hidden": "true" }, "★") : null
        ),
        el(
          "div",
          { class: "info" },
          el(
            "div",
            { class: "line1" },
            pidLabel(g.problemID),
            el("span", { class: `mode-chip ${g.gameMode === "uso" ? "uso" : ""}` }, MODES[g.gameMode].title)
          ),
          el(
            "div",
            { class: "line2" },
            tr(
              `${fmtDateTime(g.startTime)} ・ ${g.guessWord.length}/${maxGuess} 手${discarded ? " ・ 破棄 ・ 実績対象外" : ""}${g.imported ? " ・ 移行" : ""}`,
              `${fmtDateTime(g.startTime)} · ${g.guessWord.length}/${maxGuess} Guesses${discarded ? " · Discarded · No achievements" : ""}${g.imported ? " · Imported" : ""}`
            )
          )
        ),
        miniGrid(g)
      )
    );
  }
  const pageNav = pagination(totalPages, games.length);
  if (pageNav) body.append(pageNav);
}

registerScreen("history", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
  onLeave() {
    // カテゴリ（モード）の選択は持ち越さず、次に開いたときは必ず「すべて」から始める
    filter = "all";
    page = 1;
  },
});
