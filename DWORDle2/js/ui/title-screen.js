// タイトル画面。モード選択・問題選択の入り口。
// 右上のマスクボタンで DWORDlie（裏モード）に切り替わる。

import { el, clear } from "./dom.js?v=20260728-a";
import { registerScreen, navigate, getAppMode, setAppMode } from "./app.js?v=20260728-a";
import { countPlays, getCurrentGame, getHistory, isAlreadyPlayed } from "../core/records.js?v=20260728-a";
import { isDebugMode } from "../core/debug.js?v=20260728-a";
import {
  LEVELS,
  PID,
  isValidPID,
  numberPrefix,
  pidForNumber,
  problemNumber,
  pidLabel,
  pidRangeForLevel,
  todayPID,
} from "../core/problems.js?v=20260728-a";
import { getSettings, setSetting } from "../core/settings.js?v=20260728-a";
import { loadJSON, saveJSON } from "../core/store.js?v=20260728-a";
import { importFromLocalStorage, scanLegacyHistory } from "../core/migrate.js?v=20260728-a";
import { playSfx } from "../audio/sound.js?v=20260728-a";
import { toast, extraShotUnlockCelebration } from "./toast.js?v=20260728-a";
import { claimExtraShotUnlockNotice } from "../core/extra-shot.js?v=20260728-a";
import { showModal } from "./modal.js?v=20260728-a";
import { finishHistoryImport } from "./history-import.js?v=20260728-a";
import { showFirstTutorial, showHelpModal } from "./help.js?v=20260728-a";
import { confirmAndStart } from "./game-screen.js?v=20260728-a";
import { soundToggleButton } from "./sound-toggle.js?v=20260728-a";
import { burstAtElement } from "../fx/effects.js?v=20260728-a";
import { shouldReduceMotion } from "../core/motion.js?v=20260728-a";
import { icon } from "./icons.js?v=20260728-a";
import { APP_VERSION } from "../config.js?v=20260728-a";
import { SOURCE_HASH } from "../version.js?v=20260728-a";
import { localizedLevel, tr } from "../core/i18n.js?v=20260728-a";
import { CARD_UNLOCK_PLAYS } from "./player-card.js?v=20260728-a";

let root = null;
let legacyImportCheckDone = false;

function build() {
  root = document.getElementById("screen-title");
}

