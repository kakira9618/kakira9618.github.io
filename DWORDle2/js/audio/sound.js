// 効果音・BGM。すべて WebAudio でリアルタイム合成する（音源ファイル不要）。
//
// - 効果音: playSfx(name)。設定 sfx=false なら無音。
// - BGM: トラックごとのバスを必要になった時だけ作る生成音楽。
//   曲の実体は TRACKS（テンポ・コード進行・1 小節のスケジューラ）に定義する。
//   設定やモード切替時はバスをクロスフェードしてシームレスに移行する。

import { AUDIO } from "../config.js";
import { getSettings, onSettingsChange } from "../core/settings.js";

let ctx = null;
let masterGain = null;
let sfxGain = null;
let bgmGain = null;
let buses = new Map(); // trackId -> GainNode（遅延生成）
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
    desc: "プレイ中のモードに合う曲を自動で選択",
    descEn: "Automatically choose the track for the current mode",
  },
  {
    id: "normal",
    name: "DWORDle",
    nameEn: "DWORDle",
    desc: "明るいネオン・アンビエント",
    descEn: "Bright neon ambient",
  },
  {
    id: "uso",
    name: "DWORDlie",
    nameEn: "DWORDlie",
    desc: "暗く不穏なドローン",
    descEn: "Dark, ominous drone",
  },
  {
    id: "gentle",
    name: "Moonlit Calm",
    nameEn: "Moonlit Calm",
    desc: "怖さを抑えた、やさしい夜のアンビエント",
    descEn: "A gentle nighttime ambient track",
    unlockAchievement: "first-play",
    unlockLabel: "はじめの一歩",
    unlockLabelEn: "First Step",
  },
  {
    id: "classic",
    name: "Classic 8-bit",
    nameEn: "Classic 8-bit",
    desc: "原作を思わせる軽快なチップチューン",
    descEn: "An upbeat chiptune inspired by the original",
    unlockAchievement: "first-clear",
    unlockLabel: "初勝利",
    unlockLabelEn: "First Win",
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
    desc: "疾走感あふれるシンセウェーブ",
    descEn: "A driving synthwave sprint",
    unlockAchievement: "speed-60",
    unlockLabel: "スピードスター",
    unlockLabelEn: "Speed Star",
  },
  {
    id: "deepsea",
    name: "Deep Dive",
    nameEn: "Deep Dive",
    desc: "深海に沈むような静かなアンビエント",
    descEn: "A quiet ambient descent into the deep sea",
    unlockAchievement: "slow-10",
    unlockLabel: "熟考の人",
    unlockLabelEn: "Deep Thinker",
  },
  {
    id: "velvet",
    name: "Midnight Velvet",
    nameEn: "Midnight Velvet",
    desc: "真夜中のジャジーなスウィング",
    descEn: "A jazzy midnight swing",
    unlockAchievement: "night-owl",
    unlockLabel: "真夜中のワードラー",
    unlockLabelEn: "Midnight Wordler",
  },
  {
    id: "march",
    name: "Victory March",
    nameEn: "Victory March",
    desc: "勝利を讃えるファンファーレ行進曲",
    descEn: "A triumphant fanfare march",
    unlockAchievement: "wins-10",
    unlockLabel: "勝ち星コレクター",
    unlockLabelEn: "Win Collector",
  },
  {
    id: "abyssgate",
    name: "Abyss Gate",
    nameEn: "Abyss Gate",
    desc: "深淵の門をくぐる荘厳なドローン",
    descEn: "A solemn drone at the gate of the abyss",
    unlockAchievement: "extreme-clear",
    unlockLabel: "語彙の深淵",
    unlockLabelEn: "Vocabulary Abyss",
  },
  {
    id: "waltz",
    name: "Waltz of Lies",
    nameEn: "Waltz of Lies",
    desc: "嘘つきたちが回る不穏な三拍子",
    descEn: "An uneasy waltz for liars",
    unlockAchievement: "uso-5",
    unlockLabel: "嘘マスター",
    unlockLabelEn: "Lie Master",
  },
  {
    id: "lofi",
    name: "Rainy Bookshop",
    nameEn: "Rainy Bookshop",
    desc: "雨の日の本屋のようなローファイ",
    descEn: "Lo-fi like a bookshop on a rainy day",
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
    desc: "夜空に揺らめくオーロラのきらめき",
    descEn: "Shimmering lights across the night sky",
    unlockAchievement: "streak-5",
    unlockLabel: "連勝街道",
    unlockLabelEn: "Winning Road",
  },
  {
    id: "morning",
    name: "Morning Light",
    nameEn: "Morning Light",
    desc: "朝日のようにやわらかなアンビエント",
    descEn: "A soft ambient like the morning sun",
    unlockAchievement: "early-bird",
    unlockLabel: "早起きワードラー",
    unlockLabelEn: "Early Bird",
  },
  {
    id: "finale",
    name: "Grand Finale",
    nameEn: "Grand Finale",
    desc: "実績ハンターに贈る祝祭のフィナーレ",
    descEn: "A celebratory finale for achievement hunters",
    unlockAchievement: "collector",
    unlockLabel: "実績ハンター",
    unlockLabelEn: "Achievement Hunter",
  },
];

