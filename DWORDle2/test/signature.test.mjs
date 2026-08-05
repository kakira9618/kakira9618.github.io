// エクスポート JSON の署名（HMAC-SHA-256）のテスト。
// 実行: node test/signature.test.mjs

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const { canonicalJSON, signPayload, signatureAvailable, verifyPayload } =
  await import("../js/core/signature.js?v=20260806-a");

assert.equal(signatureAvailable(), true, "Node でも crypto.subtle が使えるはず");

// ---- canonical 化: キーの順番や空白に依存しない ----
assert.equal(canonicalJSON({ b: 1, a: 2 }), canonicalJSON({ a: 2, b: 1 }));
assert.equal(canonicalJSON({ a: [1, { d: 4, c: 3 }] }), '{"a":[1,{"c":3,"d":4}]}');
assert.equal(canonicalJSON([1, "x", true, null]), '[1,"x",true,null]');
assert.equal(canonicalJSON(undefined), "null", "undefined でも壊れないはず");
assert.notEqual(canonicalJSON({ a: 1 }), canonicalJSON({ a: "1" }), "型が違えば別物として扱うはず");
// 配列は順番が意味を持つので、並べ替えたら別物
assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));

// ---- 署名: 同じ内容なら同じ、1 か所でも変われば変わる ----
const payload = { app: "dwordle2", version: 2, history: [{ startTime: 1, guessWord: ["about"] }] };
const signature = await signPayload(payload);
assert.match(signature, /^[0-9a-f]{64}$/, "HMAC-SHA-256 の 16 進 64 桁のはず");
assert.equal(await signPayload({ version: 2, history: payload.history, app: "dwordle2" }), signature);
assert.notEqual(await signPayload({ ...payload, version: 3 }), signature);

// 本物の HMAC-SHA-256 であること（Node の crypto と突き合わせる）
assert.equal(
  createHmac("sha256", "dwordle2.history.v1.6f2a9c47").update(canonicalJSON(payload)).digest("hex"),
  signature,
  "canonical 文字列に対する HMAC-SHA-256 になっているはず"
);

// ---- 照合 ----
assert.equal(await verifyPayload(payload, signature), true);
assert.equal(await verifyPayload({ ...payload, version: 3 }, signature), false);
assert.equal(await verifyPayload(payload, "not-a-signature"), false, "形式違いは例外にせず false のはず");
assert.equal(await verifyPayload(payload, undefined), false);
assert.equal(await verifyPayload(payload, `${signature}00`), false);

console.log("エクスポート署名テスト: OK");
