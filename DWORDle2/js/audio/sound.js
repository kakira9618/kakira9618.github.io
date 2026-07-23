// 効果音・BGM。すべて WebAudio でリアルタイム合成する（音源ファイル不要）。
//
// - 効果音: playSfx(name)。設定 sfx=false なら無音。
// - BGM: トラックごとのバスを必要になった時だけ作る生成音楽。
//   曲の実体は TRACKS（テンポ・コード進行・1 小節のスケジューラ）に定義する。
//   設定やモード切替時はバスをクロスフェードしてシームレスに移行する。

import { AUDIO } from "../config.js?v=20260723-swup";
import { getSettings, onSettingsChange } from "../core/settings.js?v=20260723-swup";

let ctx = null;
let masterGain = null;
let sfxGain = null;
let bgmGain = null;
let buses = new Map(); // trackId -> GainNode（遅延生成）
let usoEcho = null; // uso 曲のフィードバックディレイ。バスごとに 1 つだけ作って全ノートで共有する
let bgmRunning = false;
let bgmTimer = null;
let usoMood = false;

// 設定画面と解放演出でも使う BGM カタログ。
// unlockAchievement がある曲は、その実績を獲得するまで選択できない。
export const BGM_TRACKS = [
  {
    id: "auto",
    name: "モード連動",
    nameEn: "Follow mode",
    desc: "プレイ中のモードとテーマに合う曲を自動で選択",
    descEn: "Automatically choose the track for the current mode and theme",
  },
  {
    id: "normal",
    name: "DWORDle",
    nameEn: "DWORDle",
    desc: "サイバーテーマの表の曲。明るいネオン・アンビエント",
    descEn: "The Cyber theme's normal-mode track: bright neon ambient",
  },
  {
    id: "uso",
    name: "DWORDlie",
    nameEn: "DWORDlie",
    desc: "サイバーテーマの裏の曲。暗く不穏なドローン",
    descEn: "The Cyber theme's uso-mode track: a dark, ominous drone",
  },
  {
    id: "classic",
    name: "Classic 8-bit",
    nameEn: "Classic 8-bit",
    desc: "クラシックテーマの表の曲。原作を思わせる軽快なチップチューン",
    descEn: "The Classic theme's normal-mode track: an upbeat chiptune inspired by the original",
  },
  {
    id: "darkbit",
    name: "Glitch 8-bit",
    nameEn: "Glitch 8-bit",
    desc: "クラシックテーマの裏の曲。軽快なチップチューンが短調に歪むダーク8bit",
    descEn: "The Classic theme's uso-mode track: the upbeat chiptune warped into a dark minor key",
  },
  {
    id: "pop",
    name: "Candy Pop",
    nameEn: "Candy Pop",
    desc: "Pop テーマの表の曲。甘く弾むキャンディポップ",
    descEn: "The Pop theme's normal-mode track: a sweet, bouncy candy-pop tune",
    unlockAchievement: "rainbow",
    unlockLabel: "三色盛り",
    unlockLabelEn: "Three Colors",
  },
  {
    id: "bitter",
    name: "Bitter Candy",
    nameEn: "Bitter Candy",
    desc: "Pop テーマの裏の曲。甘さに毒がにじむダークなキャンディポップ",
    descEn: "The Pop theme's uso-mode track: a candy-pop tune with poison under the sweetness",
    unlockAchievement: "rainbow",
    unlockLabel: "三色盛り",
    unlockLabelEn: "Three Colors",
  },
  {
    id: "gentle",
    name: "Moonlit Calm",
    nameEn: "Moonlit Calm",
    desc: "カリンバとオルゴールが爪弾く、やさしい夜想曲",
    descEn: "A gentle nocturne of plucked kalimba and music box",
    unlockAchievement: "first-play",
    unlockLabel: "はじめの一歩",
    unlockLabelEn: "First Step",
  },
  {
    id: "retro",
    name: "Letter Minuet",
    nameEn: "Letter Minuet",
    desc: "羽根ペンの手紙のような優雅なチェンバロのメヌエット",
    descEn: "An elegant harpsichord minuet, like a letter penned with a quill",
  },
  {
    id: "glitch",
    name: "Letter Lament",
    nameEn: "Letter Lament",
    desc: "半音ずつ沈むラメント・バスと弔鐘の暗いチェンバロ",
    descEn: "A dark harpsichord lament sinking over a chromatic bass and a tolling bell",
  },
  {
    id: "parade",
    name: "Star Parade",
    nameEn: "Star Parade",
    desc: "明るく弾むポップマーチ",
    descEn: "A bright, bouncy pop march",
    unlockAchievement: "daily-clear",
    unlockLabel: "今日の一問",
    unlockLabelEn: "Daily Dose",
  },
  {
    id: "rush",
    name: "Neon Rush",
    nameEn: "Neon Rush",
    desc: "7/8 拍子で駆け抜ける疾走のシンセウェーブ",
    descEn: "A driving synthwave sprint in 7/8 time",
    unlockAchievement: "speed-60",
    unlockLabel: "スピードスター",
    unlockLabelEn: "Speed Star",
  },
  {
    id: "deepsea",
    name: "Deep Dive",
    nameEn: "Deep Dive",
    desc: "5/4 拍子の波間に鯨の歌が響く深海アンビエント",
    descEn: "A deep-sea ambient in 5/4, with whale song in the waves",
    unlockAchievement: "slow-10",
    unlockLabel: "熟考の人",
    unlockLabelEn: "Deep Thinker",
  },
  {
    id: "velvet",
    name: "Midnight Velvet",
    nameEn: "Midnight Velvet",
    desc: "エレピとウォーキングベースが揺れる真夜中のジャズ",
    descEn: "Midnight jazz with electric piano and a walking bass",
    unlockAchievement: "night-owl",
    unlockLabel: "真夜中のDWORDler",
    unlockLabelEn: "Midnight DWORDler",
  },
  {
    id: "march",
    name: "Victory March",
    nameEn: "Victory March",
    desc: "静かなトリオを挟んで凱旋するファンファーレ行進曲",
    descEn: "A triumphant fanfare march with a quiet trio section",
    unlockAchievement: "wins-10",
    unlockLabel: "勝ち星コレクター",
    unlockLabelEn: "Win Collector",
  },
  {
    id: "abyssgate",
    name: "Abyss Gate",
    nameEn: "Abyss Gate",
    desc: "聖歌と銅鑼が響く、深淵の門の荘厳なドローン",
    descEn: "A solemn drone of chants and gongs at the gate of the abyss",
    unlockAchievement: "extreme-clear",
    unlockLabel: "語彙の深淵",
    unlockLabelEn: "Vocabulary Abyss",
  },
  {
    id: "waltz",
    name: "Waltz of Lies",
    nameEn: "Waltz of Lies",
    desc: "アコーディオンが軋む、嘘つきたちのダークワルツ",
    descEn: "A dark accordion waltz for liars",
    unlockAchievement: "uso-5",
    unlockLabel: "嘘マスター",
    unlockLabelEn: "Lie Master",
  },
  {
    id: "lofi",
    name: "Rainy Bookshop",
    nameEn: "Rainy Bookshop",
    desc: "雨音とテープの揺れに包まれる本屋のローファイ",
    descEn: "Bookshop lo-fi wrapped in rain and tape wobble",
    unlockAchievement: "plays-100",
    unlockLabel: "習うより慣れろ",
    unlockLabelEn: "Practice Makes Perfect",
  },
  {
    id: "carnival",
    name: "Bit Carnival",
    nameEn: "Bit Carnival",
    desc: "お祭り騒ぎのにぎやかチップチューン",
    descEn: "A festive, busy chiptune carnival",
    unlockAchievement: "revenge",
    unlockLabel: "リベンジ",
    unlockLabelEn: "Revenge",
  },
  {
    id: "aurora",
    name: "Aurora",
    nameEn: "Aurora",
    desc: "聴くたびに旋律が生まれ変わる、夜空の生成曲",
    descEn: "A generative night sky whose melody is never the same twice",
    unlockAchievement: "streak-5",
    unlockLabel: "連勝街道",
    unlockLabelEn: "Winning Road",
  },
  {
    id: "morning",
    name: "Morning Light",
    nameEn: "Morning Light",
    desc: "6/8 拍子で小鳥がさえずる、夜明けのパストラル",
    descEn: "A daybreak pastoral in 6/8 with birdsong",
    unlockAchievement: "early-bird",
    unlockLabel: "早起きDWORDler",
    unlockLabelEn: "Early Bird",
  },
  {
    id: "finale",
    name: "Grand Finale",
    nameEn: "Grand Finale",
    desc: "転調で駆け上がる、実績ハンターに贈る祝祭のフィナーレ",
    descEn: "A celebratory finale for achievement hunters, modulating ever upward",
    unlockAchievement: "collector",
    unlockLabel: "実績ハンター",
    unlockLabelEn: "Achievement Hunter",
  },
];

export function bgmTracksUnlockedBy(achievements) {
  const ids = new Set(achievements.map((achievement) => achievement.id));
  return BGM_TRACKS.filter((track) => track.unlockAchievement && ids.has(track.unlockAchievement));
}

// テーマごとの表 / 裏の既定曲。モード連動（auto）ではテーマとモードの両方から選ぶ。
const THEME_TRACKS = {
  cyber: { normal: "normal", uso: "uso" },
  classic: { normal: "classic", uso: "darkbit" },
  pop: { normal: "pop", uso: "bitter" },
};

function selectedTrack() {
  const settings = getSettings();
  const wanted = settings.bgmTrack;
  if (wanted === "auto" || !BGM_TRACKS.some((track) => track.id === wanted)) {
    const themeTracks = THEME_TRACKS[settings.theme] ?? THEME_TRACKS.cyber;
    return usoMood ? themeTracks.uso : themeTracks.normal;
  }
  return wanted;
}

// 現在の設定・モードで実際に再生される曲の id（「モード連動」の解決結果。
// プレイヤーカード等、再生系の外から曲名を表示したいとき用）
export function currentBgmTrackId() {
  return selectedTrack();
}

function volumeGain(base, value) {
  return base * (Math.min(100, Math.max(0, Number(value) || 0)) / 100);
}

function sfxTargetGain(settings = getSettings()) {
  return volumeGain(AUDIO.sfxGain, settings.sfxVolume);
}

function bgmTargetGain(settings = getSettings()) {
  return volumeGain(AUDIO.bgmGain, settings.bgmVolume);
}

// トラック用のバスを必要になった時に作る。選択中のトラックだけ音量 1 で始める。
function busFor(trackId) {
  let bus = buses.get(trackId);
  if (!bus) {
    bus = ctx.createGain();
    bus.gain.value = trackId === selectedTrack() ? 1 : 0;
    bus.connect(bgmGain);
    buses.set(trackId, bus);
  }
  return bus;
}

// フィードバック循環 (delay <-> fb) は互いの接続参照で生き続け GC されないため、
// バスを捨てるときに明示的に切って音声グラフから確実に消す。
function disposeUsoEcho() {
  if (!usoEcho) return;
  try {
    usoEcho.fb.disconnect();
    usoEcho.delay.disconnect();
  } catch {
    // 切断済みでも残りの状態は初期化する。
  }
  usoEcho = null;
}

// 予約済みの音源は接続先の旧バスごと切り離し、次の小節だけを新しいバスへ予約する。
// 高速なモード切替や BGM の再開で、過去と現在の小節が重なり続けるのを防ぐ。
function resetBgmBuses() {
  disposeUsoEcho();
  for (const bus of buses.values()) {
    bus.disconnect();
  }
  buses = new Map();
}

function clearAudioContextReferences() {
  if (bgmTimer) clearTimeout(bgmTimer);
  bgmTimer = null;
  bgmRunning = false;
  disposeUsoEcho();
  for (const node of [...buses.values(), bgmGain, sfxGain, masterGain]) {
    try {
      node?.disconnect();
    } catch {
      // Safari がすでに切断済みのノードを返しても、残りの状態は初期化する。
    }
  }
  // iOS Safari は同時 AudioContext 数に厳しい上限があるため、
  // 参照を捨てる前に閉じて枠をブラウザへ返す（生成途中で失敗した場合など）。
  try {
    if (ctx && ctx.state !== "closed") ctx.close?.()?.catch(() => {});
  } catch {
    // close に失敗しても参照の初期化は続行する。
  }
  ctx = null;
  masterGain = null;
  sfxGain = null;
  bgmGain = null;
  buses = new Map();
  nextBarTime = 0;
  barIndex = 0;
  bgmScheduleStartBar = 0;
}

