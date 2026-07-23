// 分析モード。各ターンでどれだけ候補（答えの組）を絞り込めたか、
// 期待情報量、より良い単語の提案を表示する。
// 計算は Worker (js/core/analysis.worker.js) で行う。
// ルート: #/analysis/<mode>/<startTime>

import { el, clear } from "./dom.js";
import { registerScreen, navigate, setViewMood } from "./app.js?v=20260723-fa";
import { findGame, MODES } from "../core/records.js";
import { Logic } from "../core/logic.js";
import { pidLabel } from "../core/problems.js";
import { computeTruePatternIds, resultToPatternId, patternIdToStates } from "../core/analysis-core.js?v=20260723-fa";
import { checkOnEvent } from "../core/achievements.js?v=20260723-fa";
import { achievementCelebration } from "./toast.js?v=20260723-fa";
import { playSfx } from "../audio/sound.js?v=20260723-fa";
import { soundToggleButton } from "./sound-toggle.js?v=20260723-fa";
import { icon } from "./icons.js";
import { currentLanguage, isEnglish, tr } from "../core/i18n.js?v=20260723-fa";
import { rowAriaLabel } from "./a11y.js?v=20260723-fa";

let root = null;
let worker = null;
let renderToken = 0; // 古い Worker 結果を捨てるための世代カウンタ

function build() {
  root = document.getElementById("screen-analysis");
}

function fmtBits(b) {
  return `${b.toFixed(2)} bit`;
}

function fmtCount(n) {
  return n.toLocaleString(currentLanguage() === "en" ? "en-US" : "ja-JP");
}

function tilesRow(word, patternId, small = true) {
  const states = patternIdToStates(patternId);
  return el(
    "div",
    { class: "rrow", style: { display: "flex", gap: "4px" }, role: "img", "aria-label": rowAriaLabel(word, states) },
    word.split("").map((c, i) =>
      el("div", { class: `rcell ${states[i]}`, style: small ? {} : {}, "aria-hidden": "true" }, c)
    )
  );
}

