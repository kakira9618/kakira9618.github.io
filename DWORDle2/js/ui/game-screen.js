// ゲーム画面。盤面・キーボード・進行管理。
//
// 進行状態 (state): "guess" 入力受付 / "checking" 判定オープン中 / "finish" 終了
//   FINAL ANSWER 有効時はクリア直後に "finalCutin"（カットイン中・入力不可）
//   → "finalGuess"（追加推理の入力受付）→ "finalChecking"（追加推理の判定中）を経て "finish"。
// 原作と同じく、Guess は確定するたびに保存され、リロードしても再開できる。
// 追加推理タイムの途中でリロード・離脱した場合、チャンスは消滅して通常クリアで記録される。

import { el, clear } from "./dom.js";
import { APP_VERSION, UI, FX } from "../config.js?v=20260723-fa";
import { Logic, CELL, usoConvert, queryWordSingle } from "../core/logic.js";
import { MODES, saveCurrentGame, clearCurrentGame, getCurrentGame, addFinishedGame, isAlreadyPlayed, getHistory } from "../core/records.js";
import { pidLabel } from "../core/problems.js";
import { checkOnGameFinish } from "../core/achievements.js?v=20260723-fa";
import { registerScreen, navigate, redirect, getAppMode, currentScreenName } from "./app.js?v=20260723-fa";
import { toast, achievementCelebration, bgmUnlockCelebration, themeUnlockCelebration, finalAnswerUnlockCelebration } from "./toast.js?v=20260723-fa";
import { isFinalAnswerEnabled, claimFinalAnswerUnlockNotice } from "../core/final-answer.js?v=20260723-fa";
import { playFinalAnswerCutin, playDoubleClearCutin, cancelFinalAnswerFx } from "./final-answer-fx.js?v=20260723-fa";
import { bgmTracksUnlockedBy, playSfx } from "../audio/sound.js?v=20260723-fa";
import { hiddenThemesUnlockedBy } from "../core/settings.js?v=20260723-fa";
import { burstAtElement, cancelTileFlights, winBurst, colorForState, flyInTiles } from "../fx/effects.js?v=20260723-fa";
import { showHelpModal } from "./help.js?v=20260723-fa";
import { soundToggleButton } from "./sound-toggle.js?v=20260723-fa";
import { icon } from "./icons.js";
import { tr } from "../core/i18n.js?v=20260723-fa";
import { getSettings } from "../core/settings.js?v=20260723-fa";
import { shouldReduceMotion } from "../core/motion.js?v=20260723-fa";
import { announce, feedbackName, rowAriaLabel, tileAriaLabel } from "./a11y.js?v=20260723-fa";

const KEY_ROWS = [
  [..."qwertyuiop".split(""), "backspace"],
  "asdfghjkl".split(""),
  [..."zxcvbnm".split(""), "enter"],
];

const RESULT_PRIORITY = { guessing: 0, unused: 1, used: 2, correct: 3 };

let root = null;
let boardEl = null;
let boardScrollEl = null;
let keyboardEl = null;
let kbdToggle = null;
let keyboardCollapsed = false; // キーボード折りたたみ状態（セッション中だけ保持）
let headerTitleEl = null;
let seedEl = null;
let counterEl = null;
let resultFab = null;

// ゲーム進行状態
let game = null; // { gameMode, problemID, startTime, guessWord, usoResults }
let logic = null;
let state = "idle";
let inputBuffer = ""; // 入力中の文字
let rows = []; // [{ rowEl, tiles: [tileEl x5] }]
let buttonStates = {}; // キーボードの色状態 (normal モードのみ)
let keyEls = {};
let seedHidden = false;
let finishedRecord = null; // 終了後に結果画面へ渡す
let finalAnswerPhase = null; // FINAL ANSWER 進行状態 { clearedWord, target, attempt: { word, success } | null }
let finalAnswerLeavePromptOpen = false;
let finalAnswerFinishPending = false;
let gatherSession = 0;
let pendingKeys = []; // 判定オープン中の先行入力（次の 1 行分だけ保持）
let lastTouchKey = null; // pointerdown で確定したタッチ入力（合成 click の重複抑止用）
let lastTouchKeyTime = 0;

