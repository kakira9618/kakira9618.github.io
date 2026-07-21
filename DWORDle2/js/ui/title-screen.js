// タイトル画面。モード選択・問題選択の入り口。
// 右上のマスクボタンで DWORDlie（裏モード）に切り替わる。

import { el, clear } from "./dom.js";
import { registerScreen, navigate, getAppMode, setAppMode } from "./app.js?v=20260721-pop-achievements";
import { getCurrentGame, getHistory, isAlreadyPlayed } from "../core/records.js";
import { LEVELS, todayPID, isValidPID, pidLabel, PID } from "../core/problems.js";
import { getSettings, setSetting } from "../core/settings.js";
import { loadJSON, saveJSON } from "../core/store.js";
import { importFromLocalStorage, scanLegacyHistory } from "../core/migrate.js";
import { playSfx } from "../audio/sound.js";
import { toast } from "./toast.js?v=20260721-pop-achievements";
import { showModal } from "./modal.js";
import { finishHistoryImport } from "./history-import.js?v=20260721-pop-achievements";
import { showFirstTutorial, showHelpModal } from "./help.js?v=20260721-ux-input";
import { confirmAndStart } from "./game-screen.js?v=20260721-pop-achievements";
import { icon } from "./icons.js";
import { APP_VERSION } from "../config.js";
import { localizedLevel, tr } from "../core/i18n.js";

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

function numberPrompt(mode) {
  const suggestion = randomPID(PID.EASY_MIN, PID.EASY_MAX, mode);
  const input = el("input", { type: "number", value: String(suggestion), min: "0", max: "39999" });
  showModal({
    title: tr("番号を指定してプレイ", "Play by puzzle number"),
    body: [
      input,
      el(
        "p",
        { class: "hint" },
        tr("No.0: 今日のデイリー問題", "No.0: Today's Daily puzzle"), el("br"),
        tr("No.1-9999: やさしい / No.10000-19999: 極", "No.1–9999: Easy / No.10000–19999: Extreme"), el("br"),
        tr("No.20000-39999: レベル別", "No.20000–39999: Level-based")
      ),
    ],
    actions: [
      { label: tr("キャンセル", "Cancel"), onClick: () => {} },
      {
        label: tr("スタート", "Start"),
        primary: true,
        onClick: () => {
          let pid = parseInt(input.value, 10);
          if (pid === 0) pid = todayPID();
          if (!isValidPID(pid)) {
            toast(tr("0〜39999 の番号を入力してください", "Enter a number from 0 to 39999"));
            return false;
          }
          confirmAndStart(pid, mode);
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
    title: tr("ランダムにプレイ（難しさを選択）", "Random puzzle — Choose difficulty"),
    body: LEVELS.map((lv) => {
      const localized = localizedLevel(lv);
      return el(
          "button",
          {
            class: `btn ${lv.id === lastLevel ? "btn-primary" : ""}`,
            style: { width: "100%", justifyContent: "space-between" },
            onclick: () => {
              setSetting("randomLevel", lv.id);
              confirmAndStart(randomPID(lv.range[0], lv.range[1], mode), mode);
            },
          },
          el("span", {}, `Lv.${lv.id} ${localized.name}${lv.id === lastLevel ? tr("（前回）", " (last)") : ""}`),
          el("span", { class: "hint" }, localized.desc)
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
          "履歴はマージされ、既存データは上書きされません。対応する実績も自動で解放されます。",
          "History is merged without overwriting existing data, and supported achievements are unlocked automatically."
        )
      ),
    ],
    actions: [
      { label: tr("スキップ", "Skip"), onClick: () => {} },
      {
        label: tr("インポート", "Import"),
        primary: true,
        onClick: () => finishHistoryImport(importFromLocalStorage()),
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

function render() {
  if (!root) build();
  clear(root);
  const mode = getAppMode();
  const isUso = mode === "uso";
  const current = getCurrentGame(mode);
  const hasOngoing = current && current.guessWord.length > 0;

  const menuBtn = (iconName, label, onclick, primary = false) =>
    el("button", { class: `btn ${primary ? "btn-primary" : ""}`, onclick }, icon(iconName), label);

  root.append(
    el("div", { style: { position: "absolute", top: "14px", right: "14px", display: "flex", gap: "8px" } },
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
      )
    ),
    el(
      "div",
      { class: "title-brand" },
      el("div", { class: "uso-banner" }, tr("う そ ぴ ょ ん", "J U S T  K I D D I N G")),
      el("div", { class: "logo" }, isUso ? "DWORDlie" : "DWORDle", el("span", { class: "two" }, " 2"))
    ),
    el(
      "div",
      { class: "tagline" },
      isUso
        ? tr("答えは 2 つ。判定は必ず嘘。15 手以内に見抜け。", "Two answers. Every clue lies. See through it in 15 Guesses.")
        : tr("答えが 2 つある Wordle。10 手以内に「どちらか」を当てろ。", "Wordle with two answers. Find either one in 10 Guesses.")
    ),
    el(
      "div",
      { class: "title-menu" },
      hasOngoing
        ? menuBtn(
            "play",
            tr(
              `つづきから（${pidLabel(current.problemID)}・${current.guessWord.length}手）`,
              `Continue (${pidLabel(current.problemID)} · ${current.guessWord.length} ${current.guessWord.length === 1 ? "Guess" : "Guesses"})`
            ),
            () => { playSfx("ui"); navigate("/game"); },
            true
          )
        : null,
      menuBtn("calendar", tr("デイリー問題", "Daily puzzle"), () => { playSfx("ui"); confirmAndStart(todayPID(), mode); }, !hasOngoing),
      menuBtn("dice", tr("ランダム（難しさを選択）", "Random (choose difficulty)"), () => { playSfx("ui"); randomPrompt(mode); }),
      menuBtn("hash", tr("番号を指定", "Choose puzzle number"), () => { playSfx("ui"); numberPrompt(mode); })
    ),
    el(
      "div",
      { class: "title-nav" },
      menuBtn("clock", tr("プレイ履歴", "Play History"), () => { playSfx("ui"); navigate("/history"); }),
      menuBtn("grid", tr("問題一覧", "Puzzles"), () => { playSfx("ui"); navigate("/problems"); }),
      menuBtn("medal", tr("実績", "Achievements"), () => { playSfx("ui"); navigate("/achievements"); }),
      menuBtn("gear", tr("設定", "Settings"), () => { playSfx("ui"); navigate("/settings"); })
    ),
    el("div", { class: "app-version", title: "DWORDle 2 version" }, `v${APP_VERSION}`)
  );
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
}

registerScreen("title", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
