// 結果画面。ゲーム終了直後にも、履歴・問題一覧からも開ける。
// ルート: #/result/<mode>/<startTime>

import { el, clear, fmtDateTime } from "./dom.js";
import { registerScreen, navigate } from "./app.js?v=20260722-oldchrome-colormix";
import { findGame, MODES } from "../core/records.js";
import { Logic, CELL } from "../core/logic.js";
import { pidLabel, isDailyPID } from "../core/problems.js";
import { playSfx } from "../audio/sound.js?v=20260722-oldchrome-colormix";
import { toast } from "./toast.js?v=20260722-oldchrome-colormix";
import { confirmAndStart } from "./game-screen.js?v=20260722-oldchrome-colormix";
import { icon } from "./icons.js";
import { downloadResultPNG } from "./snapshot.js?v=20260722-oldchrome-colormix";
import { SHARE_URL } from "../config.js?v=20260722-oldchrome-colormix";
import { tr } from "../core/i18n.js?v=20260722-oldchrome-colormix";
import { rowAriaLabel } from "./a11y.js?v=20260722-oldchrome-colormix";

let root = null;

function build() {
  root = document.getElementById("screen-result");
}

// 表示に使う判定グリッド（normal: 真の判定 / uso: 表示された嘘 = シェアと同じ）
function displayResults(record, logic) {
  if (record.gameMode === "uso" && Array.isArray(record.usoResults) && record.usoResults.length === record.guessWord.length) {
    return record.usoResults;
  }
  return record.guessWord.map((w) => logic.queryWord(w));
}

// 原作互換のシェア文字列 + 公開 URL
function buildShareText(record, logic, cleared, includeUrl = true) {
  const results = displayResults(record, logic);
  const seedLabel = isDailyPID(record.problemID) ? "Daily" : `No.${record.problemID}`;
  const maxGuess = MODES[record.gameMode].maxGuess;
  const name = record.gameMode === "uso" ? tr("[嘘] DWORDlie2", "[LIE] DWORDlie2") : "DWORDle2";
  const countText = cleared ? `${record.guessWord.length}/${maxGuess}` : `X/${maxGuess}`;
  let text = `${name} ${seedLabel} ${countText}\n\n`;
  for (const row of results) {
    for (const s of row) {
      text += s === CELL.CORRECT ? "🟩" : s === CELL.USED ? "🟨" : "⬜";
    }
    text += "\n";
  }
  text += "\n";
  if (cleared) {
    text += `You guessed Word ${logic.matchWordNo(record.guessWord[record.guessWord.length - 1])}!\n`;
  }
  if (includeUrl) text += SHARE_URL;
  return text;
}