// タブ・ページを閉じるとき、鳴っている最中の音が AudioContext の破棄で途中切断され、
// 出力の不連続がポップノイズ（プーという音）として聞こえるのを防ぐ。
// pagehide（閉じる・遷移・リロードで発火）の時点でマスターを瞬時にフェードアウトし、
// 破棄までの残り時間を無音で埋める。bfcache 入りしたページへ戻ってきた場合は
// pageshow（persisted）でフェードインして元の音量に戻す。
const UNLOAD_FADE_SEC = 0.05;
let unloadFadeInstalled = false;

function installUnloadFade() {
  if (unloadFadeInstalled) return;
  unloadFadeInstalled = true;
  // テスト環境（window のスタブ）ではリスナー登録自体を省略する
  window.addEventListener?.("pagehide", () => {
    if (!ctx || ctx.state !== "running" || !masterGain) return;
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(0, t + UNLOAD_FADE_SEC);
  });
  window.addEventListener?.("pageshow", (event) => {
    if (!event?.persisted || !ctx || ctx.state !== "running" || !masterGain) return;
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(AUDIO.masterGain, t + UNLOAD_FADE_SEC);
  });
}

function ensureContext() {
  if (ctx?.state === "closed") clearAudioContextReferences();
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = AUDIO.masterGain;
    masterGain.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxTargetGain();
    sfxGain.connect(masterGain);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0;
    bgmGain.connect(masterGain);
    buses = new Map();
  } catch {
    // iOS Safari の同時 AudioContext 上限などで生成に失敗した場合は次の操作で再試行する。
    clearAudioContextReferences();
    return null;
  }
  installUnloadFade();
  return ctx;
}

function resumeAudioContext() {
  if (!ensureContext() || ctx.state === "closed") return Promise.resolve(false);
  if (ctx.state === "running") return Promise.resolve(true);
  const resumingContext = ctx;
  let resumeResult;
  try {
    // 自動再生制限を解除できるよう、ユーザー操作のイベント処理中に直接呼び出す。
    // Safari では Promise が未完了のまま残ることがあるため、操作間では共有しない。
    resumeResult = resumingContext.resume();
  } catch {
    return Promise.resolve(false);
  }
  return Promise.resolve(resumeResult)
    // Safari は一時的に interrupted のまま resolve することがある。
    // ここでは閉じず、次のユーザー操作で同じ Context の resume を再試行する。
    .then(() => ctx === resumingContext && resumingContext.state === "running")
    .catch(() => false);
}

// 最初のユーザー操作で呼ぶ（main.js が登録する）。
// Safari 向けに、ユーザー操作中に音源を予約してから AudioContext を resume する。
export function unlockAudio({ restartBgm = false } = {}) {
  const audioContext = ensureContext();
  if (!audioContext) return Promise.resolve(false);
  const wasRunning = audioContext.state === "running";
  // 原作同様、まずユーザー操作中に resume() を呼び、その直後に音源を予約する。
  const ready = resumeAudioContext();

  // iOS Safari では resume() の Promise 完了後に初めて音源を作ると無音になることがある。
  // Promise は待たず、ユーザー操作の呼び出しスタック内でBGMを予約する。
  if (getSettings().bgm) {
    if (restartBgm) stopBgm();
    startBgm();
  }

  ready.then((isReady) => {
    if (!isReady || !getSettings().bgm) return;
    if (!wasRunning) {
      // interrupted 中に予約時刻が過ぎた場合に備え、復帰時刻を基準に予約し直す。
      // 同期予約で進んだ小節位置だけが残ると 3 小節目から始まってしまうため、
      // 現在のスケジュールが始まった位置へ戻してから予約し直す。
      // （resume 待ちの間に曲選択が小節位置を曲頭へ戻していることもあるため、
      // このコールバック開始時点ではなくスケジュール開始位置を正とする。）
      stopBgm();
      barIndex = bgmScheduleStartBar;
      startBgm();
    } else if (!bgmRunning) {
      startBgm();
    }
  });
  return ready;
}

// 常設の入力ハンドラから、Safari の音声状態だけを軽量に確認する。
export function audioNeedsRecovery() {
  if (!ctx || ctx.state !== "running") return true;
  return getSettings().bgm && !bgmRunning;
}

// バックグラウンド復帰時、Safari が AudioContext を自動復帰できた場合だけ即時再開する。
// suspended / interrupted の場合は false を返し、次のユーザー操作で unlockAudio する。
export function restartBgmIfReady() {
  if (!ctx || ctx.state !== "running" || !getSettings().bgm) return false;
  stopBgm();
  startBgm();
  return true;
}

// 表 / 裏の切替。予約済みの旧バスを破棄してから新しいモードを再生する。
export function setUsoMood(v) {
  if (usoMood === v) return;
  usoMood = v;
  if (!ctx) return;
  const followsMode = getSettings().bgmTrack === "auto";
  if (followsMode) refreshBgmMix(true);
  if (bgmRunning && followsMode && getSettings().sfx) transitionSweep(v);
}

function refreshBgmMix(restartSchedule = false) {
  if (!ctx) return;
  if (restartSchedule && bgmRunning) {
    if (bgmTimer) clearTimeout(bgmTimer);
    resetBgmBuses();
    nextBarTime = ctx.currentTime + 0.08;
    barIndex = 0;
    bgmScheduleStartBar = 0;
    bgmLoop();
    return;
  }
  const t = ctx.currentTime;
  const FADE = AUDIO.bgmCrossfadeSec;
  const active = selectedTrack();
  busFor(active); // まだ無ければ作ってからクロスフェードする
  for (const [id, bus] of buses) {
    const on = id === active;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(on ? 1 : 0, t + FADE);
  }
}

// モード切替のトランジション音（フィルタ付きノイズのライザー）
function transitionSweep(toUso) {
  const t0 = ctx.currentTime;
  const dur = 0.9;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 2.5;
  f.frequency.setValueAtTime(toUso ? 2400 : 300, t0);
  f.frequency.exponentialRampToValueAtTime(toUso ? 220 : 2600, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.14, t0 + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(sfxGain);
  src.start(t0);
}

// ---- 効果音 ----

function tone({ freq = 440, type = "sine", dur = 0.15, gain = 0.5, attack = 0.004, when = 0, detune = 0, slide = 0, dest = null }) {
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  osc.detune.value = detune;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(dest ?? sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.12, gain = 0.25, freq = 2000, when = 0, q = 1.2, dest = null }) {
  const t0 = ctx.currentTime + when;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(dest ?? sfxGain);
  src.start(t0);
}

const SFX = {
  key: () => {
    // 高域ノイズを使わず、低めの丸い音を短く重ねた柔らかな打鍵音。
    tone({ freq: 620, type: "sine", dur: 0.075, gain: 0.17, attack: 0.01, slide: -70 });
    tone({ freq: 880, type: "triangle", dur: 0.05, gain: 0.055, attack: 0.008, when: 0.004, slide: -90 });
  },
  delete: () => tone({ freq: 700, type: "triangle", dur: 0.05, gain: 0.2 }),
  revealUnused: () => tone({ freq: 220, type: "sine", dur: 0.14, gain: 0.3 }),
  revealUsed: () => {
    tone({ freq: 520, type: "triangle", dur: 0.16, gain: 0.32 });
    tone({ freq: 780, type: "sine", dur: 0.12, gain: 0.16, when: 0.02 });
  },
  revealCorrect: () => {
    tone({ freq: 660, type: "triangle", dur: 0.18, gain: 0.34 });
    tone({ freq: 990, type: "sine", dur: 0.2, gain: 0.22, when: 0.03 });
    noise({ dur: 0.1, gain: 0.06, freq: 6000 });
  },
  invalid: () => {
    tone({ freq: 190, type: "sawtooth", dur: 0.16, gain: 0.24 });
    tone({ freq: 150, type: "sawtooth", dur: 0.2, gain: 0.24, when: 0.09 });
  },
  // 施錠中メニューの拒否音: 鍵をガチャガチャ揺らすような短い金属音 2 連
  locked: () => {
    noise({ dur: 0.045, gain: 0.18, freq: 3400, q: 2.6 });
    tone({ freq: 130, type: "triangle", dur: 0.07, gain: 0.2 });
    noise({ dur: 0.05, gain: 0.14, freq: 2300, q: 2.6, when: 0.08 });
    tone({ freq: 110, type: "triangle", dur: 0.08, gain: 0.16, when: 0.08 });
  },
  // 隠し要素の解放音: 鍵がカチャッと回ってラッチが開き、キラッと光る。
  // メニューの段階解放（錠前が開く瞬間）・隠しテーマ・Extra BGM で共通に使う。
  unlock: () => {
    // 鍵を回す金属クリック
    noise({ dur: 0.04, gain: 0.16, freq: 3200, q: 2.8 });
    tone({ freq: 150, type: "triangle", dur: 0.06, gain: 0.18 });
    // ラッチが開く「ガチャッ」
    noise({ dur: 0.06, gain: 0.2, freq: 1900, q: 2.2, when: 0.11 });
    tone({ freq: 100, type: "triangle", dur: 0.1, gain: 0.24, when: 0.11 });
    // 開放のきらめき（上昇する空虚 5 度 + 高域シャワー）
    [1318.5, 1975.5, 2637].forEach((f, i) =>
      tone({ freq: f, type: "sine", dur: 0.32, gain: 0.14, when: 0.2 + i * 0.055 })
    );
    noise({ dur: 0.35, gain: 0.04, freq: 7500, when: 0.22 });
  },
  win: () => {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      tone({ freq: f, type: "triangle", dur: 0.5, gain: 0.3, when: i * 0.1 });
      tone({ freq: f * 2, type: "sine", dur: 0.4, gain: 0.1, when: i * 0.1 + 0.02 });
    });
    noise({ dur: 0.8, gain: 0.05, freq: 8000, when: 0.35 });
  },
  lose: () => {
    [392, 349.23, 311.13, 261.63].forEach((f, i) =>
      tone({ freq: f, type: "sawtooth", dur: 0.4, gain: 0.16, when: i * 0.22 })
    );
  },
  achievement: () => {
    [880, 1108.7, 1318.5, 1760].forEach((f, i) =>
      tone({ freq: f, type: "sine", dur: 0.35, gain: 0.22, when: i * 0.08 })
    );
  },
  // 実績セレブレーション用の大きめファンファーレ（上昇アルペジオ + 和音 + シャワー）
  achievementBig: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone({ freq: f, type: "triangle", dur: 0.32, gain: 0.22, when: i * 0.09 });
      tone({ freq: f * 2, type: "sine", dur: 0.26, gain: 0.08, when: i * 0.09 + 0.02 });
    });
    [1046.5, 1318.5, 1568].forEach((f, i) =>
      tone({ freq: f, type: "sine", dur: 0.95, gain: 0.15, when: 0.4 + i * 0.02 })
    );
    tone({ freq: 2093, type: "sine", dur: 0.7, gain: 0.07, when: 0.46 });
    noise({ dur: 0.9, gain: 0.05, freq: 8500, when: 0.42 });
  },
  ui: () => tone({ freq: 880, type: "sine", dur: 0.06, gain: 0.15 }),
  // 遊び方を開いたときの音（ページめくり風のスウッシュ + 問いかけるような上昇 2 音）
  help: () => {
    noise({ dur: 0.22, gain: 0.08, freq: 1400, q: 0.9 });
    tone({ freq: 587.33, type: "triangle", dur: 0.16, gain: 0.2, when: 0.03 });
    tone({ freq: 880, type: "sine", dur: 0.22, gain: 0.16, when: 0.13 });
  },
  swoosh: () => noise({ dur: 0.25, gain: 0.12, freq: 1200 }),
};

export function playSfx(name) {
  if (!getSettings().sfx) return;
  if (!ensureContext()) return;
  if (ctx.state === "running") {
    SFX[name]?.();
    return;
  }
  // Safari のユーザー操作中に resume() を呼び、そのまま SE を予約する。
  // 完了後まで待つと、Safari が音声開始を自動再生として拒否することがある。
  unlockAudio();
  if (getSettings().sfx) SFX[name]?.();
}