export function bgmTracksUnlockedBy(achievements) {
  const ids = new Set(achievements.map((achievement) => achievement.id));
  return BGM_TRACKS.filter((track) => track.unlockAchievement && ids.has(track.unlockAchievement));
}

function selectedTrack() {
  const wanted = getSettings().bgmTrack;
  if (wanted === "auto" || !BGM_TRACKS.some((track) => track.id === wanted)) {
    return usoMood ? "uso" : "normal";
  }
  return wanted;
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

// 予約済みの音源は接続先の旧バスごと切り離し、次の小節だけを新しいバスへ予約する。
// 高速なモード切替や BGM の再開で、過去と現在の小節が重なり続けるのを防ぐ。
function resetBgmBuses() {
  for (const bus of buses.values()) {
    bus.disconnect();
  }
  buses = new Map();
}

function clearAudioContextReferences() {
  if (bgmTimer) clearTimeout(bgmTimer);
  bgmTimer = null;
  bgmRunning = false;
  for (const node of [...buses.values(), bgmGain, sfxGain, masterGain]) {
    try {
      node?.disconnect();
    } catch {
      // Safari がすでに切断済みのノードを返しても、残りの状態は初期化する。
    }
  }
  ctx = null;
  masterGain = null;
  sfxGain = null;
  bgmGain = null;
  buses = new Map();
  nextBarTime = 0;
  barIndex = 0;
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
      stopBgm();
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
// 表 (normal): 明るめのアンビエント。Am–F–C–G、上昇アルペジオ + パッド + 丸いベース。
// 裏 (uso):    遅く暗いドローン。Am–Fm–E 系のクラスタパッド + 下降アルペジオ +
//              トライトーンの唸り + まばらな鐘。
// lookahead 方式で小節単位にスケジュールし、モードごとに専用バスへ流す。

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
const GENTLE = {
  tempo: 78,
  chords: [
    [60, 64, 67], // C
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [55, 59, 62], // G
  ],
};
const CLASSIC = {
  tempo: 112,
  chords: [
    [60, 64, 67], // C
    [55, 59, 62], // G
    [57, 60, 64], // Am
    [53, 57, 60], // F
  ],
};

let nextBarTime = 0;
let barIndex = 0;

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
    const delay = ctx.createDelay(2);
    delay.delayTime.value = beat * 1.5;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    osc.connect(g);
    g.connect(bus);
    g.connect(delay);
    delay.connect(fb).connect(bus);
    fb.connect(delay);
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

// Extra BGM: 柔らかいサイン波中心で、不穏な響きを避けた夜の曲。
function scheduleBarGentle(t0, chord, bar, bus) {
  const beat = 60 / GENTLE.tempo;
  for (const m of chord) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiHz(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.045, t0 + beat);
    g.gain.setValueAtTime(0.045, t0 + beat * 3);
    g.gain.linearRampToValueAtTime(0, t0 + beat * 4);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 4 + 0.1);
  }
  const pattern = [0, 2, 1, 2, 0, 1, 2, 1];
  pattern.forEach((note, i) => {
    if ((i + bar) % 3 === 1) return;
    const ti = t0 + i * beat / 2;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiHz(chord[note] + 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ti);
    g.gain.exponentialRampToValueAtTime(0.04, ti + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ti + beat * 0.8);
    osc.connect(g).connect(bus);
    osc.start(ti);
    osc.stop(ti + beat);
  });
}

