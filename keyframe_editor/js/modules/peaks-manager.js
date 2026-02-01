/**
 * Peaks.js の管理
 */

import { getLabelColor } from './utils.js';

let peaksInstance = null;

/**
 * Peaks.jsを初期化
 * @param {Object} options - Peaks.jsオプション
 * @returns {Promise<Object>} Peaks.jsインスタンス
 */
export async function initPeaks(options) {
  if (peaksInstance) {
    destroyPeaks();
  }

  return new Promise((resolve, reject) => {
    window.peaks.init(options, (err, peaks) => {
      if (err) return reject(err);
      peaksInstance = peaks;
      resolve(peaks);
    });
  });
}

/**
 * Peaks.jsインスタンスを取得
 * @returns {Object|null}
 */
export function getPeaksInstance() {
  return peaksInstance;
}

/**
 * Peaks.jsを破棄
 */
export function destroyPeaks() {
  if (peaksInstance) {
    try {
      peaksInstance.destroy();
    } catch (e) {
      console.warn('Peaks destroy failed:', e);
    }
    peaksInstance = null;
  }
}

/**
 * ポイントを追加
 * @param {Object} pointData - ポイントデータ
 * @returns {Object|null} 追加されたポイント
 */
export function addPoint(pointData) {
  if (!peaksInstance || !peaksInstance.points) return null;

  try {
    const point = peaksInstance.points.add(pointData);
    return point;
  } catch (e) {
    console.warn('Failed to add point:', e);
    return null;
  }
}

/**
 * ポイントを削除
 * @param {string} pointId - ポイントID
 * @returns {boolean} 成功したかどうか
 */
export function removePoint(pointId) {
  if (!peaksInstance || !peaksInstance.points || !pointId) return false;

  try {
    peaksInstance.points.removeById(pointId);
    return true;
  } catch (e) {
    console.warn('Failed to remove point:', e);
    return false;
  }
}

/**
 * ポイントを更新
 * @param {string} pointId - ポイントID
 * @param {Object} updates - 更新内容
 * @returns {boolean} 成功したかどうか
 */
export function updatePoint(pointId, updates) {
  if (!peaksInstance || !peaksInstance.points || !pointId) return false;

  try {
    const point = peaksInstance.points.getPoint(pointId);
    if (point) {
      point.update(updates);
      return true;
    }
  } catch (e) {
    console.warn('Failed to update point:', e);
  }
  return false;
}

/**
 * すべてのポイントをクリア
 */
export function clearAllPoints() {
  if (!peaksInstance || !peaksInstance.points) return;

  try {
    if (typeof peaksInstance.points.removeAll === 'function') {
      peaksInstance.points.removeAll();
      return;
    }
  } catch (e) {
    console.warn('points.removeAll failed:', e);
  }

  // フォールバック: 個別に削除
  try {
    const pts = typeof peaksInstance.points.getPoints === 'function'
      ? peaksInstance.points.getPoints()
      : [];
    for (const p of pts) {
      if (!p || !p.id) continue;
      try {
        peaksInstance.points.removeById(p.id);
      } catch (_) {}
    }
  } catch (e) {
    console.warn('points.getPoints/removeById failed:', e);
  }
}

/**
 * キーフレームからポイントを再構築
 * @param {Array} keyframes - キーフレーム配列
 */
export function rebuildPoints(keyframes) {
  if (!peaksInstance || !peaksInstance.points) return;

  clearAllPoints();

  for (const kf of keyframes) {
    try {
      const point = peaksInstance.points.add({
        time: kf.time,
        labelText: '',
        editable: false,
        color: kf.label ? getLabelColor(kf.label) : '#888888'
      });
      kf.pointId = point && point.id ? point.id : null;
    } catch (e) {
      console.warn('points.add failed:', e);
    }
  }
}

/**
 * ポイントの色を更新
 * @param {Array} keyframes - キーフレーム配列
 */
