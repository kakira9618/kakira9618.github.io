import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, HIDDEN_THEMES, normalizeVolume } from "../js/core/settings.js";
import { shouldReduceMotion } from "../js/core/motion.js";

assert.equal(DEFAULT_SETTINGS.sfxVolume, 100);
assert.equal(DEFAULT_SETTINGS.bgmVolume, 100);
assert.equal(DEFAULT_SETTINGS.keyboardHints, true);
assert.equal(HIDDEN_THEMES.find((theme) => theme.id === "pop")?.name, "ポップ");
assert.equal(HIDDEN_THEMES.find((theme) => theme.id === "pop")?.nameEn, "Pop");

assert.equal(normalizeVolume(-10), 0);
assert.equal(normalizeVolume(0), 0);
assert.equal(normalizeVolume("42"), 42);
assert.equal(normalizeVolume(55.6), 56);
assert.equal(normalizeVolume(120), 100);
assert.equal(normalizeVolume("invalid"), 100);

assert.equal(shouldReduceMotion({ ...DEFAULT_SETTINGS, reduceFx: false }, false), false);
assert.equal(shouldReduceMotion({ ...DEFAULT_SETTINGS, reduceFx: true }, false), true);
assert.equal(shouldReduceMotion({ ...DEFAULT_SETTINGS, reduceFx: false }, true), true);

console.log("設定テスト: OK");
