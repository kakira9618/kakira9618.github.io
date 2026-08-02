// 緊急更新（強制リロード）の判断ロジックのテスト。
// 実行: node test/critical-update.test.mjs
//
// ここで守りたいのは 2 つ。
//  1. EXTRA SHOT のような「リロードで失われるもの」がある間はリロードしない
//  2. 同じ版に対して二度と強制しない（新コードが載らなくてもリロードループにしない）

import assert from "node:assert/strict";

// store.js は localStorage の薄いラッパなので、他のテストと同じ要領で差し替える
const data = new Map();
globalThis.localStorage = {
  getItem: (key) => (data.has(key) ? data.get(key) : null),
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
};

const {
  CRITICAL_RELOAD,
  addReloadBlocker,
  isReloadBlocked,
  requestCriticalReload,
  resetCriticalUpdateForTest,
  wasCriticalReloadDone,
} = await import("../js/core/critical-update.js?v=20260803-d");

// setTimeout の代わり。溜めたコールバックを好きなタイミングで進める
function fakeClock() {
  const queue = [];
  return {
    schedule: (fn, ms) => queue.push({ fn, ms }),
    pending: () => queue.length,
    delays: () => queue.map((entry) => entry.ms),
    runNext() {
      const entry = queue.shift();
      assert.ok(entry, "進めるタイマーが無い");
      entry.fn();
      return entry.ms;
    },
  };
}

function harness() {
  const clock = fakeClock();
  const calls = { notify: 0, reload: 0 };
  return {
    clock,
    calls,
    options: {
      notify: () => calls.notify++,
      reload: () => calls.reload++,
      schedule: clock.schedule,
    },
  };
}

// ---- 妨げるものが無ければ、予告してからリロードする ----
{
  resetCriticalUpdateForTest();
  const { clock, calls, options } = harness();
  assert.equal(requestCriticalReload("hash-simple", options), true);
  assert.equal(calls.notify, 1, "リロード前に必ず知らせる");
  assert.equal(calls.reload, 0, "予告なしに即リロードしない");
  assert.deepEqual(clock.delays(), [CRITICAL_RELOAD.noticeMs]);
  clock.runNext();
  assert.equal(calls.reload, 1);
}

// ---- EXTRA SHOT 中は、終わるまで待ってからリロードする ----
{
  resetCriticalUpdateForTest();
  const { clock, calls, options } = harness();
  let inExtraShot = true;
  addReloadBlocker(() => inExtraShot);
  assert.equal(isReloadBlocked(), true);

  requestCriticalReload("hash-blocked", options);
  assert.equal(calls.notify, 0, "EXTRA SHOT 中は予告もしない");
  assert.equal(calls.reload, 0);

  // 何度見に行っても、EXTRA SHOT が続く限りリロードしない
  for (let i = 0; i < 5; i++) {
    assert.equal(clock.runNext(), CRITICAL_RELOAD.recheckMs);
    assert.equal(calls.reload, 0, "EXTRA SHOT を奪ってはいけない");
  }
  assert.equal(
    wasCriticalReloadDone("hash-blocked"),
    false,
    "リロードしていない間は「強制済み」にしない（この版を取り逃がさないため）"
  );

  // 決着が付けば、次の確認で予告 → リロードへ進む
  inExtraShot = false;
  clock.runNext();
  assert.equal(calls.notify, 1);
  clock.runNext();
  assert.equal(calls.reload, 1);
}

// ---- 同じ版では二度と強制しない（リロードループ防止）----
{
  resetCriticalUpdateForTest();
  const first = harness();
  requestCriticalReload("hash-loop", first.options);
  first.clock.runNext();
  assert.equal(first.calls.reload, 1);
  assert.equal(wasCriticalReloadDone("hash-loop"), true);

  // リロード後（＝モジュールが読み直された状態）を模して内部状態を戻す
  resetCriticalUpdateForTest();
  const second = harness();
  assert.equal(
    requestCriticalReload("hash-loop", second.options),
    false,
    "同じハッシュの緊急更新を受け取り続けてもリロードし直さない"
  );
  assert.equal(second.calls.reload, 0);

  // 別の版なら改めて効く
  resetCriticalUpdateForTest();
  const third = harness();
  assert.equal(requestCriticalReload("hash-loop-2", third.options), true);
}

// ---- 判定できないブロッカーは緊急更新を止めない ----
{
  resetCriticalUpdateForTest();
  const { clock, calls, options } = harness();
  addReloadBlocker(() => {
    throw new Error("画面が初期化されていない");
  });
  assert.equal(isReloadBlocked(), false);
  requestCriticalReload("hash-throw", options);
  clock.runNext();
  assert.equal(calls.reload, 1, "ブロッカーが壊れていても緊急更新は届く");
}

// ---- 多重要求は 1 回にまとめる ----
{
  resetCriticalUpdateForTest();
  const { clock, calls, options } = harness();
  assert.equal(requestCriticalReload("hash-dup", options), true);
  assert.equal(requestCriticalReload("hash-dup", options), false, "処理中の要求は重ねない");
  assert.equal(calls.notify, 1);
  clock.runNext();
  assert.equal(calls.reload, 1);
  assert.equal(clock.pending(), 0);
}

// ---- ハッシュが無い通知は無視する ----
{
  resetCriticalUpdateForTest();
  const { calls, options } = harness();
  assert.equal(requestCriticalReload(null, options), false);
  assert.equal(requestCriticalReload("", options), false);
  assert.equal(calls.notify, 0);
}

console.log("緊急更新テスト: OK");
