import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeVolume } from "../js/core/settings.js";

assert.equal(DEFAULT_SETTINGS.sfxVolume, 100);
assert.equal(DEFAULT_SETTINGS.bgmVolume, 100);
assert.equal(DEFAULT_SETTINGS.keyboardHints, true);

assert.equal(normalizeVolume(-10), 0);
assert.equal(normalizeVolume(0), 0);
assert.equal(normalizeVolume("42"), 42);
assert.equal(normalizeVolume(55.6), 56);
assert.equal(normalizeVolume(120), 100);
assert.equal(normalizeVolume("invalid"), 100);

console.log("設定テスト: OK");
