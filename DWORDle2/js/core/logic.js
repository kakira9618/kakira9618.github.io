// ゲーム判定ロジック。原作 DWORDle の Logic.tonyu の忠実な移植。
//
// 互換性が命のモジュール。以下は原作の挙動そのままにしてある:
// - 乱数: x <- x * 48271 % N を状態ごと引き回す独自 LCG（Logic.getNextInt）
// - 答えの選び方: 1 語目を選んだ後、リスト末尾と交換してから 2 語目を選ぶ
// - queryWord: 緑（両答えのどちらかと位置一致）→ 黄（両答えの未消費文字に存在）
//   の順で、ans1 のフラグを優先して消費する
//
// 出題の選び方だけは 2 系統ある（判定ルールは共通）。Cls.（旧出題）・2026-08-01 より前の
// デイリー・旧作からインポートしたデイリー（classic-daily 帯）は上の原作 LCG、
// それ以外は下の pickAnsNew。どの PID がどちらかは problems.js の usesNewGenerator() が決める。

import { ALL_WORDS } from "../data/words.js?v=20260806-a";
import { candidateWordsForPID, isDailyPID, problemNumber, usesNewGenerator } from "./problems.js?v=20260806-a";

export const CELL = {
  GUESSING: "guessing",
  UNUSED: "unused", // 灰
  USED: "used", // 黄
  CORRECT: "correct", // 緑
};

const allWordsSet = new Set(ALL_WORDS);

// ---- 新出題の乱数 ----
//
// 原作 LCG は i2 が i1 だけから決まるため、出題の組み合わせが候補語数どまりだった
// （やさしい語彙は 236 語しかないので、No.1-9999 に 236 通りの出題が 43 回ずつ繰り返されていた）。
// さらに番号を 1 増やすと答えの位置が一定量だけずれる等差数列なので、今日の答えから
// 明日の答えを逆算できた。ここでは番号をハッシュしてから 2 語を独立に引き、どちらも解消する。
//
// 32bit 整数演算（Math.imul）だけで組み立て、浮動小数を挟まない。どの端末・どのブラウザでも
// 同じ番号から必ず同じ出題になることが、この機能の前提なので崩さないこと。
//
// シード文字列の "r1" は出題の世代を表すだけで、これ自体は互換性を守らない。
// この定数を "dw2r2:" に書き換えると、既存の No. と 2026-08-01 以降のデイリーの答えが
// すべて変わってしまう。将来また抽選を作り直すときは、今回と同じように
// 「どの PID を新しい世代で引くか」を problems.js の usesNewGenerator() 側で分けること
// （新しい番号帯を足す / デイリーは切り替え日で区切る）。世代ごとに違う接頭辞を渡す。
const NEW_SEED_PREFIX = "dw2r1:";

// FNV-1a。番号の近さをビットの近さとして残さないための撹拌
function hashSeedText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash >>> 0;
}

function splitmix32(state) {
  let x = state >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

// [0, n) の一様乱数。単純な剰余だと端数のぶんだけ小さい番号が出やすくなるので、
// 割り切れない上端を捨ててから剰余を取る。
function nextBelow(next, n) {
  const limit = 0x100000000 - (0x100000000 % n);
  let value = next();
  while (value >= limit) value = next();
  return value % n;
}

export class Logic {
  constructor(seed) {
    this.setSeed(seed);
  }

  // 原作 Logic.resetSeed() 相当。原作は共有リストの swap を戻してから選び直すが、
  // 本実装は毎回コピーの上で選ぶので、単に再抽選すればよい。
  setSeed(seed) {
    this.seed = seed;
    this.candWords = candidateWordsForPID(seed);
    if (usesNewGenerator(seed)) this.#pickAnsNew(seed);
    else this.#pickAns(seed);
  }

  // 新出題の抽選。2 語を独立に引くので、組み合わせは N×(N-1) 通りになる。
  #pickAnsNew(seed) {
    const words = this.candWords; // 交換しないので、共有リストをコピーせずそのまま読める
    const n = words.length;
    const next = splitmix32(hashSeedText(NEW_SEED_PREFIX + problemNumber(seed)));
    const i1 = nextBelow(next, n);
    let i2 = nextBelow(next, n - 1);
    if (i2 >= i1) i2++; // i1 を欠番にした番号として読み替える（2 語が同じにならない）
    this.ans1 = words[i1];
    this.ans2 = words[i2];
  }

  // 原作 Logic.pickAns() の移植。cand リストのコピー上で同じ手順を踏む。
  // LCG のシードは原作が使う値（Cls. は番号、デイリーは日付 YYYYMMDD）でなければならないので、
  // 内部 PID をそのまま使わず problemNumber で戻す（旧作インポートのデイリーは
  // classic-daily 帯へオフセットされているため）。
  #pickAns(seed) {
    const cand = this.candWords.slice();
    let x = problemNumber(seed);
    const nextInt = (n) => {
      x = (x * 48271) % n;
      return x;
    };

    const N = cand.length;
    const i1 = nextInt(N);
    this.ans1 = cand[i1];
    // 1 語目を末尾と交換（原作と同じ）
    const tmp = cand[N - 1];
    cand[N - 1] = this.ans1;
    cand[i1] = tmp;

    const i2 = nextInt(N - 1);
    this.ans2 = cand[i2];
  }

  isValidWord(word) {
    return allWordsSet.has(word);
  }

  isGameClear(word) {
    return word === this.ans1 || word === this.ans2;
  }

  matchWordNo(word) {
    if (word === this.ans1) return 1;
    if (word === this.ans2) return 2;
    return 0;
  }

  // EXTRA SHOT 用: word が答えの一方なら、もう一方の答えを返す
  otherAnswer(word) {
    if (word === this.ans1) return this.ans2;
    if (word === this.ans2) return this.ans1;
    return null;
  }

  queryWord(word) {
    return queryWordPair(word, this.ans1, this.ans2);
  }

  get isDaily() {
    return isDailyPID(this.seed);
  }
}