// ---- BGM（生成音楽）----
//
// テーマごとに表 / 裏の専用曲を持つ（THEME_TRACKS 参照）。
//   サイバー:   normal（明るいアンビエント）/ uso（遅く暗いドローン）
//   クラシック: classic（原作風チップチューン）/ darkbit（短調に歪むダーク 8bit）
//   Pop:        pop（キャンディポップ）/ bitter（ダークなキャンディポップ）
// lookahead 方式で小節単位にスケジュールし、トラックごとに専用バスへ流す。

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const NORMAL = {
  tempo: 92,
  chords: [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [48, 52, 55], // C
    [55, 59, 62], // G
  ],
};
const USO = {
  tempo: 72,
  chords: [
    [57, 60, 64], // Am
    [56, 60, 63], // 減和音寄り
    [53, 56, 60], // Fm
    [52, 56, 59], // E
  ],
};
let nextBarTime = 0;
let barIndex = 0;
// 現在の予約スケジュールが始まった小節位置。barIndex は予約のたびに進むため、
// suspend 中の同期予約を破棄して予約し直すとき（unlockAudio の resume 完了
// コールバック）はここまで巻き戻す。途中で曲選択などが barIndex をリセット
// した場合も、最後にスケジュールを始めた位置が正になる。
let bgmScheduleStartBar = 0;

// 表モードの 1 小節
function scheduleBarNormal(t0, chord, bar, bus) {
  const beat = 60 / NORMAL.tempo;
  // パッド: デチューンした saw + ゆっくり開閉するローパス
  for (const m of chord) {
    for (const det of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiHz(m);
      osc.detune.value = det;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(300, t0);
      f.frequency.linearRampToValueAtTime(900, t0 + beat * 2);
      f.frequency.linearRampToValueAtTime(300, t0 + beat * 4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.4);
      g.gain.setValueAtTime(0.05, t0 + beat * 4 - 0.5);
      g.gain.linearRampToValueAtTime(0, t0 + beat * 4);
      osc.connect(f).connect(g).connect(bus);
      osc.start(t0);
      osc.stop(t0 + beat * 4 + 0.1);
    }
  }
  // ベース
  {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiHz(chord[0] - 24);
    const g = ctx.createGain();
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * beat;
      g.gain.setValueAtTime(0.0001, tb);
      g.gain.exponentialRampToValueAtTime(0.16, tb + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, tb + beat * 0.85);
    }
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 4 + 0.1);
  }
  // 上昇気味のアルペジオ (16 分) + ディレイ
  const arpNotes = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 0, 2, 1, 2];
  for (let i = 0; i < 16; i++) {
    const ti = t0 + (i * beat) / 4;
    const m = chord[arpNotes[i]] + 12 + (i % 8 === 7 ? 12 : 0);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiHz(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ti);
    g.gain.linearRampToValueAtTime(0.06, ti + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ti + beat / 4 + 0.12);
    const delay = ctx.createDelay();
    delay.delayTime.value = beat * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.25;
    osc.connect(g);
    g.connect(bus);
    g.connect(delay);
    delay.connect(fb).connect(bus);
    osc.start(ti);
    osc.stop(ti + 0.5);
  }
}

// 裏モードの 1 小節（暗く・遅く・不穏に）
function scheduleBarUso(t0, chord, bar, bus) {
  const beat = 60 / USO.tempo;
  // 低音ドローン: ルート + 5 度、たまにトライトーンが忍び寄る
  const droneNotes = [chord[0] - 24, chord[0] - 17];
  if (bar % 4 >= 2) droneNotes.push(chord[0] - 18); // 減5度で不穏さを足す
  for (const m of droneNotes) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiHz(m);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(160, t0);
    f.frequency.linearRampToValueAtTime(420, t0 + beat * 2);
    f.frequency.linearRampToValueAtTime(160, t0 + beat * 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.075, t0 + 0.8);
    g.gain.setValueAtTime(0.075, t0 + beat * 4 - 0.8);
    g.gain.linearRampToValueAtTime(0, t0 + beat * 4);
    osc.connect(f).connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 4 + 0.1);
  }
  // クラスタ気味のパッド（半音でぶつけて揺らす）
  for (const [m, det] of [[chord[1], -8], [chord[1] + 1, 8], [chord[2], -4]]) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiHz(m);
    osc.detune.value = det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.03, t0 + beat);
    g.gain.linearRampToValueAtTime(0.012, t0 + beat * 3);
    g.gain.linearRampToValueAtTime(0, t0 + beat * 4);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 4 + 0.1);
  }
  // 下降アルペジオ（8 分・まばら・長いディレイ）
  // ディレイはノートごとに作らず、バスごとの共有フィードバックエコー 1 本に流す
  // （線形なので音は同じ。ノート数ぶんの delay/fb 循環がグラフに残留しない）。
  if (!usoEcho || usoEcho.bus !== bus) {
    disposeUsoEcho();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = beat * 1.5;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    delay.connect(fb).connect(bus);
    fb.connect(delay);
    usoEcho = { bus, delay, fb };
  }
  const pattern = [2, -1, 1, 0, 2, -1, 0, 1]; // -1 = 休符
  for (let i = 0; i < 8; i++) {
    if (pattern[i] < 0) continue;
    const ti = t0 + (i * beat) / 2;
    const m = chord[2 - pattern[i]] + 12;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiHz(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ti);
    g.gain.linearRampToValueAtTime(0.055, ti + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ti + beat * 0.9);
    osc.connect(g);
    g.connect(bus);
    g.connect(usoEcho.delay);
    osc.start(ti);
    osc.stop(ti + 1.2);
  }
  // まばらな鐘（2 小節に 1 回、高い減和音の倍音）
  if (bar % 2 === 0) {
    const ti = t0 + beat * (bar % 4 === 0 ? 1.5 : 3);
    for (const [ratio, gv] of [[1, 0.05], [2.76, 0.02], [5.4, 0.012]]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = midiHz(chord[0] + 24) * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ti);
      g.gain.linearRampToValueAtTime(gv, ti + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ti + 2.2);
      osc.connect(g).connect(bus);
      osc.start(ti);
      osc.stop(ti + 2.4);
    }
  }
}

// Moonlit Calm: FM カリンバとオルゴールの夜想曲。7th/9th の和声 8 小節をゆっくり巡り、
// フレーズの終わりで音数を減らして呼吸する。
function scheduleBarGentle(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.gentle.tempo;
  const resting = bar % 8 === 7; // フレーズ末は音数を減らして呼吸する
  // 暖かいパッド: ルートと 7th を中心に、ごく浅いビブラートで揺れる
  for (const [i, m] of chord.entries()) {
    bgmTone(bus, { midi: m, t: t0, dur: beat * 4, type: "sine", gain: i < 2 ? 0.042 : 0.028, attack: beat, vibHz: 3.2, vibCents: i % 2 ? 5 : 4 });
  }
  // サブベース: ルートに置き、フレーズ中はオクターブや 5 度へそっと動く
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * (resting ? 4 : 2.4), type: "sine", gain: 0.08, attack: 0.04 });
  if (!resting) bgmTone(bus, { midi: chord[0] - 24 + (bar % 2 ? 7 : 12), t: t0 + beat * 2.5, dur: beat * 1.4, type: "sine", gain: 0.05, attack: 0.04 });
  // FM カリンバのアルペジオ（フレーズ末はまばらに）
  const arp = [0, 2, 1, 3, 0, 3, 1, 2];
  arp.forEach((deg, i) => {
    if (resting && i % 2 === 1) return;
    bgmFm(bus, { midi: chord[deg % chord.length] + 12, t: t0 + (i * beat) / 2, dur: beat * 1.1, gain: 0.036, ratio: 3.6, index: 1.4, bright: 0.09 });
  });
  // オルゴール: 2 小節ごとに高音で歌う短い旋律
  if (bar % 2 === 0) {
    const tune = [[3, 2], [1, 3], [2, 0], [3, 1]][Math.floor(bar / 2) % 4];
    tune.forEach((deg, i) => {
      bgmFm(bus, { midi: chord[deg % chord.length] + 24, t: t0 + (1 + i * 1.5) * beat, dur: beat * 1.6, gain: 0.024, ratio: 4, index: 2.2, bright: 0.05 });
    });
  }
}

// Classic 8-bit: bVII の借用和音と V/V を交えた 16 小節構成（A メロ 8 + B メロ 8）のチップチューン。
// 矩形波 2 本を薄くデチューンしてパルス波風の厚みを出し、B メロは 1 オクターブ上で歌う。
function scheduleBarClassic(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.classic.tempo;
  const section = Math.floor(bar / 8) % 2; // 0: A メロ, 1: B メロ
  // ベース: 8 分のチップチューンライン。B メロは 5 度と 7 度で駆け上がる
  const bassLine = section ? [0, 7, 12, 7, 0, 7, 10, 12] : [0, 12, 7, 12, 0, 12, 7, 12];
  bassLine.forEach((interval, i) => {
    bgmTone(bus, { midi: chord[0] - 24 + interval, t: t0 + (i * beat) / 2, dur: beat * 0.34, type: "triangle", gain: 0.09, attack: 0.006 });
  });
  // ドラム: 丸いキック（1・3 拍）、ノイズスネア（2・4 拍）、8 分裏の軽いハット
  for (const b of [0, 2]) bgmTone(bus, { midi: 36, t: t0 + b * beat, dur: 0.1, type: "sine", gain: 0.1, bend: -14 });
  for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.07, gain: 0.03, freq: 4200, q: 0.8 });
  for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + ((i + 0.5) * beat) / 2, dur: 0.03, gain: 0.012, freq: 9000 });
  // セクションの変わり目は 16 分ロールのフィルで告げる
  if (bar % 8 === 7) {
    for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + (2 + i * 0.25) * beat, dur: 0.04, gain: 0.016 + i * 0.003, freq: 5000, q: 0.8 });
  }
  // 裏打ちの和音スタブ（2 拍目・4 拍目の裏に短く）
  for (const b of [1.5, 3.5]) {
    for (const m of chord) {
      bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.2, type: "square", gain: 0.008, attack: 0.004 });
    }
  }
  // リード: 4 小節でひとまとまりのフレーズ（コード構成音 2 オクターブへの度数。-1 = 休符）
  const degrees = [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12, chord[2] + 12];
  const phrases = [
    [3, 4, 5, 4, 3, -1, 2, 3],
    [4, 3, 2, 3, 4, -1, 4, 5],
    [3, -1, 4, 5, 3, 2, 3, -1],
    [4, 5, 4, 3, 2, 3, -1, -1], // 後半はフィルに譲る
  ];
  const lift = section ? 12 : 0;
  phrases[bar % 4].forEach((deg, i) => {
    if (deg < 0) return;
    const ti = t0 + (i * beat) / 2;
    for (const det of [-8, 8]) {
      bgmTone(bus, { midi: degrees[deg] + lift, t: ti, dur: beat * 0.36, type: "square", gain: 0.013, attack: 0.006, detune: det });
    }
    // NES 風エコー: 付点 8 分遅れで同じ音を小さく繰り返す
    bgmTone(bus, { midi: degrees[deg] + lift, t: ti + beat * 0.75, dur: beat * 0.3, type: "square", gain: 0.008, attack: 0.006 });
  });
  // 4 小節目の最後に 16 分の駆け上がりフィル
  if (bar % 4 === 3) {
    [2, 3, 4, 5].forEach((deg, i) => {
      bgmTone(bus, { midi: degrees[deg] + lift, t: t0 + (3 + i * 0.25) * beat, dur: beat * 0.2, type: "square", gain: 0.024, attack: 0.004 });
    });
  }
}

