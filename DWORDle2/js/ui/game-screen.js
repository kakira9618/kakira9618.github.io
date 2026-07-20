// ゲーム画面。盤面・キーボード・進行管理。
//
// 進行状態 (state): "guess" 入力受付 / "checking" 判定オープン中 / "finish" 終了
// 原作と同じく、Guess は確定するたびに保存され、リロードしても再開できる。

import { el, clear } from "./dom.js";
import { APP_VERSION, UI, FX } from "../config.js";
import { Logic, CELL, usoConvert } from "../core/logic.js";
import { MODES, saveCurrentGame, clearCurrentGame, getCurrentGame, addFinishedGame, isAlreadyPlayed, getHistory } from "../core/records.js";
import { pidLabel } from "../core/problems.js";
import { checkOnGameFinish } from "../core/achievements.js";
import { registerScreen, navigate, getAppMode, currentScreenName, rememberPlayedMode } from "./app.js";
import { toast, achievementToast, bgmUnlockCelebration } from "./toast.js";
import { bgmTracksUnlockedBy, playSfx } from "../audio/sound.js";
import { burstAtElement, winBurst, colorForState, flyInTiles } from "../fx/bursts.js";
import { showHelpModal } from "./help.js";
import { icon } from "./icons.js";
import { tr } from "../core/i18n.js";

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

function build() {
  root = document.getElementById("screen-game");
  clear(root);

  headerTitleEl = el("div", { class: "title" }, "DWORDle");
  counterEl = el("span", { class: "sub" }, "0 / 10");
  seedEl = el("button", { class: "sub", style: { fontWeight: "700" }, onclick: toggleSeed }, "No.");
  const header = el(
    "div",
    { class: "header" },
    el("button", { class: "icon-btn", onclick: () => { playSfx("ui"); navigate("/"); } }, icon("arrowLeft")),
    headerTitleEl,
    el("span", { class: "spacer" }),
    counterEl,
    seedEl,
    el("button", { class: "icon-btn", onclick: () => showHelpModal(game?.gameMode ?? getAppMode()) }, "?")
  );

  boardEl = el("div", { id: "board" });
  boardScrollEl = el("div", { id: "board-scroll" }, boardEl);
  installBoardDragScroll();

  keyboardEl = el("div", { id: "keyboard" });
  buildKeyboard();

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

  root.append(header, boardScrollEl, keyboardEl, resultFab);
}

