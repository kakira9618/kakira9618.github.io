// ルール説明モーダル。
// BLOOD / SOLVE に TOOLS を入力し、緑・黄がどちらの答えの文字を
// 参照した判定なのかを線とハイライトで順番に示す。
// DWORDle では解説後、同じパネルを使って「全部緑でも不正解」の例を再生する。

import { el } from "./dom.js";
import { showModal } from "./modal.js?v=20260723-badge-socket";
import { playSfx } from "../audio/sound.js?v=20260723-badge-socket";
import { queryWordPair, usoConvert } from "../core/logic.js";
import { currentLanguage } from "../core/i18n.js?v=20260723-badge-socket";
import { shouldReduceMotion } from "../core/motion.js?v=20260723-badge-socket";

const EX = {
  ans1: "blood",
  ans2: "solve",
  guess: "tools",
};
const ALL_GREEN_EX = {
  ans1: "about",
  ans2: "black",
  guess: "block",
  sources: [2, 2, 1, 2, 2],
};
const FEEDBACK_STATES = ["unused", "used", "correct"];
const TIMING = {
  typeMs: 190,
  flipMs: 310,
  reactionMs: 720,
  lieCompareMs: 900,
  lieFlipMs: 360,
  holdMs: 1700,
  switchOutMs: 160,
  switchInMs: 240,
};

let timers = [];

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

function stopAnimation() {
  timers.forEach(clearTimeout);
  timers = [];
}

// 本体ロジックと同じ消費順で、各判定が参照した Word / 文字位置も記録する。
function traceExample() {
  const result = queryWordPair(EX.guess, EX.ans1, EX.ans2);
  const flags = [Array(5).fill(0), Array(5).fill(0)];
  const links = Array(5).fill(null);

  for (let i = 0; i < 5; i++) {
    if (result[i] !== "correct") continue;
    if (EX.guess[i] === EX.ans1[i]) {
      flags[0][i] = 1;
      links[i] = { answer: 0, target: i, state: "correct" };
    } else {
      flags[1][i] = 1;
      links[i] = { answer: 1, target: i, state: "correct" };
    }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] !== "used") continue;
    for (let j = 0; j < 5; j++) {
      if (i === j) continue;
      if (!flags[0][j] && EX.guess[i] === EX.ans1[j]) {
        flags[0][j] = 1;
        links[i] = { answer: 0, target: j, state: "used" };
        break;
      }
      if (!flags[1][j] && EX.guess[i] === EX.ans2[j]) {
        flags[1][j] = 1;
        links[i] = { answer: 1, target: j, state: "used" };
        break;
      }
    }
  }
  return { result, links };
}

function buildWordRow(label, word) {
  const tiles = word
    .split("")
    .map((char) => el("div", { class: "rcell htile big answer-tile", "aria-hidden": "true" }, char));
  return {
    tiles,
    element: el(
      "div",
      { class: "help-ans-line", role: "img", "aria-label": `${label}: ${word.toUpperCase()}` },
      el("span", { class: "hint" }, label),
      el("div", { class: "help-anim-row" }, tiles)
    ),
  };
}

