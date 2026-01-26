/**
 * 共通ユーティリティと入力検証
 */

// ==================== 入力検証・サニタイゼーション ====================

/**
 * ラベル名をサニタイズ（XSS対策）
 * @param {string} input - 入力されたラベル名
 * @returns {string} サニタイズされたラベル名
 */
export function sanitizeLabelName(input) {
  if (!input) return '';
  // HTMLタグや危険な文字を除去
  return input
    .trim()
    .replace(/[<>'"&]/g, '')
    .replace(/javascript:/gi, '')
    .substring(0, 100); // 最大100文字に制限
}

/**
 * コメントをサニタイズ
 * @param {string} input - 入力されたコメント
 * @returns {string} サニタイズされたコメント
 */
export function sanitizeComment(input) {
  if (!input) return '';
  return input
    .trim()
    .replace(/[<>'"&]/g, '')
    .replace(/javascript:/gi, '')
    .substring(0, 500); // 最大500文字に制限
}

/**
 * JSONデータを検証
 * @param {any} data - 検証するデータ
 * @throws {Error} 検証エラー
 */
export function validateKeyframesData(data) {
  const root = Array.isArray(data) ? { keyframes: data } : data;

  if (!root || typeof root !== 'object') {
    throw new Error('オブジェクトまたは配列の JSON を指定してください');
  }

  if (!Array.isArray(root.keyframes)) {
    throw new Error('"keyframes" 配列が見つかりません');
  }

  // キーフレーム数の制限
  if (root.keyframes.length > 10000) {
    throw new Error('キーフレームは最大10,000個までです');
  }

  for (let i = 0; i < root.keyframes.length; i++) {
    const kf = root.keyframes[i];

    if (!kf || typeof kf !== 'object') {
      throw new Error(`keyframes[${i}] がオブジェクトではありません`);
    }

    const time = Number(kf.time);
    if (!Number.isFinite(time) || time < 0) {
      throw new Error(`keyframes[${i}].time は 0 以上の数値で指定してください`);
    }

    // 時間の上限チェック（24時間 = 86400秒）
    if (time > 86400) {
      throw new Error(`keyframes[${i}].time が長すぎます（最大24時間）`);
    }
  }
}

// ==================== 数値・文字列処理 ====================

/**
 * 値を指定範囲にクランプ
 * @param {number} v - 値
 * @param {number} lo - 最小値
 * @param {number} hi - 最大値
 * @returns {number} クランプされた値
 */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 全角数字・記号を半角に正規化
 * @param {string} str - 入力文字列
 * @returns {string} 正規化された文字列
 */
export function normalizeNumberLikeText(str) {
  if (!str) return '';
  let out = str;
  // 全角数字・記号を半角に
  out = out.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  out = out.replace(/[：]/g, ':');
  out = out.replace(/[．。]/g, '.');
  out = out.replace(/[＋﹢]/g, '+');
  out = out.replace(/[－ーｰ―‐−﹣]/g, '-');
  out = out.replace(/[，、]/g, ',');
  return out;
}

/**
 * 時間を mm:ss.ms 形式にフォーマット
 * @param {number} sec - 秒数
 * @returns {string} フォーマットされた時間文字列
 */
export function formatTime(sec) {
  if (!Number.isFinite(sec)) return '--:--.---';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = Math.floor(s).toString().padStart(2, '0');
  const ms = Math.floor((s - Math.floor(s)) * 1000).toString().padStart(3, '0');
  return `${m.toString().padStart(2, '0')}:${ss}.${ms}`;
}

/**
 * 時間文字列をパース（絶対値または相対値）
 * @param {string} str - 入力文字列
 * @param {number} currentTime - 現在時刻（相対値計算用）
 * @param {number} duration - 音声の長さ
 * @returns {number|null} パースされた時間（秒）
 */
export function parseTimeInput(str, currentTime, duration) {
  if (!str) return null;
  const s = normalizeNumberLikeText(str).trim();
  if (!s) return null;

  const clampTime = (t) => clamp(t, 0, Number.isFinite(duration) ? duration : Infinity);

  const parseAbsolute = (text) => {
    const parts = text.split(':');
    if (parts.length === 1) {
      const v = parseFloat(parts[0]);
      return Number.isFinite(v) ? v : null;
    }
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const v = parseFloat(parts[i]);
      if (!Number.isFinite(v)) return null;
      total = total * 60 + v;
    }
    return total;
  };

  const parseDelta = (text) => {
    const sign = text.startsWith('-') ? -1 : 1;
    const body = text.slice(1);
    const absVal = parseAbsolute(body);
    if (absVal === null) return null;
    return clampTime(currentTime + sign * absVal);
  };

  // 相対時間 (+/-)
  if (s.startsWith('+') || s.startsWith('-')) {
    return parseDelta(s);
  }

  // 絶対時間
  const abs = parseAbsolute(s);
  if (abs === null) return null;
  return clampTime(abs);
}

// ==================== 色生成 ====================

/**
 * ラベル名から一貫した色を生成（HSLベース）
 * @param {string} label - ラベル名
 * @returns {string} CSS色文字列
 */
export function getLabelColor(label) {
  if (!label) return '#888888';
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 60%)`;
}

// ==================== 数学関数 ====================

/**
 * n 以上の最小の2のべき乗を返す
 * @param {number} n - 入力値
 * @returns {number} 2のべき乗
 */
export function nearestPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * n 以下の最大の2のべき乗を返す
 * @param {number} n - 入力値
 * @returns {number} 2のべき乗
 */
export function floorPow2(n) {
  let p = 1;
  while ((p << 1) <= n) p <<= 1;
  return p;
}

// ==================== ハッシュ (MD5) ====================

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

const MD5_K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }
  return k;
})();

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function toHex(val) {
  return (val >>> 0).toString(16).padStart(8, '0');
}

/**
 * ArrayBuffer から MD5 ハッシュを計算
 * @param {ArrayBuffer|TypedArray} buffer - 入力データ
 * @returns {string} 32文字の16進ハッシュ
 */
export function md5(buffer) {
  const src = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
  const data = new Uint8Array(src);
  const len = data.length;

  // パディング: 1bit (0x80) + 0埋め + 長さ64bit
  const withOne = len + 1;
  const padLen = (withOne % 64 <= 56) ? (56 - (withOne % 64)) : (56 + 64 - (withOne % 64));
  const totalLen = withOne + padLen + 8;
  const bytes = new Uint8Array(totalLen);
  bytes.set(data);
  bytes[len] = 0x80;

  const bitLen = len * 8;
  for (let i = 0; i < 8; i++) {
    bytes[totalLen - 8 + i] = (bitLen >>> (8 * i)) & 0xff;
  }

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const M = new Uint32Array(16);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4;
      M[i] = bytes[base] | (bytes[base + 1] << 8) | (bytes[base + 2] << 16) | (bytes[base + 3] << 24);
    }

    let A = a, B = b, C = c, D = d;

    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      const tmp = D;
      D = C;
      C = B;
      const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
      B = (B + rotl(sum, MD5_S[i])) >>> 0;
      A = tmp;
    }

    a = (a + A) >>> 0;
    b = (b + B) >>> 0;
    c = (c + C) >>> 0;
    d = (d + D) >>> 0;
  }

  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

// ==================== 双対数スライダー ====================

/**
 * 双対数スライダーのマッピングを作成
 * @param {Object} opts - オプション
 * @param {number} opts.min - 最小値
 * @param {number} opts.max - 最大値
 * @param {number} opts.steps - ステップ数
 * @returns {Object} マッピングオブジェクト
 */
export function createBiLogMapping({ min, max, steps }) {
  return { min, max, steps, mid: steps / 2 };
}

/**
 * スライダー値から倍率を計算
 * @param {number} value - スライダー値
 * @param {Object} map - マッピングオブジェクト
 * @returns {number} 倍率
 */
export function factorFromSlider(value, map) {
  const v = clamp(Number(value), 0, map.steps);
  const mid = map.mid;
  if (v === mid) return 1;
  if (v < mid) {
    const p = v / mid; // 0..1
    return map.min * Math.pow(1 / map.min, p);
  }
  const p = (v - mid) / mid; // 0..1
  return Math.pow(map.max, p);
}

/**
 * 倍率からスライダー値を計算
 * @param {number} factor - 倍率
 * @param {Object} map - マッピングオブジェクト
 * @returns {number} スライダー値
 */
export function sliderFromFactor(factor, map) {
  const f = clamp(factor, map.min, map.max);
  const mid = map.mid;
  if (Math.abs(f - 1) < 1e-12) return Math.round(mid);
  if (f < 1) {
    const p = Math.log(f / map.min) / Math.log(1 / map.min);
    return Math.round(p * mid);
  }
  const p = Math.log(f) / Math.log(map.max);
  return Math.round(mid + p * mid);
}

/**
 * 倍率をフォーマット
 * @param {number} factor - 倍率
 * @returns {string} フォーマットされた文字列
 */
export function formatFactor(factor) {
  if (factor >= 10) return factor.toFixed(0);
  if (factor >= 1) return factor.toFixed(2);
  if (factor >= 0.1) return factor.toFixed(3);
  return factor.toFixed(4);
}

// ==================== DOM ヘルパー ====================

/**
 * IDで要素を取得
 * @param {string} id - 要素ID
 * @returns {HTMLElement|null} DOM要素
 */
export function el(id) {
  return document.getElementById(id);
}

/**
 * 次のフレームまで待機
 * @returns {Promise<void>}
 */
export function yieldFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
