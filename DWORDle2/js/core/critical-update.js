// 緊急更新（強制リロード）の判断。
//
// 通常のデプロイは、扉絵の間なら自動リロード、プレイ中ならトーストで知らせるだけに留める
// （main.js の controllerchange）。出題や保存データが壊れているなど、古いコードを使い
// 続けてほしくないデプロイに限り、sw.js に緊急フラグを焼き込んで
// 全クライアントへ強制リロードを配る（`npm run hash -- --force-reload`）。
//
// この仕組みは「受信側が載っているクライアント」にしか効かない。つまり緊急時に慌てて
// 入れても間に合わないので、平時から積んでおくためのもの。一度もアプリを開かない
// オフライン PWA には、どうやっても届かない。
//
// 守ること:
// - 進行中の EXTRA SHOT を奪わない。リロードすると追加推理のチャンスは消滅するので
//   （game-screen.js 冒頭の仕様）、安全な状態になるまで待ってからリロードする
// - リロードループに入らない。新しいコードが載らないまま同じフラグを受け取り続けても、
//   1 つのハッシュにつき 1 回しか強制しない

import { loadJSON, saveJSON } from "./store.js?v=20260728-a";

export const CRITICAL_RELOAD = {
  noticeMs: 5000, // 予告してから実際にリロードするまで
  recheckMs: 1000, // 安全になったかを見に行く間隔
};

// 強制済みのハッシュ。リロードを跨いで残す必要があるので localStorage に置く
const DONE_KEY = "criticalReloadHash";

const blockers = new Set();
let pending = null;

// 「いまリロードすると失われるものがある」間だけ true を返す関数を登録する。
// 盤面は 1 手ごとに保存されるので通常のプレイ中は妨げない。
export function addReloadBlocker(isBlocked) {
  blockers.add(isBlocked);
  return () => blockers.delete(isBlocked);
}

export function isReloadBlocked() {
  for (const isBlocked of blockers) {
    try {
      if (isBlocked()) return true;
    } catch {
      // 判定できないものは妨げない（緊急更新を止める側に倒さない）
    }
  }
  return false;
}

export function wasCriticalReloadDone(hash) {
  return loadJSON(DONE_KEY, null) === hash;
}

// 緊急フラグ付きの更新を受け取ったときに呼ぶ。実際にリロードするなら true。
// notify / reload / schedule は UI と環境を持ち込まないための差し込み口（テストでも使う）。
export function requestCriticalReload(hash, options = {}) {
  const {
    notify = () => {},
    reload = () => location.reload(),
    schedule = (fn, ms) => setTimeout(fn, ms),
  } = options;
  if (!hash || pending) return false;
  if (wasCriticalReloadDone(hash)) return false; // この版はもう強制した。ループ防止
  pending = hash;

  const attempt = () => {
    if (isReloadBlocked()) {
      // 待つ側に上限は設けない。上限を切って割り込むと、結局 EXTRA SHOT を
      // 黙って奪うことになる（タブを閉じるか決着が付けば、そこで適用される）
      schedule(attempt, CRITICAL_RELOAD.recheckMs);
      return;
    }
    // リロードの前に記録する。読み込みに失敗しても同じ版で繰り返さない
    saveJSON(DONE_KEY, pending);
    notify();
    schedule(reload, CRITICAL_RELOAD.noticeMs);
  };
  attempt();
  return true;
}

// テスト用。1 プロセスで複数ケースを回すために内部状態を戻す
export function resetCriticalUpdateForTest() {
  pending = null;
  blockers.clear();
}