function buildExample(mode, language) {
  const isEnglish = language === "en";
  const { result: trueResult, links } = traceExample();
  const allGreenResult = queryWordPair(ALL_GREEN_EX.guess, ALL_GREEN_EX.ans1, ALL_GREEN_EX.ans2);
  const answerRows = [
    buildWordRow("Word 1", EX.ans1),
    buildWordRow("Word 2", EX.ans2),
  ];
  const guessTiles = EX.guess.split("").map(() => el("div", { class: "rcell htile big" }, ""));
  const guessRow = el("div", { class: "help-anim-row", "aria-hidden": "true" }, guessTiles);
  const exampleTitle = el(
    "div",
    { class: "hint", style: { textAlign: "center" } },
    isEnglish ? "Example answers" : "例：2 つの答え"
  );
  const caption = el("div", { class: "help-caption", "aria-live": "polite" }, "\u00a0");
  const reactionLine = el("div", { class: "help-reaction-line", "aria-hidden": "true" });
  const box = el(
    "div",
    { class: "help-example-box" },
    exampleTitle,
    el("div", { class: "help-answers" }, answerRows.map((row) => row.element)),
    el("div", { class: "help-guess-area" }, guessRow),
    caption,
    reactionLine
  );

  const setAnswerWords = (example) => {
    [example.ans1, example.ans2].forEach((word, rowIndex) => {
      word.split("").forEach((char, tileIndex) => {
        answerRows[rowIndex].tiles[tileIndex].textContent = char;
      });
    });
  };

  const clearReaction = () => {
    guessTiles.forEach((tile) => tile.classList.remove("reacting"));
    answerRows.forEach((row) => {
      row.element.classList.remove("checking-absent");
      row.tiles.forEach((tile) => tile.classList.remove("reacting", "reaction-correct", "reaction-used"));
    });
    reactionLine.className = "help-reaction-line";
  };

  const switchExample = (nextExample) => {
    box.classList.remove("help-example-switch-in");
    box.classList.add("help-example-switch-out");
    later(() => {
      box.classList.remove("help-example-switch-out");
      nextExample();
      void box.offsetWidth;
      box.classList.add("help-example-switch-in");
      later(() => box.classList.remove("help-example-switch-in"), TIMING.switchInMs);
    }, TIMING.switchOutMs);
  };

  const showReaction = (guessIndex, link, example = EX) => {
    clearReaction();
    const from = guessTiles[guessIndex];
    const to = answerRows[link.answer].tiles[link.target];
    from.classList.add("reacting");
    to.classList.add("reacting", `reaction-${link.state}`);

    const boxRect = box.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width / 2 - boxRect.left;
    const y1 = fromRect.top - boxRect.top;
    const x2 = toRect.left + toRect.width / 2 - boxRect.left;
    const y2 = toRect.top + toRect.height / 2 - boxRect.top;
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const lineHalfHeight = reactionLine.offsetHeight / 2;
    Object.assign(reactionLine.style, {
      left: `${x1}px`,
      top: `${y1 - lineHalfHeight}px`,
      width: `${distance}px`,
      transform: `rotate(${angle}rad)`,
    });
    reactionLine.className = `help-reaction-line show ${link.state}`;

    const char = example.guess[guessIndex].toUpperCase();
    const stateLabel = link.state === "correct" ? (isEnglish ? "Green" : "緑") : isEnglish ? "Yellow" : "黄";
    const reason = link.state === "correct"
      ? (isEnglish ? "same spot" : "同位置")
      : (isEnglish ? "elsewhere" : "別位置");
    caption.textContent = isEnglish
      ? `${stateLabel} ${char} → Word ${link.answer + 1} #${link.target + 1} (${reason})`
      : `${stateLabel} ${char} → Word ${link.answer + 1}・${link.target + 1} 文字目（${reason}）`;
  };

  const showNoMatch = (guessIndex) => {
    clearReaction();
    guessTiles[guessIndex].classList.add("reacting");
    answerRows.forEach((row) => row.element.classList.add("checking-absent"));
    const char = EX.guess[guessIndex].toUpperCase();
    caption.textContent = isEnglish
      ? `Gray ${char} → neither word`
      : `灰 ${char} → どちらの Word にもなし`;
  };

  // 元の判定色から、実際に選ばれた嘘の色へ一度だけ反転する。
  const showLieResult = (lieResult) => {
    guessTiles.forEach((tile) => tile.classList.remove("flip", "lied"));
    void box.offsetWidth;
    guessTiles.forEach((tile) => tile.classList.add("flip"));
    later(() => {
      guessTiles.forEach((tile, index) => {
        tile.classList.remove(...FEEDBACK_STATES);
        tile.classList.add(lieResult[index], "lied");
      });
    }, TIMING.lieFlipMs / 2);
  };

  const drawIllustrativeLies = () => {
    const shown = trueResult.map((state) => usoConvert(state));
    // 同じ本当の判定でも別々の嘘になり得ることを確実に見せる、有効な抽選例。
    for (let i = 0; i < trueResult.length; i++) {
      const j = trueResult.findIndex((state, index) => index > i && state === trueResult[i]);
      if (j < 0) continue;
      if (shown[i] === shown[j]) {
        shown[j] = FEEDBACK_STATES.find((state) => state !== trueResult[j] && state !== shown[i]);
      }
      break;
    }
    return shown;
  };

  function resetPrimaryExample() {
    clearReaction();
    box.classList.remove("showing-all-green");
    exampleTitle.textContent = isEnglish ? "Example answers" : "例：2 つの答え";
    setAnswerWords(EX);
    guessTiles.forEach((tile) => {
      tile.textContent = "";
      tile.className = "rcell htile big";
    });
    caption.textContent = isEnglish ? "Your guess…" : "あなたの入力…";
  }

  function playPrimaryExample() {
    resetPrimaryExample();
    EX.guess.split("").forEach((char, index) => {
      later(() => {
        guessTiles[index].textContent = char;
        guessTiles[index].classList.add("typed");
      }, TIMING.typeMs * (index + 1));
    });

    const typedDone = TIMING.typeMs * 6;
    later(
      () => {
        caption.textContent = mode === "uso"
          ? (isEnglish ? "First, the true feedback is…" : "まず、本当の判定は…")
          : (isEnglish ? "Checking…" : "判定中…");
      },
      typedDone
    );
    trueResult.forEach((stateName, index) => {
      later(() => {
        guessTiles[index].classList.add("flip");
        later(() => guessTiles[index].classList.add(stateName), 140);
      }, typedDone + TIMING.flipMs * index);
    });

    const revealDone = typedDone + TIMING.flipMs * 5 + 260;
    const reactions = links.map((link, index) => ({ link, index }));
    reactions.forEach(({ link, index }, order) => {
      later(
        () => (link ? showReaction(index, link) : showNoMatch(index)),
        revealDone + 300 + order * TIMING.reactionMs
      );
    });
    const reactionDone = revealDone + 300 + reactions.length * TIMING.reactionMs;

    if (mode === "uso") {
      const lieResult = drawIllustrativeLies();
      const originalColorStart = reactionDone + 180;
      later(() => {
        clearReaction();
        caption.textContent = isEnglish ? "Original colors" : "元の色";
      }, originalColorStart);
      const lieStart = originalColorStart + TIMING.lieCompareMs;
      later(() => {
        caption.textContent = isEnglish ? "Colors actually chosen" : "実際に選ばれる色";
        showLieResult(lieResult);
      }, lieStart);
      const lieDone = lieStart + TIMING.lieFlipMs;
      later(playPrimaryExample, lieDone + TIMING.holdMs);
    } else {
      later(() => switchExample(playAllGreenExample), reactionDone + TIMING.holdMs);
    }
  }

  function resetAllGreenExample() {
    clearReaction();
    box.classList.add("showing-all-green");
    exampleTitle.textContent = isEnglish
      ? "Example: all green, not solved"
      : "例：全部緑でも未正解";
    setAnswerWords(ALL_GREEN_EX);
    guessTiles.forEach((tile) => {
      tile.textContent = "";
      tile.className = "rcell htile big";
    });
    caption.textContent = isEnglish ? "Guessing BLOCK…" : "BLOCK を入力…";
  }

  function playAllGreenExample() {
    resetAllGreenExample();
    ALL_GREEN_EX.guess.split("").forEach((char, index) => {
      later(() => {
        guessTiles[index].textContent = char;
        guessTiles[index].classList.add("typed");
      }, TIMING.typeMs * (index + 1));
    });

    const typedDone = TIMING.typeMs * 6;
    later(() => {
      caption.textContent = isEnglish ? "Checking…" : "判定中…";
    }, typedDone);
    allGreenResult.forEach((state, index) => {
      later(() => {
        guessTiles[index].classList.add("flip");
        later(() => guessTiles[index].classList.add(state), 140);
      }, typedDone + TIMING.flipMs * index);
    });

    const revealDone = typedDone + TIMING.flipMs * 5 + 260;
    const reactions = ALL_GREEN_EX.sources.map((source, index) => ({
      index,
      link: { answer: source - 1, target: index, state: "correct" },
    }));
    reactions.forEach(({ link, index }, order) => {
      later(
        () => showReaction(index, link, ALL_GREEN_EX),
        revealDone + 300 + order * TIMING.reactionMs
      );
    });
    const reactionDone = revealDone + 300 + reactions.length * TIMING.reactionMs;
    later(() => {
      clearReaction();
      caption.textContent = isEnglish
        ? "Each tile matches one word → all green"
        : "各文字がどちらかと一致 → 全部緑";
    }, reactionDone);
    later(() => {
      // CSS の reduce-motion クランプは Web Animations API には効かないため個別に抑制する
      if (!shouldReduceMotion()) {
        box.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-4px)" },
            { transform: "translateX(4px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 280, easing: "ease-out" }
        );
      }
      caption.textContent = isEnglish
        ? "Not either answer → keep playing"
        : "どちらの答えでもない → 続行";
    }, reactionDone + 1250);
    later(
      () => switchExample(playPrimaryExample),
      reactionDone + 1250 + TIMING.holdMs + 900
    );
  }

  const notes = mode === "uso"
    ? isEnglish
      ? [
          ["correct", "G", "A green lie means this letter was truly yellow or gray"],
          ["used", "Y", "A yellow lie means this letter was truly green or gray"],
          ["unused", "×", "A gray lie means this letter was truly green or yellow"],
        ]
      : [
          ["correct", "緑", "この文字の本当の判定は「黄 か 灰」"],
          ["used", "黄", "この文字の本当の判定は「緑 か 灰」"],
          ["unused", "灰", "この文字の本当の判定は「緑 か 黄」"],
        ]
    : isEnglish
      ? [
          ["correct", "G", "Green: matches the same position in Word 1 or Word 2"],
          ["used", "Y", "Yellow: appears elsewhere in Word 1 or Word 2"],
          ["unused", "×", "Gray: does not appear in either answer"],
        ]
      : [
          ["correct", "緑", "Word 1 / 2 どちらかの同じ位置と一致"],
          ["used", "黄", "Word 1 / 2 どちらかの別の位置に含まれる"],
          ["unused", "灰", "どちらの答えにも含まれない"],
        ];

  box.append(
    el(
      "div",
      { class: "help-notes" },
      notes.map(([stateName, label, text]) =>
        el(
          "div",
          { class: "help-note" },
          el("span", { class: `rcell htile small ${stateName}` }, label),
          el("span", { class: "hint" }, text)
        )
      )
    )
  );
  later(playPrimaryExample, 80);
  return box;
}