// 原作 Logic.queryWord() の移植（answers を引数化したもの）。
export function queryWordPair(word, ans1, ans2) {
  const result = [CELL.UNUSED, CELL.UNUSED, CELL.UNUSED, CELL.UNUSED, CELL.UNUSED];
  const flags = [
    [0, 0, 0, 0, 0], // ans1 の各文字を判定に使ったか
    [0, 0, 0, 0, 0], // ans2 の各文字を判定に使ったか
  ];

  for (let i = 0; i < 5; i++) {
    if (word[i] === ans1[i] || word[i] === ans2[i]) {
      result[i] = CELL.CORRECT;
      if (word[i] === ans1[i]) flags[0][i] = 1;
      else flags[1][i] = 1;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (result[i] === CELL.CORRECT) continue;
    for (let j = 0; j < 5; j++) {
      if (i === j) continue;
      if (flags[0][j] === 0 && word[i] === ans1[j]) {
        result[i] = CELL.USED;
        flags[0][j] = 1;
        break;
      } else if (flags[1][j] === 0 && word[i] === ans2[j]) {
        result[i] = CELL.USED;
        flags[1][j] = 1;
        break;
      }
    }
  }
  return result;
}

// 1 語だけを対象にした Wordle 標準の判定（旧 EXTRA SHOT 履歴の互換表示用）。
// 緑を先に確定し、残った文字から黄を左から順に消費する。
export function queryWordSingle(word, ans) {
  const result = [CELL.UNUSED, CELL.UNUSED, CELL.UNUSED, CELL.UNUSED, CELL.UNUSED];
  const consumed = [0, 0, 0, 0, 0]; // ans の各文字を判定に使ったか
  for (let i = 0; i < 5; i++) {
    if (word[i] === ans[i]) {
      result[i] = CELL.CORRECT;
      consumed[i] = 1;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === CELL.CORRECT) continue;
    for (let j = 0; j < 5; j++) {
      if (consumed[j] === 0 && word[i] === ans[j]) {
        result[i] = CELL.USED;
        consumed[j] = 1;
        break;
      }
    }
  }
  return result;
}

// 裏モード (DWORDlie) の嘘変換。原作 Game.usoConvert() の移植。
// 真の判定と必ず異なる状態を、残り 2 状態から等確率で返す（シード無し乱数）。
export function usoConvert(state, random = Math.random) {
  if (state === CELL.GUESSING) return CELL.GUESSING;
  const order = [CELL.UNUSED, CELL.USED, CELL.CORRECT];
  const v = order.indexOf(state);
  let r;
  do {
    r = Math.floor(random() * 3);
  } while (r === v);
  return order[r];
}

// 真の判定を、選択中のゲームモードで実際に見せる判定へ変換する。
// DWORDle はそのまま、DWORDlie は全マスで必ず嘘をつく。
// 通常 Guess と EXTRA SHOT の双方がこの関数を使い、判定規則のずれを防ぐ。
export function displayResultForMode(trueResult, mode, random = Math.random) {
  return mode === "uso"
    ? trueResult.map((state) => usoConvert(state, random))
    : trueResult.slice();
}
