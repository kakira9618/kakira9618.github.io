import assert from "node:assert/strict";
import { FX } from "../js/config.js?v=20260723-fa";
import { randomTileLineScale } from "../js/fx/pop-background.js?v=20260723-fa";

assert.deepEqual(FX.popBg.tiles.scale, [0.5, 0.8]);
assert.equal(randomTileLineScale(() => 0), 0.5);
assert.equal(randomTileLineScale(() => 0.5), 0.65);
assert.equal(randomTileLineScale(() => 1), 0.8);

for (let i = 0; i < 100; i++) {
  const scale = randomTileLineScale();
  assert(scale >= 0.5 && scale <= 0.8, `tile-line scale should stay within 0.5-0.8: ${scale}`);
}

console.log("ポップ背景テスト: OK");