// クラシックテーマの裏の曲 Glitch 8-bit: Classic 8-bit と対になるダークチップチューン。
// 同じ NES 編成（三角波ベース・ノイズドラム・デチューン矩形波リード + エコー）のまま
// 短調へ歪み、ベースは半音経過音で沈み、リードはまれに半音下へベンドして「嘘」をつく。
function scheduleBarDarkbit(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.darkbit.tempo;
  const section = Math.floor(bar / 8) % 2; // 0: A メロ, 1: B メロ
  // ベース: 8 分のチップチューンライン。A メロは減 5 度・半音経過音で影を差し、
  // B メロは長 7 度で不穏に駆け上がる
  const bassLine = section ? [0, 7, 12, 7, 0, 7, 11, 12] : [0, 12, 7, 12, 0, 12, 6, 7];
  bassLine.forEach((interval, i) => {
    bgmTone(bus, { midi: chord[0] - 24 + interval, t: t0 + (i * beat) / 2, dur: beat * 0.34, type: "triangle", gain: 0.09, attack: 0.006 });
  });
  // ドラム: 丸いキック（1・3 拍）、スネアは 4 拍目を半拍うしろへ倒して足を引っ掛ける
  for (const b of [0, 2]) bgmTone(bus, { midi: 36, t: t0 + b * beat, dur: 0.1, type: "sine", gain: 0.1, bend: -14 });
  for (const b of [1, 3.5]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.07, gain: 0.03, freq: 3400, q: 0.8 });
  // ハットはまばらに置き、2 小節ごとの裏拍でグリッチノイズがざらりと走る
  for (const i of [1, 3, 5, 7]) bgmNoise(bus, { t: t0 + ((i + 0.5) * beat) / 2, dur: 0.03, gain: 0.01, freq: 7800 });
  if (bar % 2 === 1) bgmNoise(bus, { t: t0 + 2.5 * beat, dur: 0.09, gain: 0.02, freq: 5200, q: 0.6 });
  // 裏打ちの和音スタブ（表より暗く、2 拍目裏だけに絞る）
  for (const m of chord) {
    bgmTone(bus, { midi: m, t: t0 + 1.5 * beat, dur: beat * 0.2, type: "square", gain: 0.008, attack: 0.004 });
  }
  // リード: 下降癖のある短調フレーズ（コード構成音 2 オクターブへの度数。-1 = 休符）
  const degrees = [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12, chord[2] + 12];
  const phrases = [
    [3, 2, 1, 2, 3, -1, 4, 3],
    [2, 3, 4, 3, 2, -1, 1, 0],
    [3, -1, 2, 1, 0, 1, 2, -1],
    [4, 3, 2, 1, 2, 0, -1, -1], // 後半はフィルに譲る
  ];
  const lift = section ? 12 : 0;
  phrases[bar % 4].forEach((deg, i) => {
    if (deg < 0) return;
    const ti = t0 + (i * beat) / 2;
    const lies = (bar * 8 + i) % 11 === 7; // まれに音程が半音下へ折れて嘘をつく
    for (const det of [-8, 8]) {
      bgmTone(bus, { midi: degrees[deg] + lift, t: ti, dur: beat * 0.36, type: "square", gain: 0.013, attack: 0.006, detune: det, bend: lies ? -1 : 0 });
    }
    // NES 風エコー: 付点 8 分遅れで同じ音を小さく繰り返す
    bgmTone(bus, { midi: degrees[deg] + lift, t: ti + beat * 0.75, dur: beat * 0.3, type: "square", gain: 0.008, attack: 0.006 });
  });
  // 4 小節目の最後は駆け上がりではなく、半音ずつ沈む 16 分の転げ落ちフィル
  if (bar % 4 === 3) {
    [5, 4, 3, 2].forEach((deg, i) => {
      bgmTone(bus, { midi: degrees[deg] + lift, t: t0 + (3 + i * 0.25) * beat, dur: beat * 0.2, type: "square", gain: 0.022, attack: 0.004 });
    });
  }
  // 4 小節ごとの頭に、遠くのブラウン管が鳴るような固定ピッチの鐘（自動選択の識別にも使う）
  if (bar % 4 === 0) bgmBell(bus, { midi: 76, t: t0, dur: 1.8, gain: 0.014 });
}

// Pop テーマの既定曲 Candy Pop: 甘く弾むキャンディポップ。
// スキップするベース + 手拍子 + 裏拍のプラック + 明るいメロディ + 鐘のきらめき。
function scheduleBarPop(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.pop.tempo;
  // ベース: ルートとオクターブでスキップする 8 分
  const bassLine = [0, 12, 7, 12, 0, 12, 5, 7];
  bassLine.forEach((interval, i) => {
    bgmTone(bus, { midi: chord[0] - 24 + interval, t: t0 + (i * beat) / 2, dur: beat * 0.32, type: "triangle", gain: i % 2 ? 0.055 : 0.1, attack: 0.006 });
  });
  // ドラム: 丸いキック（1・3 拍）+ 手拍子風スネア（2・4 拍に二度打ち）+ 8 分裏のハット
  for (const b of [0, 2]) bgmTone(bus, { midi: 36, t: t0 + b * beat, dur: 0.1, type: "sine", gain: 0.1, bend: -12 });
  for (const b of [1, 3]) {
    bgmNoise(bus, { t: t0 + b * beat, dur: 0.055, gain: 0.036, freq: 2400, q: 0.8 });
    bgmNoise(bus, { t: t0 + b * beat + 0.03, dur: 0.05, gain: 0.022, freq: 3000, q: 0.8 });
  }
  for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + ((i + 0.5) * beat) / 2, dur: 0.03, gain: 0.013, freq: 8600 });
  // 裏拍の和音プラック（ウクレレ風に軽く）
  for (const b of [0.5, 1.5, 2.5, 3.5]) {
    for (const m of chord) bgmTone(bus, { midi: m + 12, t: t0 + b * beat, dur: beat * 0.2, type: "triangle", gain: 0.017, attack: 0.004 });
  }
  // メロディ: スキップするような明るいフレーズ（コード構成音への度数。-1 = 休符）
  const degrees = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24, chord[1] + 24, chord[2] + 24];
  const phrases = [
    [0, -1, 1, 2, -1, 2, 1, 2],
    [3, -1, 2, 1, 2, -1, 1, 0],
    [0, 1, 2, -1, 3, -1, 4, 3],
    [2, 1, 0, -1, 1, -1, -1, -1], // 小節末は鐘の駆け上がりに譲る
  ];
  phrases[bar % 4].forEach((deg, i) => {
    if (deg < 0) return;
    bgmTone(bus, { midi: degrees[deg], t: t0 + (i * beat) / 2, dur: beat * 0.38, type: "square", gain: 0.026, attack: 0.005 });
  });
  // 鐘のきらめき: 小節あたまの星 + 4 小節目の駆け上がり
  bgmBell(bus, { midi: chord[0] + 24, t: t0, dur: 1.1, gain: 0.02 });
  if (bar % 4 === 3) {
    [0, 1, 2].forEach((deg, i) => bgmBell(bus, { midi: chord[deg] + 24, t: t0 + (2.5 + i * 0.5) * beat, dur: 1.0, gain: 0.018 }));
  }
}

// クラシックテーマの表の曲 Letter Minuet: 羽根ペンの手紙のような優雅なチェンバロのメヌエット（3 拍子）。
// チェロ風ベース + アルベルティ・バス風の通奏低音 + 前打音付きのリード + 弦のパッド。ドラムは使わない。
function scheduleBarRetro(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.retro.tempo;
  // ベース: 1 拍目にルート、3 拍目に 5 度（カデンツ小節はルートを保続して属和音を支える）
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 1.7, type: "triangle", gain: 0.095, attack: 0.012 });
  bgmTone(bus, { midi: chord[0] - 24 + (bar % 8 === 7 ? 0 : 7), t: t0 + beat * 2, dur: beat * 0.8, type: "triangle", gain: 0.055, attack: 0.012 });
  // 通奏低音: 8 分の分散和音
  const alberti = [0, 2, 1, 2, 0, 2];
  alberti.forEach((note, i) => {
    bgmPluck(bus, { midi: chord[note], t: t0 + (i * beat) / 2, dur: beat * 0.5, gain: 0.013 });
  });
  // リード: 8 小節（パッヘルベル進行 1 周）ひとまとまりの旋律（-1 = 休符）
  const degrees = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24, chord[1] + 24];
  const phrases = [
    [0, -1, 1, 2, -1, -1],
    [2, -1, 1, 0, -1, -1],
    [0, 1, 2, -1, 3, -1],
    [2, -1, 1, -1, 0, -1],
    [1, 2, 3, -1, 2, -1],
    [3, -1, 2, 1, 2, -1], // 6 小節目が頂点
    [2, 1, 0, -1, 1, -1],
    null, // カデンツ小節はトリルに譲る
  ];
  const phrase = phrases[bar % 8];
  if (phrase) {
    phrase.forEach((deg, i) => {
      if (deg < 0) return;
      bgmPluck(bus, { midi: degrees[deg], t: t0 + (i * beat) / 2, dur: beat * 0.55, gain: 0.028 });
    });
    // 小節あたまの音に上隣の和音構成音の前打音を添える
    if (phrase[0] >= 0 && phrase[0] < 4) {
      bgmPluck(bus, { midi: degrees[phrase[0] + 1], t: t0 - 0.045, dur: 0.07, gain: 0.014 });
    }
  } else {
    // カデンツ: 16 分のトリルから 2 拍目へ解決する
    for (let i = 0; i < 4; i++) {
      bgmPluck(bus, { midi: chord[2] + 12 + (i % 2 ? 2 : 0), t: t0 + (i * beat) / 4, dur: beat * 0.24, gain: 0.026 });
    }
    bgmPluck(bus, { midi: chord[1] + 12, t: t0 + beat, dur: beat * 0.9, gain: 0.028 });
  }
  // 2 小節ごとの弦のパッドと、8 小節のあたまを告げるチェレスタ
  if (bar % 2 === 0) {
    for (const [i, m] of chord.entries()) {
      bgmTone(bus, { midi: m, t: t0, dur: beat * 3, type: "triangle", gain: 0.012, attack: beat * 0.8, detune: i % 2 ? 5 : -5 });
    }
  }
  if (bar % 8 === 0) bgmBell(bus, { midi: chord[2] + 24, t: t0, dur: 1.6, gain: 0.014 });
}

// クラシックテーマの裏の曲 Letter Lament: 半音ずつ沈むラメント・バスと弔鐘の暗いチェンバロ。
// 嘆きのバス + 陰鬱な弦パッド + 下降アルペジオ + 半音上から倒れ込む前打音。ドラムは使わない。
function scheduleBarGlitch(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.glitch.tempo;
  // ラメント・バス: ルートを長く弾き、半音下の経過音で次の小節へ沈む（結びの小節は 3 度で頭へ戻る）
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 2.6, type: "triangle", gain: 0.1, attack: 0.02 });
  const passing = bar % 4 === 3 ? chord[0] - 24 + 4 : chord[0] - 25;
  bgmTone(bus, { midi: passing, t: t0 + beat * 2.5, dur: beat * 1.3, type: "triangle", gain: 0.06, attack: 0.02 });
  // 弦の陰鬱なパッド（後半の小節は短 9 度の影を薄く重ねる）
  for (const [i, m] of chord.entries()) {
    bgmTone(bus, { midi: m, t: t0, dur: beat * 4, type: "triangle", gain: 0.016, attack: beat * 1.2, detune: i % 2 ? 6 : -6 });
  }
  if (bar % 4 >= 2) bgmTone(bus, { midi: chord[0] + 13, t: t0, dur: beat * 4, type: "triangle", gain: 0.007, attack: beat * 1.5 });
  // チェンバロ: 下降するまばらなアルペジオ。時々半音上から倒れ込む前打音が付く（-1 = 休符）
  const degrees = [chord[0], chord[1], chord[2], chord[0] + 12];
  const patterns = [
    [3, -1, 2, 1, -1, 0, -1, -1],
    [-1, 2, -1, 1, 0, -1, 1, -1],
  ];
  patterns[bar % 2].forEach((deg, i) => {
    if (deg < 0) return;
    const ti = t0 + (i * beat) / 2;
    if ((i + bar) % 5 === 0) bgmPluck(bus, { midi: degrees[deg] + 1, t: ti - 0.05, dur: 0.08, gain: 0.011 });
    bgmPluck(bus, { midi: degrees[deg], t: ti, dur: beat * 0.7, gain: 0.021 });
  });
  // 弔鐘: 2 小節ごとにルートの鐘、4 小節ごとに遠くでトライトーンの影
  if (bar % 2 === 0) bgmBell(bus, { midi: chord[0] + 12, t: t0, dur: 3.0, gain: 0.03 });
  if (bar % 4 === 2) bgmBell(bus, { midi: chord[0] + 18, t: t0 + beat * 2, dur: 2.2, gain: 0.01 });
}

