// 効果音・BGM。すべて WebAudio でリアルタイム合成する（音源ファイル不要）。
//
// - 効果音: playSfx(name)。設定 sfx=false なら無音。
// - BGM: 表・裏・穏やか・8-bit の 4 バスを持つ生成音楽。
//   設定やモード切替時はバスをクロスフェードしてシームレスに移行する。

import { AUDIO } from "../config.js";
import { getSettings, onSettingsChange } from "../core/settings.js";

let ctx = null;
let masterGain = null;
let sfxGain = null;
let bgmGain = null;
let busNormal = null; // 表 BGM 用バス
let busUso = null; // 裏 BGM 用バス
let busGentle = null; // 穏やかな Extra BGM
let busClassic = null; // 8-bit 風 Extra BGM
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
    desc: "DWORDle / DWORDlie に合わせて自動で切り替え",
    descEn: "Switch automatically between DWORDle and DWORDlie",
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

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = AUDIO.masterGain;
  masterGain.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = AUDIO.sfxGain;
  sfxGain.connect(masterGain);
  bgmGain = ctx.createGain();
  bgmGain.gain.value = AUDIO.bgmGain;
  bgmGain.connect(masterGain);
  busNormal = ctx.createGain();
  busUso = ctx.createGain();
  busGentle = ctx.createGain();
  busClassic = ctx.createGain();
  busNormal.connect(bgmGain);
  busUso.connect(bgmGain);
  busGentle.connect(bgmGain);
  busClassic.connect(bgmGain);
  const active = selectedTrack();
  for (const [id, bus] of Object.entries(bgmBuses())) bus.gain.value = id === active ? 1 : 0;
  return ctx;
}

function bgmBuses() {
  return { normal: busNormal, uso: busUso, gentle: busGentle, classic: busClassic };
}

// 最初のユーザー操作で呼ぶ（main.js が登録する）
export function unlockAudio() {
  if (!ensureContext()) return;
  if (ctx.state === "suspended") ctx.resume();
  if (getSettings().bgm) startBgm();
}

// 表 / 裏の切替。BGM はバスをクロスフェードしてシームレスに移行する。
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
  const t = ctx.currentTime;
  const FADE = AUDIO.bgmCrossfadeSec;
  const active = selectedTrack();
  for (const [id, bus] of Object.entries(bgmBuses())) {
    const on = id === active;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(on ? 1 : 0, t + FADE);
  }
  if (restartSchedule && bgmRunning) {
    if (bgmTimer) clearTimeout(bgmTimer);
    nextBarTime = t + 0.08;
    barIndex = 0;
    bgmLoop();
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
  src.connect(f).connect(g).connect(masterGain);
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
    tone({ freq: 1250, type: "triangle", dur: 0.05, gain: 0.25 });
    noise({ dur: 0.03, gain: 0.1, freq: 4000 });
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
  ui: () => tone({ freq: 880, type: "sine", dur: 0.06, gain: 0.15 }),
  swoosh: () => noise({ dur: 0.25, gain: 0.12, freq: 1200 }),
};

export function playSfx(name) {
  if (!getSettings().sfx) return;
  if (!ensureContext() || ctx.state === "suspended") return;
  SFX[name]?.();
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
function scheduleBarNormal(t0, chord) {
  const beat = 60 / NORMAL.tempo;
  const bus = busNormal;
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
function scheduleBarUso(t0, chord, bar) {
  const beat = 60 / USO.tempo;
  const bus = busUso;
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
function scheduleBarGentle(t0, chord, bar) {
  const beat = 60 / GENTLE.tempo;
  const bus = busGentle;
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
function scheduleBarClassic(t0, chord, bar) {
  const beat = 60 / CLASSIC.tempo;
  const bus = busClassic;
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

function bgmLoop() {
  if (!bgmRunning) return;
  // 選択中トラックを先読みスケジュールする。切替時は旧バスをフェードアウトする。
  while (true) {
    const track = selectedTrack();
    const mood = track === "uso" ? USO : track === "gentle" ? GENTLE : track === "classic" ? CLASSIC : NORMAL;
    const barDur = (60 / mood.tempo) * 4;
    if (nextBarTime >= ctx.currentTime + barDur * 1.5) break;
    const chord = mood.chords[barIndex % mood.chords.length];
    if (track === "uso") scheduleBarUso(nextBarTime, chord, barIndex);
    else if (track === "gentle") scheduleBarGentle(nextBarTime, chord, barIndex);
    else if (track === "classic") scheduleBarClassic(nextBarTime, chord, barIndex);
    else scheduleBarNormal(nextBarTime, chord);
    nextBarTime += barDur;
    barIndex++;
  }
  bgmTimer = setTimeout(bgmLoop, 300);
}

export function startBgm() {
  if (!ensureContext() || bgmRunning) return;
  bgmRunning = true;
  const t = ctx.currentTime;
  bgmGain.gain.cancelScheduledValues(t);
  bgmGain.gain.setValueAtTime(bgmGain.gain.value, t);
  bgmGain.gain.linearRampToValueAtTime(AUDIO.bgmGain, t + 0.25);
  refreshBgmMix(false);
  nextBarTime = ctx.currentTime + 0.1;
  bgmLoop();
}

export function stopBgm() {
  bgmRunning = false;
  if (bgmTimer) clearTimeout(bgmTimer);
  if (ctx && bgmGain) {
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
  if (key === "bgmTrack") refreshBgmMix(true);
});