function localizedBody(mode, language) {
  const isEnglish = language === "en";
  if (mode === "uso") {
    return [
      el(
        "p",
        { class: "hint" },
        isEnglish
          ? "The basic rules are the same as DWORDle: there are two possible answers. However…"
          : "基本ルールは DWORDle と同じ（答えは 2 つ）ですが…"
      ),
      el(
        "p",
        { class: "help-lie-callout" },
        isEnglish
          ? "Each letter gets its own lie"
          : "文字ごとに嘘の判定をします"
      ),
      buildExample("uso", language),
      el(
        "p",
        { class: "hint" },
        isEnglish
          ? "For every tile, one of the two colors other than its true feedback is chosen at random, independently of all other tiles. Even tiles with the same true feedback may therefore show different colors. Guess either answer within 15 tries. The keyboard does not change color because its feedback cannot be trusted."
          : "各タイルは、ほかの文字とは関係なく、本当の判定以外の 2 色からランダムに 1 色を選びます。そのため本当の判定が同じ文字同士でも、別の色を表示することがあります。15 回以内の試行で、2 つの正解単語の「どちらか」を当ててください。キーボードは色づきません（嘘なので）。"
      ),
    ];
  }
  return [
    el(
      "p",
      { class: "hint" },
      isEnglish
        ? "The rules are like Wordle, but there are two answer words. Green and yellow feedback can refer to either answer."
        : "ルールは Wordle と同じですが、正解単語が 2 つあります。緑・黄の判定は Word 1 / 2 のどちらかについての情報です。"
    ),
    buildExample("normal", language),
    el(
      "p",
      { class: "hint" },
      isEnglish
        ? "Guess either answer within 10 tries. Even five green tiles may not be an exact answer; if so, the game continues."
        : "10 回以内の試行で、2 つの正解単語の「どちらか」を当ててください。全部緑であっても正解単語とは限りません（その場合ゲーム続行となります）。"
    ),
  ];
}