// Pop テーマの裏の曲 Bitter Candy: 甘さに毒がにじむダークなキャンディポップ。
// 短調に沈むスキップベース + くぐもった手拍子 + ずれたオルゴール + ささやく短調メロディ。
function scheduleBarBitter(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.bitter.tempo;
  // ベース: Candy Pop と同じスキップを短調で。7 音目のトライトーンが毒
  const bassLine = [0, 12, 7, 12, 0, 12, 6, 7];
  bassLine.forEach((interval, i) => {
    bgmTone(bus, { midi: chord[0] - 24 + interval, t: t0 + (i * beat) / 2, dur: beat * 0.32, type: "triangle", gain: i % 2 ? 0.05 : 0.095, attack: 0.006 });
  });
  // ドラム: 鈍いキック + くぐもった手拍子（低めのノイズを二度打ち）+ 8 分裏のハット
  for (const b of [0, 2]) bgmTone(bus, { midi: 34, t: t0 + b * beat, dur: 0.11, type: "sine", gain: 0.1, bend: -12 });
  for (const b of [1, 3]) {
    bgmNoise(bus, { t: t0 + b * beat, dur: 0.06, gain: 0.032, freq: 1600, q: 0.8 });
    bgmNoise(bus, { t: t0 + b * beat + 0.035, dur: 0.05, gain: 0.018, freq: 2000, q: 0.8 });
  }
  for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + ((i + 0.5) * beat) / 2, dur: 0.03, gain: 0.011, freq: 7000 });
  // 裏拍の和音プラック（甘さの名残を、音程を下にずらして）
  for (const b of [0.5, 1.5, 2.5, 3.5]) {
    for (const m of chord) bgmTone(bus, { midi: m + 12, t: t0 + b * beat, dur: beat * 0.18, type: "triangle", gain: 0.014, attack: 0.004, detune: -9 });
  }
  // メロディ: ささやくような短調フレーズ（-1 = 休符）
  const degrees = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24, chord[1] + 24];
  const phrases = [
    [0, -1, 1, 0, -1, 2, 1, 0],
    [2, -1, 3, 2, 1, -1, 0, -1],
    [0, 1, 2, -1, 2, 3, 2, 1],
    [1, 0, -1, -1, 0, -1, -1, -1],
  ];
  phrases[bar % 4].forEach((deg, i) => {
    if (deg < 0) return;
    bgmTone(bus, { midi: degrees[deg], t: t0 + (i * beat) / 2, dur: beat * 0.36, type: "square", gain: 0.022, attack: 0.005 });
  });
  // ずれたオルゴール: 小節あたまに半音上から落ちる鐘、奇数小節は遠くでもう一度
  bgmBell(bus, { midi: chord[0] + 25, t: t0, dur: 0.5, gain: 0.011 });
  bgmBell(bus, { midi: chord[0] + 24, t: t0 + beat * 0.25, dur: 1.4, gain: 0.02 });
  if (bar % 2 === 1) bgmBell(bus, { midi: chord[2] + 24, t: t0 + beat * 2.5, dur: 1.2, gain: 0.012 });
}

// ---- Extra BGM 用の小さな音源ヘルパー ----

function bgmTone(bus, { midi, t, dur, type = "sine", gain = 0.05, attack = 0.01, detune = 0, bend = 0, vibHz = 0, vibCents = 0, glide = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  if (glide) {
    // glide 半音ぶん離れた高さから素早く目的の音へ滑り込む（弦・笛のポルタメント）
    osc.frequency.setValueAtTime(midiHz(midi + glide), t);
    osc.frequency.exponentialRampToValueAtTime(midiHz(midi), t + Math.min(0.1, dur * 0.35));
  } else {
    osc.frequency.setValueAtTime(midiHz(midi), t);
  }
  if (bend) osc.frequency.linearRampToValueAtTime(midiHz(midi + bend), t + dur);
  osc.detune.value = detune;
  if (vibHz) {
    // LFO を周波数へ足してビブラートをかける
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vibHz;
    const depth = ctx.createGain();
    depth.gain.value = midiHz(midi) * (Math.pow(2, vibCents / 1200) - 1);
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// ハイハット・スネア・ノイズ系（バンドパスノイズの短発）
function bgmNoise(bus, { t, dur = 0.06, gain = 0.04, freq = 6500, q = 1.1 }) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t);
}

// チェンバロ・リュート系（鋭い立ち上がりの saw + 1 オクターブ上の弱い共鳴）
function bgmPluck(bus, { midi, t, dur, gain = 0.03 }) {
  bgmTone(bus, { midi, t, dur, type: "sawtooth", gain, attack: 0.004 });
  bgmTone(bus, { midi: midi + 12, t, dur: dur * 0.6, type: "sawtooth", gain: gain * 0.25, attack: 0.004 });
}

// 鐘・オルゴール系（基音 + 非整数倍音）
function bgmBell(bus, { midi, t, dur = 1.6, gain = 0.05 }) {
  for (const [ratio, gv] of [[1, gain], [2.76, gain * 0.4], [5.4, gain * 0.2]]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiHz(midi) * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gv, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }
}

// 2 オペレータ FM。ratio（モジュレータ周波数比）と index（変調の深さ）の組み合わせで
// エレピ・カリンバ・ブラス・銅鑼など、単純な波形では出せない音色を作り分ける。
// bright は変調が減衰する秒数。短いほどアタックだけ輝くプラック系になる。
function bgmFm(bus, { midi, t, dur, gain = 0.05, ratio = 2, index = 2, attack = 0.005, bright = 0.4, detune = 0, bend = 0 }) {
  const freq = midiHz(midi);
  const car = ctx.createOscillator();
  car.type = "sine";
  car.frequency.setValueAtTime(freq, t);
  if (bend) car.frequency.linearRampToValueAtTime(midiHz(midi + bend), t + dur);
  car.detune.value = detune;
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.setValueAtTime(freq * ratio, t);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(freq * index, t);
  depth.gain.exponentialRampToValueAtTime(Math.max(0.5, freq * index * 0.06), t + Math.max(0.03, bright));
  mod.connect(depth).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  car.connect(g).connect(bus);
  car.start(t);
  car.stop(t + dur + 0.05);
  mod.start(t);
  mod.stop(t + dur + 0.05);
}

// 聖歌の母音パッド（saw を母音フォーマントの帯域 2 本に通す）。vowel 0..2 = アー・オー・ウー
function bgmChoir(bus, { midi, t, dur, gain = 0.05, vowel = 0 }) {
  const formants = [[730, 1090], [570, 840], [300, 870]][vowel % 3];
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = midiHz(midi);
  const sum = ctx.createGain();
  sum.gain.setValueAtTime(0, t);
  sum.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
  sum.gain.linearRampToValueAtTime(gain * 0.7, t + dur * 0.75);
  sum.gain.linearRampToValueAtTime(0, t + dur);
  for (const [i, f] of formants.entries()) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = 8;
    const w = ctx.createGain();
    w.gain.value = i ? 0.7 : 1;
    osc.connect(bp).connect(w).connect(sum);
  }
  sum.connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// ---- Extra BGM の 1 小節スケジューラ（12 曲）----

// Star Parade: セカンダリドミナント（V/V・V/vi）で彩ったポップマーチ。
// 8 小節の前半はグロッケン主体で軽く、後半はビブラート付きピッコロが重なって膨らむ。
function scheduleBarParade(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.parade.tempo;
  const full = bar % 8 >= 4; // 後半はピッコロが加わる
  // チューバ風ベース + 裏拍の和音
  for (let b = 0; b < 4; b++) {
    bgmTone(bus, { midi: chord[0] - 24 + (b % 2 === 1 ? 7 : 0), t: t0 + b * beat, dur: beat * 0.55, type: "triangle", gain: 0.115, attack: 0.008 });
    for (const m of chord) bgmTone(bus, { midi: m, t: t0 + (b + 0.5) * beat, dur: beat * 0.26, type: "triangle", gain: 0.022 });
  }
  // マーチドラム: キック + スネア（2・4 拍と 16 分の装飾）+ 4 小節ごとのロール
  for (const b of [0, 2]) bgmTone(bus, { midi: 36, t: t0 + b * beat, dur: 0.09, type: "sine", gain: 0.09, bend: -12 });
  for (const b of [1, 3]) {
    bgmNoise(bus, { t: t0 + b * beat, dur: 0.08, gain: 0.04, freq: 3400, q: 0.7 });
    bgmNoise(bus, { t: t0 + (b + 0.75) * beat, dur: 0.04, gain: 0.018, freq: 3400, q: 0.7 });
  }
  if (bar % 4 === 3) {
    for (let i = 0; i < 6; i++) bgmNoise(bus, { t: t0 + (3.25 + i * 0.125) * beat, dur: 0.04, gain: 0.02 + i * 0.004, freq: 3400, q: 0.7 });
  }
  // グロッケン: 小節あたまをきらめかせる
  bgmFm(bus, { midi: chord[0] + 24, t: t0, dur: beat * 1.4, gain: 0.02, ratio: 3, index: 1.6, bright: 0.05 });
  // メロディ: シンコペーションの効いた行進フレーズ（[度数, 拍位置]）
  const phrases = [
    [[0, 0], [1, 0.5], [2, 1], [1, 2], [2, 2.5], [0, 3]],
    [[2, 0], [1, 1], [0, 1.5], [1, 2], [2, 3], [2, 3.5]],
  ];
  for (const [deg, pos] of phrases[bar % 2]) {
    bgmTone(bus, { midi: chord[deg] + 12, t: t0 + pos * beat, dur: beat * 0.42, type: "square", gain: 0.032, attack: 0.006 });
    if (full) bgmTone(bus, { midi: chord[deg] + 24, t: t0 + pos * beat, dur: beat * 0.36, type: "square", gain: 0.012, attack: 0.006, vibHz: 6, vibCents: 8 });
  }
}

// Neon Rush: 7/8 拍子（2+2+3）で駆けるシンセウェーブ。ドリアンの D メジャーが効いた進行を、
// キックのたびにパッドが沈むサイドチェイン風の強弱で押し出す。
function scheduleBarRush(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.rush.tempo; // 4 分音符。1 小節 = 8 分音符 7 個（3.5 拍）
  const eighth = beat / 2;
  const groups = [0, 2, 4]; // 2+2+3 のグループ頭（8 分単位）
  // ベース: 8 分 7 連打。グループ頭にアクセント、最後の 3 連グループはオクターブ上へ
  for (let i = 0; i < 7; i++) {
    bgmTone(bus, { midi: chord[0] - 24 + (i >= 5 ? 12 : 0), t: t0 + i * eighth, dur: eighth * 0.8, type: "sawtooth", gain: groups.includes(i) ? 0.095 : 0.06, attack: 0.005 });
  }
  // キックはグループ頭、スネアは 3 連グループの頭、ハットは 16 分裏
  for (const i of groups) bgmTone(bus, { midi: 34, t: t0 + i * eighth, dur: 0.09, type: "sine", gain: 0.09, bend: -12 });
  bgmNoise(bus, { t: t0 + 4 * eighth, dur: 0.09, gain: 0.04, freq: 2600, q: 0.8 });
  for (let i = 0; i < 7; i++) bgmNoise(bus, { t: t0 + (i + 0.5) * eighth, dur: 0.03, gain: i % 2 ? 0.024 : 0.012, freq: 8500 });
  // パッド: キック位置で沈み込むサイドチェイン風エンベロープ
  for (const [i, m] of chord.entries()) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiHz(m + 12);
    osc.detune.value = i % 2 ? 9 : -9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    for (const gi of groups) {
      const tg = t0 + gi * eighth;
      g.gain.setValueAtTime(0.002, tg);
      g.gain.linearRampToValueAtTime(0.011, tg + eighth * (gi === 4 ? 2.4 : 1.6));
    }
    g.gain.linearRampToValueAtTime(0.0001, t0 + 7 * eighth);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + 7 * eighth + 0.1);
  }
  // アルペジオ: 16 分で 7/8 を駆ける。小節ごとに音形を裏返す
  const arp = bar % 2 ? [2, 1, 0, 1] : [0, 1, 2, 1];
  for (let i = 0; i < 14; i++) {
    bgmTone(bus, { midi: chord[arp[i % 4]] + 12 + (i >= 10 ? 12 : 0), t: t0 + i * eighth / 2, dur: eighth * 0.45, type: "sawtooth", gain: i % 2 ? 0.018 : 0.028, detune: 6 });
  }
  // 4 小節ごとにライザーで次のループへなだれ込む
  if (bar % 4 === 3) bgmTone(bus, { midi: chord[0] + 12, t: t0 + 4 * eighth, dur: eighth * 3, type: "sawtooth", gain: 0.02, bend: 12, attack: 0.02 });
}