function buildKeyboard() {
  clear(keyboardEl);
  keyEls = {};
  KEY_ROWS.forEach((rowKeys, rowIndex) => {
    const row = el("div", { class: `kbd-row row-${rowIndex + 1}` });
    rowKeys.forEach((k, keyIndex) => {
      const label = k === "enter" ? "Enter" : k === "backspace" ? icon("backspace", 20) : k;
      const gridColumn = rowIndex === 0
        ? (k === "backspace" ? "12" : String(keyIndex + 1))
        : rowIndex === 1
          ? String(keyIndex + 2)
          : (k === "enter" ? "11 / span 2" : String(keyIndex + 2));
      const btn = el(
        "button",
        {
          class: `key ${k.length > 1 ? "wide" : ""}`,
          dataset: { key: k },
          style: { gridColumn },
          "aria-label": k === "backspace" ? "Backspace" : k,
          onclick: () => handleKey(k),
        },
        label
      );
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

function updateHeader() {
  const mode = MODES[game.gameMode];
  headerTitleEl.textContent = mode.title;
  counterEl.textContent = `${game.guessWord.length + (state === "finish" ? 0 : 1)} / ${mode.maxGuess}`;
  seedEl.textContent = seedHidden ? "No.????" : pidLabel(game.problemID);
}

// ---- ゲーム開始 / 再開 ----

// 新しいゲームを開始して #/game へ
export function startNewGame(pid, mode) {
  rememberPlayedMode(mode);
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
  resultFab.textContent = tr("結果を見る", "View result");
  const mode = getAppMode();
  const current = getCurrentGame(mode);
  if (!current) {
    navigate("/");
    return;
  }
  game = current;
  logic = new Logic(game.problemID);
  state = "guess";
  inputBuffer = "";
  finishedRecord = null;
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
  for (let i = 0; i < 5; i++) tiles.push(el("div", { class: "tile" }));
  const rowEl = el("div", { class: "row" }, tiles);
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
  row.tiles.forEach((t) => (t.style.opacity = "0"));
  boardScrollEl.scrollTop = boardScrollEl.scrollHeight;
  requestAnimationFrame(() => {
    const rects = row.tiles.map((t) => t.getBoundingClientRect());
    const flight = flyInTiles(
      rects,
      game.gameMode === "uso",
      row.tiles.map((tile) => tile.textContent)
    );
    row.gatherFlight = flight;
    if (flight.skipped) {
      // classic テーマ / パーティクルオフ時: 2D の簡易集合
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
  tile.classList.add("filled");
  if (stateName && stateName !== CELL.GUESSING) tile.classList.add(`state-${stateName}`);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    boardScrollEl.scrollTo({ top: boardScrollEl.scrollHeight, behavior: "smooth" });
  });
}

// ---- 入力処理 ----

function handleKey(k) {
  if (state !== "guess") return;
  if (k === "enter") return submitGuess();
  if (k === "backspace") {
    if (inputBuffer.length > 0) {
      playSfx("delete");
      inputBuffer = inputBuffer.slice(0, -1);
      const tile = currentRow().tiles[inputBuffer.length];
      tile.textContent = "";
      tile.classList.remove("filled");
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

export function handlePhysicalKey(e) {
  if (currentScreenName() !== "game") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "enter") handleKey("enter");
  else if (k === "backspace") handleKey("backspace");
  else if (/^[a-z]$/.test(k)) handleKey(k);
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
    if (logic.isGameClear(word) || game.guessWord.length >= maxGuess) {
      finishGame(true);
    } else {
      state = "guess";
      inputBuffer = "";
      addRow(true);
      updateHeader();
    }
  });
}

function rejectGuess(message) {
  playSfx("invalid");
  toast(message);
  const row = currentRow().rowEl;
  row.classList.remove("shake");
  void row.offsetWidth; // アニメーション再トリガ
  row.classList.add("shake");
}

// タイルを 1 枚ずつフリップして判定を開く
function revealRow(row, word, result, done) {
  result.forEach((stateName, i) => {
    setTimeout(() => {
      const tile = row.tiles[i];
      tile.classList.add("reveal");
      setTimeout(() => {
        tile.classList.add(`state-${stateName}`);
        playSfx(stateName === CELL.CORRECT ? "revealCorrect" : stateName === CELL.USED ? "revealUsed" : "revealUnused");
        burstAtElement(tile, colorForState(stateName), FX.burst.countPerTile[stateName] ?? 7);
        if (game.gameMode === "normal") applyKeyStyle(word[i]);
      }, UI.revealFlipMs / 2);
    }, i * UI.revealIntervalMs);
  });
  setTimeout(done, 5 * UI.revealIntervalMs + UI.revealFlipMs / 2 + UI.afterRevealPauseMs);
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
  if (buttonStates[c] !== CELL.GUESSING) btn.classList.add(`state-${buttonStates[c]}`);
}

function applyAllKeyStyles() {
  for (const c of "abcdefghijklmnopqrstuvwxyz") applyKeyStyle(c);
}

// ---- 終了処理 ----

function finishGame(justFinished) {
  state = "finish";
  updateHeader();

  const lastWord = game.guessWord[game.guessWord.length - 1];
  const cleared = logic.isGameClear(lastWord);

  if (justFinished) {
    // 履歴へ保存
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
    });
    clearCurrentGame(game.gameMode);
    finishedRecord = record;

    // 実績判定
    const results = game.guessWord.map((w) => logic.queryWord(w));
    const newly = checkOnGameFinish({
      record,
      results,
      durationSec: record.endTime - record.startTime,
      endDate: new Date(record.endTime * 1000),
      maxGuess: MODES[game.gameMode].maxGuess,
      hadLostBefore,
    });

    if (cleared) {
      playSfx("win");
      winBurst([colorForState(CELL.CORRECT), colorForState(CELL.USED), 0x00d5ff]);
    } else {
      playSfx("lose");
    }

    // 演出の後に結果画面へ
    setTimeout(() => {
      if (newly.length > 0) {
        achievementToast(newly);
        const bgmUnlocks = bgmTracksUnlockedBy(newly);
        if (bgmUnlocks.length > 0) {
          bgmUnlockCelebration(bgmUnlocks, newly.length * 700 + 3400);
        }
      }
      navigate(`/result/${record.gameMode}/${record.startTime}`);
    }, cleared ? 1400 : 900);
  } else {
    // リロード等で復帰した決着済みゲーム: 履歴に保存だけして結果ボタンを出す
    const record = addFinishedGame({
      version: game.version,
      startTime: game.startTime,
      endTime: Math.floor(Date.now() / 1000),
      gameMode: game.gameMode,
      problemID: game.problemID,
      guessWord: game.guessWord.slice(),
      usoResults: game.gameMode === "uso" ? game.usoResults.slice() : undefined,
    });
    clearCurrentGame(game.gameMode);
    finishedRecord = record;
    resultFab.style.display = "";
  }
}

// すでにプレイ済みなら確認してから開始する（原作の確認ダイアログ相当）
export async function confirmAndStart(pid, mode) {
  if (isAlreadyPlayed(pid, mode)) {
    const { confirmModal } = await import("./modal.js");
    const label = pidLabel(pid);
    const ok = await confirmModal(
      tr("プレイ済みの問題", "Puzzle already played"),
      tr(`${label} はすでにプレイしています。\nもう一度プレイしますか？`, `${label} has already been played.\nPlay it again?`)
    );
    if (!ok) return false;
  }
  const current = getCurrentGame(mode);
  if (current && current.guessWord.length > 0) {
    const { confirmModal } = await import("./modal.js");
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
});