// Extra BGM: 短い矩形波と三角波ベースの軽快な 8-bit アレンジ。
function scheduleBarClassic(t0, chord, bar, bus) {
  const beat = 60 / CLASSIC.tempo;
  for (let b = 0; b < 4; b++) {
    const ti = t0 + b * beat;
    const bass = ctx.createOscillator();
    bass.type = "triangle";
    bass.frequency.value = midiHz(chord[0] - 24 + (b === 3 ? 7 : 0));
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, ti);
    bg.gain.exponentialRampToValueAtTime(0.1, ti + 0.015);
    bg.gain.exponentialRampToValueAtTime(0.0001, ti + beat * 0.72);
    bass.connect(bg).connect(bus);
    bass.start(ti);
    bass.stop(ti + beat);
  }
  const melody = [0, 1, 2, 1, 2, 1, 0, 1];
  melody.forEach((note, i) => {
    const ti = t0 + i * beat / 2;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = midiHz(chord[note] + 12 + ((bar + i) % 8 === 7 ? 12 : 0));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ti);
    g.gain.exponentialRampToValueAtTime(0.027, ti + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ti + beat * 0.34);
    osc.connect(g).connect(bus);
    osc.start(ti);
    osc.stop(ti + beat * 0.45);
  });
}

// ---- Extra BGM 用の小さな音源ヘルパー ----

function bgmTone(bus, { midi, t, dur, type = "sine", gain = 0.05, attack = 0.01, detune = 0, bend = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(midiHz(midi), t);
  if (bend) osc.frequency.linearRampToValueAtTime(midiHz(midi + bend), t + dur);
  osc.detune.value = detune;
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

// ---- Extra BGM の 1 小節スケジューラ（12 曲）----

// Star Parade: 明るく弾むポップマーチ。裏拍のスタブと軽いハット。
function scheduleBarParade(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.parade.tempo;
  for (let b = 0; b < 4; b++) {
    bgmTone(bus, { midi: chord[0] - 24 + (b % 2 === 1 ? 7 : 0), t: t0 + b * beat, dur: beat * 0.55, type: "triangle", gain: 0.11, attack: 0.008 });
    bgmNoise(bus, { t: t0 + (b + 0.5) * beat, dur: 0.05, gain: 0.028, freq: 7500 });
    for (const m of chord) {
      bgmTone(bus, { midi: m, t: t0 + (b + 0.5) * beat, dur: beat * 0.28, type: "triangle", gain: 0.02 });
    }
  }
  const melody = [2, -1, 1, 2, 0, -1, 1, 2];
  melody.forEach((note, i) => {
    if (note < 0) return;
    const lift = bar % 4 === 3 && i >= 6 ? 12 : 0;
    bgmTone(bus, { midi: chord[note] + 12 + lift, t: t0 + i * beat / 2, dur: beat * 0.42, type: "square", gain: 0.028, attack: 0.006 });
  });
}

// Neon Rush: 8 分駆動のベースが走るシンセウェーブ。
function scheduleBarRush(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.rush.tempo;
  for (let i = 0; i < 8; i++) {
    const accent = i % 2 === 0;
    bgmTone(bus, { midi: chord[0] - 24 + (i === 7 ? 12 : 0), t: t0 + i * beat / 2, dur: beat * 0.4, type: "sawtooth", gain: accent ? 0.075 : 0.05, attack: 0.005 });
    if (i % 2 === 1) bgmNoise(bus, { t: t0 + i * beat / 2, dur: 0.04, gain: 0.024, freq: 8500 });
  }
  const arp = [0, 1, 2, 1];
  for (let i = 0; i < 16; i++) {
    if ((bar + Math.floor(i / 4)) % 2 === 1 && i % 4 === 3) continue;
    bgmTone(bus, { midi: chord[arp[i % 4]] + 12 + (i % 8 === 6 ? 12 : 0), t: t0 + i * beat / 4, dur: beat * 0.22, type: "sawtooth", gain: 0.02, detune: 6 });
  }
}

// Deep Dive: 深海。低い正弦のうねりとソナーピン。
function scheduleBarDeepsea(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.deepsea.tempo;
  for (const [m, det] of [[chord[0] - 24, -4], [chord[0] - 17, 4], [chord[1] - 12, 0]]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiHz(m);
    osc.detune.value = det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.07, t0 + beat * 1.6);
    g.gain.linearRampToValueAtTime(0.02, t0 + beat * 4);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 4 + 0.1);
  }
  bgmNoise(bus, { t: t0, dur: beat * 4, gain: 0.006, freq: 500, q: 0.4 });
  if (bar % 2 === 1) bgmBell(bus, { midi: chord[2] + 24, t: t0 + beat * 1.5, dur: 2.6, gain: 0.022 });
}