// Deep Dive: 5/4 拍子（3+2）の波にドリアンの和声。鯨の歌と気泡が漂う深海。
function scheduleBarDeepsea(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.deepsea.tempo;
  // 低いうねり: ゆっくり満ちて引く
  for (const [m, det] of [[chord[0] - 24, -4], [chord[0] - 17, 4], [chord[1] - 12, 0]]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiHz(m);
    osc.detune.value = det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.085, t0 + beat * 2);
    g.gain.linearRampToValueAtTime(0.024, t0 + beat * 5);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 5 + 0.1);
  }
  // 波: 小節をかけて寄せては返すフィルタノイズ
  {
    const len = Math.floor(ctx.sampleRate * beat * 5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(300, t0);
    f.frequency.linearRampToValueAtTime(900, t0 + beat * 3);
    f.frequency.linearRampToValueAtTime(250, t0 + beat * 5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.018, t0 + beat * 3);
    g.gain.linearRampToValueAtTime(0.0001, t0 + beat * 5);
    src.connect(f).connect(g).connect(bus);
    src.start(t0);
  }
  // 鼓動: 3+2 のグループ頭で打つ
  for (const b of [0, 3]) bgmTone(bus, { midi: 28, t: t0 + b * beat, dur: 0.5, type: "sine", gain: 0.045, attack: 0.05, bend: -5 });
  // 中音の和音を薄く敷いて水中の厚みを出す
  bgmTone(bus, { midi: chord[2] - 12, t: t0, dur: beat * 5, type: "sine", gain: 0.03, attack: beat * 2 });
  bgmTone(bus, { midi: chord[3] ?? chord[1], t: t0 + beat * 3, dur: beat * 2, type: "sine", gain: 0.018, attack: beat });
  // 鯨の歌: 4 小節ごとに、ゆっくり上へ滑る低い声
  if (bar % 4 === 1) {
    bgmTone(bus, { midi: chord[0] - 5, t: t0 + beat, dur: beat * 3, type: "sine", gain: 0.038, attack: beat * 0.8, bend: 7, vibHz: 2.5, vibCents: 30 });
  }
  // 気泡: 高い FM の粒がランダムに浮かぶ
  const bubbles = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < bubbles; i++) {
    bgmFm(bus, { midi: chord[2] + 24 + Math.floor(Math.random() * 5), t: t0 + Math.random() * beat * 4.5, dur: 0.25, gain: 0.012, ratio: 1.5, index: 1, bright: 0.03, bend: 5 });
  }
  // ソナーピン: 2 小節ごとに響かせる
  if (bar % 2 === 0) bgmBell(bus, { midi: chord[2] + 24, t: t0 + beat * 1.5, dur: 2.6, gain: 0.024 });
}

// Midnight Velvet: 9th/13th のジャズ和声を ii-V で回すスウィング。
// ウォーキングベースは次の小節のルートへ半音でアプローチし、8 小節目はドラムが抜けて息をつく。
function scheduleBarVelvet(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.velvet.tempo;
  const sw = beat * 0.67; // スウィングの裏拍位置
  const chords = TRACKS.velvet.chords;
  // ウッドベースの音域（E1〜）に収まるようルートを正規化する
  const bassRoot = (m) => 40 + ((((m - 40) % 12) + 12) % 12);
  const root = bassRoot(chord[0]);
  const nextRoot = bassRoot(chords[(bar + 1) % chords.length][0]);
  const breakBar = bar % 8 === 7; // ベースとエレピだけになるブレイク
  // ウォーキングベース: ルート → 3 度 → 5 度 → 次のルートへの半音アプローチ
  const walk = [root, root + (chord[1] - chord[0]), root + 7, nextRoot + (root > nextRoot ? 1 : -1)];
  walk.forEach((m, b) => {
    bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.85, type: "triangle", gain: b === 0 ? 0.105 : 0.08, attack: 0.012 });
  });
  if (!breakBar) {
    // ライドのスウィング + 2・4 拍のブラシ + 1・3 拍の柔らかいキック
    for (let b = 0; b < 4; b++) {
      bgmNoise(bus, { t: t0 + b * beat, dur: 0.1, gain: b % 2 ? 0.026 : 0.017, freq: 9000, q: 0.8 });
      bgmNoise(bus, { t: t0 + b * beat + sw, dur: 0.05, gain: 0.013, freq: 9500, q: 0.8 });
    }
    for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.12, gain: 0.02, freq: 3000, q: 0.5 });
    for (const b of [0, 2]) bgmTone(bus, { midi: 33, t: t0 + b * beat, dur: 0.09, type: "sine", gain: 0.045, bend: -8 });
  }
  // FM エレピ: シンコペーションでコンピング
  const compHits = bar % 2 ? [0.67, 2.5] : [1.5, 3.67];
  for (const pos of compHits) {
    for (const m of chord) bgmFm(bus, { midi: m, t: t0 + pos * beat, dur: beat * 1.1, gain: breakBar ? 0.02 : 0.015, ratio: 2, index: 1.1, bright: 0.07, detune: 4 });
  }
  // メロディ: 奇数小節はためのあるフレーズ（b5 のブルーノート入り）、偶数小節は短い応え
  if (bar % 2 === 1) {
    const line = [
      [chord[2] + 12, 0.67, 0.8],
      [chord[3] + 12, 1.33, 0.5],
      [chord[0] + 18, 2, 0.4], // ルートの増 4 度上 = ブルーノート
      [chord[2] + 12, 2.33, 1.4],
    ];
    for (const [m, pos, len] of line) {
      bgmTone(bus, { midi: m, t: t0 + pos * beat, dur: beat * len, type: "sine", gain: 0.042, vibHz: 5.5, vibCents: 14, glide: -1 });
    }
  } else {
    bgmTone(bus, { midi: chord[1] + 12, t: t0 + 2.67 * beat, dur: beat * 0.5, type: "sine", gain: 0.032, vibHz: 5.5, vibCents: 10 });
    bgmTone(bus, { midi: chord[0] + 12, t: t0 + 3.33 * beat, dur: beat * 0.6, type: "sine", gain: 0.036, vibHz: 5.5, vibCents: 10 });
  }
}

// Victory March: 行進曲の定石どおり、勇壮な A と穏やかなトリオの 16 小節構成。
// A は FM ブラスの 3 連ファンファーレ、トリオは木管風のビブラートが歌って強弱の谷を作る。
function scheduleBarMarch(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.march.tempo;
  const trio = bar % 16 >= 8; // 後半 8 小節は静かなトリオ
  const dyn = trio ? 0.5 : 1;
  // ベース（1・3 拍）と 2・4 拍の和音刻み
  for (const b of [0, 2]) bgmTone(bus, { midi: chord[0] - 24, t: t0 + b * beat, dur: beat * 0.8, type: "triangle", gain: trio ? 0.08 : 0.11, attack: 0.01 });
  for (const b of [1, 3]) {
    for (const m of chord) bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.4, type: "triangle", gain: trio ? 0.018 : 0.028 });
  }
  // ドラム: スネア（2・4 拍 + 16 分の装飾）と 8 分ハット。トリオでは弱まる
  for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.11, gain: 0.055 * dyn, freq: 3400, q: 0.7 });
  bgmNoise(bus, { t: t0 + 1.75 * beat, dur: 0.05, gain: 0.024 * dyn, freq: 3400, q: 0.7 });
  for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + i * beat / 2, dur: 0.03, gain: 0.013 * dyn, freq: 8000 });
  if (bar % 16 === 0) bgmNoise(bus, { t: t0, dur: 0.4, gain: 0.032, freq: 9000, q: 0.5 });
  // セクション終わりはロールのクレッシェンドでなだれ込む
  if (bar % 8 === 7) {
    for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + (3 + i * 0.125) * beat, dur: 0.05, gain: (0.018 + i * 0.004) * dyn, freq: 3400, q: 0.7 });
  }
  if (trio) {
    // トリオ: 木管風の旋律が 2 小節単位で歌う（[度数, 拍位置, 長さ]）
    const tune = [[[0, 0, 1.5], [1, 1.5, 1], [2, 2.5, 1.5]], [[2, 0, 1], [1, 1, 0.75], [0, 1.75, 2]]][bar % 2];
    for (const [deg, pos, len] of tune) {
      bgmTone(bus, { midi: chord[deg] + 12, t: t0 + pos * beat, dur: beat * len, type: "sine", gain: 0.042, attack: 0.03, vibHz: 5.5, vibCents: 12 });
    }
  } else {
    // A: 小節あたまは FM ブラスの 3 連符、そのあと高音の呼び交わし
    const trip = beat / 3;
    [0, 1, 2].forEach((i) => {
      bgmFm(bus, { midi: chord[i] + 12, t: t0 + i * trip, dur: trip * 0.9, gain: 0.046, ratio: 1, index: 2.5, bright: 0.12, attack: 0.01 });
    });
    const calls = bar % 2 ? [[2, 1.5], [1, 2], [0, 2.5], [1, 3]] : [[0, 1.5], [1, 2], [2, 3]];
    for (const [deg, pos] of calls) {
      bgmFm(bus, { midi: chord[deg] + 24, t: t0 + pos * beat, dur: beat * 0.5, gain: 0.03, ratio: 1, index: 2, bright: 0.1, attack: 0.012 });
    }
    // ティンパニ
    bgmTone(bus, { midi: chord[0] - 12, t: t0, dur: 0.3, type: "sine", gain: 0.05, bend: -3 });
  }
}

// Abyss Gate: フリジアンの bII が影を落とす深淵。聖歌の母音パッドと FM の銅鑼が、
// 8 小節かけて満ちてゆく長い強弱の弧を描く。
function scheduleBarAbyssgate(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.abyssgate.tempo;
  const swell = 0.5 + 0.5 * ((bar % 8) / 7); // 8 小節かけて満ちる
  // 低いドローン
  for (const m of [chord[0] - 24, chord[0] - 17]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiHz(m);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(130, t0);
    f.frequency.linearRampToValueAtTime(380, t0 + beat * 2);
    f.frequency.linearRampToValueAtTime(130, t0 + beat * 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.09, t0 + 0.7);
    g.gain.setValueAtTime(0.09, t0 + beat * 4 - 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + beat * 4);
    osc.connect(f).connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 4 + 0.1);
  }
  // 聖歌: 小節ごとに母音を変えながら和音で歌う
  for (const [i, m] of chord.entries()) {
    bgmChoir(bus, { midi: m, t: t0, dur: beat * 4, gain: (i === 0 ? 0.05 : 0.034) * swell, vowel: (bar + i) % 3 });
  }
  // 深い鼓動と、4 小節ごとの FM 銅鑼
  for (const b of [0, 2.5]) bgmTone(bus, { midi: 30, t: t0 + b * beat, dur: 0.4, type: "sine", gain: 0.05, attack: 0.04, bend: -6 });
  if (bar % 4 === 0) bgmFm(bus, { midi: chord[0], t: t0, dur: beat * 4, gain: 0.05, ratio: 1.41, index: 4, bright: 1.2, attack: 0.02 });
  if (bar % 4 === 2) bgmBell(bus, { midi: chord[1] + 12, t: t0 + beat * 2, dur: 2.8, gain: 0.026 });
  // 半音の動機: フレーズ後半、bII へ上がって戻る囁き
  if (bar % 8 >= 5) {
    bgmTone(bus, { midi: chord[0] + 12, t: t0 + beat, dur: beat * 1.2, type: "sine", gain: 0.03 * swell, attack: 0.06, vibHz: 4, vibCents: 10 });
    bgmTone(bus, { midi: chord[0] + 13, t: t0 + beat * 2.2, dur: beat * 0.9, type: "sine", gain: 0.026 * swell, attack: 0.06 });
    bgmTone(bus, { midi: chord[0] + 12, t: t0 + beat * 3.1, dur: beat * 0.9, type: "sine", gain: 0.022 * swell, attack: 0.06 });
  }
}

// Waltz of Lies: 和声的短音階の E7b9 とナポリの Bb が回る、酒場のダークワルツ。
// アコーディオン（デチューン saw + ビブラート）とすべり込むバイオリン。7-8 小節目はヘミオラで足がもつれる。
function scheduleBarWaltz(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.waltz.tempo;
  const phrase = bar % 8;
  const hemiola = phrase >= 6; // 2 小節（6 拍）を 2 拍 × 3 に読み替える
  const cresc = 0.85 + 0.25 * (phrase / 7); // フレーズ後半へ向けてクレッシェンド
  if (hemiola) {
    // ヘミオラ: ベースと和音が 2 拍ごとに来て、回転がもつれる
    for (const pos of [0, 2]) {
      bgmTone(bus, { midi: chord[0] - 24, t: t0 + pos * beat, dur: beat * 0.8, type: "triangle", gain: 0.11, attack: 0.01 });
      for (const m of chord) {
        for (const det of [10, -10]) {
          bgmTone(bus, { midi: m, t: t0 + (pos + 1) * beat, dur: beat * 0.5, type: "sawtooth", gain: 0.016, detune: det, vibHz: 5, vibCents: 8 });
        }
      }
    }
  } else {
    // ブン・チャッ・チャッ
    bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 0.9, type: "triangle", gain: 0.11 * cresc, attack: 0.01 });
    for (const b of [1, 2]) {
      for (const m of chord) {
        // アコーディオン風: デチューンした saw を 2 本重ねる
        for (const det of [10, -10]) {
          bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.5, type: "sawtooth", gain: 0.016 * cresc, detune: det, vibHz: 5, vibCents: 8 });
        }
      }
      bgmNoise(bus, { t: t0 + b * beat, dur: 0.05, gain: 0.014, freq: 6500, q: 0.8 });
    }
  }
  // バイオリン: 半音上からすべり込むむせび泣きの旋律（[度数, 拍位置, 長さ]）
  const lines = [
    [[0, 0, 1.4], [1, 1.5, 1.4]],
    [[2, 0, 0.9], [1, 1, 0.9], [0, 2, 0.9]],
    [[1, 0, 2.8]],
    [[2, 0, 0.9], [3, 1, 1.8]],
  ];
  for (const [deg, pos, len] of lines[Math.floor(bar / 2) % 4]) {
    const m = (chord[deg] ?? chord[0] + 12) + 12;
    bgmTone(bus, { midi: m, t: t0 + pos * beat, dur: beat * len, type: "sawtooth", gain: 0.034 * cresc, attack: 0.05, glide: 1, vibHz: 5.5, vibCents: 18 });
    // 1 オクターブ下のハモリで厚みを足す
    bgmTone(bus, { midi: m - 12, t: t0 + pos * beat, dur: beat * len * 0.9, type: "triangle", gain: 0.02 * cresc, attack: 0.05 });
  }
}

