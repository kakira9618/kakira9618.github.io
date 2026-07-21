// プレイ履歴閲覧モード。最近のプレイ一覧 → タップで結果画面へ。
// ルート: #/history

import { el, clear, fmtDateTime } from "./dom.js";
import { registerScreen, navigate } from "./app.js?v=20260722-uso-modal-hint";
import { getRecentGames, getStatistics, MODES } from "../core/records.js";
import { Logic, CELL } from "../core/logic.js";
import { pidLabel } from "../core/problems.js";
import { playSfx } from "../audio/sound.js?v=20260722-uso-modal-hint";
import { showModal } from "./modal.js?v=20260722-uso-modal-hint";
import { soundToggleButton } from "./sound-toggle.js?v=20260722-uso-modal-hint";
import { icon } from "./icons.js";
import { currentLanguage, tr } from "../core/i18n.js?v=20260722-uso-modal-hint";
import { rowAriaLabel } from "./a11y.js?v=20260722-uso-modal-hint";

let root = null;
let filter = "all"; // "all" | "normal" | "uso"
let filtersExpanded = false;
const PAGE_SIZE = 50;
let page = 1;
let filters = {
  dateFrom: "",
  dateTo: "",
  result: "all", // "all" | "win" | "lose"
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
        el("div", {}, el("b", {}, s.maxStreak), el("div", { class: "hint" }, "Max Streak"))
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

function selectControl(label, value, options, onChange) {
  const select = el(
    "select",
    { "aria-label": label, onchange: (event) => onChange(event.target.value) },
    options.map(([key, text]) => el("option", { value: key }, text))
  );
  select.value = value;
  return select;
}

function historyControls(total) {
  const update = (key, value) => {
    filters = { ...filters, [key]: value };
    page = 1;
    render();
  };
  const numberFilter = (key, label, placeholder) =>
    el(
      "label",
      { class: "history-filter-field compact" },
      el("span", {}, label),
      el("input", {
        type: "number",
        min: "1",
        max: "15",
        value: filters[key],
        placeholder,
        onchange: (event) => update(key, event.target.value),
      })
    );
  const activeCount = [
    filters.dateFrom,
    filters.dateTo,
    filters.result !== "all",
    filters.guessesMin,
    filters.guessesMax,
    filters.sort !== "date-desc",
  ].filter(Boolean).length;

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
      activeCount
        ? el("span", { class: "history-active-count" }, tr(`${activeCount} 条件`, `${activeCount} active`))
        : null,
      el("span", { class: "spacer" }),
      el(
        "span",
        { class: "history-match-count" },
        tr(`該当 ${total.toLocaleString()} 件`, `${total.toLocaleString("en-US")} matching`)
      )
    ),
    el(
      "div",
      { class: "history-control-body" },
      el(
        "div",
        { class: "history-filter-grid" },
        el(
          "label",
          { class: "history-filter-field" },
          el("span", {}, tr("開始日", "Start date")),
          el("input", {
            type: "date",
            value: filters.dateFrom,
            onchange: (event) => update("dateFrom", event.target.value),
          })
        ),
        el(
          "label",
          { class: "history-filter-field" },
          el("span", {}, tr("終了日", "End date")),
          el("input", {
            type: "date",
            value: filters.dateTo,
            onchange: (event) => update("dateTo", event.target.value),
          })
        ),
        el(
          "label",
          { class: "history-filter-field" },
          el("span", {}, tr("結果", "Result")),
          selectControl(
            tr("結果", "Result"),
            filters.result,
            [["all", tr("すべて", "All")], ["win", tr("成功", "Win")], ["lose", tr("失敗", "Loss")]],
            (value) => update("result", value)
          )
        ),
        numberFilter("guessesMin", tr("手数", "Guesses"), tr("最小", "Min")),
        numberFilter("guessesMax", tr("〜", "to"), tr("最大", "Max")),
        el(
          "label",
          { class: "history-filter-field sort" },
          el("span", {}, tr("並べ替え", "Sort")),
          selectControl(
            tr("並べ替え", "Sort"),
            filters.sort,
            [
              ["date-desc", tr("日付（新しい順）", "Date (newest)")],
              ["date-asc", tr("日付（古い順）", "Date (oldest)")],
              ["guesses-asc", tr("手数（少ない順）", "Guesses (fewest)")],
              ["guesses-desc", tr("手数（多い順）", "Guesses (most)")],
            ],
            (value) => update("sort", value)
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
    if (filters.result === "lose" && game.clear) return false;
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
    render();
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
            filter = key;
            page = 1;
            render();
          },
        },
        label
      )
    )
  );

  const games = filteredGames();
  const totalPages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  page = Math.min(page, totalPages);
  const visibleGames = games.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const body = el("div", { class: "list-screen-body" });
  body.append(historyControls(games.length));
  if (games.length === 0) {
    body.append(el("p", { class: "hint", style: { textAlign: "center", marginTop: "40px" } },
      getRecentGames().length === 0
        ? tr("まだプレイ履歴がありません。", "No play history yet.")
        : tr("条件に一致する履歴がありません。", "No history matches these filters."),
      el("br"),
      getRecentGames().length === 0
        ? tr("旧作からの移行は「設定」からできます。", "You can import history from the original games in Settings.")
        : tr("フィルタ条件を変更してください。", "Try changing the filters.")));
  }
  for (const g of visibleGames) {
    const maxGuess = MODES[g.gameMode].maxGuess;
    body.append(
      el(
        "button",
        {
          class: "card tappable history-item",
          "aria-label": tr(
            `${pidLabel(g.problemID)}、${MODES[g.gameMode].title}、${g.clear ? "成功" : "失敗"}、${g.guessWord.length} 手`,
            `${pidLabel(g.problemID)}, ${MODES[g.gameMode].title}, ${g.clear ? "win" : "loss"}, ${g.guessWord.length} Guesses`
          ),
          onclick: () => {
            playSfx("ui");
            navigate(`/result/${g.gameMode}/${g.startTime}`);
          },
        },
        el("div", { class: `badge ${g.clear ? "win" : "lose"}` }, g.clear ? `${g.guessWord.length}` : "X"),
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
              `${fmtDateTime(g.startTime)} ・ ${g.guessWord.length}/${maxGuess} 手${g.imported ? " ・ 移行" : ""}`,
              `${fmtDateTime(g.startTime)} · ${g.guessWord.length}/${maxGuess} Guesses${g.imported ? " · Imported" : ""}`
            )
          )
        ),
        miniGrid(g)
      )
    );
  }
  const pageNav = pagination(totalPages, games.length);
  if (pageNav) body.append(pageNav);
  root.append(header, seg, body);
}

registerScreen("history", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