// Midnight Velvet: スウィングするジャズ風。7th コードとウォーキングベース。
function scheduleBarVelvet(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.velvet.tempo;
  const walk = [chord[0] - 24, chord[1] - 24, chord[2] - 24, chord[0] - 24 + (bar % 2 === 0 ? 2 : -1)];
  walk.forEach((m, b) => {
    bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.85, type: "triangle", gain: 0.085, attack: 0.012 });
  });
  for (const m of [...chord, chord[0] + 11]) {
    bgmTone(bus, { midi: m, t: t0 + beat * 1.5, dur: beat * 1.2, type: "triangle", gain: 0.017, detune: 5 });
  }
  for (let b = 0; b < 4; b++) {
    bgmNoise(bus, { t: t0 + b * beat, dur: 0.09, gain: 0.02, freq: 9000, q: 0.8 });
    bgmNoise(bus, { t: t0 + (b + 0.67) * beat, dur: 0.05, gain: 0.013, freq: 9500, q: 0.8 });
  }
  if (bar % 2 === 1) {
    const phrase = [chord[2] + 12, chord[1] + 12, chord[0] + 12];
    phrase.forEach((m, i) => {
      bgmTone(bus, { midi: m, t: t0 + (2 + i * 0.67) * beat, dur: beat * 0.55, type: "sine", gain: 0.038 });
    });
  }
}

// Victory March: ファンファーレ行進曲。1・3 拍のブラス風と 2・4 拍のスネア。
function scheduleBarMarch(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.march.tempo;
  for (const b of [0, 2]) {
    for (const m of chord) {
      bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.7, type: "sawtooth", gain: 0.022, detune: 7 });
      bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.7, type: "sawtooth", gain: 0.022, detune: -7 });
    }
    bgmTone(bus, { midi: chord[0] - 24, t: t0 + b * beat, dur: beat * 0.8, type: "triangle", gain: 0.1, attack: 0.01 });
  }
  for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.11, gain: 0.05, freq: 3400, q: 0.7 });
  if (bar % 4 === 3) {
    for (let i = 0; i < 6; i++) bgmNoise(bus, { t: t0 + (3.4 + i * 0.1) * beat, dur: 0.05, gain: 0.028, freq: 3400, q: 0.7 });
  }
  const fanfare = bar % 2 === 0 ? [0, 1, 2, -1] : [2, -1, 1, 0];
  fanfare.forEach((note, i) => {
    if (note < 0) return;
    bgmTone(bus, { midi: chord[note] + 12, t: t0 + i * beat, dur: beat * 0.5, type: "square", gain: 0.024, attack: 0.008 });
  });
}

// Abyss Gate: 荘厳なドローンと深い鐘。
function scheduleBarAbyssgate(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.abyssgate.tempo;
  for (const m of [chord[0] - 24, chord[0] - 17]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiHz(m);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(140, t0);
    f.frequency.linearRampToValueAtTime(500, t0 + beat * 2);
    f.frequency.linearRampToValueAtTime(140, t0 + beat * 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.08, t0 + 0.7);
    g.gain.setValueAtTime(0.08, t0 + beat * 4 - 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + beat * 4);
    osc.connect(f).connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + beat * 4 + 0.1);
  }
  bgmBell(bus, { midi: chord[0], t: t0, dur: 3.2, gain: 0.05 });
  if (bar % 2 === 1) {
    const climb = [chord[0], chord[1], chord[2]];
    climb.forEach((m, i) => {
      bgmTone(bus, { midi: m + 12, t: t0 + (1.5 + i * 0.75) * beat, dur: beat * 0.8, type: "triangle", gain: 0.03 });
    });
  }
}

// Waltz of Lies: 3 拍子。1 拍目のベースと 2・3 拍目の和音、回るメロディ。
function scheduleBarWaltz(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.waltz.tempo;
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 0.9, type: "triangle", gain: 0.1, attack: 0.01 });
  for (const b of [1, 2]) {
    for (const m of chord) {
      bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.5, type: "triangle", gain: 0.022, detune: b === 2 ? 6 : -6 });
    }
  }
  const spin = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]][bar % 4];
  spin.forEach((note, i) => {
    bgmTone(bus, { midi: chord[note] + 12 + (bar % 8 === 7 ? 12 : 0), t: t0 + (i + 0.5) * beat, dur: beat * 0.6, type: "sine", gain: 0.036 });
  });
}