function build() {
  root = document.getElementById("screen-game");
  clear(root);

  headerTitleEl = el("h1", { class: "title" }, "DWORDle");
  counterEl = el("span", { class: "sub" }, "0 / 10");
  seedEl = el(
    "button",
    { class: "sub", style: { fontWeight: "700" }, "aria-label": tr("問題番号を隠す", "Hide puzzle number"), onclick: toggleSeed },
    "No."
  );
  const header = el(
    "div",
    { class: "header" },
    el(
      "button",
      { class: "icon-btn", "aria-label": tr("タイトルへ戻る", "Back to title"), onclick: requestBackToTitle },
      icon("arrowLeft")
    ),
    headerTitleEl,
    el("span", { class: "spacer" }),
    counterEl,
    seedEl,
    soundToggleButton(),
    el(
      "button",
      { class: "icon-btn", "aria-label": tr("遊び方", "How to play"), onclick: () => showHelpModal(game?.gameMode ?? getAppMode()) },
      "?"
    )
  );

  boardEl = el("div", { id: "board" });
  boardScrollEl = el("div", { id: "board-scroll" }, boardEl);
  installBoardDragScroll();

  keyboardEl = el("div", { id: "keyboard" });
  buildKeyboard();
  kbdToggle = el(
    "button",
    { id: "kbd-toggle", class: "icon-btn", onclick: toggleKeyboardCollapsed },
    icon("triangleDown", 18)
  );
  applyKeyboardCollapsed();

  resultFab = el(
    "button",
    {
      class: "btn btn-primary",
      style: { position: "absolute", bottom: "calc(var(--kbd-h) + 18px)", right: "16px", display: "none", zIndex: 20 },
      onclick: () => {
        if (finishedRecord) navigate(`/result/${finishedRecord.gameMode}/${finishedRecord.startTime}`);
      },
    },
    tr("結果を見る", "View result")
  );

  root.append(header, boardScrollEl, keyboardEl, kbdToggle, resultFab);
}

// キーボード折りたたみ: 盤面を全画面で見たいとき用。状態はセッション中だけ保持する。
// 折りたたみ中も物理キーボードの入力は受け付ける。
function toggleKeyboardCollapsed() {
  keyboardCollapsed = !keyboardCollapsed;
  playSfx("swoosh");
  applyKeyboardCollapsed();
}

function applyKeyboardCollapsed() {
  root.classList.toggle("kbd-collapsed", keyboardCollapsed);
  kbdToggle.setAttribute("aria-expanded", String(!keyboardCollapsed));
  kbdToggle.setAttribute(
    "aria-label",
    keyboardCollapsed ? tr("キーボードを展開", "Expand keyboard") : tr("キーボードを折りたたむ", "Collapse keyboard")
  );
}

function buildKeyboard() {
  clear(keyboardEl);
  keyEls = {};
  KEY_ROWS.forEach((rowKeys, rowIndex) => {
    const row = el("div", { class: `kbd-row row-${rowIndex + 1}` });
    rowKeys.forEach((k) => {
      const label = k === "enter" ? "Enter" : k === "backspace" ? icon("backspace", 20) : k;
      const btn = el(
        "button",
        {
          class: `key ${k.length > 1 ? "wide" : ""}`,
          dataset: { key: k },
          "aria-label": k === "backspace" ? "Backspace" : k === "enter" ? "Enter" : k.toUpperCase(),
          onclick: (event) => {
            // タッチ/ペンの pointerdown ですでに処理済みのタップの合成 click は無視する
            // （抑止が効かない環境での二重入力防止）。キーボード・支援技術の click は通す。
            if (event.timeStamp - lastTouchKeyTime < 700 && lastTouchKey === k) return;
            handleKey(k);
          },
        },
        label
      );
      // タッチ/ペンは押し下げた時点で、モーションが出たキーそのもので確定する（Gboard と同じ）。
      // click（指を離した時点）で確定すると、iOS は離した位置の要素に click を飛ばすため
      // R を押したのに E が入る、指を滑らせると入力が消える、といった食い違いが起きる。
      btn.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return; // マウスは従来どおり click で処理
        event.preventDefault(); // 合成 click を抑止する
        lastTouchKey = k;
        lastTouchKeyTime = event.timeStamp;
        handleKey(k);
      });
      keyEls[k] = btn;
      row.append(btn);
    });
    keyboardEl.append(row);
  });
}