export function showHelpModal(mode, afterClose = null) {
  stopAnimation();
  playSfx("help");
  const language = currentLanguage();
  const content = el("div", { class: "help-localized" });
  content.append(...localizedBody(mode, language));

  showModal({
    title: mode === "uso" ? (language === "en" ? "DWORDlie Guide" : "DWORDlie 遊び方") : (language === "en" ? "DWORDle Guide" : "DWORDle 遊び方"),
    body: [content],
    actions: [{ label: language === "en" ? "Close" : "閉じる", primary: true, onClick: () => {} }],
    onClose: () => {
      stopAnimation();
      afterClose?.();
    },
  });
}

export function showFirstTutorial(mode, afterClose = null) {
  const point = (number, title, text) =>
    el(
      "li",
      { class: "tutorial-point" },
      el("span", { class: "tutorial-number", "aria-hidden": "true" }, number),
      el("div", {}, el("b", {}, title), el("span", {}, text))
    );

  const points = mode === "uso"
    ? [
        point(
          "1",
          currentLanguage() === "en" ? "Same basic rules as DWORDle" : "基本ルールは DWORDle と同じ",
          currentLanguage() === "en"
            ? "There are two answers. Guess either one to win."
            : "答えは 2 つ。どちらかを当てればクリアです。"
        ),
        point(
          "2",
          currentLanguage() === "en" ? "Feedback always lies" : "判定は必ず嘘をつく",
          currentLanguage() === "en"
            ? "Every displayed color differs from the true feedback."
            : "表示色は、正しい判定とは必ず異なります。"
        ),
      ]
    : [
        point(
          "1",
          currentLanguage() === "en" ? "Wordle with two answers" : "答えが 2 つある Wordle",
          currentLanguage() === "en"
            ? "Guess either answer to win."
            : "どちらかを当てればクリアです。"
        ),
        point(
          "2",
          currentLanguage() === "en" ? "Feedback checks both words" : "判定は 2 つの答えを参照",
          currentLanguage() === "en"
            ? "Green and yellow may refer to Word 1 or 2."
            : "緑・黄は、Word 1 / 2 のどちらかの情報です。"
        ),
        point(
          "3",
          currentLanguage() === "en" ? "All green may be unsolved" : "全部緑でも未正解の可能性",
          currentLanguage() === "en"
            ? "Match Word 1 or 2 exactly to win."
            : "入力全体が Word 1 / 2 と一致すればクリアです。"
        ),
      ];

  let openingFullGuide = false;
  showModal({
    title: `${currentLanguage() === "en" ? "Basic Rules" : "基本ルール"} | ${mode === "uso" ? "DWORDlie" : "DWORDle"}`,
    body: [
      el(
        "ol",
        { class: "tutorial-points" },
        points
      ),
    ],
    actions: [
      {
        label: currentLanguage() === "en" ? "Full Guide" : "詳しい遊び方",
        onClick: () => {
          openingFullGuide = true;
          setTimeout(() => showHelpModal(mode, afterClose), 0);
        },
      },
      { label: currentLanguage() === "en" ? "Got it" : "わかった", primary: true, onClick: () => {} },
    ],
    onClose: () => {
      if (!openingFullGuide) afterClose?.();
    },
  });
}
