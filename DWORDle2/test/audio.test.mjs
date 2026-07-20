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

  start() {}
  stop() {}
}

class FakeBufferSource extends FakeNode {
  start() {}
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 48000;
    this.state = "running";
    this.destination = new FakeNode(this);
    this.gains = [];
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
  resume() {}
}

globalThis.window = { AudioContext: FakeAudioContext };

const { setSetting } = await import("../js/core/settings.js");
const { unlockAudio, setUsoMood, stopBgm } = await import("../js/audio/sound.js");

unlockAudio();
for (let i = 0; i < 12; i++) setUsoMood(i % 2 === 0);

const context = FakeAudioContext.instance;
const masterGain = context.gains.find((gain) => gain.connections.includes(context.destination));
const outputGains = context.gains.filter((gain) => gain.connections.includes(masterGain));
const bgmGain = outputGains.find((gain) => Math.abs(gain.gain.value - 0.16) < 1e-9);
const sfxGain = outputGains.find((gain) => gain !== bgmGain);
const currentBuses = context.gains.filter((gain) => gain.connections.includes(bgmGain));

assert.equal(currentBuses.length, 4, "only the current four BGM buses should remain connected");
assert(context.gains.filter((gain) => gain.disconnected).length >= 4, "old BGM buses should be disconnected");

setSetting("bgmVolume", 50);
setSetting("sfxVolume", 25);
assert.equal(bgmGain.gain.value, 0.08);
assert.equal(sfxGain.gain.value, 0.125);

stopBgm();
console.log("音声テスト: OK");