// ホイール／通常のタッチスクロールに加え、盤面をつかんだドラッグでも移動する。
function installBoardDragScroll() {
  let pointerId = null;
  let startY = 0;
  let startScroll = 0;
  let dragging = false;

  boardScrollEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    pointerId = e.pointerId;
    startY = e.clientY;
    startScroll = boardScrollEl.scrollTop;
    dragging = false;
  });
  boardScrollEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    const delta = e.clientY - startY;
    if (!dragging && Math.abs(delta) < 5) return;
    if (!dragging) {
      dragging = true;
      boardScrollEl.setPointerCapture(pointerId);
      boardScrollEl.classList.add("dragging");
    }
    boardScrollEl.scrollTop = startScroll - delta;
    e.preventDefault();
  });
  const stop = (e) => {
    if (e.pointerId !== pointerId) return;
    if (boardScrollEl.hasPointerCapture?.(pointerId)) boardScrollEl.releasePointerCapture(pointerId);
    pointerId = null;
    dragging = false;
    boardScrollEl.classList.remove("dragging");
  };
  boardScrollEl.addEventListener("pointerup", stop);
  boardScrollEl.addEventListener("pointercancel", stop);
}

function toggleSeed() {
  seedHidden = !seedHidden;
  updateHeader();
}

function isFinalAnswerActive() {
  return state === "finalCutin" || state === "finalGuess" || state === "finalChecking";
}

async function requestBackToTitle() {
  playSfx("ui");
  if (!isFinalAnswerActive()) {
    navigate("/");
    return;
  }
  if (finalAnswerLeavePromptOpen) return;
  finalAnswerLeavePromptOpen = true;
  const { confirmModal } = await import("./modal.js?v=20260723-fa");
  const forfeit = await confirmModal(
    tr("FINAL ANSWERを棄権しますか？", "Forfeit FINAL ANSWER?"),
    tr(
      "棄権すると通常クリアとして履歴に記録されます。\nタイトルへ戻りますか？",
      "Forfeiting records this game as a normal clear.\nReturn to the title?"
    )
  );
  finalAnswerLeavePromptOpen = false;
  if (!forfeit) {
    if (finalAnswerFinishPending) {
      finalAnswerFinishPending = false;
      finishGame(true);
    }
    return;
  }
  finalAnswerFinishPending = false;
  forfeitFinalAnswer();
  navigate("/");
}

function updateHeader() {
  const mode = MODES[game.gameMode];
  headerTitleEl.textContent = mode.title;
  const inFinalAnswer = state === "finalCutin" || state === "finalGuess" || state === "finalChecking";
  counterEl.classList.toggle("fa-counter", inFinalAnswer);
  if (inFinalAnswer) {
    counterEl.replaceChildren(el("span", {}, "FINAL"), el("span", {}, "ANSWER"));
    counterEl.setAttribute("aria-label", "FINAL ANSWER");
  } else {
    counterEl.textContent = `${game.guessWord.length + (state === "finish" ? 0 : 1)} / ${mode.maxGuess}`;
    counterEl.removeAttribute("aria-label");
  }
  const label = seedHidden ? "No.????" : pidLabel(game.problemID);
  // "Daily 2026-07-22" のような 2 語ラベルは 2 行 + 小さめの文字で表示し、
  // 狭い端末でもタイトルや右側のボタン群を削らずに収める
  const words = label.split(" ");
  seedEl.classList.toggle("seed-stacked", words.length > 1);
  if (words.length > 1) {
    seedEl.replaceChildren(...words.map((word) => el("span", {}, word)));
  } else {
    seedEl.textContent = label;
  }
  seedEl.setAttribute("aria-label", seedHidden ? tr("問題番号を表示", "Show puzzle number") : tr("問題番号を隠す", "Hide puzzle number"));
}

// ---- ゲーム開始 / 再開 ----

// 新しいゲームを開始して #/game へ
export function startNewGame(pid, mode) {
  const g = {
    version: APP_VERSION,
    startTime: Math.floor(Date.now() / 1000),
    gameMode: mode,
    problemID: pid,
    guessWord: [],
    usoResults: [],
  };
  saveCurrentGame(g);
  navigate("/game");
  if (currentScreenName() === "game") render([]); // 既に #/game にいる場合
}

