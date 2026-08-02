// 結果画面。ゲーム終了直後にも、履歴・問題一覧からも開ける。
// ルート: #/result/<mode>/<startTime>

import { el, clear, fmtDateTime } from "./dom.js?v=20260803-c";
import { registerScreen, navigate, setViewMood } from "./app.js?v=20260803-c";
import { findGame, MODES, getExtraShot, getExtraShotResult } from "../core/records.js?v=20260803-c";
import { Logic, CELL } from "../core/logic.js?v=20260803-c";
import { pidLabel } from "../core/problems.js?v=20260803-c";
import { playSfx } from "../audio/sound.js?v=20260803-c";
import { toast } from "./toast.js?v=20260803-c";
import { confirmAndStart } from "./game-screen.js?v=20260803-c";
import { soundToggleButton } from "./sound-toggle.js?v=20260803-c";
import { icon } from "./icons.js?v=20260803-c";
import { downloadResultPNG } from "./snapshot.js?v=20260803-c";
import { SHARE_URL } from "../config.js?v=20260803-c";
import { getSettings } from "../core/settings.js?v=20260803-c";
import { tr } from "../core/i18n.js?v=20260803-c";
import { rowAriaLabel } from "./a11y.js?v=20260803-c";
import { createRotatingCrownCanvas } from "./crown.js?v=20260803-c";

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

// シェア文の長さの目安。X は絵文字を 2 文字、URL を t.co の長さで数えるため、
// DWORDlie の 15 手 + EXTRA SHOT だと 280 文字に収まらない。収まらないときは
// 「You guessed → Guessed に短縮」→「EXTRA SHOT の判定行を落とす」の順に削る。
const TWEET = {
  limit: 280, // X の 1 ツイートの上限（重み付き文字数）
  margin: 2, // 共有先が文言を足したときのための最低限の余裕
  urlWeight: 23, // URL は t.co に置き換えられて常にこの長さになる
  // 重み 1 で数える符号位置（twitter-text と同じ）。外れる文字（絵文字・全角）は 2。
  lightRanges: [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]],
};

// X の重み付き文字数。twitter-text の weightedLength と同じ数え方をする。
function tweetLength(text) {
  let length = 0;
  const body = text.replace(/https?:\/\/\S+/g, () => {
    length += TWEET.urlWeight;
    return "";
  });
  for (const ch of body) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) continue; // 異体字セレクタは直前の絵文字の一部
    length += TWEET.lightRanges.some(([from, to]) => cp >= from && cp <= to) ? 1 : 2;
  }
  return length;
}