export function updatePointColors(keyframes) {
  if (!peaksInstance || !peaksInstance.points) return;

  try {
    for (const kf of keyframes) {
      if (kf.pointId) {
        const point = peaksInstance.points.getPoint(kf.pointId);
        if (point) {
          const color = kf.label ? getLabelColor(kf.label) : '#888888';
          point.update({ color });
        }
      }
    }
  } catch (e) {
    console.warn('Failed to update point colors:', e);
  }
}

/**
 * ポイントを再作成（選択状態の変更などでマーカーを更新するため）
 * @param {string} pointId - ポイントID
 * @param {number} time - 時間
 * @param {string} color - 色
 * @returns {string|null} 新しいポイントID
 */
export function recreatePoint(pointId, time, color) {
  if (!peaksInstance || !peaksInstance.points || !pointId) return null;

  try {
    // 既存のポイントを削除
    peaksInstance.points.removeById(pointId);

    // 新しいポイントを追加
    const point = peaksInstance.points.add({
      time: time,
      labelText: '',
      editable: false,
      color: color
    });

    return point && point.id ? point.id : null;
  } catch (e) {
    console.warn('Failed to recreate point:', e);
    return null;
  }
}

/**
 * ビューを再描画
 */
export function refreshViews() {
  if (!peaksInstance || !peaksInstance.views || typeof peaksInstance.views.getView !== 'function') return;

  try {
    peaksInstance.views.getView('zoomview')?.render?.();
  } catch (_) {}

  try {
    peaksInstance.views.getView('overview')?.render?.();
  } catch (_) {}
}

/**
 * ズームビューの開始時間を取得
 * @returns {number|null}
 */
export function getZoomViewStartTime() {
  if (!peaksInstance || !peaksInstance.views || typeof peaksInstance.views.getView !== 'function') {
    return null;
  }

  try {
    const view = peaksInstance.views.getView('zoomview');
    if (view && typeof view.getStartTime === 'function') {
      return view.getStartTime();
    }
  } catch (_) {}

  return null;
}

/**
 * ズームビューの終了時間を取得
 * @returns {number|null}
 */
export function getZoomViewEndTime() {
  if (!peaksInstance || !peaksInstance.views || typeof peaksInstance.views.getView !== 'function') {
    return null;
  }

  try {
    const view = peaksInstance.views.getView('zoomview');
    if (view && typeof view.getEndTime === 'function') {
      return view.getEndTime();
    }
  } catch (_) {}

  return null;
}

/**
 * ズームビューの開始時間を設定
 * @param {number} startTime - 開始時間
 */
export function setZoomViewStartTime(startTime) {
  if (!peaksInstance || !peaksInstance.views || typeof peaksInstance.views.getView !== 'function') {
    return;
  }

  try {
    const view = peaksInstance.views.getView('zoomview');
    if (view && typeof view.setStartTime === 'function') {
      view.setStartTime(startTime);
    }
  } catch (e) {
    console.warn('Failed to set zoom view start time:', e);
  }
}

/**
 * ズームレベルを設定
 * @param {number} zoomIndex - ズームインデックス
 * @param {number} [startTime] - 開始時間（オプション）
 */
export function setZoomLevel(zoomIndex, startTime) {
  if (!peaksInstance || !peaksInstance.zoom) return;

  try {
    if (startTime !== undefined) {
      peaksInstance.zoom.setZoom(zoomIndex, startTime);
    } else {
      peaksInstance.zoom.setZoom(zoomIndex);
    }
  } catch (e) {
    console.warn('zoom.setZoom failed:', e);
  }
}

/**
 * 再生速度を設定
 * @param {number} rate - 再生速度
 */
export function setPlaybackRate(rate) {
  if (!peaksInstance || !peaksInstance.player) return;

  try {
    if (typeof peaksInstance.player.setPlaybackRate === 'function') {
      peaksInstance.player.setPlaybackRate(rate);
    }
  } catch (e) {
    console.warn('Failed to set playback rate:', e);
  }
}
