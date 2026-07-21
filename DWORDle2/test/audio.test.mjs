import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};

class FakeParam {
  value = 0;

  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}

class FakeNode {
  constructor(context) {
    this.context = context;
    this.connections = [];
    this.disconnected = false;
  }

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.connections = [];
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  constructor(context) {
    super(context);
    this.gain = new FakeParam();
  }
}

class FakeOscillator extends FakeNode {
  constructor(context) {
    super(context);
    this.frequency = new FakeParam();
    this.detune = new FakeParam();
  }

  start() {
    this.context.startedOscillators++;
    this.context.startedFrequencies.push(this.frequency.value);
  }
  stop() {}
}

class FakeBufferSource extends FakeNode {
  start() {}
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 48000;
    this.state = "suspended";
    this.destination = new FakeNode(this);
    this.gains = [];
    this.startedOscillators = 0;
    this.startedFrequencies = [];
    this.resumeCalls = 0;
    FakeAudioContext.instances.push(this);
    FakeAudioContext.instance = this;
  }

  createGain() {
    const gain = new FakeGain(this);
    this.gains.push(gain);
    return gain;
  }

  createOscillator() { return new FakeOscillator(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createBiquadFilter() {
    const filter = new FakeNode(this);
    filter.frequency = new FakeParam();
    filter.Q = new FakeParam();
    return filter;
  }
  createDelay() {
    const delay = new FakeNode(this);
    delay.delayTime = new FakeParam();
    return delay;
  }
  createBuffer(_channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
  resume() {
    this.resumeCalls++;
    if (FakeAudioContext.holdNextResume) {
      FakeAudioContext.holdNextResume = false;
      return new Promise(() => {});
    }
    if (FakeAudioContext.failNextResume) {
      FakeAudioContext.failNextResume = false;
      return Promise.reject(new Error("Safari audio interruption"));
    }
    return Promise.resolve().then(() => {
      this.state = "running";
    });
  }
}

FakeAudioContext.instances = [];
FakeAudioContext.failNextResume = false;
FakeAudioContext.holdNextResume = false;

globalThis.window = { AudioContext: FakeAudioContext };

const { setSetting } = await import("../js/core/settings.js?v=20260722-bgm-unlock-batch");
const { audioNeedsRecovery, playSfx, unlockAudio, setUsoMood, stopBgm, BGM_TRACKS } = await import("../js/audio/sound.js");

setSetting("bgm", false);
playSfx("ui");
const context = FakeAudioContext.instance;
assert.equal(context.startedOscillators, 1, "SFX should be scheduled inside the first user operation");
assert.equal(await unlockAudio(), true);
const oscillatorsBeforeHelp = context.startedOscillators;
playSfx("help");
assert.equal(
  context.startedOscillators,
  oscillatorsBeforeHelp + 2,
  "opening Help should schedule its two-note SFX"
);
setSetting("bgm", true);
await unlockAudio();
assert.equal(audioNeedsRecovery(), false, "running BGM should not be restarted on every input");
for (let i = 0; i < 12; i++) setUsoMood(i % 2 === 0);

const masterGain = context.gains.find((gain) => gain.connections.includes(context.destination));
const outputGains = context.gains.filter((gain) => gain.connections.includes(masterGain));
const bgmGain = outputGains.find((gain) => Math.abs(gain.gain.value - 0.16) < 1e-9);
const sfxGain = outputGains.find((gain) => gain !== bgmGain);
const currentBuses = context.gains.filter((gain) => gain.connections.includes(bgmGain));

assert.equal(currentBuses.length, 1, "only the bus for the active track should remain connected");
assert(context.gains.filter((gain) => gain.disconnected).length >= 12, "old BGM buses should be disconnected");

const disconnectedBeforeReloadRestart = context.gains.filter((gain) => gain.disconnected).length;
await unlockAudio({ restartBgm: true });
await Promise.resolve();
assert(
  context.gains.filter((gain) => gain.disconnected).length >= disconnectedBeforeReloadRestart + 1,
  "reload recovery should rebuild the active BGM bus"
);

setSetting("bgmVolume", 50);
setSetting("sfxVolume", 25);
assert.equal(bgmGain.gain.value, 0.08);
assert.equal(sfxGain.gain.value, 0.125);

context.state = "closed";
assert.equal(audioNeedsRecovery(), true, "a closed Safari audio context should request recovery");
playSfx("ui");
const rebuiltContext = FakeAudioContext.instance;
assert.notEqual(rebuiltContext, context, "a closed Safari audio context should be replaced");
assert.equal(await unlockAudio(), true);

rebuiltContext.state = "interrupted";
FakeAudioContext.failNextResume = true;
assert.equal(await unlockAudio(), false, "an interrupted Safari audio context should fail cleanly");
assert.equal(FakeAudioContext.instance, rebuiltContext, "a temporarily interrupted context should be retained");
assert.equal(await unlockAudio(), true, "the next user operation should retry the same audio context");

rebuiltContext.state = "interrupted";
FakeAudioContext.holdNextResume = true;
const oscillatorsBeforeStalledResume = rebuiltContext.startedOscillators;
void unlockAudio({ restartBgm: true });
assert(
  rebuiltContext.startedOscillators > oscillatorsBeforeStalledResume,
  "Safari recovery should schedule BGM synchronously inside the user operation"
);
const resumeCallsAfterStall = rebuiltContext.resumeCalls;
assert.equal(await unlockAudio(), true, "a new user operation should bypass a stalled Safari resume promise");
assert.equal(rebuiltContext.resumeCalls, resumeCallsAfterStall + 1);

// すべての BGM トラック（隠し曲を含む）が選択でき、エラーなく音源を予約できること
assert(
  BGM_TRACKS.filter((track) => track.unlockAchievement).length >= 13,
  "there should be at least 13 unlockable hidden BGM tracks"
);
let previousStarts = rebuiltContext.startedOscillators;
for (const track of BGM_TRACKS.filter((track) => track.id !== "auto")) {
  setSetting("bgmTrack", track.id);
  assert(
    rebuiltContext.startedOscillators > previousStarts,
    `track "${track.id}" should schedule at least one oscillator`
  );
  previousStarts = rebuiltContext.startedOscillators;
}

// Pop テーマの表・裏の曲は Pop テーマ解放と同じ実績（rainbow）で解放されること
assert(
  BGM_TRACKS.some((track) => track.id === "pop" && track.unlockAchievement === "rainbow"),
  "the Candy Pop track should unlock together with the Pop theme (rainbow achievement)"
);
assert(
  BGM_TRACKS.some((track) => track.id === "bitter" && track.unlockAchievement === "rainbow"),
  "the Bitter Candy track should unlock together with the Pop theme (rainbow achievement)"
);
// クラシックテーマの表・裏の曲は初期状態で解放されていること
for (const id of ["retro", "glitch"]) {
  assert(
    BGM_TRACKS.some((track) => track.id === id && !track.unlockAchievement),
    `the "${id}" track should be unlocked from the start`
  );
}

// bgmBell が予約する第 2 倍音の周波数（各テーマ曲の自動選択を識別する）
const bellHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12) * 2.76;
const scheduledAfter = (fn) => {
  const before = rebuiltContext.startedFrequencies.length;
  fn();
  return rebuiltContext.startedFrequencies.slice(before);
};

// モード連動 + Pop テーマでは Candy Pop が自動選択されること
setSetting("bgmTrack", "auto");
const popBellHz = bellHz(84); // Candy Pop の小節あたまの鐘（C6）
const themeFreqs = scheduledAfter(() => setSetting("theme", "pop"));
assert(
  themeFreqs.some((freq) => Math.abs(freq - popBellHz) < 0.01),
  "auto BGM should schedule Candy Pop while the Pop theme is active"
);

// Pop テーマの裏モードでは Candy Pop ではなく Bitter Candy が選ばれること
const usoFreqs = scheduledAfter(() => setUsoMood(true));
assert(usoFreqs.length > 0, "switching to uso mood should reschedule BGM");
assert(
  !usoFreqs.some((freq) => Math.abs(freq - popBellHz) < 0.01),
  "uso mood should override the Pop theme track"
);
assert(
  usoFreqs.some((freq) => Math.abs(freq - bellHz(81)) < 0.01), // Bitter Candy のオルゴール（A5）
  "uso mood on the Pop theme should schedule Bitter Candy"
);

// クラシックテーマの裏モードでは Letter Lament が選ばれること
const classicUsoFreqs = scheduledAfter(() => setSetting("theme", "classic"));
assert(
  classicUsoFreqs.some((freq) => Math.abs(freq - bellHz(69)) < 0.01), // Letter Lament の弔鐘（A4）
  "uso mood on the Classic theme should schedule Letter Lament"
);

// クラシックテーマの表モードでは Letter Minuet が選ばれること
const classicFreqs = scheduledAfter(() => setUsoMood(false));
assert(
  classicFreqs.some((freq) => Math.abs(freq - bellHz(91)) < 0.01), // Letter Minuet のチェレスタ（G6）
  "auto BGM should schedule Letter Minuet while the Classic theme is active"
);

stopBgm();
console.log("音声テスト: OK");
