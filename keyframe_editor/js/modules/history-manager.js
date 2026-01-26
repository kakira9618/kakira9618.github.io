/**
 * キーフレーム編集の履歴管理
 * Undo/Redo機能を提供
 */

let undoStack = [];
let redoStack = [];
const MAX_HISTORY_SIZE = 100;

/**
 * 現在の状態を履歴に保存
 * @param {Array} keyframesSnapshot - キーフレームの現在の状態（ディープコピー）
 */
export function pushState(keyframesSnapshot) {
  // ディープコピーを保存
  const snapshot = JSON.parse(JSON.stringify(keyframesSnapshot));
  undoStack.push(snapshot);

  // 履歴サイズの制限
  if (undoStack.length > MAX_HISTORY_SIZE) {
    undoStack.shift();
  }

  // 新しい操作を行ったらredoスタックをクリア
  redoStack = [];
}

/**
 * Undo可能かどうか
 * @returns {boolean}
 */
export function canUndo() {
  return undoStack.length > 0;
}

/**
 * Redo可能かどうか
 * @returns {boolean}
 */
export function canRedo() {
  return redoStack.length > 0;
}

/**
 * Undo操作
 * @param {Array} currentState - 現在のキーフレーム状態
 * @returns {Array|null} 復元すべき状態、またはnull
 */
export function undo(currentState) {
  if (!canUndo()) return null;

  // 現在の状態をredoスタックに保存
  const current = JSON.parse(JSON.stringify(currentState));
  redoStack.push(current);

  // undoスタックから状態を取り出して復元
  const previousState = undoStack.pop();
  return previousState;
}

/**
 * Redo操作
 * @param {Array} currentState - 現在のキーフレーム状態
 * @returns {Array|null} 復元すべき状態、またはnull
 */
export function redo(currentState) {
  if (!canRedo()) return null;

  // 現在の状態をundoスタックに保存
  const current = JSON.parse(JSON.stringify(currentState));
  undoStack.push(current);

  // redoスタックから状態を取り出して復元
  const nextState = redoStack.pop();
  return nextState;
}

/**
 * 履歴をクリア（ファイル読み込み時などに使用）
 */
export function clearHistory() {
  undoStack = [];
  redoStack = [];
}

/**
 * 履歴の状態を取得（デバッグ用）
 * @returns {Object}
 */
export function getHistoryState() {
  return {
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    canUndo: canUndo(),
    canRedo: canRedo()
  };
}