function render() {
  if (!root) build();
  gatherSession++;
  resultFab.textContent = tr("結果を見る", "View result");
  const mode = getAppMode();
  const current = getCurrentGame(mode);
  if (!current) {
    // navigate だと #/game が履歴に残り、戻るボタンで再リダイレクトの往復になる
    redirect("/");
    return;
  }
  game = current;
  logic = new Logic(game.problemID);
  state = "guess";
  inputBuffer = "";
  pendingKeys = [];
  finishedRecord = null;
  finalAnswerPhase = null;
  finalAnswerLeavePromptOpen = false;
  finalAnswerFinishPending = false;
  resultFab.style.display = "none";
  rows = [];
  clear(boardEl);
  buttonStates = {};
  for (const c of "abcdefghijklmnopqrstuvwxyz") buttonStates[c] = CELL.GUESSING;

  // 過去の Guess を復元
  for (let t = 0; t < game.guessWord.length; t++) {
    const word = game.guessWord[t];
    const result = game.gameMode === "uso" ? game.usoResults[t] : logic.queryWord(word);
    const row = addRow(false);
    for (let i = 0; i < 5; i++) {
      setTile(row.tiles[i], word[i], result[i]);
    }
    if (game.gameMode === "normal") updateButtonStates(word, result);
  }
  applyAllKeyStyles();

  // 決着済みかチェック（リロード対策）
  const last = game.guessWord[game.guessWord.length - 1];
  const maxGuess = MODES[game.gameMode].maxGuess;
  if (last && (logic.isGameClear(last) || game.guessWord.length >= maxGuess)) {
    finishGame(false);
  } else {
    addRow(true);
  }
  updateHeader();
  scrollToBottom();
}

function addRow(animate) {
  const tiles = [];
  for (let i = 0; i < 5; i++) {
    tiles.push(el("div", { class: "tile", role: "img", "aria-label": tileAriaLabel("") }));
  }
  const rowEl = el(
    "div",
    { class: "row", role: "group", "aria-label": tr(`入力 ${rows.length + 1}`, `Guess ${rows.length + 1}`) },
    tiles
  );
  boardEl.append(rowEl);
  const row = { rowEl, tiles, gatherFlight: null };
  rows.push(row);
  if (animate) {
    gatherRow(row);
  } else {
    scrollToBottom();
  }
  return row;
}

// 原作の「タイルが外から集合してくる」演出の 3D 版。
// fx3d キャンバス上でタイル面を透視投影で飛ばし (fx/bursts.js の flyInTiles)、
// 着地した瞬間に本物の DOM タイルへすり替える。
// 着地座標を安定させるため、スクロールは即時に済ませてから飛ばす。
function gatherRow(row) {
  const session = gatherSession;
  if (shouldReduceMotion()) {
    boardScrollEl.scrollTop = boardScrollEl.scrollHeight;
    return;
  }
  row.tiles.forEach((t) => (t.style.opacity = "0"));
  boardScrollEl.scrollTop = boardScrollEl.scrollHeight;
  requestAnimationFrame(() => {
    if (session !== gatherSession || currentScreenName() !== "game") {
      row.tiles.forEach((tile) => (tile.style.opacity = ""));
      return;
    }
    const flight = flyInTiles(
      row.tiles,
      game.gameMode === "uso",
      row.tiles.map((tile) => tile.textContent),
      boardScrollEl
    );
    row.gatherFlight = flight;
    if (flight.skipped) {
      // classic テーマ: 2D の簡易集合
      row.tiles.forEach((tile, i) => {
        tile.style.opacity = "";
        const ang = Math.random() * Math.PI * 2;
        tile.animate(
          [
            { transform: `translate(${Math.cos(ang) * 60}px, ${Math.sin(ang) * 60}px) rotate(${(Math.random() - 0.5) * 40}deg)`, opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 360, delay: i * 40, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)", fill: "backwards" }
        );
      });
      row.gatherFlight = null;
      return;
    }
    flight.onArrive = (i) => {
      const tile = row.tiles[i];
      tile.style.opacity = "";
      tile.animate(
        [{ transform: "scale(1.14)" }, { transform: "scale(1)" }],
        { duration: 150, easing: "ease-out" }
      );
    };
    // 保険: 画面遷移などで着地コールバックが飛んでも必ず可視化する
    flight.promise.then(() => {
      row.tiles.forEach((t) => (t.style.opacity = ""));
      row.gatherFlight = null;
    });
  });
}

function setTile(tile, char, stateName) {
  tile.textContent = char.toUpperCase();
  tile.setAttribute("aria-label", tileAriaLabel(char, stateName));
  if (stateName && stateName !== CELL.GUESSING) {
    tile.classList.remove("filled");
    tile.classList.add(`state-${stateName}`);
  } else {
    tile.classList.add("filled");
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    boardScrollEl.scrollTo({ top: boardScrollEl.scrollHeight, behavior: "smooth" });
  });
}

// ---- 入力処理 ----

