/**
 * キーフレームの管理
 * 入力検証とサニタイゼーションを含む
 */

import { sanitizeLabelName, sanitizeComment, validateKeyframesData, getLabelColor } from './utils.js';
import * as HistoryManager from './history-manager.js';

let keyframes = [];
let allLabels = [];
let kfSeq = 1;
let lastEditedLabel = '';

// 履歴記録を一時的に無効化するフラグ（復元中に履歴を追加しないため）
let skipHistory = false;

/**
 * 現在の状態を履歴に保存
 */
function saveToHistory() {
  if (skipHistory) return;
  HistoryManager.pushState(keyframes);
}

/**
 * キーフレームを追加
 * @param {number} time - 時間（秒）
 * @param {string} label - ラベル（サニタイズ済み）
 * @param {string} comment - コメント（サニタイズ済み）
 * @param {string|null} pointId - Peaks.jsのポイントID
 * @returns {Object} 追加されたキーフレーム
 */
export function addKeyframe(time, label = '', comment = '', pointId = null) {
  // 履歴に保存
  saveToHistory();

  const id = `kf-${kfSeq++}`;
  const seq = kfSeq - 1;

  // 入力をサニタイズ
  const sanitizedLabel = sanitizeLabelName(label);
  const sanitizedComment = sanitizeComment(comment);

  const kf = {
    id,
    seq,
    time,
    label: sanitizedLabel,
    comment: sanitizedComment,
    pointId
  };

  keyframes.push(kf);

  if (sanitizedLabel) {
    lastEditedLabel = sanitizedLabel;
  }

  updateAllLabels();
  return kf;
}

/**
 * キーフレームを削除
 * @param {string} id - キーフレームID
 * @returns {Object|null} 削除されたキーフレーム
 */
export function removeKeyframe(id) {
  const index = keyframes.findIndex(k => k.id === id);
  if (index === -1) return null;

  // 履歴に保存
  saveToHistory();

  const removed = keyframes.splice(index, 1)[0];
  updateAllLabels();
  return removed;
}

/**
 * キーフレームを更新（サニタイゼーション付き）
 * @param {string} id - キーフレームID
 * @param {Object} updates - 更新内容
 * @param {boolean} saveHistory - 履歴に保存するかどうか（デフォルト: true）
 */
export function updateKeyframe(id, updates, saveHistory = true) {
  const kf = keyframes.find(k => k.id === id);
  if (!kf) return;

  // 履歴に保存（オプション）
  if (saveHistory) {
    saveToHistory();
  }

  if (updates.time !== undefined) {
    kf.time = updates.time;
  }
  if (updates.label !== undefined) {
    kf.label = sanitizeLabelName(updates.label);
    if (kf.label) lastEditedLabel = kf.label;
  }
  if (updates.comment !== undefined) {
    kf.comment = sanitizeComment(updates.comment);
  }
  if (updates.pointId !== undefined) {
    kf.pointId = updates.pointId;
  }

  updateAllLabels();
}

/**
 * すべてのキーフレームを取得
 * @returns {Array} キーフレーム配列
 */
export function getKeyframes() {
  return keyframes;
}

/**
 * IDでキーフレームを取得
 * @param {string} id - キーフレームID
 * @returns {Object|null}
 */
export function getKeyframeById(id) {
  return keyframes.find(k => k.id === id) || null;
}

/**
 * すべてのキーフレームをクリア
 */
export function clearKeyframes() {
  keyframes = [];
  allLabels = [];
  lastEditedLabel = '';
  // ファイルをクリアする際は履歴もクリア
  HistoryManager.clearHistory();
}

/**
 * キーフレームをインポート（検証とサニタイゼーション付き）
 * @param {Object|Array} data - インポートするデータ
 * @param {boolean} clearHistoryOnImport - インポート時に履歴をクリアするか（デフォルト: false）
 * @throws {Error} 検証エラー
 */
export function importKeyframes(data, clearHistoryOnImport = false) {
  // 入力検証
  validateKeyframesData(data);

  // 履歴に保存（ファイル読み込み時などでなければ）
  if (!clearHistoryOnImport) {
    saveToHistory();
  }

  const root = Array.isArray(data) ? { keyframes: data } : data;
  const parsed = [];
  let maxSeq = 0;

  for (let i = 0; i < root.keyframes.length; i++) {
    const raw = root.keyframes[i];
    const time = Number(raw.time);

    // サニタイズ
    const label = sanitizeLabelName(raw.label != null ? String(raw.label) : '');
    const comment = sanitizeComment(raw.comment != null ? String(raw.comment) : '');

    let seq = Number(raw.id);
    if (!Number.isFinite(seq) || seq <= 0) seq = i + 1;
    maxSeq = Math.max(maxSeq, seq);

    parsed.push({
      id: `kf-${seq}`,
      seq,
      time,
      label,
      comment,
      pointId: null
    });
  }

  keyframes = parsed;
  kfSeq = maxSeq + 1;
  updateLastEditedLabelFromKeyframes();
  updateAllLabels();
}

