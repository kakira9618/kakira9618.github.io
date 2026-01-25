/**
 * UI操作（スライダー、ドラッグ、インライン編集など）
 */

import {
  clamp,
  formatFactor,
  factorFromSlider,
  sliderFromFactor,
  createBiLogMapping
} from './utils.js';

const SNAP_RANGE = 0.1; // ±10% で 1x にスナップ

/**
 * 双対数スライダーをバインド
 * @param {Object} opts - オプション
 * @returns {Object} 制御オブジェクト
 */
export function bindBiLogSlider({ inputEl, labelEl, map, onChange }) {
  inputEl.min = '0';
  inputEl.max = String(map.steps);

  const applyFromSlider = (rawVal) => {
    const clamped = clamp(Math.round(Number(rawVal) || 0), 0, map.steps);
    let factor = factorFromSlider(clamped, map);
    let snapped = false;

    if (Math.abs(factor - 1) <= SNAP_RANGE) {
      factor = 1;
      const snapVal = sliderFromFactor(1, map);
      if (snapVal !== clamped) inputEl.value = String(snapVal);
      snapped = true;
    }

    setFactorLabel(labelEl, factor, snapped);
    if (typeof onChange === 'function') onChange(factor, snapped);
  };

  inputEl.addEventListener('input', () => applyFromSlider(inputEl.value));

  const set = (factor) => {
    const sliderVal = sliderFromFactor(factor, map);
    inputEl.value = String(sliderVal);
    applyFromSlider(sliderVal);
  };

  return { set };
}

/**
 * 倍率ラベルを設定
 * @param {HTMLElement} labelEl - ラベル要素
 * @param {number} factor - 倍率
 * @param {boolean} snapped - スナップされたか
 */
export function setFactorLabel(labelEl, factor, snapped) {
  if (snapped || Math.abs(factor - 1) < 1e-6) {
    labelEl.textContent = '1.0x';
    labelEl.style.color = '#ffd166';
  } else {
    labelEl.textContent = `${formatFactor(factor)}x`;
    labelEl.style.color = 'var(--muted)';
  }
}

/**
 * ドラッグでナッジ（微調整）できるようにする
 * @param {HTMLElement} el - 対象要素
 * @param {Object} opts - オプション
 */
export function attachDragNudge(el, {
  getValue,
  applyValue,
  stepPerPx = 0.01,
  min = -Infinity,
  max = Infinity,
  compute
}) {
  if (!el || typeof getValue !== 'function' || typeof applyValue !== 'function') return;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startVal = 0;

  const onPointerDown = (e) => {
    startX = e.clientX;
    startVal = getValue();
    dragging = true;
    moved = false;
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const update = (dx, isFinal) => {
    const minVal = typeof min === 'function' ? min() : min;
    const maxVal = typeof max === 'function' ? max() : max;
    const base = typeof compute === 'function'
      ? compute(dx, startVal)
      : startVal + dx * stepPerPx;
    const next = clamp(base, minVal, maxVal);
    applyValue(next, !!isFinal);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 2) moved = true;
    update(dx, false);
    e.preventDefault();
  };

  const onPointerUp = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const wasMoved = moved || Math.abs(dx) > 2;
    dragging = false;
    el.releasePointerCapture?.(e.pointerId);

    if (wasMoved) {
      update(dx, true);
      // prevent the subsequent click from triggering inline edit
      el.dataset.skipClick = '1';
      setTimeout(() => { el.dataset.skipClick = '0'; }, 0);
      e.preventDefault();
      e.stopPropagation();
    }
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('pointerleave', onPointerUp);
}

/**
 * ラベルをインライン編集可能にする
 * @param {HTMLElement} labelEl - ラベル要素
 * @param {Object} opts - オプション
 */
export function makeInlineFactorEditable(labelEl, { map, getCurrent, applyFactor }) {
  if (!labelEl) return;

  labelEl.style.cursor = 'pointer';
  labelEl.title = 'クリックして値を入力 (Enterで確定 / Escでキャンセル)';

  labelEl.addEventListener('click', () => {
    if (labelEl.dataset.skipClick === '1') {
      labelEl.dataset.skipClick = '0';
      return;
    }
    if (labelEl.dataset.editing === '1') return;
    labelEl.dataset.editing = '1';

    const parent = labelEl.parentNode;
    if (!parent) {
      labelEl.dataset.editing = '0';
      return;
    }

    const current = Number(getCurrent?.()) || 1;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = formatFactor(current);
    const w = Math.max(labelEl.getBoundingClientRect().width || 0, 56);
    input.style.width = `${w}px`;
    input.style.fontSize = '11px';
    input.style.padding = '4px 6px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid rgba(255,255,255,.25)';
    input.style.background = '#0a0f1b';
    input.style.color = 'var(--text)';
    input.style.textAlign = 'center';
    input.style.boxSizing = 'border-box';

    parent.replaceChild(input, labelEl);

    const restore = () => {
      if (input.parentNode === parent) parent.replaceChild(labelEl, input);
      labelEl.dataset.editing = '0';
    };

    const commit = () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) {
        const clamped = clamp(v, map.min, map.max);
        if (typeof applyFactor === 'function') applyFactor(clamped);
      }
      restore();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); restore(); }
    });
    input.addEventListener('blur', commit);

    setTimeout(() => {
      input.focus();
      input.setSelectionRange(0, input.value.length);
    }, 0);
  });
}

/**
 * ズーム設定を作成
 * @param {number} baseSPP - ベースのsamplesPerPixel（1x時）
 * @returns {Object} ズーム設定
 */
export function createZoomConfig(baseSPP = 2048) {
  const map = createBiLogMapping({ min: 0.125, max: 256, steps: 200 });

  const factorToSamplesPerPixel = (factor) => baseSPP / factor;

  const buildZoomLevels = () => {
    const levels = [];
    for (let i = 0; i <= map.steps; i++) {
      const f = factorFromSlider(i, map);
      levels.push(Math.round(factorToSamplesPerPixel(f)));
    }
    return Array.from(new Set(levels)).sort((a, b) => a - b);
  };

  const findClosestZoomIndex = (samplesPerPixel, zoomLevels) => {
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < zoomLevels.length; i++) {
      const diff = Math.abs(zoomLevels[i] - samplesPerPixel);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  return {
    map,
    baseSPP,
    factorToSamplesPerPixel,
    buildZoomLevels,
    findClosestZoomIndex
  };
}

/**
 * 再生速度設定を作成
 * @returns {Object} 再生速度設定
 */
export function createRateConfig() {
  const map = createBiLogMapping({ min: 0.0625, max: 16, steps: 200 });
  return { map };
}

/**
 * ドラッグ＆ドロップのハンドリングを設定
 * @param {HTMLElement} dropZone - ドロップゾーン要素
 * @param {Function} onFileDrop - ファイルドロップ時のコールバック
 */
export function setupDragAndDrop(dropZone, onFileDrop) {
  if (!dropZone) return;

  const prevent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  ['dragenter', 'dragover'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      prevent(e);
      dropZone.classList.add('hover');
    });
  });

  ['dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      prevent(e);
      dropZone.classList.remove('hover');
    });
  });

  dropZone.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && typeof onFileDrop === 'function') {
      await onFileDrop(files);
    }
  });

  // ブラウザがファイルを開くのを防止
  ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, prevent));
}