// Rainy Bookshop: ローファイ。緩いエレピ風の 7th、ビニールノイズ、丸いキック。
function scheduleBarLofi(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.lofi.tempo;
  for (const [i, m] of [...chord, chord[0] + 10].entries()) {
    bgmTone(bus, { midi: m, t: t0 + 0.012 * i, dur: beat * 3.6, type: "triangle", gain: 0.026, detune: (i % 2 ? 9 : -9) });
  }
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 1.8, type: "sine", gain: 0.1, attack: 0.015 });
  bgmTone(bus, { midi: chord[2] - 24, t: t0 + beat * 2, dur: beat * 1.8, type: "sine", gain: 0.08, attack: 0.015 });
  for (const b of [0, 2.5]) bgmTone(bus, { midi: 32, t: t0 + b * beat, dur: 0.1, type: "sine", gain: 0.09, bend: -10 });
  for (const b of [1, 3]) bgmNoise(bus, { t: t0 + b * beat, dur: 0.08, gain: 0.03, freq: 4200, q: 0.6 });
  for (let i = 0; i < 7; i++) {
    bgmNoise(bus, { t: t0 + Math.random() * beat * 4, dur: 0.02, gain: 0.008, freq: 8800, q: 2.5 });
  }
}

// Bit Carnival: にぎやかなチップチューン。忙しい旋律とオクターブ跳躍。
function scheduleBarCarnival(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.carnival.tempo;
  for (let i = 0; i < 8; i++) {
    bgmTone(bus, { midi: chord[0] - 24 + (i % 2 === 1 ? 7 : 0), t: t0 + i * beat / 2, dur: beat * 0.3, type: "triangle", gain: 0.085, attack: 0.006 });
    bgmNoise(bus, { t: t0 + (i + 0.5) * beat / 2, dur: 0.025, gain: 0.02, freq: 9000 });
  }
  const jump = [0, 2, 1, 2, 0, 2, 1, 2, 2, 0, 1, 0, 2, 1, 2, 1];
  for (let i = 0; i < 16; i++) {
    const oct = i % 4 === 2 ? 24 : 12;
    bgmTone(bus, { midi: chord[jump[i]] + oct, t: t0 + i * beat / 4, dur: beat * 0.2, type: "square", gain: 0.022, attack: 0.004 });
  }
}

// Aurora: きらめく高音のスプリンクルと温かいパッド。
function scheduleBarAurora(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.aurora.tempo;
  for (const [i, m] of chord.entries()) {
    bgmTone(bus, { midi: m, t: t0, dur: beat * 4, type: "triangle", gain: 0.028, attack: beat, detune: i % 2 ? 7 : -7 });
  }
  bgmTone(bus, { midi: chord[0] - 24, t: t0, dur: beat * 4, type: "sine", gain: 0.07, attack: 0.05 });
  const penta = [0, 2, 4, 7, 9];
  const sprinkles = 5 + (bar % 3);
  for (let i = 0; i < sprinkles; i++) {
    const m = chord[0] + 24 + penta[Math.floor(Math.random() * penta.length)];
    const ti = t0 + Math.random() * beat * 3.5;
    bgmBell(bus, { midi: m, t: ti, dur: 1.4, gain: 0.02 });
  }
}

// Morning Light: add9 の柔らかいパッドとハープ風ロールアルペジオ。
function scheduleBarMorning(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.morning.tempo;
  for (const m of [...chord, chord[0] + 14]) {
    bgmTone(bus, { midi: m, t: t0, dur: beat * 4, type: "sine", gain: 0.03, attack: beat * 0.8 });
  }
  bgmTone(bus, { midi: chord[0] - 12, t: t0, dur: beat * 4, type: "sine", gain: 0.05, attack: 0.06 });
  const roll = [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12];
  roll.forEach((m, i) => {
    bgmTone(bus, { midi: m, t: t0 + i * 0.07, dur: beat * 1.6, type: "triangle", gain: 0.03, attack: 0.008 });
  });
  if (bar % 2 === 1) {
    bgmTone(bus, { midi: chord[2] + 12, t: t0 + beat * 2, dur: beat * 1.4, type: "sine", gain: 0.032 });
  }
}