/**
 * キーフレームをエクスポート
 * @returns {Object} エクスポート用データ
 */
export function exportKeyframes() {
  return {
    keyframes: keyframes
      .slice()
      .sort((a, b) => a.time - b.time)
      .map(({ time, label, comment, seq }) => ({
        time,
        label: label || '',
        comment: comment || '',
        id: seq ?? null
      }))
  };
}

/**
 * すべてのユニークなラベルを取得
 * @returns {Array<string>}
 */
export function getAllLabels() {
  return allLabels;
}

/**
 * 最後に編集されたラベルを取得
 * @returns {string}
 */
export function getLastEditedLabel() {
  return lastEditedLabel;
}

/**
 * ラベル一覧を更新（内部用）
 */
function updateAllLabels() {
  const labelSet = new Set();
  for (const kf of keyframes) {
    if (kf.label) labelSet.add(kf.label);
  }
  allLabels = Array.from(labelSet).sort();
}

/**
 * 最後に編集されたラベルを更新（内部用）
 */
function updateLastEditedLabelFromKeyframes() {
  lastEditedLabel = '';
  for (let i = keyframes.length - 1; i >= 0; i--) {
    const lbl = keyframes[i].label;
    if (lbl) {
      lastEditedLabel = lbl;
      break;
    }
  }
}

/**
 * フィルタリングされたキーフレームを取得
 * @param {string} filterLabel - フィルタ条件（'' / '__NONE__' / ラベル名）
 * @returns {Array} フィルタリングされたキーフレーム
 */
export function getFilteredKeyframes(filterLabel) {
  if (filterLabel === '__NONE__') {
    return keyframes.filter(k => !k.label);
  }
  if (filterLabel) {
    return keyframes.filter(k => (k.label || '') === filterLabel);
  }
  return keyframes;
}

/**
 * キーフレームをソート
 * @param {Array} kfs - ソートするキーフレーム
 * @param {string} sortField - ソートフィールド ('time' | 'label' | 'id')
 * @param {number} sortDir - ソート方向 (1: 昇順, -1: 降順)
 * @returns {Array} ソートされたキーフレーム
 */
export function sortKeyframes(kfs, sortField, sortDir) {
  return kfs.slice().sort((a, b) => {
    let cmp = 0;
    if (sortField === 'label') {
      const la = (a.label || '').toLowerCase();
      const lb = (b.label || '').toLowerCase();
      if (la !== lb) cmp = la < lb ? -1 : 1;
      else cmp = a.time - b.time;
    } else if (sortField === 'id') {
      cmp = (a.seq ?? 0) - (b.seq ?? 0);
    } else {
      cmp = a.time - b.time;
    }
    return cmp * sortDir;
  });
}

/**
 * Undo可能かどうか
 * @returns {boolean}
 */
export function canUndo() {
  return HistoryManager.canUndo();
}

/**
 * Redo可能かどうか
 * @returns {boolean}
 */
export function canRedo() {
  return HistoryManager.canRedo();
}

/**
 * Undo操作を実行
 * @returns {boolean} 成功したかどうか
 */
export function performUndo() {
  const previousState = HistoryManager.undo(keyframes);
  if (!previousState) return false;

  // 履歴記録を無効化して復元
  skipHistory = true;
  restoreKeyframesFromState(previousState);
  skipHistory = false;

  return true;
}

/**
 * Redo操作を実行
 * @returns {boolean} 成功したかどうか
 */
export function performRedo() {
  const nextState = HistoryManager.redo(keyframes);
  if (!nextState) return false;

  // 履歴記録を無効化して復元
  skipHistory = true;
  restoreKeyframesFromState(nextState);
  skipHistory = false;

  return true;
}

/**
 * キーフレームの状態を復元（内部用）
 * @param {Array} state - 復元する状態
 */
function restoreKeyframesFromState(state) {
  keyframes = JSON.parse(JSON.stringify(state));

  // seqの最大値を再計算
  let maxSeq = 0;
  for (const kf of keyframes) {
    if (kf.seq > maxSeq) maxSeq = kf.seq;
  }
  kfSeq = maxSeq + 1;

  updateLastEditedLabelFromKeyframes();
  updateAllLabels();
}
