// 結果画面。ゲーム終了直後にも、履歴・問題一覧からも開ける。
// ルート: #/result/<mode>/<startTime>

import { el, clear, fmtDateTime } from "./dom.js";
import { registerScreen, navigate, setViewMood } from "./app.js?v=20260723-fa";
import { findGame, MODES, getExtraShot } from "../core/records.js";
import { Logic, CELL, queryWordSingle } from "../core/logic.js";
import { pidLabel, isDailyPID } from "../core/problems.js";
import { playSfx } from "../audio/sound.js?v=20260723-fa";
import { toast } from "./toast.js?v=20260723-fa";
import { confirmAndStart } from "./game-screen.js?v=20260723-fa";
import { soundToggleButton } from "./sound-toggle.js?v=20260723-fa";
import { icon } from "./icons.js";
import { downloadResultPNG } from "./snapshot.js?v=20260723-fa";
import { SHARE_URL } from "../config.js?v=20260723-fa";
import { getSettings } from "../core/settings.js?v=20260723-fa";
import { tr } from "../core/i18n.js?v=20260723-fa";
import { rowAriaLabel } from "./a11y.js?v=20260723-fa";
import { createRotatingCrownCanvas } from "./crown.js?v=20260723-fa";

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
  // ハイコントラスト設定では絵文字も本家 Wordle と同じ 🟧 / 🟦 に置き換える
  const highContrast = getSettings().highContrast;
  const correctEmoji = highContrast ? "🟧" : "🟩";
  const usedEmoji = highContrast ? "🟦" : "🟨";
  for (const row of results) {
    for (const s of row) {
      text += s === CELL.CORRECT ? correctEmoji : s === CELL.USED ? usedEmoji : "⬜";
    }
    text += "\n";
  }
  text += "\n";
  if (cleared) {
    text += `You guessed Word ${logic.matchWordNo(record.guessWord[record.guessWord.length - 1])}!\n`;
  }
  if (getExtraShot(record)?.success) {
    text += "EXTRA SHOT ⭐ DOUBLE CLEAR!!\n";
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

  // 履歴などから別モードの記録を開いても、その記録のモードの配色で表示する
  setViewMood(record.gameMode);

  const logic = new Logic(record.problemID);
  const lastWord = record.guessWord[record.guessWord.length - 1];
  const cleared = record.clear;
  const results = displayResults(record, logic);
  const maxGuess = MODES[record.gameMode].maxGuess;
  // EXTRA SHOT の記録。旧 finalAnswer レコードも同じ表示へ透過する。
  const fa = getExtraShot(record);
  const doubleClear = Boolean(fa?.success);
  const faTarget = cleared ? logic.otherAnswer(lastWord) : null;
  const faResult = fa && faTarget ? queryWordSingle(fa.word, faTarget) : null;

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
    el("span", { class: `mode-chip ${record.gameMode === "uso" ? "uso" : ""}` }, MODES[record.gameMode].title),
    soundToggleButton()
  );

  // 答えを判定グリッドと同じ寸法・位置の 2 x 5 タイルで表示。
  // ラベルは左、正解を示す旗は右へ絶対配置し、有無で行がずれないようにする。
  const answerRow = (no, word) => {
    const matched = cleared && lastWord === word;
    const extraMatched = doubleClear && faTarget === word; // EXTRA SHOT で当てた方は金の王冠
    return el(
      "div",
      {
        class: "answer-row",
        role: "img",
        "aria-label": tr(
          `Word ${no}: ${word.toUpperCase()}${matched ? "、あなたが当てた答え" : extraMatched ? "、EXTRA SHOTで当てた答え" : ""}`,
          `Word ${no}: ${word.toUpperCase()}${matched ? ", your answer" : extraMatched ? ", your EXTRA SHOT" : ""}`
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
        : extraMatched
          ? el(
              "span",
              { class: "fa-crown-slot", "aria-hidden": "true" },
              createRotatingCrownCanvas()
            )
          : null
    );
  };

  // EXTRA SHOT の追加推理の記録（挑戦した場合のみ。成功・失敗どちらも表示する）
  const extraShotCard = fa && faResult
    ? el(
        "div",
        { class: `card fa-result ${fa.success ? "success" : "fail"}` },
        el("div", { class: "fa-result-head" }, "EXTRA SHOT"),
        el(
          "div",
          {
            class: "rrow",
            role: "img",
            "aria-label": tr(
              `EXTRA SHOT: ${fa.word.toUpperCase()}、${fa.success ? "成功" : "失敗"}`,
              `EXTRA SHOT: ${fa.word.toUpperCase()}, ${fa.success ? "success" : "miss"}`
            ),
          },
          fa.word.split("").map((c, i) => el("div", { class: `rcell ${faResult[i]}`, "aria-hidden": "true" }, c))
        ),
        el(
          "div",
          { class: "hint" },
          fa.success
            ? tr("もう一つの答えも一発で見抜いた！", "You named the other answer in one shot!")
            : tr("惜しい！もう一つの答えには届かなかった", "So close — the other answer slipped away")
        )
      )
    : null;

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
    el(
      "div",
      { class: `result-title ${doubleClear ? "double" : cleared ? "clear" : "over"}` },
      doubleClear ? "DOUBLE CLEAR!" : cleared ? "GAME CLEAR" : "GAME OVER"
    ),
    el(
      "div",
      { class: "hint" },
      tr(
        `${fmtDateTime(record.startTime)} ・ ${record.guessWord.length} / ${maxGuess} 手${record.imported ? " ・ 移行" : ""}`,
        `${fmtDateTime(record.startTime)} · ${record.guessWord.length} / ${maxGuess} Guesses${record.imported ? " · Imported" : ""}`
      )
    ),
    el("div", { class: "card answers-grid" }, answerRow(1, logic.ans1), answerRow(2, logic.ans2)),
    grid,
    extraShotCard,
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
        void downloadResultPNG(record, logic, results).then(() => toast(tr("画像を保存しました", "Image saved")));
      }),
      actionBtn("flask", tr("分析", "Analysis"), () => navigate(`/analysis/${record.gameMode}/${record.startTime}`)),
      actionBtn("retry", tr("もう一度", "Play again"), () => confirmAndStart(record.problemID, record.gameMode)),
      el("button", { class: "btn", onclick: () => navigate("/") }, tr("タイトルへ", "Title"))
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
  onLeave() {
    setViewMood(null); // 一時的に適用した記録モードの配色を現在のモードへ戻す
  },
});
