/**
 * AudioContext と音声ファイルの管理
 * メモリリーク対策を含む
 */

let audioContext = null;
let audioBufferSrc = null;
let objectUrl = null;

/**
 * AudioContextを初期化または取得
 * @returns {AudioContext} AudioContextインスタンス
 */
export function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

/**
 * AudioContextを破棄（メモリリーク対策）
 * @returns {Promise<void>}
 */
export async function destroyAudioContext() {
  if (audioContext) {
    try {
      if (audioContext.state !== 'closed') {
        await audioContext.close();
      }
    } catch (e) {
      console.warn('AudioContext close failed:', e);
    }
    audioContext = null;
  }
}

/**
 * AudioContextの状態を取得
 * @returns {string|null} 'suspended' | 'running' | 'closed' | null
 */
export function getAudioContextState() {
  return audioContext ? audioContext.state : null;
}

/**
 * AudioBufferを取得
 * @returns {AudioBuffer|null}
 */
export function getAudioBuffer() {
  return audioBufferSrc;
}

/**
 * AudioBufferを設定
 * @param {AudioBuffer} buffer
 */
export function setAudioBuffer(buffer) {
  audioBufferSrc = buffer;
}

/**
 * サンプルレートを取得
 * @returns {number|null}
 */
export function getSampleRate() {
  return audioBufferSrc ? audioBufferSrc.sampleRate : null;
}

/**
 * 音声ファイルをデコード
 * @param {File} file - 音声ファイル
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = ensureAudioContext();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  audioBufferSrc = audioBuffer;
  return audioBuffer;
}

/**
 * Object URLを作成
 * @param {File} file - ファイル
 * @returns {string} Object URL
 */
export function createObjectURL(file) {
  // 既存のURLを破棄
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
  objectUrl = URL.createObjectURL(file);
  return objectUrl;
}

/**
 * Object URLを破棄
 */
export function revokeObjectURL() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

/**
 * ファイルが音声ファイルかチェック
 * @param {File} file - チェックするファイル
 * @returns {boolean}
 */
export function isAudioFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('audio/')) return true;
  return /\.(mp3|wav|ogg|flac|m4a)$/i.test(file.name || '');
}

/**
 * すべてのリソースをクリーンアップ
 * @returns {Promise<void>}
 */
export async function cleanup() {
  revokeObjectURL();
  audioBufferSrc = null;
  await destroyAudioContext();
}