// Rainy Bookshop: FM ローズの 9th コードにテープの揺れ。雨音・レコードノイズ・
// 後ろにもたるドラム。7-8 小節目はビートが抜けて雨音だけが残る。
function scheduleBarLofi(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.lofi.tempo;
  const lay = 0.035; // ドラムがビートの後ろにもたれる秒数
  const thin = bar % 8 >= 6; // ビートが抜けるビートスイッチ
  // FM ローズ: 和音をわずかに時間差で弾き、テープのようにピッチが揺れる
  for (const [i, m] of chord.entries()) {
    bgmFm(bus, { midi: m, t: t0 + i * 0.03, dur: beat * 3.6, gain: 0.034, ratio: 2, index: 1.3, bright: 0.09, detune: (bar % 2 ? 6 : -6) + (i % 2 ? 4 : -4) });
  }
  // ベース: ルートから 4 度・5 度へもたれて動く
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 1.8, type: "sine", gain: 0.1, attack: 0.015 });
  bgmTone(bus, { midi: chord[0] - 24 + (bar % 2 ? 5 : 7), t: t0 + beat * 2.5, dur: beat * 1.3, type: "sine", gain: 0.07, attack: 0.015 });
  if (!thin) {
    // ドラム: 後ろにもたるキックとスネア、スウィングするハット
    for (const b of [0, 2.5]) bgmTone(bus, { midi: 32, t: t0 + b * beat + (b ? lay : 0), dur: 0.1, type: "sine", gain: 0.1, bend: -10 });
    for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat + lay, dur: 0.08, gain: 0.034, freq: 4200, q: 0.6 });
    for (let b = 0; b < 4; b++) {
      bgmNoise(bus, { t: t0 + b * beat + lay, dur: 0.025, gain: 0.01, freq: 7200, q: 1.2 });
      bgmNoise(bus, { t: t0 + (b + 0.67) * beat + lay, dur: 0.025, gain: 0.007, freq: 7200, q: 1.2 });
    }
  }
  // 雨: 窓の外のノイズカーテンと、ときどきガラスを打つ雫
  {
    const len = Math.floor(ctx.sampleRate * beat * 4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 5500;
    f.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(thin ? 0.009 : 0.006, t0 + beat);
    g.gain.linearRampToValueAtTime(0.0001, t0 + beat * 4);
    src.connect(f).connect(g).connect(bus);
    src.start(t0);
  }
  for (let i = 0; i < 5; i++) bgmNoise(bus, { t: t0 + Math.random() * beat * 4, dur: 0.03, gain: 0.008, freq: 3000 + Math.random() * 4000, q: 4 });
  // レコードのクラックル
  for (let i = 0; i < 6; i++) bgmNoise(bus, { t: t0 + Math.random() * beat * 4, dur: 0.015, gain: 0.007, freq: 9000, q: 2.5 });
  // 奇数小節にためて弾くエレピのリック
  if (bar % 2 === 1) {
    const lick = [[chord[2] + 12, 2, 0.6], [chord[1] + 12, 2.67, 0.5], [chord[0] + 12, 3.17, 1.2]];
    for (const [m, pos, len] of lick) bgmFm(bus, { midi: m, t: t0 + pos * beat, dur: beat * len, gain: 0.026, ratio: 2, index: 1.4, bright: 0.08 });
  }
}

// Bit Carnival: にぎやかなチップチューン。忙しい旋律とオクターブ跳躍、お祭りのドラム。
function scheduleBarCarnival(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.carnival.tempo;
  for (let i = 0; i < 8; i++) {
    bgmTone(bus, { midi: chord[0] - 24 + (i % 2 === 1 ? 7 : 0), t: t0 + i * beat / 2, dur: beat * 0.3, type: "triangle", gain: 0.095, attack: 0.006 });
    bgmNoise(bus, { t: t0 + (i + 0.5) * beat / 2, dur: 0.025, gain: 0.024, freq: 9000 });
  }
  // キック（1・3 拍）とスネア（2・4 拍）で祭囃子を締める
  for (const b of [0, 2]) bgmTone(bus, { midi: 36, t: t0 + b * beat, dur: 0.08, type: "sine", gain: 0.09, bend: -14 });
  for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.06, gain: 0.032, freq: 4000, q: 0.8 });
  const jump = [0, 2, 1, 2, 0, 2, 1, 2, 2, 0, 1, 0, 2, 1, 2, 1];
  for (let i = 0; i < 16; i++) {
    const oct = i % 4 === 2 ? 24 : 12;
    bgmTone(bus, { midi: chord[jump[i]] + oct, t: t0 + i * beat / 4, dur: beat * 0.2, type: "square", gain: 0.026, attack: 0.004 });
  }
  // 4 小節目の終わりに笛が駆け上がる
  if (bar % 4 === 3) bgmTone(bus, { midi: chord[0] + 12, t: t0 + 3 * beat, dur: beat * 0.9, type: "square", gain: 0.022, bend: 12 });
}

// Aurora: リディアンの #11 が浮遊する生成曲。旋律はランダムウォークで生まれ、同じ夜は二度と来ない。
let auroraWalk = 3; // ランダムウォークの現在位置（リディアン音階の度数）
function scheduleBarAurora(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.aurora.tempo;
  const lydian = [0, 2, 4, 6, 7, 9, 11]; // #4 がリディアンの光
  // パッド: 和音がゆっくり呼吸する
  for (const [i, m] of chord.entries()) {
    bgmTone(bus, { midi: m, t: t0, dur: beat * 4, type: "triangle", gain: i < 2 ? 0.034 : 0.022, attack: beat * (1 + i * 0.3), detune: i % 2 ? 7 : -7, vibHz: 2.5, vibCents: 4 });
  }
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 4, type: "sine", gain: 0.08, attack: 0.06 });
  // 旋律: ランダムウォークが 8 分でリディアンをさまよい、ときどき 3 度跳躍する
  for (let i = 0; i < 8; i++) {
    if (Math.random() < 0.45) continue; // 休符も歩みのうち
    const step = Math.random() < 0.15 ? (Math.random() < 0.5 ? 3 : -3) : Math.random() < 0.5 ? 1 : -1;
    auroraWalk = Math.min(13, Math.max(0, auroraWalk + step));
    const m = 72 + 12 * Math.floor(auroraWalk / 7) + lydian[auroraWalk % 7];
    bgmFm(bus, { midi: m, t: t0 + i * beat / 2, dur: beat * 1.6, gain: 0.022, ratio: 3.01, index: 1.8, bright: 0.06 });
    // テープエコーのような減衰リピート
    bgmFm(bus, { midi: m, t: t0 + i * beat / 2 + beat * 0.75, dur: beat * 1.2, gain: 0.009, ratio: 3.01, index: 1.5, bright: 0.05 });
  }
  // オーロラのカーテン: まれに高い持続音がゆっくり明滅する
  if (Math.random() < 0.3) {
    bgmTone(bus, { midi: chord[0] + 24 + lydian[Math.floor(Math.random() * 7)], t: t0 + Math.random() * beat * 2, dur: beat * 3, type: "sine", gain: 0.016, attack: beat, vibHz: 3, vibCents: 8 });
  }
  // 低いうねりが 2 小節ごとに寄せる
  if (bar % 2 === 1) bgmTone(bus, { midi: chord[0] - 12, t: t0 + beat, dur: beat * 2.5, type: "sine", gain: 0.03, attack: beat * 0.8 });
}

// Morning Light: 6/8 拍子のパストラル。ハープのロール、息の混じった笛、小鳥のさえずり。
// 16 小節かけて夜が明けるように音が増えてゆく。
function scheduleBarMorning(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.morning.tempo;
  const eighth = beat / 2; // 6/8: 1 小節 = 8 分音符 6 個（3+3）
  const wake = Math.min(1, 0.4 + bar / 16); // 夜明けの強弱: だんだん音が満ちる
  // パッド: add9 の柔らかい持続
  for (const m of chord) bgmTone(bus, { midi: m, t: t0, dur: beat * 3, type: "sine", gain: 0.03 * wake, attack: beat });
  // ベース: 3+3 のグループ頭にそっと置く
  bgmTone(bus, { midi: chord[0] - 12, t: t0, dur: beat * 1.4, type: "sine", gain: 0.07, attack: 0.03 });
  bgmTone(bus, { midi: chord[0] - 12 + 7, t: t0 + 3 * eighth, dur: beat * 1.3, type: "sine", gain: 0.045, attack: 0.03 });
  // ハープ: 6/8 の流れに乗って上下するロール（グループ頭にアクセント）
  const roll = bar % 2 ? [3, 2, 1, 0, 1, 2] : [0, 1, 2, 3, 2, 1];
  roll.forEach((deg, i) => {
    bgmFm(bus, { midi: chord[deg % chord.length] + 12, t: t0 + i * eighth, dur: eighth * 2.2, gain: (i % 3 === 0 ? 0.03 : 0.02) * wake, ratio: 2, index: 1, bright: 0.05 });
  });
  // 笛: 2 小節ごとに息の混じった旋律（[度数, 8 分位置, 長さ]）
  if (bar % 2 === 0) {
    const tunes = [
      [[2, 0, 3], [3, 3, 3]],
      [[3, 0, 2], [2, 2, 1], [1, 3, 3]],
      [[1, 0, 3], [2, 3, 3]],
      [[2, 0, 2], [1, 2, 1], [0, 3, 3]],
    ];
    for (const [deg, pos, len] of tunes[Math.floor(bar / 2) % 4]) {
      const m = chord[deg % chord.length] + 12;
      bgmNoise(bus, { t: t0 + pos * eighth, dur: 0.06, gain: 0.008 * wake, freq: midiHz(m) * 2, q: 3 }); // 息のノイズ
      bgmTone(bus, { midi: m, t: t0 + pos * eighth, dur: eighth * len, type: "sine", gain: 0.04 * wake, attack: 0.04, vibHz: 5, vibCents: 10 });
    }
  }
  // 小鳥: 明るくなるほどよくさえずる 2 音のさえずり
  if (Math.random() < 0.25 + 0.35 * wake) {
    const tb = t0 + Math.random() * beat * 2.5;
    const base = 88 + Math.floor(Math.random() * 5);
    bgmTone(bus, { midi: base, t: tb, dur: 0.09, type: "sine", gain: 0.012, bend: 3 });
    bgmTone(bus, { midi: base + 2, t: tb + 0.11, dur: 0.07, type: "sine", gain: 0.009, bend: -2 });
  }
}

