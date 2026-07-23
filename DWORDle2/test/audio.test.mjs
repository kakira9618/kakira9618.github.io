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

const windowListeners = new Map();
globalThis.window = {
  AudioContext: FakeAudioContext,
  addEventListener: (type, listener) => windowListeners.set(type, listener),
};

const { AUDIO } = await import("../js/config.js?v=20260723-fa");
const { setSetting } = await import("../js/core/settings.js?v=20260723-fa");
const { audioNeedsRecovery, currentBgmTrackId, playSfx, rewindBgm, unlockAudio, setUsoMood, stopBgm, BGM_TRACKS } = await import("../js/audio/sound.js");

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
// クラシックテーマの表・裏の曲（と旧・表裏の Letter Minuet / Letter Lament）は初期状態で解放されていること
for (const id of ["classic", "darkbit", "glitch", "retro"]) {
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

// クラシックテーマの裏モードでは Glitch 8-bit（Classic 8-bit と対のダーク 8bit）が選ばれること
const classicUsoFreqs = scheduledAfter(() => setSetting("theme", "classic"));
assert(
  classicUsoFreqs.some((freq) => Math.abs(freq - bellHz(76)) < 0.01), // Glitch 8-bit のブラウン管の鐘（E5）
  "uso mood on the Classic theme should schedule Glitch 8-bit"
);
assert(
  !classicUsoFreqs.some((freq) => Math.abs(freq - bellHz(69)) < 0.01), // Letter Lament の弔鐘（A4）は鳴らない
  "the Classic theme's uso mode must no longer schedule Letter Lament by default"
);

// クラシックテーマの表モードでは Classic 8-bit が選ばれること
const classicFreqs = scheduledAfter(() => setUsoMood(false));
assert.equal(currentBgmTrackId(), "classic", "auto BGM should resolve to Classic 8-bit while the Classic theme is active");
assert(classicFreqs.length > 0, "switching back to normal mood should reschedule BGM");
assert(
  !classicFreqs.some((freq) => Math.abs(freq - bellHz(91)) < 0.01), // Letter Minuet のチェレスタ（G6）は鳴らない
  "the Classic theme's normal mode must no longer schedule Letter Minuet"
);

// 扉絵の「開始」用の巻き戻し: 小節位置が進んだ状態からの再開は進んだ小節の続きになるが、
// rewindBgm() を挟むと曲頭（1 小節目）から予約し直される。
// Classic 8-bit のベース頭（小節コードのルート - 24）で小節位置を識別する:
// 3 小節目 (Bb) のベース頭 midi 34 は、巻き戻しなしの再開でだけ現れる。
// （この時点で直前の再スケジュールにより 1〜2 小節目が予約済み = 小節位置は 3 小節目）
// unlockAudio は resume 完了後の内部コールバック（BGM 再開ガード）を持つため、
// 同期キャプチャではなく await で内部処理まで消化してから次へ進む
// （消化しないと、最後の stopBgm() の後にガードが BGM ループを再始動して
// タイマーが残り、テストプロセスが終了しなくなる）。
const bassHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const beforeResume = rebuiltContext.startedFrequencies.length;
await unlockAudio({ restartBgm: true });
const resumeFreqs = rebuiltContext.startedFrequencies.slice(beforeResume);
assert(
  resumeFreqs.some((freq) => Math.abs(freq - bassHz(34)) < 0.01),
  "a restart without rewind should resume from the advanced bar position"
);
const beforeRewind = rebuiltContext.startedFrequencies.length;
rewindBgm();
await unlockAudio({ restartBgm: true });
const rewindFreqs = rebuiltContext.startedFrequencies.slice(beforeRewind);
assert(
  rewindFreqs.some((freq) => Math.abs(freq - bassHz(31)) < 0.01), // 2 小節目 (G) のベース頭
  "rewindBgm + restart should schedule the track from its first bars"
);
assert(
  !rewindFreqs.some((freq) => Math.abs(freq - bassHz(34)) < 0.01),
  "rewindBgm + restart must not resume from the middle of the track"
);

// ページを閉じるときのポップノイズ防止: pagehide でマスターが無音へフェードアウトし、
// bfcache からの復帰（persisted な pageshow）でのみ元の音量へ戻ること
const activeMasterGain = rebuiltContext.gains.find((gain) => gain.connections.includes(rebuiltContext.destination));
windowListeners.get("pagehide")();
assert.equal(activeMasterGain.gain.value, 0, "pagehide should fade the master gain out");
windowListeners.get("pageshow")({ persisted: false });
assert.equal(activeMasterGain.gain.value, 0, "a normal pageshow must not restore the master gain");
windowListeners.get("pageshow")({ persisted: true });
assert.equal(activeMasterGain.gain.value, AUDIO.masterGain, "pageshow from bfcache should restore the master gain");

// resume 前の新規 AudioContext への unlockAudio（扉絵「開始」と同じ経路）では、
// suspend 中の同期予約を破棄して復帰時刻で予約し直す。このとき小節位置を開始時へ
// 戻さないと、1〜2 小節目が捨てられて 3 小節目から始まってしまう不具合があった。
rebuiltContext.state = "closed";
rewindBgm();
await unlockAudio({ restartBgm: true });
const freshContext = FakeAudioContext.instance;
assert.notEqual(freshContext, rebuiltContext, "a closed audio context should be replaced");
assert(
  freshContext.startedFrequencies.some((freq) => Math.abs(freq - bassHz(36)) < 0.01), // 1 小節目 (C) のベース頭
  "a fresh-context unlock should schedule the track from its first bar"
);
assert(
  !freshContext.startedFrequencies.some((freq) => Math.abs(freq - bassHz(34)) < 0.01), // 3 小節目 (Bb) のベース頭
  "a fresh-context unlock must not skip to bar 3"
);

// 中断からの復帰タップで BGM を選曲した場合（設定画面の BGM 選択と同じ経路）:
// pointerdown の unlockAudio が resume を待つ間に、click の曲選択が小節位置を
// 曲頭へ戻す。resume 完了コールバックが復帰前の古い小節位置で上書きすると、
// 選んだ曲が途中の小節から始まってしまう不具合があった。
// 実際に鳴るのはコールバックの再予約分だけ（旧バスは破棄される）なので、
// その内容が Candy Pop の曲頭（1〜2 小節目）であることを確認する。
freshContext.state = "interrupted";
const pendingRecovery = unlockAudio({ restartBgm: true }); // pointerdown（await しない）
setSetting("bgmTrack", "pop"); // click: 曲選択
const beforeRecoveryCallback = freshContext.startedFrequencies.length;
await pendingRecovery;
await Promise.resolve();
const recoveryFreqs = freshContext.startedFrequencies.slice(beforeRecoveryCallback);
assert(
  recoveryFreqs.some((freq) => Math.abs(freq - bassHz(33)) < 0.01), // 2 小節目 (Am) のベースルート
  "selecting a track during audio recovery should schedule it from its first bars"
);
assert(
  !recoveryFreqs.some((freq) => Math.abs(freq - bassHz(29)) < 0.01), // 3 小節目 (F) のベースルート
  "selecting a track during audio recovery must not start it mid-track"
);

// 全トラックで同じ検証: 「開始」経路（wasRunning=false の unlockAudio）の予約内容が、
// 二重開始の起きない wasRunning=true の再開（= 必ず 1 小節目から）と周波数集合で一致すること。
// ランダム要素のある曲も比較できるよう乱数は固定する。
// （aurora は小節をまたいで持続する内部状態で旋律が変わる生成曲のため、集合比較の対象外）
const originalRandom = Math.random;
Math.random = () => 0.42;
try {
  for (const track of BGM_TRACKS.filter((t) => t.id !== "auto" && t.id !== "aurora")) {
    setSetting("bgmTrack", track.id);
    // 基準: running 状態での再開（1 小節目から）
    rewindBgm();
    const refBefore = FakeAudioContext.instance.startedFrequencies.length;
    await unlockAudio({ restartBgm: true });
    const refSet = new Set(FakeAudioContext.instance.startedFrequencies.slice(refBefore).map((f) => Math.round(f * 1000)));
    // 検証対象: 新規（suspend 中の）context での unlock = 扉絵「開始」経路
    FakeAudioContext.instance.state = "closed";
    rewindBgm();
    await unlockAudio({ restartBgm: true });
    const gateSet = new Set(FakeAudioContext.instance.startedFrequencies.map((f) => Math.round(f * 1000)));
    const extra = [...gateSet].filter((f) => !refSet.has(f));
    assert.equal(extra.length, 0, `track "${track.id}" must start from bar 1 (extra freqs: ${extra.slice(0, 8).join(", ")})`);
  }
} finally {
  Math.random = originalRandom;
}

// 聴取時間: BGM が実際に鳴っている間、選択中の曲へ累計時間が積まれる（お気に入り BGM の材料）
{
  const { getActivity } = await import("../js/core/activity.js?v=20260723-fa");
  setSetting("bgmTrack", "classic");
  const before = getActivity().usage.bgm.classic ?? 0;
  await new Promise((resolve) => setTimeout(resolve, 700)); // BGM ループ（300ms 周期）の 2 tick ぶん待つ
  const after = getActivity().usage.bgm.classic ?? 0;
  assert.ok(after > before, `listening time should accrue while the classic track plays (${before} -> ${after})`);
}

stopBgm();

// 停止中は聴取時間が積まれない
{
  const { getActivity } = await import("../js/core/activity.js?v=20260723-fa");
  const stopped = getActivity().usage.bgm.classic ?? 0;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(getActivity().usage.bgm.classic ?? 0, stopped, "listening time must not accrue after stopBgm");
}

console.log("音声テスト: OK");
