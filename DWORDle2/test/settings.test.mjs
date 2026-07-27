import assert from "node:assert/strict";

// 音量スケールの移行を確かめるため、モジュール読み込み前に localStorage を用意する
// （settings.js は import 時に保存値を読んで移行を走らせる）。
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const { DEFAULT_SETTINGS, HIDDEN_THEMES, normalizeVolume } = await import("../js/core/settings.js?v=20260728-a");
const { shouldReduceMotion } = await import("../js/core/motion.js?v=20260728-a");
const { AUDIO } = await import("../js/config.js?v=20260728-a");

// 音量は AUDIO.volumeUnityPercent (50) が従来の音量で、100 まで上げると 2 倍になる
assert.equal(DEFAULT_SETTINGS.sfxVolume, AUDIO.volumeUnityPercent);
assert.equal(DEFAULT_SETTINGS.bgmVolume, AUDIO.volumeUnityPercent);
assert.equal(DEFAULT_SETTINGS.lockZoom, false, "zoom must be allowed unless the player locks it");
assert.equal(DEFAULT_SETTINGS.keyboardHints, true);
assert.equal(HIDDEN_THEMES.find((theme) => theme.id === "pop")?.name, "ポップ");
assert.equal(HIDDEN_THEMES.find((theme) => theme.id === "pop")?.nameEn, "Pop");

assert.equal(normalizeVolume(-10), 0);
assert.equal(normalizeVolume(0), 0);
assert.equal(normalizeVolume("42"), 42);
assert.equal(normalizeVolume(55.6), 56);
assert.equal(normalizeVolume(120), 100);
assert.equal(normalizeVolume("invalid"), DEFAULT_SETTINGS.sfxVolume);

assert.equal(shouldReduceMotion({ ...DEFAULT_SETTINGS, reduceFx: false }, false), false);
assert.equal(shouldReduceMotion({ ...DEFAULT_SETTINGS, reduceFx: true }, false), true);
assert.equal(shouldReduceMotion({ ...DEFAULT_SETTINGS, reduceFx: false }, true), true);

// 旧スケール（100% = 等倍）で保存された音量は、鳴り方が変わらないよう半分にして引き継ぐ。
// 移行は 1 度だけで、その後に保存した新スケールの値はそのまま読み戻せること。
{
  storage.clear();
  storage.set("dwordle2.settings", JSON.stringify({ sfxVolume: 100, bgmVolume: 60, theme: "classic" }));
  const legacy = await import("../js/core/settings.js?v=volume-scale-migration");
  assert.equal(legacy.getSettings().sfxVolume, 50, "old 100% must become the new 50% (same loudness)");
  assert.equal(legacy.getSettings().bgmVolume, 30, "old 60% must become the new 30% (same loudness)");
  assert.equal(legacy.getSettings().theme, "classic", "migration must not touch other settings");
  assert.equal(JSON.parse(storage.get("dwordle2.settings")).sfxVolume, 50, "the halved value must be saved");

  // 移行済みマーカーが立っているので、次の読み込みでは 2 重に半分にしない
  legacy.setSetting("sfxVolume", 80);
  const migrated = await import("../js/core/settings.js?v=volume-scale-migration-2");
  assert.equal(migrated.getSettings().sfxVolume, 80, "a value saved on the new scale must not be halved again");
}

// 移行前の保存値が無い（新規プレイヤー）ときは既定値のまま
{
  storage.clear();
  const fresh = await import("../js/core/settings.js?v=volume-scale-fresh");
  assert.equal(fresh.getSettings().sfxVolume, AUDIO.volumeUnityPercent);
  assert.equal(fresh.getSettings().bgmVolume, AUDIO.volumeUnityPercent);
  assert.equal(storage.get("dwordle2.settings"), undefined, "a fresh install must not rewrite settings on load");
}

console.log("設定テスト: OK");