// 原作互換のシェア文字列 + 公開 URL
function buildShareText(record, logic, cleared) {
  const results = displayResults(record, logic);
  // Daily は日付まで入れる（"Daily" だけだと別の日のシェアと見分けが付かない）。
  // 画面表示・履歴と同じ pidLabel を使う: "Daily 2026-07-26" / "No.12345"
  const seedLabel = pidLabel(record.problemID);
  const maxGuess = MODES[record.gameMode].maxGuess;
  const name = record.gameMode === "uso" ? tr("[嘘] DWORDlie2", "[LIE] DWORDlie2") : "DWORDle2";
  const countText = record.discarded
    ? `DISCARDED ${record.guessWord.length}/${maxGuess}`
    : cleared ? `${record.guessWord.length}/${maxGuess}` : `X/${maxGuess}`;
  // ハイコントラスト設定では絵文字も本家 Wordle と同じ 🟧 / 🟦 に置き換える
  const highContrast = getSettings().highContrast;
  const correctEmoji = highContrast ? "🟧" : "🟩";
  const usedEmoji = highContrast ? "🟦" : "🟨";
  const rowEmoji = (row) =>
    row.map((s) => (s === CELL.CORRECT ? correctEmoji : s === CELL.USED ? usedEmoji : "⬜")).join("");

  let gridBlock = `${name} ${seedLabel} ${countText}\n\n`;
  for (const row of results) gridBlock += `${rowEmoji(row)}\n`;

  const wordNo = cleared ? logic.matchWordNo(record.guessWord[record.guessWord.length - 1]) : null;
  const guessedLine = cleared ? `You guessed Word ${wordNo}!\n` : "";
  const shortGuessedLine = cleared ? `Guessed Word ${wordNo}!\n` : "";
  // EXTRA SHOT は挑戦した記録なら成功・失敗どちらの判定も載せる（惜しかったのが伝わる）
  const extraShot = getExtraShot(record);
  const extraResult = extraShot ? getExtraShotResult(record, logic) : null;
  const extraLine = extraResult ? `EX:\n${rowEmoji(extraResult)}\n` : "";
  const doubleLine = extraShot?.success ? "DOUBLE ⭐️ CLEAR!!\n" : "";

  // 収まるものを上から順に選ぶ。EXTRA SHOT の判定行は「You guessed」の短縮より優先して残す。
  // 並びは「判定グリッド → EX: の追加推理 → 空行 → 結果の文言 → URL」。
  const compose = (guessed, extra) => `${gridBlock}${extra}\n${guessed}${doubleLine}${SHARE_URL}`;
  const candidates = [
    compose(guessedLine, extraLine),
    compose(shortGuessedLine, extraLine),
    compose(guessedLine, ""),
    compose(shortGuessedLine, ""),
  ];
  return candidates.find((text) => tweetLength(text) <= TWEET.limit - TWEET.margin) ?? candidates.at(-1);
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
  const discarded = Boolean(record.discarded);
  const results = displayResults(record, logic);
  const maxGuess = MODES[record.gameMode].maxGuess;
  // EXTRA SHOT の記録。旧 finalAnswer レコードも同じ表示へ透過する。
  const fa = getExtraShot(record);
  const doubleClear = Boolean(fa?.success);
  const faTarget = cleared ? logic.otherAnswer(lastWord) : null;
  const faResult = fa && faTarget ? getExtraShotResult(record, logic) : null;
  const allGreenMiss =
    record.gameMode === "normal" &&
    fa?.success === false &&
    faResult?.every((state) => state === CELL.CORRECT);

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
          { class: `hint ${allGreenMiss ? "fa-all-green-miss" : ""}` },
          fa.success
            ? tr("もう一つの答えも一発で見抜いた！", "You named the other answer in one shot!")
            : allGreenMiss
              ? tr(
                  "全部緑。でも、もう一つの答えそのものではなかった！",
                  "All green, but it wasn't the other answer itself!"
                )
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
      { class: `result-title ${doubleClear ? "double" : cleared ? "clear" : discarded ? "discarded" : "over"}` },
      doubleClear ? "DOUBLE CLEAR!" : cleared ? "GAME CLEAR" : discarded ? "DISCARDED" : "GAME OVER"
    ),
    el(
      "div",
      { class: "hint" },
      tr(
        `${fmtDateTime(record.startTime)} ・ ${record.guessWord.length} / ${maxGuess} 手${discarded ? " ・ 破棄 ・ 実績対象外" : ""}${record.imported ? " ・ 移行" : ""}`,
        `${fmtDateTime(record.startTime)} · ${record.guessWord.length} / ${maxGuess} Guesses${discarded ? " · Discarded · No achievements" : ""}${record.imported ? " · Imported" : ""}`
      )
    ),
    el("div", { class: "card answers-grid" }, answerRow(1, logic.ans1), answerRow(2, logic.ans2)),
    grid,
    extraShotCard,
    el(
      "div",
      { class: "result-actions" },
      actionBtn("share", tr("シェア", "Share"), async () => {
        // url や title を別に渡すと、共有先アプリによっては URL だけを拾って結果のマス目が
        // 消えたり、逆に title を本文へ足して 280 文字を超えたりする。text 一本で渡す。
        const text = buildShareText(record, logic, cleared);
        if (navigator.share) {
          try {
            await navigator.share({ text });
            return;
          } catch (error) {
            if (error?.name === "AbortError") return;
          }
        }
        // open() は <a target="_blank"> と違って暗黙の noopener にならないため明示する
        // （開いた先に window.opener を渡さない）
        open(
          `https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(record, logic, cleared))}`,
          "_blank",
          "noopener"
        );
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