function render(args) {
  if (!root) build();
  clear(root);
  const token = ++renderToken;
  const [mode, startTimeStr] = args;
  const record = findGame(parseInt(startTimeStr, 10), mode);
  // 履歴などから別モードの記録を開いても、その記録のモードの配色で表示する
  if (record) setViewMood(record.gameMode);

  const header = el(
    "div",
    { class: "header" },
    el(
      "button",
      {
        class: "icon-btn",
        "aria-label": tr("前の画面へ戻る", "Back"),
        onclick: () => { playSfx("ui"); history.length > 1 ? history.back() : navigate("/history"); },
      },
      icon("arrowLeft")
    ),
    el("h1", { class: "title" }, tr("分析モード", "Analysis")),
    el("span", { class: "spacer" }),
    record ? el("span", { class: "sub" }, pidLabel(record.problemID)) : null,
    soundToggleButton()
  );
  const body = el("div", { class: "list-screen-body" });
  root.append(header, body);

  if (!record) {
    body.append(el("p", { class: "hint" }, tr("記録が見つかりませんでした。", "Record not found.")));
    return;
  }
  if (record.gameMode === "uso" && (!record.usoResults || record.usoResults.length !== record.guessWord.length)) {
    body.append(
      el(
        "p",
        { class: "hint" },
        tr("この記録には表示判定が保存されていないため、分析できません。", "This record has no saved displayed feedback and cannot be analyzed.")
      )
    );
    return;
  }

  // 実績: アナリスト
  const newly = checkOnEvent("analysis");
  if (newly.length) achievementCelebration(newly);

  body.append(
    el(
      "aside",
      { class: "card analysis-purpose" },
      el("b", {}, tr("この分析について", "About this analysis")),
      el(
        "p",
        {},
        tr(
          "勝率や正解そのものの採点ではなく、各手が候補ペアをどれだけ減らせたかを測る「情報効率」の分析です。正解した手には順位評価や候補提案を表示しません。",
          "This measures information efficiency—how much each Guess reduced the candidate pairs—not win probability or whether the Guess was correct. Winning Guesses are not ranked and receive no alternative suggestions."
        )
      ),
      el(
        "ul",
        { class: "analysis-terms" },
        el(
          "li",
          {},
          el("b", {}, tr("期待情報量", "Expected information")),
          tr(
            " … 判定を見る前の時点で、その単語が平均してどれだけ絞れると見込めたか（手の強さの目安）。",
            " — how much that word was expected to narrow the pairs on average, before seeing the feedback (a measure of Guess strength)."
          )
        ),
        el(
          "li",
          {},
          el("b", {}, tr("獲得情報量", "Information gained")),
          tr(
            " … 判定を見た結果、答えの組が実際にどれだけ絞れたか。1 bit ごとに候補が半分になる。",
            " — how much the feedback actually narrowed the answer pairs. Each bit halves the candidates."
          )
        )
      )
    )
  );

  // 進捗表示
  const progressLabel = el("div", { class: "hint" }, tr("分析を準備中…", "Preparing analysis…"));
  const progressFill = el("div", { class: "bar-fill", style: { width: "0%" } });
  const progressWrap = el(
    "div",
    { class: "analysis-progress card", style: { width: "100%" } },
    el("div", { style: { fontWeight: "800" } }, tr("候補ペアを計算しています", "Calculating candidate pairs")),
    el("div", { class: "bar-track", style: { width: "100%" } }, progressFill),
    progressLabel
  );
  body.append(progressWrap);

  // Worker 起動
  const logic = new Logic(record.problemID);
  const truePatternIds = computeTruePatternIds(logic.ans1, logic.ans2, record.guessWord);
  const shownPatternIds =
    record.gameMode === "uso" ? record.usoResults.map((r) => resultToPatternId(r)) : truePatternIds;

  if (worker) worker.terminate();
  worker = new Worker(new URL("../core/analysis.worker.js?v=20260723-fa", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    if (token !== renderToken) return; // 画面遷移後の古い結果
    const msg = e.data;
    if (msg.type === "progress") {
      progressFill.style.width = `${Math.round(msg.ratio * 100)}%`;
      progressLabel.textContent = isEnglish() ? `Analyzing… ${Math.round(msg.ratio * 100)}%` : msg.label;
    } else if (msg.type === "done") {
      progressWrap.remove();
      renderResult(body, record, logic, msg.result);
    } else if (msg.type === "error") {
      progressWrap.remove();
      body.append(el("p", { class: "hint" }, tr(`分析に失敗しました: ${msg.message}`, `Analysis failed: ${msg.message}`)));
    }
  };
  // モジュールのロード失敗や worker 内の未捕捉例外は onmessage に届かないため、
  // ここで受けて進捗表示が「分析中…」のまま止まり続けるのを防ぐ。
  worker.onerror = (event) => {
    if (token !== renderToken) return;
    progressWrap.remove();
    body.append(
      el(
        "p",
        { class: "hint" },
        tr(
          `分析を開始できませんでした: ${event.message || "Worker の読み込みに失敗しました"}`,
          `Could not start analysis: ${event.message || "failed to load the worker"}`
        )
      )
    );
  };
  worker.postMessage({
    pid: record.problemID,
    mode: record.gameMode,
    guessWords: record.guessWord,
    truePatternIds,
    shownPatternIds,
  });
}

function renderResult(body, record, logic, res) {
  playSfx("swoosh");
  const isUso = record.gameMode === "uso";

  // サマリカード
  body.append(
    el(
      "div",
      { class: "card", style: { display: "flex", flexDirection: "column", gap: "6px" } },
      el("div", { style: { fontWeight: "800" } }, `${MODES[record.gameMode].title} ${pidLabel(record.problemID)}`),
      el("div", { class: "hint" }, tr(`答え: ${logic.ans1.toUpperCase()} / ${logic.ans2.toUpperCase()}`, `Answers: ${logic.ans1.toUpperCase()} / ${logic.ans2.toUpperCase()}`)),
      el(
        "div",
        { class: "hint" },
        tr(
          `候補リスト ${fmtCount(res.candListSize)} 語 → 答えの組は ${fmtCount(res.initialPairs)} 通り`,
          `${fmtCount(res.candListSize)} candidate words → ${fmtCount(res.initialPairs)} answer pairs`
        )
      ),
      res.sampled
        ? el(
            "div",
            { class: "hint", style: { color: "var(--accent-2)" } },
            tr("※ 組が膨大なため、サンプリングによる推定値で表示しています", "Estimated from a sample because the number of pairs is very large.")
          )
        : null,
      isUso
        ? el(
            "div",
            { class: "hint", style: { color: "#ff7a9a" } },
            tr(
              "※ 裏モード: 表示は嘘なので「真の判定と全位置で食い違う組」が候補として残ります",
              "DWORDlie: displayed feedback lies, so pairs whose true feedback differs at every position remain candidates."
            )
          )
        : null
    )
  );

  const maxLogInitial = Math.log2(res.initialPairs);

  res.turns.forEach((turn, t) => {
    const eliminated = turn.before - turn.after;
    const elimPct = turn.before > 0 ? (100 * eliminated) / turn.before : 0;
    const sug = turn.suggestions;
    const winningTurn = logic.isGameClear(turn.word);

    const card = el(
      "div",
      { class: "card turn-card" },
      el(
        "div",
        { class: "turn-head" },
        el("span", { class: "tn" }, `TURN ${t + 1}`),
        el("span", { class: "tw" }, turn.word),
        winningTurn ? el("span", { class: "analysis-correct" }, tr("正解！", "SOLVED!")) : null,
        el("span", { class: "spacer", style: { flex: 1 } }),
        tilesRow(turn.word, turn.shownPattern)
      ),
      // 候補数の推移
      el(
        "div",
        { class: "bar-wrap" },
        el("div", { class: "bar-label" }, tr("残り候補", "Candidates left")),
        el(
          "div",
          { class: "bar-track" },
          el("div", {
            class: "bar-fill bar-grow",
            style: { width: `${Math.max(2, (100 * Math.log2(Math.max(2, turn.after))) / maxLogInitial)}%`, "--bar-index": t * 3 },
          })
        ),
        el("div", { class: "bar-value" }, tr(`${fmtCount(turn.after)} 組`, `${fmtCount(turn.after)} pairs`))
      ),
      el(
        "div",
        { class: "hint" },
        tr(
          `${fmtCount(turn.before)} → ${fmtCount(turn.after)} 組（${elimPct.toFixed(1)}% を排除）`,
          `${fmtCount(turn.before)} → ${fmtCount(turn.after)} pairs (${elimPct.toFixed(1)}% eliminated)`
        )
      ),
      // 情報量
      el(
        "div",
        { class: "bar-wrap" },
        el("div", { class: "bar-label" }, tr("期待情報量", "Expected information")),
        el(
          "div",
          { class: "bar-track" },
          el("div", {
            class: "bar-fill bar-grow",
            style: { width: `${Math.min(100, (100 * turn.expectedBits) / Math.max(0.01, turn.maxBits))}%`, opacity: 0.65, "--bar-index": t * 3 + 1 },
          })
        ),
        el("div", { class: "bar-value" }, fmtBits(turn.expectedBits))
      ),
      el(
        "div",
        { class: "bar-wrap" },
        el("div", { class: "bar-label" }, tr("獲得情報量", "Information gained")),
        el(
          "div",
          { class: "bar-track" },
          el("div", {
            class: "bar-fill bar-grow",
            style: { width: `${Math.min(100, (100 * turn.bitsGained) / Math.max(0.01, turn.maxBits))}%`, "--bar-index": t * 3 + 2 },
          })
        ),
        el("div", { class: "bar-value" }, fmtBits(turn.bitsGained))
      )
    );

    if (winningTurn) {
      card.append(
        el(
          "div",
          { class: "analysis-correct-note" },
          tr("正解した手のため、順位評価と候補提案はありません。", "Winning Guess—ranking and alternative suggestions are omitted.")
        )
      );
    }

    // 提案
    if (!winningTurn && sug && sug.list.length > 0) {
      const rankNote =
        sug.playedRank !== null
          ? tr(
              `あなたの手は ${sug.playedRank} 位 / ${sug.evalPairs < turn.before ? "評価はサンプル" : "評価対象"} ${fmtCount(sug.evalPairs)} 組（期待 ${fmtBits(sug.playedExpectedBits)}）`,
              `Your Guess ranked #${sug.playedRank} across ${fmtCount(sug.evalPairs)} ${sug.evalPairs < turn.before ? "sampled" : "evaluated"} pairs (expected ${fmtBits(sug.playedExpectedBits)})`
            )
          : null;
      card.append(
        el("div", { class: "hint", style: { marginTop: "4px", fontWeight: "700" } },
          isUso
            ? tr("もっと絞れたかもしれない単語（真の判定基準）:", "Words that may have narrowed it further (true-feedback basis):")
            : tr("もっと絞れたかもしれない単語:", "Words that may have narrowed it further:")),
        el(
          "div",
          { class: "suggest-list" },
          sug.list.map((s, i) =>
            el(
              "div",
              { class: "srow" },
              el("span", { class: "hint", style: { width: "18px" } }, `${i + 1}.`),
              el("span", { class: "sword" }, s.word),
              el("span", { class: "sbits" }, tr(`期待 ${fmtBits(s.expectedBits)}`, `Expected ${fmtBits(s.expectedBits)}`)),
              s.word === turn.word ? el("span", { class: "hit" }, tr("← あなたの手", "← Your Guess")) : null
            )
          )
        ),
        rankNote ? el("div", { class: "hint" }, rankNote) : null
      );
    }
    body.append(card);
  });
}

registerScreen("analysis", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
  onLeave() {
    renderToken++;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    setViewMood(null); // 一時的に適用した記録モードの配色を現在のモードへ戻す
  },
});