// Grand Finale: 祝祭のフィナーレ。上昇カスケードとスネアロール。
function scheduleBarFinale(t0, chord, bar, bus) {
  const beat = 60 / TRACKS.finale.tempo;
  for (let b = 0; b < 4; b++) {
    for (const m of chord) {
      bgmTone(bus, { midi: m, t: t0 + b * beat, dur: beat * 0.5, type: "sawtooth", gain: 0.016, detune: b % 2 ? 8 : -8 });
    }
    bgmTone(bus, { midi: chord[0] - 24 + (b === 3 ? 5 : 0), t: t0 + b * beat, dur: beat * 0.6, type: "triangle", gain: 0.1, attack: 0.008 });
    bgmNoise(bus, { t: t0 + (b + 0.5) * beat, dur: 0.05, gain: 0.026, freq: 8000 });
  }
  const cascade = [0, 1, 2, 0, 1, 2, 0, 1];
  cascade.forEach((note, i) => {
    bgmTone(bus, { midi: chord[note] + 12 + Math.floor(i / 3) * 12, t: t0 + i * beat / 2, dur: beat * 0.4, type: "square", gain: 0.02, attack: 0.006 });
  });
  if (bar % 4 === 3) {
    for (let i = 0; i < 8; i++) bgmNoise(bus, { t: t0 + (3 + i * 0.125) * beat, dur: 0.06, gain: 0.02 + i * 0.003, freq: 3600, q: 0.7 });
  }
}

// 全トラックの定義。beats は 1 小節の拍数（ワルツのみ 3）。
const TRACKS = {
  normal: { ...NORMAL, beats: 4, schedule: scheduleBarNormal },
  uso: { ...USO, beats: 4, schedule: scheduleBarUso },
  gentle: { ...GENTLE, beats: 4, schedule: scheduleBarGentle },
  classic: { ...CLASSIC, beats: 4, schedule: scheduleBarClassic },
  parade: { tempo: 118, beats: 4, chords: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]], schedule: scheduleBarParade },
  rush: { tempo: 132, beats: 4, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], schedule: scheduleBarRush },
  deepsea: { tempo: 54, beats: 4, chords: [[50, 53, 57], [48, 52, 55], [46, 50, 53], [48, 52, 55]], schedule: scheduleBarDeepsea },
  velvet: { tempo: 84, beats: 4, chords: [[60, 64, 67], [57, 60, 64], [62, 65, 69], [55, 59, 62]], schedule: scheduleBarVelvet },
  march: { tempo: 108, beats: 4, chords: [[60, 64, 67], [65, 69, 72], [55, 59, 62], [60, 64, 67]], schedule: scheduleBarMarch },
  abyssgate: { tempo: 66, beats: 4, chords: [[45, 48, 52], [44, 48, 51], [41, 44, 48], [40, 44, 47]], schedule: scheduleBarAbyssgate },
  waltz: { tempo: 100, beats: 3, chords: [[57, 60, 64], [52, 56, 59], [53, 57, 60], [52, 56, 59]], schedule: scheduleBarWaltz },
  lofi: { tempo: 76, beats: 4, chords: [[60, 64, 67], [57, 60, 64], [65, 69, 72], [55, 59, 62]], schedule: scheduleBarLofi },
  carnival: { tempo: 140, beats: 4, chords: [[60, 64, 67], [65, 69, 72], [55, 59, 62], [57, 60, 64]], schedule: scheduleBarCarnival },
  aurora: { tempo: 70, beats: 4, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], schedule: scheduleBarAurora },
  morning: { tempo: 88, beats: 4, chords: [[60, 64, 67], [53, 57, 60], [57, 60, 64], [55, 59, 62]], schedule: scheduleBarMorning },
  finale: { tempo: 124, beats: 4, chords: [[60, 64, 67], [65, 69, 72], [57, 60, 64], [55, 59, 62]], schedule: scheduleBarFinale },
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

export function startBgm() {
  if (!ensureContext() || bgmRunning) return;
  resetBgmBuses();
  bgmRunning = true;
  const t = ctx.currentTime;
  bgmGain.gain.cancelScheduledValues(t);
  bgmGain.gain.setValueAtTime(bgmGain.gain.value, t);
  bgmGain.gain.linearRampToValueAtTime(bgmTargetGain(), t + 0.25);
  nextBarTime = ctx.currentTime + 0.1;
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
});
