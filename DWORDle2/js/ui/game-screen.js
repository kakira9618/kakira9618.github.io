// ゲーム画面。盤面・キーボード・進行管理。
//
// 進行状態 (state): "guess" 入力受付 / "checking" 判定オープン中 / "finish" 終了
// 原作と同じく、Guess は確定するたびに保存され、リロードしても再開できる。

import { el, clear } from "./dom.js";
import { APP_VERSION, UI, FX } from "../config.js?v=20260722-ios-save";
import { Logic, CELL, usoConvert } from "../core/logic.js";
import { MODES, saveCurrentGame, clearCurrentGame, getCurrentGame, addFinishedGame, isAlreadyPlayed, getHistory } from "../core/records.js";
import { pidLabel } from "../core/problems.js";
import { checkOnGameFinish } from "../core/achievements.js?v=20260722-ios-save";
import { registerScreen, navigate, redirect, getAppMode, currentScreenName, rememberPlayedMode } from "./app.js?v=20260722-ios-save";
import { toast, achievementCelebration, bgmUnlockCelebration, themeUnlockCelebration } from "./toast.js?v=20260722-ios-save";
import { bgmTracksUnlockedBy, playSfx } from "../audio/sound.js?v=20260722-ios-save";
import { hiddenThemesUnlockedBy } from "../core/settings.js?v=20260722-ios-save";
import { burstAtElement, cancelTileFlights, winBurst, colorForState, flyInTiles } from "../fx/effects.js?v=20260722-ios-save";
import { showHelpModal } from "./help.js?v=20260722-ios-save";
import { soundToggleButton } from "./sound-toggle.js?v=20260722-ios-save";
import { icon } from "./icons.js";
import { tr } from "../core/i18n.js?v=20260722-ios-save";
import { getSettings } from "../core/settings.js?v=20260722-ios-save";
import { shouldReduceMotion } from "../core/motion.js?v=20260722-ios-save";
import { announce, feedbackName, rowAriaLabel, tileAriaLabel } from "./a11y.js?v=20260722-ios-save";

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
let gatherSession = 0;
let pendingKeys = []; // 判定オープン中の先行入力（次の 1 行分だけ保持）

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
      { class: "icon-btn", "aria-label": tr("タイトルへ戻る", "Back to title"), onclick: () => { playSfx("ui"); navigate("/"); } },
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
    rowKeys.forEach((k) => {
      const label = k === "enter" ? "Enter" : k === "backspace" ? icon("backspace", 20) : k;
      const btn = el(
        "button",
        {
          class: `key ${k.length > 1 ? "wide" : ""}`,
          dataset: { key: k },
          "aria-label": k === "backspace" ? "Backspace" : k === "enter" ? "Enter" : k.toUpperCase(),
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
  if (state !== "guess") return;
  if (k === "enter") return submitGuess();
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
  if (currentScreenName() !== "game" || (state !== "guess" && state !== "checking")) return;
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
    if (logic.isGameClear(word) || game.guessWord.length >= maxGuess) {
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
    }, i * UI.revealIntervalMs);
  });
  setTimeout(() => {
    if (session !== gatherSession) return;
    announce(rowAriaLabel(word, result));
    done();
  }, 5 * UI.revealIntervalMs + UI.revealFlipMs / 2 + UI.afterRevealPauseMs);
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

function finishGame(justFinished) {
  state = "finish";
  pendingKeys = []; // 決着後に持ち越された先行入力は捨てる
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

    // 演出の後にまず結果画面へ進み、その上で解放通知を表示する。
    // 待機中にユーザーが別画面へ移動していたら（gatherSession が進む）、
    // その操作を上書きしないよう強制遷移はやめ、解放通知だけを表示する。
    const session = gatherSession;
    setTimeout(() => {
      if (session === gatherSession) navigate(`/result/${record.gameMode}/${record.startTime}`);
      if (newly.length > 0) {
        achievementCelebration(newly);
        const bgmUnlocks = bgmTracksUnlockedBy(newly);
        if (bgmUnlocks.length > 0) {
          bgmUnlockCelebration(bgmUnlocks);
        }
        hiddenThemesUnlockedBy(newly).forEach(themeUnlockCelebration);
      }
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
    const { confirmModal } = await import("./modal.js?v=20260722-ios-save");
    const label = pidLabel(pid);
    const countNote = playedToday
      ? tr(
          "\n\n※この問題は本日プレイ済みです。今回のプレイは、プレイ数・勝利数などのカウント系実績には加算されません。",
          "\n\nThis puzzle has already been played today. This play will not be added to play, win, or other count-based achievement totals."
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
    const { confirmModal } = await import("./modal.js?v=20260722-ios-save");
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
    gatherSession++;
    pendingKeys = [];
    cancelTileFlights();
    rows.forEach((row) => {
      row.tiles.forEach((tile) => (tile.style.opacity = ""));
      row.gatherFlight = null;
    });
    releaseKeyboardPresses();
  },
});
