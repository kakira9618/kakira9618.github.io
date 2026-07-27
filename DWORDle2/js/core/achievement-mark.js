// 実績を「本当に初見の問題で達成したのか」を、あとから検証できる形で残すための署名。
//
// 保存するのは 8 桁の 16 進だけ。実績 ID・状態・解除時刻を混ぜてから作るので、
//   - 同じ状態でも実績ごとに違う値になる（並べても状態を突き合わせられない）
//   - 書き出した JSON を眺めただけでは、どの状態なのか読み取れない
// 検証は verifyAchievementMark()。3 つの状態それぞれの署名を作り直し、一致したものが答え。
//
// 目隠しであって暗号ではない（js/core/secret.js と同じ方針）。ソースを読めば作り方は分かるし、
// 手で書き換えることもできる。狙いは「エクスポートした JSON を見ただけでは分からない」まで。
// MARK_SALT や作り方を変えると、それ以前に記録した署名はすべて「不明」になるので変えない。

export const MARK = {
  FRESH: "fresh", // その問題を遊ぶのが初めてのプレイで達成した
  REPLAY: "replay", // 過去に遊んだことのある問題で達成した（答えを知っていた可能性がある）
  RESTORED: "restored", // 履歴からの復元・インポートで解除。どちらだったかは分からない
};

// 検証で試す順。増やすときは末尾に足す（既存の署名の意味は変わらない）
export const MARK_STATES = [MARK.FRESH, MARK.REPLAY, MARK.RESTORED];

const MARK_SALT = "d2.mk.9f13";
const MARK_LENGTH = 8; // 16 進 8 桁 = 32bit

// 32bit のハッシュ。FNV-1a と djb2 を回してから撹拌し、桁の偏りを散らす。
function hash32(text) {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ code) >>> 0;
  }
  let mixed = (Math.imul(fnv ^ (djb >>> 15), 0x85ebca6b) ^ Math.imul(djb ^ (fnv >>> 13), 0xc2b2ae35)) >>> 0;
  mixed = (mixed ^ (mixed >>> 16)) >>> 0;
  return mixed;
}

// 実績 ID・状態・解除時刻から署名を作る。同じ入力からは必ず同じ値になる。
export function signAchievement(id, state, unlockedAt) {
  return hash32(`${MARK_SALT}|${id}|${state}|${unlockedAt}`).toString(16).padStart(MARK_LENGTH, "0");
}

// 署名がどの状態のものかを返す。付いていない / 合わないときは null（不明・改ざん）。
export function verifyAchievementMark(id, mark, unlockedAt) {
  if (typeof mark !== "string" || mark.length !== MARK_LENGTH) return null;
  return MARK_STATES.find((state) => signAchievement(id, state, unlockedAt) === mark) ?? null;
}