// 未プレイの番号を優先して選ぶ
function randomPID(lo, hi, mode) {
  for (let tryCount = 0; tryCount < 30; tryCount++) {
    const pid = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (!isAlreadyPlayed(pid, mode)) return pid;
  }
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// 番号の割り当て表。レベル順（Lv.1→Lv.6）で並べる。
// 左右の列を通しで揃えるため、行ラッパーを作らず 2 列グリッドへ直接並べる。
// classic を指定すると Cls.（旧出題）側の表記になる。
// デイリーはここに載せない（番号を持たず、タイトルの「本日の問題」から遊ぶ）。
function numberGuide(classic = false) {
  const cells = [];
  const addRow = (range, name, desc) => {
    cells.push(
      el("span", { class: "number-guide-range" }, range),
      el(
        "span",
        { class: "number-guide-label" },
        el("span", { class: "number-guide-name" }, name),
        desc ? el("span", { class: "number-guide-desc" }, desc) : null
      )
    );
  };
  const prefix = numberPrefix(classic);
  for (const level of LEVELS.slice().sort((a, b) => a.id - b.id)) {
    const localized = localizedLevel(level);
    addRow(`${prefix}${level.range[0]}-${level.range[1]}`, `Lv.${level.id} ${localized.name}`, localized.desc);
  }
  return el("div", { class: "number-guide" }, cells);
}

function numberPrompt(mode) {
  // 既定は新出題。Cls. は原作互換の旧出題で、実績の対象外であることを添えて選べるようにする。
  let classic = false;
  const [easyMin, easyMax] = pidRangeForLevel(LEVELS[0], classic);
  const input = el("input", {
    type: "number",
    value: String(problemNumber(randomPID(easyMin, easyMax, mode))),
    min: String(PID.EASY_MIN),
    max: String(PID.NUMBER_MAX),
    "aria-label": tr("問題番号", "Puzzle number"),
  });
  const guideBox = el("div", { class: "number-guide-box" });
  const note = el(
    "p",
    { class: "hint problem-set-note" },
    tr(
      "Cls. は原作 DWORDle 互換の旧出題です。2026-08-01 以降のプレイは実績の対象になりません（通算プレイ日数・連続プレイは数えます）。",
      "Cls. puzzles use the original DWORDle generator. Plays on or after 2026-08-01 do not count toward achievements (play days and play streaks still count)."
    )
  );
  const setButtons = [
    [false, tr("新出題", "New"), "No."],
    [true, tr("旧出題", "Classic"), "Cls."],
  ].map(([value, label, prefix]) =>
    el(
      "button",
      {
        onclick: () => {
          playSfx("ui");
          classic = value;
          refresh();
        },
      },
      el("span", { class: "problem-set-name" }, label),
      el("span", { class: "problem-set-prefix" }, prefix)
    )
  );
  const setSeg = el("div", { class: "seg problem-set-tabs" }, setButtons);
  function refresh() {
    setButtons.forEach((button, i) => button.classList.toggle("active", classic === (i === 1)));
    note.style.display = classic ? "" : "none";
    clear(guideBox);
    guideBox.append(numberGuide(classic));
  }
  refresh();
  showModal({
    title: tr("番号を指定してプレイ", "Play by puzzle number"),
    body: [
      setSeg,
      input,
      note,
      guideBox,
    ],
    actions: [
      { label: tr("キャンセル", "Cancel"), onClick: () => {} },
      {
        label: tr("スタート", "Start"),
        primary: true,
        onClick: () => {
          // デイリーはここからは選べない（番号を持たない共通問題なので、
          // タイトルの「本日の問題」から遊ぶ）
          const number = parseInt(input.value, 10);
          const pid = pidForNumber(number, classic);
          if (!Number.isInteger(number) || number < PID.EASY_MIN || number > PID.NUMBER_MAX || !isValidPID(pid)) {
            toast(tr("1〜39999 の番号を入力してください", "Enter a number from 1 to 39999"));
            return false;
          }
          return confirmAndStart(pid, mode);
        },
      },
    ],
  });
  setTimeout(() => input.select(), 60);
}

// ランダムプレイ。難しさ（レベル）を選んでスタートする。
// 前回選んだレベルを覚えておく。
function randomPrompt(mode) {
  const lastLevel = getSettings().randomLevel;
  showModal({
    title: tr("ランダム（難しさを選択）", "Random (choose difficulty)"),
    body: LEVELS.map((lv) => {
      const localized = localizedLevel(lv);
      return el(
          "button",
          {
            class: `btn random-level-option ${lv.id === lastLevel ? "btn-primary" : ""}`,
            onclick: () => {
              playSfx("ui");
              setSetting("randomLevel", lv.id);
              const [lo, hi] = pidRangeForLevel(lv); // ランダムプレイは新出題から選ぶ
              confirmAndStart(randomPID(lo, hi, mode), mode);
            },
          },
          el(
            "span",
            { class: "random-level-name" },
            `Lv.${lv.id} ${localized.name}`,
            lv.id === lastLevel
              ? el("span", { class: "random-level-last" }, tr("（前回）", "(last)"))
              : null
          ),
          el("span", { class: "hint random-level-desc" }, localized.desc)
        );
    }),
    actions: [{ label: tr("閉じる", "Close"), onClick: () => {} }],
  });
}

function maybeOfferLegacyImport(afterClose = null) {
  if (legacyImportCheckDone) return false;
  legacyImportCheckDone = true;
  if (
    getHistory().length > 0 ||
    getCurrentGame("normal") ||
    getCurrentGame("uso") ||
    loadJSON("legacyImportPrompted", false)
  ) {
    return false;
  }

  const found = scanLegacyHistory();
  saveJSON("legacyImportPrompted", true);
  if (found.length === 0) return false;

  const achievementsCheck = el("input", { type: "checkbox", checked: true });
  showModal({
    title: tr("旧作のプレイ履歴が見つかりました", "Original game history found"),
    body: [
      el(
        "p",
        { class: "hint", style: { fontSize: "14px" } },
        tr(
          "このブラウザに旧 DWORDle / DWORDlie のプレイ履歴があります。DWORDle 2 にインポートしますか？",
          "This browser contains play history from the original DWORDle / DWORDlie. Import it into DWORDle 2?"
        )
      ),
      el(
        "p",
        { class: "hint" },
        tr(
          "履歴はマージされ、既存データは上書きされません。",
          "History is merged without overwriting existing data."
        )
      ),
      el(
        "label",
        { class: "import-achievements-choice" },
        achievementsCheck,
        tr("履歴の条件を満たす実績も解除する", "Also unlock achievements supported by the history")
      ),
    ],
    actions: [
      { label: tr("スキップ", "Skip"), onClick: () => {} },
      {
        label: tr("インポート", "Import"),
        primary: true,
        onClick: () => {
          const withAchievements = achievementsCheck.checked;
          finishHistoryImport(importFromLocalStorage({ withAchievements }), { withAchievements });
        },
      },
    ],
    onClose: afterClose,
  });
  return true;
}

function maybeShowFirstTutorial(mode, afterClose = null) {
  const key = mode === "uso" ? "tutorialSeenUso" : "tutorialSeen";
  if (loadJSON(key, false)) return false;
  saveJSON(key, true);
  showFirstTutorial(mode, afterClose);
  return true;
}

// タイトルメニューの段階解放しきい値（必要プレイ回数）。
// 1 回プレイで DWORDlie（uso）以外をすべて解放し、2 回プレイで DWORDlie を解放する。
// プレイヤーカードは 5 回プレイで解放。
// プレイ回数は countPlays()（同日・同問題の再プレイも数え、旧作インポートは数えない）。
const MENU_UNLOCKS = { history: 1, achievements: 1, random: 1, problems: 1, number: 1, uso: 2, card: CARD_UNLOCK_PLAYS };
// 解放お披露目アニメーションの項目ごとの時間差
const UNLOCK_REVEAL_STAGGER_MS = 150;
// DWORDlie 解放モーダルは解錠演出（鍵シェイク→開錠）が終わってから出す
const USO_UNLOCK_MODAL_DELAY_MS = 1100;
// reduce-motion 時は解錠演出がないので、描画が落ち着く最短の間だけ置く
const USO_UNLOCK_MODAL_DELAY_REDUCED_MS = 250;
// 解放モーダル中の位置ガイド矢印: ボタン下端から矢印までの間隔
const USO_ARROW_GAP_PX = 8;
// 位置ガイド矢印のサイズ
const USO_ARROW_SIZE = 30;

// プレイヤーカードはメニュー最下段の行を独占させて特別感を出す（グリッド 2 列ぶち抜き）
function playerCardMenuButton(menuBtn) {
  const button = menuBtn(
    "card",
    tr("プレイヤーカード", "Player Card"),
    () => { playSfx("ui"); navigate("/card"); },
    false,
    MENU_UNLOCKS.card
  );
  button.style.gridColumn = "1 / -1";
  return button;
}

function render() {
  if (!root) build();
  clear(root);
  const mode = getAppMode();
  const isUso = mode === "uso";
  const current = getCurrentGame(mode);
  const hasOngoing = current && current.guessWord.length > 0;

  // 段階解放: 新しく解放された項目にはお披露目アニメーションを付ける
  const plays = countPlays();
  const bypass = isDebugMode();
  const seenPlays = loadJSON("menuUnlockSeen", 0);
  const isUnlocked = (req) => bypass || plays >= req;
  const justUnlocked = (req) => !bypass && req > 0 && seenPlays < req && plays >= req;
  let revealCount = 0;
  const applyReveal = (button, req) => {
    if (!justUnlocked(req)) return button;
    const delayMs = revealCount++ * UNLOCK_REVEAL_STAGGER_MS;
    button.classList.add("unlock-reveal");
    button.style.setProperty("--reveal-delay", `${delayMs}ms`);
    // 解錠演出: 金の鍵がガチャガチャ揺れ、開いた瞬間にパーティクルが弾けて光が走る
    if (!shouldReduceMotion()) {
      const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#00d5ff";
      const lockFx = el("span", { class: "unlock-lock", "aria-hidden": "true" }, icon("lock", 22));
      button.append(lockFx);
      setTimeout(() => {
        if (!button.isConnected) return;
        if (delayMs === 0) playSfx("unlock"); // 解錠音は最初の錠前が開く瞬間に 1 回だけ
        lockFx.replaceChildren(icon("unlock", 22));
        lockFx.classList.add("open");
        burstAtElement(button, revealCount % 2 ? accent : "#ffd166", 14);
      }, delayMs + 380);
      setTimeout(() => lockFx.remove(), delayMs + 1050);
    }
    return button;
  };

  // 施錠中の項目をタップしたときの拒否リアクション。
  // 鍵がガチャガチャ震えて「まだ開かない」ことを音と動きで伝える
  const lockedTapFx = (button) => {
    playSfx("locked");
    if (shouldReduceMotion()) return;
    button.classList.remove("locked-shake");
    void button.offsetWidth; // 連打時にアニメーションを最初から再生し直す
    button.classList.add("locked-shake");
  };

  const menuBtn = (iconName, label, onclick, primary = false, req = 0) => {
    if (!isUnlocked(req)) {
      const remain = req - plays;
      const button = el(
        "button",
        {
          class: "btn menu-locked",
          "aria-disabled": "true",
          "aria-label": tr(`${label}（あと${remain}回プレイで解放）`, `${label} (play ${remain} more to unlock)`),
          onclick: () => lockedTapFx(button),
        },
        icon("lock"),
        label,
        el("span", { class: "unlock-hint" }, tr(`あと${remain}回プレイ`, remain === 1 ? "1 more play" : `${remain} more plays`))
      );
      return button;
    }
    return applyReveal(el("button", { class: `btn ${primary ? "btn-primary" : ""}`, onclick }, icon(iconName), label), req);
  };

  // 裏モード切替は 2 回プレイで解放（裏 → 表へ戻る方向はいつでも可能）
  const usoLocked = !isUso && !isUnlocked(MENU_UNLOCKS.uso);
  const modeToggle = usoLocked
    ? el(
        "button",
        {
          class: "icon-btn menu-locked",
          "aria-disabled": "true",
          title: tr(`あと${MENU_UNLOCKS.uso - plays}回プレイで解放`, `Play ${MENU_UNLOCKS.uso - plays} more to unlock`),
          "aria-label": tr(`裏モード（あと${MENU_UNLOCKS.uso - plays}回プレイで解放）`, `Secret mode (play ${MENU_UNLOCKS.uso - plays} more to unlock)`),
          onclick: () => {
            lockedTapFx(modeToggle);
            // アイコンだけで解放条件が見えないため、タップ時にトーストで補足する
            toast(tr(`あと${MENU_UNLOCKS.uso - plays}回プレイで解放`, `Play ${MENU_UNLOCKS.uso - plays} more to unlock`));
          },
        },
        icon("lock")
      )
    : applyReveal(
        el(
          "button",
          {
            class: "icon-btn",
            title: isUso ? tr("表モードへ", "Switch to DWORDle") : tr("裏モードへ", "Switch to DWORDlie"),
            "aria-label": isUso ? tr("表モードへ", "Switch to DWORDle") : tr("裏モードへ", "Switch to DWORDlie"),
            style: isUso ? { boxShadow: "0 0 12px rgba(255,43,94,0.8)", color: "#ff5f8f" } : {},
            onclick: () => {
              playSfx("swoosh");
              setAppMode(isUso ? "normal" : "uso");
              render();
            },
          },
          icon(isUso ? "mask" : "moon")
        ),
        MENU_UNLOCKS.uso
      );

  root.append(
    el("div", { style: { position: "absolute", top: "14px", right: "14px", display: "flex", gap: "8px" } },
      soundToggleButton(),
      el(
        "button",
        {
          class: "icon-btn",
          title: tr("遊び方", "How to play"),
          "aria-label": tr("遊び方", "How to play"),
          onclick: () => showHelpModal(mode),
        },
        "?"
      ),
      modeToggle
    ),
    el(
      "div",
      { class: "title-brand" },
      el("div", { class: "uso-banner" }, tr("う そ ぴ ょ ん", "J U S T  K I D D I N G")),
      el("h1", { class: "logo" }, isUso ? "DWORDlie" : "DWORDle", el("span", { class: "two" }, " 2"))
    ),
    el(
      "div",
      { class: "tagline" },
      isUso
        // 英語は iPhone 幅で 1 行に収まる長さにする
        ? tr("判定は必ず嘘。15手以内に見抜け。", "Every clue lies. Solve it in 15 Guesses.")
        : tr("答えは2つ、盤面は1つ。10手で片方を当てろ。", "Two answers, one board. Find either in 10.")
    ),
    el(
      "div",
      { class: "title-menu" },
      hasOngoing
        ? menuBtn(
            "play",
            el(
              "span",
              { class: "continue-label" },
              el("span", { class: "continue-label-main" }, tr("つづきから", "Continue")),
              el(
                "span",
                { class: "continue-label-detail" },
                tr(
                  `（${pidLabel(current.problemID)}・${current.guessWord.length}手）`,
                  `(${pidLabel(current.problemID)} · ${current.guessWord.length} ${current.guessWord.length === 1 ? "Guess" : "Guesses"})`
                )
              )
            ),
            () => { playSfx("ui"); navigate("/game"); },
            true
          )
        : null,
      menuBtn("calendar", tr("本日の問題", "Daily puzzle"), () => { playSfx("ui"); confirmAndStart(todayPID(), mode); }, !hasOngoing),
      menuBtn("dice", tr("ランダム（難しさを選択）", "Random (choose difficulty)"), () => { playSfx("ui"); randomPrompt(mode); }, false, MENU_UNLOCKS.random),
      menuBtn("hash", tr("番号を指定", "Choose puzzle number"), () => { playSfx("ui"); numberPrompt(mode); }, false, MENU_UNLOCKS.number)
    ),
    el(
      "div",
      { class: "title-nav" },
      menuBtn("clock", tr("プレイ履歴", "Play History"), () => { playSfx("ui"); navigate("/history"); }, false, MENU_UNLOCKS.history),
      menuBtn("grid", tr("問題一覧", "Puzzles"), () => { playSfx("ui"); navigate("/problems"); }, false, MENU_UNLOCKS.problems),
      menuBtn("medal", tr("実績", "Achievements"), () => { playSfx("ui"); navigate("/achievements"); }, false, MENU_UNLOCKS.achievements),
      menuBtn("gear", tr("設定", "Settings"), () => { playSfx("ui"); navigate("/settings"); }),
      playerCardMenuButton(menuBtn)
    ),
    el("div", { class: "app-version", title: "DWORDle 2 version" }, `v${APP_VERSION} (${SOURCE_HASH})`)
  );
  // お披露目は 1 回だけ。解錠音は錠前が開く瞬間（applyReveal 内）に鳴らすが、
  // reduce-motion 時は解錠演出がないのでここで即時に鳴らす
  if (!bypass && plays !== seenPlays) saveJSON("menuUnlockSeen", plays);
  if (revealCount > 0 && shouldReduceMotion()) playSfx("unlock");
  // DWORDlie の解放は大きな節目なので、解錠演出のあとにモーダルで案内する
  if (!isUso && justUnlocked(MENU_UNLOCKS.uso)) {
    const delayMs = shouldReduceMotion()
      ? USO_UNLOCK_MODAL_DELAY_REDUCED_MS
      : revealCount * UNLOCK_REVEAL_STAGGER_MS + USO_UNLOCK_MODAL_DELAY_MS;
    setTimeout(() => {
      if (!root.classList.contains("active")) return; // 既に別画面へ移動していたら出さない
      playSfx("help");
      const switchToUso = () => {
        playSfx("swoosh");
        setAppMode("uso");
        render();
      };
      // タイトル画面は #app (z:1) のスタッキングコンテキスト内にあり、実ボタンを
      // モーダル暗幕 (z:100) より上へは出せない。そこで切り替えボタンの複製を
      // body 直下 (z:120) に同じ位置で重ね、明るいまま見せて矢印で場所を指す。
      // 複製のタップでもそのまま切り替えられる。
      const rect = modeToggle.getBoundingClientRect();
      let spotlight = null;
      let guideArrow = null;
      let closeModal = () => {};
      if (rect.width > 0) {
        spotlight = el(
          "button",
          {
            class: "icon-btn unlock-spotlight",
            "aria-hidden": "true",
            tabindex: "-1",
            style: { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` },
            onclick: () => {
              closeModal();
              switchToUso();
            },
          },
          icon("moon")
        );
        guideArrow = el(
          "div",
          {
            class: "unlock-arrow",
            "aria-hidden": "true",
            style: { left: `${rect.left + rect.width / 2}px`, top: `${rect.bottom + USO_ARROW_GAP_PX}px` },
          },
          icon("arrowUp", USO_ARROW_SIZE)
        );
        document.body.append(spotlight, guideArrow);
      }
      closeModal = showModal({
        title: tr("裏モード解放！", "Secret mode unlocked!"),
        body: [
          el("div", { class: "uso-unlock-mask", "aria-hidden": "true" }, icon("mask", 44)),
          el(
            "p",
            { style: { fontSize: "14px" } },
            tr("裏モード「DWORDlie」が解放されました。", "The secret mode “DWORDlie” is now unlocked.")
          ),
          el(
            "p",
            { class: "hint" },
            tr(
              "答えは 2 つ、判定は必ず嘘。すべての色を疑って 15 手以内に見抜くモードです。",
              "Two answers, and every clue lies. Doubt every color and see through it within 15 guesses."
            )
          ),
          el(
            "p",
            { class: "hint" },
            tr(
              "タイトル右上の月アイコンからいつでも DWORDlie へ切り替えられます。DWORDlie 中は同じボタンがマスクアイコンになり、タップすると DWORDle へ戻ります。",
              "Switch to DWORDlie anytime with the moon icon at the top right of the title screen. While in DWORDlie, the same button shows a mask icon — tap it to return to DWORDle."
            )
          ),
        ],
        actions: [
          { label: tr("あとで", "Later"), onClick: () => {} },
          {
            label: tr("DWORDlie で遊ぶ", "Play DWORDlie"),
            primary: true,
            onClick: switchToUso,
          },
        ],
        onClose: () => {
          spotlight?.remove();
          guideArrow?.remove();
        },
      });
    }, delayMs);
  }
  const noPlayData =
    getHistory().length === 0 &&
    !getCurrentGame("normal") &&
    !getCurrentGame("uso");
  const shouldShowTutorial =
    mode === "uso"
      ? !loadJSON("tutorialSeenUso", false)
      : noPlayData && !loadJSON("tutorialSeen", false);
  // 初回はルール説明を読み終えてから、旧作データの移行を案内する。
  if (shouldShowTutorial) {
    maybeShowFirstTutorial(mode, () => maybeOfferLegacyImport());
  } else {
    maybeOfferLegacyImport();
  }
  // アプリ更新前から 10 回プレイに到達していた人にも、初回のタイトル表示で
  // EXTRA SHOT モードの解放を通知する（通常はゲーム終了時に通知される）。
  if (claimExtraShotUnlockNotice()) extraShotUnlockCelebration();
}

registerScreen("title", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