// Grand Finale: 全音上への転調（C → D）を仕込んだ 16 小節の祝祭。
// 転調の瞬間はシンバルとティンパニが鳴り、フレーズ末はロールと駆け上がりでなだれ込む。
function scheduleBarFinale(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.finale.tempo;
  const lift = bar % 16 >= 8; // 後半 8 小節はキーが全音上（chords 側で転調済み）
  for (let b = 0; b < 4; b++) {
    for (const m of chord) {
      bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.5, type: "sawtooth", gain: 0.019, detune: b % 2 ? 8 : -8 });
    }
    bgmTone(bus, { midi: chord[0] - 24 + (b === 3 ? 5 : 0), t: t0 + b * beat, dur: beat * 0.6, type: "triangle", gain: 0.11, attack: 0.008 });
    bgmNoise(bus, { t: t0 + (b + 0.5) * beat, dur: 0.05, gain: 0.03, freq: 8000 });
  }
  // 4 つ打ちキックと 2・4 拍のスネアで祝祭を推し進める
  for (let b = 0; b < 4; b++) bgmTone(bus, { midi: 36, t: t0 + b * beat, dur: 0.08, type: "sine", gain: 0.085, bend: -12 });
  for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.07, gain: 0.036, freq: 3600, q: 0.7 });
  // 転調の瞬間に大きなシンバルとティンパニ
  if (bar % 8 === 0) {
    bgmNoise(bus, { t: t0, dur: 0.5, gain: 0.04, freq: 9000, q: 0.4 });
    bgmTone(bus, { midi: chord[0] - 12, t: t0, dur: 0.5, type: "sine", gain: 0.06, bend: -4 });
  }
  // ファンファーレ: 小節あたまの FM ブラス 3 連符と 8 分の上昇カスケード
  const trip = beat / 3;
  [0, 1, 2].forEach((i) => {
    bgmFm(bus, { midi: chord[i] + 12, t: t0 + i * trip, dur: trip * 0.9, gain: 0.026, ratio: 1, index: 2.4, bright: 0.11, attack: 0.01 });
  });
  const cascade = [0, 1, 2, 0, 1, 2, 0, 1];
  cascade.forEach((note, i) => {
    bgmTone(bus, { midi: chord[note] + 12 + Math.floor(i / 3) * 12, t: t0 + i * beat / 2, dur: beat * 0.4, type: "square", gain: 0.022, attack: 0.006 });
  });
  // 2 小節ごとに高い鐘のきらめき（転調後はさらに輝く）
  if (bar % 2 === 0) bgmBell(bus, { midi: chord[0] + 36, t: t0, dur: 1.4, gain: lift ? 0.02 : 0.014 });
  // フレーズ末: ロールのクレッシェンドと全員での駆け上がり
  if (bar % 8 === 7) {
    for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + (3 + i * 0.125) * beat, dur: 0.06, gain: 0.024 + i * 0.003, freq: 3600, q: 0.7 });
    [0, 4, 7, 12].forEach((interval, i) => {
      bgmFm(bus, { midi: chord[0] + 12 + interval, t: t0 + (2 + i * 0.5) * beat, dur: beat * 0.45, gain: 0.024, ratio: 1, index: 2.2, bright: 0.1 });
    });
  }
}

// 全トラックの定義。beats は 1 小節の拍数（4 分音符単位。3 = ワルツ・6/8、3.5 = 7/8、5 = 5/4）。
const TRACKS = {
  normal: { ...NORMAL, beats: 4, schedule: scheduleBarNormal },
  uso: { ...USO, beats: 4, schedule: scheduleBarUso },
  // Moonlit Calm は 7th/9th の 8 小節（Cmaj7 Am7 Fmaj7 G6 | Em7 Am7 Dm7 G7sus4）をゆっくり巡る
  gentle: { tempo: 72, beats: 4, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 64], [52, 55, 59, 62], [57, 60, 64, 67], [50, 53, 57, 60], [55, 60, 62, 65]], schedule: scheduleBarGentle },
  // Classic 8-bit は A メロ（C G Bb F ×2 — bVII 借用）と B メロ（Am F D7 G / Am F G C）の 16 小節構成
  classic: { tempo: 112, beats: 4, chords: [[60, 64, 67], [55, 59, 62], [58, 62, 65], [53, 57, 60], [60, 64, 67], [55, 59, 62], [58, 62, 65], [53, 57, 60], [57, 60, 64], [53, 57, 60], [50, 54, 57], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [60, 64, 67]], schedule: scheduleBarClassic },
  // Glitch 8-bit は Classic 8-bit の平行短調。A メロ（Am Em F E ×2 — 2 周目はナポリの Bb）と
  // B メロ（Dm Am Bb E7 / Dm F E7 Am）の 16 小節構成
  darkbit: { tempo: 104, beats: 4, chords: [[57, 60, 64], [52, 55, 59], [53, 57, 60], [52, 56, 59], [57, 60, 64], [52, 55, 59], [58, 62, 65], [52, 56, 59], [50, 53, 57], [57, 60, 64], [58, 62, 65], [52, 56, 59, 62], [50, 53, 57], [53, 57, 60], [52, 56, 59, 62], [57, 60, 64]], schedule: scheduleBarDarkbit },
  pop: { tempo: 122, beats: 4, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], schedule: scheduleBarPop },
  // Letter Minuet はパッヘルベル進行（C G Am Em F C F G）を 8 小節で 1 周する
  retro: { tempo: 116, beats: 3, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [52, 55, 59], [53, 57, 60], [60, 64, 67], [53, 57, 60], [55, 59, 62]], schedule: scheduleBarRetro },
  // Letter Lament はラメント進行（Am G F E）。ベースが A→G→F→E と半音経過音を挟んで沈む
  glitch: { tempo: 63, beats: 4, chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]], schedule: scheduleBarGlitch },
  bitter: { tempo: 112, beats: 4, chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]], schedule: scheduleBarBitter },
  // Star Parade はセカンダリドミナント入りの 8 小節（C Am F D7 | G E7 Am G7）
  parade: { tempo: 118, beats: 4, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [50, 54, 57], [55, 59, 62], [52, 56, 59], [57, 60, 64], [55, 59, 65]], schedule: scheduleBarParade },
  // Neon Rush は 7/8 拍子。ドリアンの IV（D メジャー）を経て E へ向かう（Am F D E）
  rush: { tempo: 138, beats: 3.5, chords: [[57, 60, 64], [53, 57, 60], [50, 54, 57], [52, 56, 59]], schedule: scheduleBarRush },
  // Deep Dive は 5/4 拍子の D ドリアン（Dm9 G/D Am7 Cmaj7）
  deepsea: { tempo: 50, beats: 5, chords: [[50, 53, 57, 64], [50, 55, 59, 62], [45, 48, 52, 55], [48, 52, 55, 59]], schedule: scheduleBarDeepsea },
  // Midnight Velvet は 9th/13th の ii-V（Cmaj9 A7b9 Dm9 G13 | Em7 A7b9 Dm9 G13）
  velvet: { tempo: 84, beats: 4, chords: [[60, 64, 71, 74], [57, 61, 67, 70], [50, 53, 60, 64], [55, 59, 65, 69], [52, 55, 59, 62], [57, 61, 67, 70], [50, 53, 60, 64], [55, 59, 65, 69]], schedule: scheduleBarVelvet },
  // Victory March は A（C 主体 + D7）8 小節とトリオ（F 主体）8 小節の行進曲構成
  march: { tempo: 106, beats: 4, chords: [[60, 64, 67], [60, 64, 67], [53, 57, 60], [50, 54, 57, 60], [55, 59, 62], [55, 59, 62, 65], [60, 64, 67], [55, 59, 62, 65], [53, 57, 60], [50, 53, 57], [58, 62, 65], [53, 57, 60], [60, 64, 67, 70], [60, 64, 67, 70], [53, 57, 60], [60, 64, 67, 70]], schedule: scheduleBarMarch },
  // Abyss Gate はフリジアン（Am Bb Am Gm）。bII が深淵の影
  abyssgate: { tempo: 58, beats: 4, chords: [[45, 48, 52], [46, 50, 53], [45, 48, 52], [43, 46, 50]], schedule: scheduleBarAbyssgate },
  // Waltz of Lies は和声的短音階とナポリの 8 小節（Am E7 Am A7 | Dm Bb E7b9 Am）
  waltz: { tempo: 96, beats: 3, chords: [[57, 60, 64], [52, 56, 59, 62], [57, 60, 64], [57, 61, 64, 67], [50, 53, 57], [58, 62, 65], [52, 56, 62, 65], [57, 60, 64]], schedule: scheduleBarWaltz },
  // Rainy Bookshop は 9th 主体の 4 小節（Am9 Fmaj9 Dm9 E7#9）
  lofi: { tempo: 74, beats: 4, chords: [[57, 60, 67, 71], [53, 57, 64, 67], [50, 53, 60, 64], [52, 56, 62, 67]], schedule: scheduleBarLofi },
  carnival: { tempo: 140, beats: 4, chords: [[60, 64, 67], [65, 69, 72], [55, 59, 62], [57, 60, 64]], schedule: scheduleBarCarnival },
  // Aurora は C リディアン上を漂う（Cmaj7 D/C Bm7 Cmaj7#11）
  aurora: { tempo: 60, beats: 4, chords: [[60, 64, 67, 71], [60, 62, 66, 69], [59, 62, 66, 69], [60, 64, 66, 71]], schedule: scheduleBarAurora },
  // Morning Light は 6/8 拍子の 8 小節（Cadd9 G/B Am7 Fmaj9 | C/E Dm7 G7sus4 Cadd9）
  morning: { tempo: 80, beats: 3, chords: [[60, 62, 64, 67], [59, 62, 67, 71], [57, 60, 64, 67], [53, 57, 64, 67], [52, 60, 64, 67], [50, 53, 57, 60], [55, 60, 62, 65], [60, 62, 64, 67]], schedule: scheduleBarMorning },
  // Grand Finale は前半 C メジャー、後半で全音上の D メジャーへ転調する 16 小節
  finale: { tempo: 124, beats: 4, chords: [[60, 64, 67], [65, 69, 72], [57, 60, 64], [55, 59, 62], [60, 64, 67], [65, 69, 72], [55, 59, 62], [55, 59, 62, 65], [62, 66, 69], [67, 71, 74], [59, 62, 66], [57, 61, 64], [62, 66, 69], [67, 71, 74], [57, 61, 64], [57, 61, 64, 67]], schedule: scheduleBarFinale },
};

function bgmLoop() {
  if (!bgmRunning) return;
  // 選択中トラックを先読みスケジュールする。切替時は旧バスをフェードアウトする。
  while (true) {
    const track = selectedTrack();
    const def = TRACKS[track] ?? TRACKS.normal;
    const barDur = (60 / def.tempo) * def.beats;
    if (nextBarTime >= ctx.currentTime + barDur * 1.5) break;
    const chord = def.chords[barIndex % def.chords.length];
    def.schedule(nextBarTime, chord, barIndex, busFor(track));
    nextBarTime += barDur;
    barIndex++;
  }
  bgmTimer = setTimeout(bgmLoop, 300);
}

// BGM を曲頭（1 小節目）へ巻き戻す。次の startBgm がトラックの先頭から予約し直す。
// 単体では再生位置を変えないため、unlockAudio({ restartBgm: true }) とセットで使う。
// 扉絵の「開始」が使い、入場時の BGM を必ず曲の頭から鳴らす
// （音復帰の設定変更で BGM が先に走り出し、小節位置が進んでいることがあるため）。
export function rewindBgm() {
  barIndex = 0;
  bgmScheduleStartBar = 0;
}

export function startBgm() {
  if (!ensureContext() || bgmRunning) return;
  resetBgmBuses();
  bgmRunning = true;
  const t = ctx.currentTime;
  bgmGain.gain.cancelScheduledValues(t);
  bgmGain.gain.setValueAtTime(bgmGain.gain.value, t);
  bgmGain.gain.linearRampToValueAtTime(bgmTargetGain(), t + 0.25);
  nextBarTime = ctx.currentTime + 0.1;
  bgmScheduleStartBar = barIndex;
  bgmLoop();
}

export function stopBgm() {
  bgmRunning = false;
  if (bgmTimer) clearTimeout(bgmTimer);
  bgmTimer = null;
  if (ctx && ctx.state !== "closed" && bgmGain) {
    const t = ctx.currentTime;
    bgmGain.gain.cancelScheduledValues(t);
    bgmGain.gain.setValueAtTime(bgmGain.gain.value, t);
    bgmGain.gain.linearRampToValueAtTime(0, t + 0.2);
  }
}

// 設定変更に追従
onSettingsChange((s, key) => {
  if (key === "bgm") {
    if (s.bgm) unlockAudio();
    else stopBgm();
  }
  if (key === "sfxVolume" && ctx && sfxGain) {
    sfxGain.gain.setTargetAtTime(sfxTargetGain(s), ctx.currentTime, 0.015);
  }
  if (key === "bgmVolume" && ctx && bgmGain && s.bgm) {
    bgmGain.gain.setTargetAtTime(bgmTargetGain(s), ctx.currentTime, 0.02);
  }
  if (key === "bgmTrack") refreshBgmMix(true);
  // モード連動ではテーマも選曲に効くため、テーマ変更で選び直す
  if (key === "theme" && s.bgmTrack === "auto") refreshBgmMix(true);
});
