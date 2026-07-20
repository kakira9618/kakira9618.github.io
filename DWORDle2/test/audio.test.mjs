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

  start() { this.context.startedOscillators++; }
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

const { setSetting } = await import("../js/core/settings.js");
const { audioNeedsRecovery, playSfx, unlockAudio, setUsoMood, stopBgm } = await import("../js/audio/sound.js");

setSetting("bgm", false);
playSfx("ui");
const context = FakeAudioContext.instance;
assert.equal(context.startedOscillators, 0, "SFX should wait until the audio context resumes");
assert.equal(await unlockAudio(), true);
assert.equal(context.startedOscillators, 1, "the first SFX should play after the audio context resumes");
setSetting("bgm", true);
await unlockAudio();
assert.equal(audioNeedsRecovery(), false, "running BGM should not be restarted on every input");
for (let i = 0; i < 12; i++) setUsoMood(i % 2 === 0);

const masterGain = context.gains.find((gain) => gain.connections.includes(context.destination));
const outputGains = context.gains.filter((gain) => gain.connections.includes(masterGain));
const bgmGain = outputGains.find((gain) => Math.abs(gain.gain.value - 0.16) < 1e-9);
const sfxGain = outputGains.find((gain) => gain !== bgmGain);
const currentBuses = context.gains.filter((gain) => gain.connections.includes(bgmGain));

assert.equal(currentBuses.length, 4, "only the current four BGM buses should remain connected");
assert(context.gains.filter((gain) => gain.disconnected).length >= 4, "old BGM buses should be disconnected");

const disconnectedBeforeReloadRestart = context.gains.filter((gain) => gain.disconnected).length;
await unlockAudio({ restartBgm: true });
await Promise.resolve();
assert(
  context.gains.filter((gain) => gain.disconnected).length >= disconnectedBeforeReloadRestart + 4,
  "reload recovery should rebuild the four BGM buses"
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
void unlockAudio();
const resumeCallsAfterStall = rebuiltContext.resumeCalls;
assert.equal(await unlockAudio(), true, "a new user operation should bypass a stalled Safari resume promise");
assert.equal(rebuiltContext.resumeCalls, resumeCallsAfterStall + 1);

stopBgm();
console.log("音声テスト: OK");