function handleKey(k) {
  if (state === "checking") return queuePendingKey(k);
  // カットイン・追加推理の判定中は先行入力も受けない（うっかり Enter で
  // 1 回きりのチャンスを消費させないため、追加推理は必ず手入力で始める）
  if (state !== "guess" && state !== "finalGuess") return;
  if (k === "enter") return state === "finalGuess" ? submitFinalAnswer() : submitGuess();
  if (k === "backspace") {
    if (inputBuffer.length > 0) {
      playSfx("delete");
      inputBuffer = inputBuffer.slice(0, -1);
      const tile = currentRow().tiles[inputBuffer.length];
      tile.textContent = "";
      tile.classList.remove("filled");
      tile.setAttribute("aria-label", tileAriaLabel(""));
      currentRow().gatherFlight?.setText?.(inputBuffer.length, "");
    }
    return;
  }
  if (inputBuffer.length >= 5) return;
  playSfx("key");
  const tile = currentRow().tiles[inputBuffer.length];
  inputBuffer += k;
  setTile(tile, k, null);
  currentRow().gatherFlight?.setText?.(inputBuffer.length - 1, k);
}

function currentRow() {
  return rows[rows.length - 1];
}

// ---- 先行入力（判定オープン中のキーバッファ）----

function pendingBufferLength() {
  let length = 0;
  for (const k of pendingKeys) length += k === "backspace" ? -1 : 1;
  return length;
}

// Enter で確定した次の行より先は、判定を見てから打つべきなので受け付けない
function queuePendingKey(k) {
  if (pendingKeys.includes("enter")) return;
  const length = pendingBufferLength();
  if (k === "enter") {
    if (length === 5) pendingKeys.push(k);
  } else if (k === "backspace") {
    if (length > 0) pendingKeys.push(k);
  } else if (length < 5) {
    pendingKeys.push(k);
  }
}

function flushPendingKeys() {
  const keys = pendingKeys;
  pendingKeys = [];
  for (const k of keys) handleKey(k);
}

function physicalGameKey(e) {
  const key = e.key.toLowerCase();
  if (key === "enter" || key === "backspace" || /^[a-z]$/.test(key)) return key;
  return null;
}

// モーダル・解放ダイアログが開いている間は、背面のゲームへ物理キー入力を流さない
function overlayBlocksInput() {
  return (
    document.getElementById("modal-layer")?.childElementCount > 0 ||
    document.getElementById("unlock-layer")?.classList.contains("is-active")
  );
}