function render(args) {
  if (!root) build();
  clear(root);
  const [mode, startTimeStr] = args;
  const record = findGame(parseInt(startTimeStr, 10), mode);
  if (!record) {
    clear(root).append(
      el("div", { class: "list-screen-body" }, el("p", { class: "hint" }, tr("記録が見つかりませんでした。", "Record not found."))),
      el(
        "div",
        { style: { padding: "12px" } },
        el("button", { class: "btn", onclick: () => navigate("/history") }, tr("履歴へ戻る", "Back to history"))
      )
    );
    return;
  }

  const logic = new Logic(record.problemID);
  const lastWord = record.guessWord[record.guessWord.length - 1];
  const cleared = record.clear;
  const results = displayResults(record, logic);
  const maxGuess = MODES[record.gameMode].maxGuess;

  const header = el(
    "div",
    { class: "header" },
    el(
      "button",
      {
        class: "icon-btn",
        "aria-label": tr("前の画面へ戻る", "Back"),
        onclick: () => { playSfx("ui"); history.length > 1 ? history.back() : navigate("/"); },
      },
      icon("arrowLeft")
    ),
    el("h1", { class: "title" }, "RESULT"),
    el("span", { class: "spacer" }),
    el("span", { class: "sub" }, pidLabel(record.problemID)),
    el("span", { class: `mode-chip ${record.gameMode === "uso" ? "uso" : ""}` }, MODES[record.gameMode].title)
  );

  // 答えを判定グリッドと同じ寸法・位置の 2 x 5 タイルで表示。
  // ラベルは左、正解を示す旗は右へ絶対配置し、有無で行がずれないようにする。
  const answerRow = (no, word) => {
    const matched = cleared && lastWord === word;
    return el(
      "div",
      {
        class: "answer-row",
        role: "img",
        "aria-label": tr(
          `Word ${no}: ${word.toUpperCase()}${matched ? "、あなたが当てた答え" : ""}`,
          `Word ${no}: ${word.toUpperCase()}${matched ? ", your answer" : ""}`
        ),
      },
      el(
        "span",
        { class: "answer-label-group", "aria-hidden": "true" },
        el("span", { class: "alabel" }, `Word ${no}`)
      ),
      word.split("").map((c) => el("span", { class: "rcell htile", "aria-hidden": "true" }, c)),
      matched
        ? el(
            "span",
            { class: "guess-flag-slot", "aria-hidden": "true" },
            el(
              "span",
              { class: "guess-flag" },
              el("span", { class: "guess-flag-pole" }),
              el("span", { class: "guess-flag-base" }),
              el("span", { class: "guess-flag-cloth" })
            )
          )
        : null
    );
  };

  const grid = el(
    "div",
    { class: "result-grid" },
    record.guessWord.map((w, t) =>
      el(
        "div",
        { class: "rrow", role: "img", "aria-label": rowAriaLabel(w, results[t]) },
        w.split("").map((c, i) => el("div", { class: `rcell ${results[t][i]}`, "aria-hidden": "true" }, c))
      )
    )
  );

  const actionBtn = (iconName, label, onclick, primary = false) =>
    el("button", { class: `btn ${primary ? "btn-primary" : ""}`, onclick }, icon(iconName), label);

  const body = el(
    "div",
    { class: "list-screen-body" },
    el("div", { class: `result-title ${cleared ? "clear" : "over"}` }, cleared ? "GAME CLEAR" : "GAME OVER"),
    el(
      "div",
      { class: "hint" },
      tr(
        `${fmtDateTime(record.startTime)} ・ ${record.guessWord.length} / ${maxGuess} 手${record.imported ? " ・ 旧作から移行" : ""}`,
        `${fmtDateTime(record.startTime)} · ${record.guessWord.length} / ${maxGuess} Guesses${record.imported ? " · Imported" : ""}`
      )
    ),
    el("div", { class: "card answers-grid" }, answerRow(1, logic.ans1), answerRow(2, logic.ans2)),
    grid,
    el(
      "div",
      { class: "result-actions" },
      actionBtn("share", tr("シェア", "Share"), async () => {
        const text = buildShareText(record, logic, cleared, false);
        if (navigator.share) {
          try {
            await navigator.share({ title: "DWORDle 2", text, url: SHARE_URL });
            return;
          } catch (error) {
            if (error?.name === "AbortError") return;
          }
        }
        open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(record, logic, cleared))}`, "_blank");
      }, true),
      actionBtn("copy", tr("コピー", "Copy"), async () => {
        try {
          await navigator.clipboard.writeText(buildShareText(record, logic, cleared));
          toast(tr("結果をコピーしました", "Result copied"));
        } catch {
          toast(tr("コピーに失敗しました", "Copy failed"));
        }
      }),
      actionBtn("camera", tr("画像保存", "Save image"), () => {
        downloadResultPNG(record, logic, results);
        toast(tr("画像を保存しました", "Image saved"));
      }),
      actionBtn("flask", tr("分析", "Analysis"), () => navigate(`/analysis/${record.gameMode}/${record.startTime}`)),
      actionBtn("retry", tr("もう一度", "Play again"), () => confirmAndStart(record.problemID, record.gameMode)),
      el("button", { class: "btn btn-ghost", onclick: () => navigate("/") }, tr("タイトルへ", "Title"))
    )
  );

  root.append(header, body);
}

registerScreen("result", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
