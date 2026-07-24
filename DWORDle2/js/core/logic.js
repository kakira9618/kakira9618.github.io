// ゲーム判定ロジック。原作 DWORDle の Logic.tonyu の忠実な移植。
//
// 互換性が命のモジュール。以下は原作の挙動そのままにしてある:
// - 乱数: x <- x * 48271 % N を状態ごと引き回す独自 LCG（Logic.getNextInt）
// - 答えの選び方: 1 語目を選んだ後、リスト末尾と交換してから 2 語目を選ぶ
// - queryWord: 緑（両答えのどちらかと位置一致）→ 黄（両答えの未消費文字に存在）
//   の順で、ans1 のフラグを優先して消費する

import { ALL_WORDS } from "../data/words.js?v=20260723-fa";
import { candidateWordsForPID, isDailyPID } from "./problems.js?v=20260723-fa";

export const CELL = {
  GUESSING: "guessing",
  UNUSED: "unused", // 灰
  USED: "used", // 黄
  CORRECT: "correct", // 緑
};

const allWordsSet = new Set(ALL_WORDS);

export class Logic {
  constructor(seed) {
    this.setSeed(seed);
  }

  // 原作 Logic.resetSeed() 相当。原作は共有リストの swap を戻してから選び直すが、
  // 本実装は毎回コピーの上で選ぶので、単に再抽選すればよい。
  setSeed(seed) {
    this.seed = seed;
    this.candWords = candidateWordsForPID(seed);
    this.#pickAns(seed);
  }

  // 原作 Logic.pickAns() の移植。cand リストのコピー上で同じ手順を踏む。
  #pickAns(seed) {
    const cand = this.candWords.slice();
    let x = seed;
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