export function handlePhysicalKey(e) {
  if (currentScreenName() !== "game" || (state !== "guess" && state !== "checking" && state !== "finalGuess")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (overlayBlocksInput()) return;
  const key = physicalGameKey(e);
  if (!key) return;
  e.preventDefault();
  keyEls[key]?.classList.add("is-pressed");
  handleKey(key);
}

export function handlePhysicalKeyUp(e) {
  const key = physicalGameKey(e);
  if (key) keyEls[key]?.classList.remove("is-pressed");
}

export function releaseKeyboardPresses() {
  for (const key of Object.values(keyEls)) key.classList.remove("is-pressed");
}

function submitGuess() {
  if (inputBuffer.length !== 5) {
    return rejectGuess("Not enough letters");
  }
  const word = inputBuffer;
  if (!logic.isValidWord(word)) {
    return rejectGuess("Not in word list");
  }

  const trueResult = logic.queryWord(word);
  const shownResult = game.gameMode === "uso" ? trueResult.map((s) => usoConvert(s)) : trueResult;

  game.guessWord.push(word);
  if (game.gameMode === "uso") game.usoResults.push(shownResult);
  saveCurrentGame(game);
  if (game.gameMode === "normal") updateButtonStates(word, trueResult);

  state = "checking";
  revealRow(currentRow(), word, shownResult, () => {
    const maxGuess = MODES[game.gameMode].maxGuess;
    if (logic.isGameClear(word) && isFinalAnswerEnabled()) {
      beginFinalAnswer(word);
    } else if (logic.isGameClear(word) || game.guessWord.length >= maxGuess) {
      finishGame(true);
    } else {
      state = "guess";
      inputBuffer = "";
      addRow(true);
      updateHeader();
      flushPendingKeys();
    }
  });
}

// ---- FINAL ANSWER（クリア後の追加推理タイム）----

// クリアの判定オープン直後に呼ばれる。カットインを流してから追加推理の行を出す。
function beginFinalAnswer(clearedWord) {
  state = "finalCutin";
  pendingKeys = []; // クリア判定中の先行入力は「次の通常 Guess」のつもりなので捨てる
  inputBuffer = "";
  finalAnswerPhase = { clearedWord, target: logic.otherAnswer(clearedWord), attempt: null };
  updateHeader();
  playSfx("finalAnswer");
  announce(
    tr(
      "FINAL ANSWER。当てなかったもう一つの答えを、1 回だけ推理できます。",
      "FINAL ANSWER. You get one guess at the other hidden answer."
    )
  );
  const session = gatherSession;
  playFinalAnswerCutin(game.gameMode === "uso").then(() => {
    if (session !== gatherSession || state !== "finalCutin") return;
    state = "finalGuess";
    const row = addRow(true);
    row.rowEl.classList.add("fa-row");
    row.rowEl.setAttribute("aria-label", tr("FINAL ANSWER 入力", "FINAL ANSWER Guess"));
    updateHeader();
    scrollToBottom();
  });
}

// 追加推理の確定。チャンスは 1 回だけで、成功なら DOUBLE CLEAR として記録される。
function submitFinalAnswer() {
  if (inputBuffer.length !== 5) {
    return rejectGuess("Not enough letters");
  }
  const word = inputBuffer;
  if (!logic.isValidWord(word)) {
    return rejectGuess("Not in word list");
  }
  if (word === finalAnswerPhase.clearedWord) {
    // 当てた方をもう一度入力してもチャンスは消費させず、打ち直しを促す
    return rejectGuess(tr("それはさっき当てた答え！", "You already found that one!"));
  }
  const success = word === finalAnswerPhase.target;
  finalAnswerPhase.attempt = { word, success };
  state = "finalChecking";
  // 判定は残る答え 1 語だけとの比較。DWORDlie でもここは真実を表示する（最後の開示）。
  const result = queryWordSingle(word, finalAnswerPhase.target);
  const row = currentRow();
  const session = gatherSession;
  const beginReveal = () => {
    if (session !== gatherSession) return;
    row.rowEl.classList.remove("fa-charging");
    revealRow(row, word, result, () => {
      if (finalAnswerLeavePromptOpen) {
        finalAnswerFinishPending = true;
        return;
      }
      finishGame(true);
    });
  };
  if (shouldReduceMotion()) {
    beginReveal();
  } else {
    // ドラムロールのタメ。タイルが小さく震え、太鼓が鳴り止んだ直後に判定が開く
    playSfx("drumroll");
    row.rowEl.classList.add("fa-charging");
    setTimeout(beginReveal, FX.finalAnswer.drumrollMs);
  }
}

function rejectGuess(message) {
  playSfx("invalid");
  toast(message);
  const row = currentRow().rowEl;
  row.classList.remove("shake");
  void row.offsetWidth; // アニメーション再トリガ
  row.classList.add("shake");
}

// タイルを 1 枚ずつフリップして判定を開く。
// 画面離脱・再描画で gatherSession が進んだら、残っているタイマは何もしない
// （古い done が新しい盤面へ作用したり、離脱後に音や演出が鳴るのを防ぐ）。
function revealRow(row, word, result, done) {
  const session = gatherSession;
  const finalAnswerReveal = state === "finalChecking";
  const revealDelay = (index) =>
    index * UI.revealIntervalMs + (finalAnswerReveal && index === 4 ? FX.finalAnswer.lastTilePauseMs : 0);
  if (shouldReduceMotion()) {
    result.forEach((stateName, i) => {
      const tile = row.tiles[i];
      tile.classList.remove("reveal", "filled");
      tile.classList.add(`state-${stateName}`);
      tile.setAttribute("aria-label", tileAriaLabel(word[i], stateName));
      if (game.gameMode === "normal") applyKeyStyle(word[i]);
    });
    playSfx(result.includes(CELL.CORRECT) ? "revealCorrect" : result.includes(CELL.USED) ? "revealUsed" : "revealUnused");
    announce(rowAriaLabel(word, result));
    setTimeout(() => {
      if (session === gatherSession) done();
    }, 0);
    return;
  }
  result.forEach((stateName, i) => {
    setTimeout(() => {
      if (session !== gatherSession) return;
      const tile = row.tiles[i];
      tile.classList.add("reveal");
      setTimeout(() => {
        if (session !== gatherSession) return;
        tile.classList.add(`state-${stateName}`);
        tile.setAttribute("aria-label", tileAriaLabel(word[i], stateName));
        playSfx(stateName === CELL.CORRECT ? "revealCorrect" : stateName === CELL.USED ? "revealUsed" : "revealUnused");
        burstAtElement(tile, colorForState(stateName), FX.burst.countPerTile[stateName] ?? 7);
        if (game.gameMode === "normal") applyKeyStyle(word[i]);
      }, UI.revealFlipMs / 2);
      setTimeout(() => {
        // forwards の3Dアニメーション状態を残すと、Safariが各タイルを恒久的な
        // GPUレイヤーとして扱い、画面外から戻した際に再描画が遅れる。
        tile.classList.remove("reveal", "filled");
      }, UI.revealFlipMs + 20);
    }, revealDelay(i));
  });
  setTimeout(() => {
    if (session !== gatherSession) return;
    announce(rowAriaLabel(word, result));
    done();
  }, 5 * UI.revealIntervalMs
    + (finalAnswerReveal ? FX.finalAnswer.lastTilePauseMs : 0)
    + UI.revealFlipMs / 2
    + UI.afterRevealPauseMs);
}

// ---- キーボード色 ----

function updateButtonStates(word, result) {
  for (let i = 0; i < 5; i++) {
    const c = word[i];
    if (RESULT_PRIORITY[buttonStates[c]] < RESULT_PRIORITY[result[i]]) {
      buttonStates[c] = result[i];
    }
  }
}

function applyKeyStyle(c) {
  const btn = keyEls[c];
  if (!btn) return;
  btn.classList.remove("state-unused", "state-used", "state-correct");
  if (game?.gameMode === "normal" && getSettings().keyboardHints && buttonStates[c] !== CELL.GUESSING) {
    btn.classList.add(`state-${buttonStates[c]}`);
    btn.setAttribute("aria-label", tr(`${c.toUpperCase()}、${feedbackName(buttonStates[c])}`, `${c.toUpperCase()}, ${feedbackName(buttonStates[c])}`));
  } else {
    btn.setAttribute("aria-label", c.toUpperCase());
  }
}

function applyAllKeyStyles() {
  for (const c of "abcdefghijklmnopqrstuvwxyz") applyKeyStyle(c);
}

// ---- 終了処理 ----

function persistFinishedGame({ includeFinalAnswer = true } = {}) {
  const hadLostBefore = getHistory().some(
    (g) => g.gameMode === game.gameMode && g.problemID === game.problemID && !g.clear
  );
  const record = addFinishedGame({
    version: game.version,
    startTime: game.startTime,
    endTime: Math.floor(Date.now() / 1000),
    gameMode: game.gameMode,
    problemID: game.problemID,
    guessWord: game.guessWord.slice(),
    usoResults: game.gameMode === "uso" ? game.usoResults.slice() : undefined,
    // 棄権・リロード復帰は通常クリアとして扱い、FINAL ANSWER の記録を付けない。
    finalAnswer: includeFinalAnswer && finalAnswerPhase?.attempt
      ? { word: finalAnswerPhase.attempt.word, success: finalAnswerPhase.attempt.success }
      : undefined,
  });
  clearCurrentGame(game.gameMode);
  finishedRecord = record;

  const results = game.guessWord.map((w) => logic.queryWord(w));
  const newly = checkOnGameFinish({
    record,
    results,
    durationSec: record.endTime - record.startTime,
    endDate: new Date(record.endTime * 1000),
    maxGuess: MODES[game.gameMode].maxGuess,
    hadLostBefore,
  });
  return { record, newly };
}

function showFinishUnlocks(newly) {
  if (newly.length > 0) {
    achievementCelebration(newly);
    const bgmUnlocks = bgmTracksUnlockedBy(newly);
    if (bgmUnlocks.length > 0) bgmUnlockCelebration(bgmUnlocks);
    hiddenThemesUnlockedBy(newly).forEach(themeUnlockCelebration);
  }
  if (claimFinalAnswerUnlockNotice()) finalAnswerUnlockCelebration();
}

// FINAL ANSWER 中に画面を離れたら、追加推理は棄権し、元のゲームだけを通常クリアで確定する。
function forfeitFinalAnswer() {
  if (!isFinalAnswerActive()) return null;
  state = "finish";
  pendingKeys = [];
  finalAnswerFinishPending = false;
  cancelFinalAnswerFx();
  const settled = persistFinishedGame({ includeFinalAnswer: false });
  finalAnswerPhase = null;
  announce(tr("FINAL ANSWERを棄権し、通常クリアとして記録しました。", "FINAL ANSWER forfeited. Recorded as a normal clear."));
  queueMicrotask(() => showFinishUnlocks(settled.newly));
  return settled.record;
}

function finishGame(justFinished) {
  state = "finish";
  pendingKeys = []; // 決着後に持ち越された先行入力は捨てる
  finalAnswerFinishPending = false;
  updateHeader();

  const lastWord = game.guessWord[game.guessWord.length - 1];
  const cleared = logic.isGameClear(lastWord);
  const { record, newly } = persistFinishedGame({ includeFinalAnswer: justFinished });

  if (justFinished) {
    const doubleCleared = Boolean(record.finalAnswer?.success);
    if (doubleCleared) {
      // 大成功: 専用ファンファーレ + 金色の DOUBLE CLEAR カットイン + 金色バースト
      playSfx("doubleClear");
      playDoubleClearCutin();
      winBurst(FX.finalAnswer.burstColors);
      announce(tr("大成功！DOUBLE CLEAR！両方の答えを当てました。", "DOUBLE CLEAR! You found both answers."));
    } else if (cleared) {
      playSfx("win");
      winBurst([colorForState(CELL.CORRECT), colorForState(CELL.USED), 0x00d5ff]);
    } else {
      playSfx("lose");
    }

    // 演出の後にまず結果画面へ進み、その上で解放通知を表示する。
    // 待機中にユーザーが別画面へ移動していたら（gatherSession が進む）、
    // その操作を上書きしないよう強制遷移はやめ、解放通知だけを表示する。
    const session = gatherSession;
    setTimeout(() => {
      if (session === gatherSession) navigate(`/result/${record.gameMode}/${record.startTime}`);
      showFinishUnlocks(newly);
    }, doubleCleared ? FX.finalAnswer.resultDelayMs : cleared ? 1400 : 900);
  } else {
    // リロード等で復帰した決着済みゲームも、棄権扱いの通常クリアとして完全に確定する。
    resultFab.style.display = "";
    queueMicrotask(() => showFinishUnlocks(newly));
  }
}

// すでにプレイ済みなら確認してから開始する（原作の確認ダイアログ相当）
export async function confirmAndStart(pid, mode) {
  const today = new Date().toDateString();
  const playedToday = getHistory().some((record) => {
    if (record.problemID !== pid) return false;
    const endTime = Number(record.endTime);
    const startTime = Number(record.startTime);
    const playedAt = Number.isFinite(endTime) && endTime > 0 ? endTime : startTime;
    return Number.isFinite(playedAt) && new Date(playedAt * 1000).toDateString() === today;
  });
  if (isAlreadyPlayed(pid, mode) || playedToday) {
    // 注意: 動的 import にも必ず ?v= トークンを付ける。素の URL だと古いキャッシュの
    // modal.js（旧トークンで sound.js を import する）が混ざり、BGM が二重再生される。
    const { confirmModal } = await import("./modal.js?v=20260723-fa");
    const label = pidLabel(pid);
    const countNote = playedToday
      ? tr(
          "\n\n※この問題は本日プレイ済みです。今回のプレイは、プレイ数・勝利数などのカウント系実績に加算されず、隠し実績の判定対象にもなりません。",
          "\n\nThis puzzle has already been played today. This play will not count toward play, win, or other count-based achievement totals, and will not be checked for secret achievements."
        )
      : "";
    const ok = await confirmModal(
      tr("プレイ済みの問題", "Puzzle already played"),
      tr(`${label} はすでにプレイしています。\nもう一度プレイしますか？`, `${label} has already been played.\nPlay it again?`) + countNote
    );
    if (!ok) return false;
  }
  const current = getCurrentGame(mode);
  if (current && current.guessWord.length > 0) {
    const { confirmModal } = await import("./modal.js?v=20260723-fa");
    const ok = await confirmModal(
      tr("進行中のゲーム", "Game in progress"),
      tr(
        `${pidLabel(current.problemID)} のゲームが進行中です。\n破棄して新しいゲームを始めますか？`,
        `${pidLabel(current.problemID)} is in progress.\nDiscard it and start a new game?`
      )
    );
    if (!ok) return false;
  }
  startNewGame(pid, mode);
  return true;
}

registerScreen("game", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
  onLeave() {
    // ブラウザの戻る操作やハッシュ遷移など、ヘッダーボタン以外の離脱も棄権として確定する。
    if (isFinalAnswerActive()) forfeitFinalAnswer();
    gatherSession++;
    pendingKeys = [];
    cancelTileFlights();
    cancelFinalAnswerFx();
    rows.forEach((row) => {
      row.tiles.forEach((tile) => (tile.style.opacity = ""));
      row.gatherFlight = null;
    });
    releaseKeyboardPresses();
  },
});
