/**
 * Keyframe Editor - Main Application
 * v1.0.0 - モジュール化 + 入力検証強化 + メモリリーク対策
 */

import * as AudioManager from './modules/audio-manager.js';
import * as KeyframeManager from './modules/keyframe-manager.js';
import * as PeaksManager from './modules/peaks-manager.js';
import * as SpectrogramModule from './modules/spectrogram.js';
import * as UIControls from './modules/ui-controls.js';
import * as Utils from './modules/utils.js';

// ==================== DOM要素 ====================
const fileInput = Utils.el('file');
const dropZone = Utils.el('fileDrop');
const audio = Utils.el('audio');
const overviewContainer = Utils.el('overview-container');
const zoomviewContainer = Utils.el('zoomview-container');
const spectrumCanvas = Utils.el('spectrum-canvas');
const spectrumContainer = Utils.el('spectrum-container');
const spectrumStatus = Utils.el('spectrum-status');
const specPlayhead = Utils.el('spectrum-playhead');
const chkWebGPU = Utils.el('useWebGPU');
const chkEnableSpec = Utils.el('enableSpectrogram');

const btnPlay = Utils.el('play');
const btnStepBack = Utils.el('stepBack');
const btnStepFwd = Utils.el('stepFwd');
const selRate = Utils.el('rate');
const elRateLabel = Utils.el('rateLabel');
const elZoom = Utils.el('zoom');
const elZoomLabel = Utils.el('zoomLabel');
const timeBadge = Utils.el('timeDisplay');
const timeWrap = Utils.el('timeDisplayWrap');

const btnAddKf = Utils.el('addKf');
const kfList = Utils.el('kfList');
const labelFilter = Utils.el('labelFilter');

const jsonArea = Utils.el('json');
const btnCopy = Utils.el('copy');
const fileNameLabel = Utils.el('fileNameLabel');

// ==================== アプリケーション状態 ====================
let preferWebGPU = SpectrogramModule.isWebGPUSupported();
let rememberedWebGpu = preferWebGPU;

let spectrogram = null;
let spectrogramRequestId = 0;
let hiResSpec = null;
let hiResRequestId = 0;
let hiResPending = false;
let lastHiResRequestedAt = 0;

let specViewStart = 0;
let specViewDuration = 0;

let isScrubbingOverview = false;
let isScrubbingZoomview = false;
let isScrubbingSpectrum = false;

let specSyncRaf = null;
let specScrubRaf = null;
let stepPreviewTimer = null;
let isStepPreview = false;

let timeEditInput = null;
let isTimeEditing = false;

let sortField = 'id'; // 'time' | 'label' | 'id'
let sortDir = 1; // 1 = asc, -1 = desc
let filterLabel = '';

let isUpdatingJsonArea = false;
let jsonApplyTimer = null;
const JSON_APPLY_DEBOUNCE_MS = 450;

const FRAME_SEC = 1 / 60;

// ズーム・再生速度設定
const zoomConfig = UIControls.createZoomConfig(2048);
const rateConfig = UIControls.createRateConfig();
let zoomLevels = zoomConfig.buildZoomLevels();

// ==================== ヒートマップLUT ====================
function buildHeatLut() {
  const stops = [
    { t: 0.0, c: [5, 8, 17] },
    { t: 0.25, c: [32, 54, 120] },
    { t: 0.5, c: [69, 137, 205] },
    { t: 0.7, c: [255, 209, 102] },
    { t: 0.85, c: [255, 128, 96] },
    { t: 1.0, c: [255, 255, 255] }
  ];
  const lut = new Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0], b = stops[stops.length - 1];
    for (let j = 0; j < stops.length - 1; j++) {
      if (t >= stops[j].t && t <= stops[j + 1].t) {
        a = stops[j]; b = stops[j + 1]; break;
      }
    }
    const localT = (t - a.t) / Math.max(1e-6, (b.t - a.t));
    const mix = (x, y) => Math.round(x + (y - x) * localT);
    lut[i] = [mix(a.c[0], b.c[0]), mix(a.c[1], b.c[1]), mix(a.c[2], b.c[2])];
  }
  return lut;
}

const HEAT_LUT = buildHeatLut();

// ==================== UI更新関数 ====================

function setUiEnabled(enabled) {
  for (const node of [btnPlay, btnStepBack, btnStepFwd, selRate, elZoom, btnAddKf, btnCopy]) {
    if (node) node.disabled = !enabled;
  }
}

function updateTimeBadge() {
  if (isTimeEditing || !timeBadge) return;
  timeBadge.textContent = Utils.formatTime(audio.currentTime);
}

function updatePlayButton() {
  if (!btnPlay) return;
  const playing = !audio.paused;
  btnPlay.textContent = playing ? '⏸' : '▶';
  btnPlay.title = playing ? '停止 (Space)' : '再生 (Space)';
}

// ==================== ラベルフィルター ====================

function refreshLabelFilterOptions() {
  if (!labelFilter) return;
  const prev = filterLabel || labelFilter.value || '';
  labelFilter.innerHTML = '';

  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = '(すべて)';
  labelFilter.appendChild(optAll);

  const optNone = document.createElement('option');
  optNone.value = '__NONE__';
  optNone.textContent = '(なし)';
  labelFilter.appendChild(optNone);

  for (const label of KeyframeManager.getAllLabels()) {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    labelFilter.appendChild(opt);
  }

  if (prev === '__NONE__') {
    labelFilter.value = '__NONE__';
    filterLabel = '__NONE__';
  } else if (prev && KeyframeManager.getAllLabels().includes(prev)) {
    labelFilter.value = prev;
    filterLabel = prev;
  } else {
    labelFilter.value = '';
    filterLabel = '';
  }
}

// ==================== JSON編集 ====================

function updateJson() {
  if (!jsonArea) return;
  const payload = KeyframeManager.exportKeyframes();
  isUpdatingJsonArea = true;
  jsonArea.value = JSON.stringify(payload, null, 2);
  clearJsonError();
  isUpdatingJsonArea = false;
}

function clearJsonError() {
  if (!jsonArea) return;
  jsonArea.style.borderColor = '';
  jsonArea.style.boxShadow = '';
  jsonArea.title = '';
}

function markJsonError(message) {
  if (!jsonArea) return;
  jsonArea.style.borderColor = 'rgba(255,107,107,0.7)';
  jsonArea.style.boxShadow = '0 0 0 1px rgba(255,107,107,0.4)';
  jsonArea.title = message;
}

function applyJsonToState() {
  if (!jsonArea) return;

  let parsed;
  try {
    parsed = JSON.parse(jsonArea.value);
  } catch (e) {
    markJsonError('JSON の構文エラー: ' + e.message);
    return;
  }

  try {
    KeyframeManager.importKeyframes(parsed);
  } catch (e) {
    markJsonError(e.message);
    return;
  }

  refreshLabelFilterOptions();
  renderKeyframeList();
  rebuildPeaksPoints();
  updatePointColors();
  updateJson();
  clearJsonError();
}

// ==================== Peaks.js統合 ====================

function rebuildPeaksPoints() {
  const keyframes = KeyframeManager.getKeyframes();
  PeaksManager.rebuildPoints(keyframes);
}

function updatePointColors() {
  const keyframes = KeyframeManager.getKeyframes();
  PeaksManager.updatePointColors(keyframes);
}

// ==================== ズーム・再生速度 ====================

function currentSliderFactor(elInput, map) {
  const raw = Number(elInput.value) || 0;
  const f = Utils.factorFromSlider(raw, map);
  const SNAP_RANGE = 0.1;
  return Math.abs(f - 1) <= SNAP_RANGE ? 1 : f;
}

function currentSamplesPerPixel() {
  const factor = currentSliderFactor(elZoom, zoomConfig.map);
  const target = zoomConfig.factorToSamplesPerPixel(factor);
  const idx = zoomConfig.findClosestZoomIndex(target, zoomLevels);
  return zoomLevels[idx] ?? target;
}

function currentPixelsPerSecond() {
  const spp = currentSamplesPerPixel();
  const sr = AudioManager.getSampleRate();
  if (!sr || !spp) return null;
  return sr / spp;
}

function applyZoom(factor, optionalStartTime) {
  const peaks = PeaksManager.getPeaksInstance();
  if (!peaks) return;

  const spp = Math.round(zoomConfig.factorToSamplesPerPixel(factor));
  const idx = zoomConfig.findClosestZoomIndex(spp, zoomLevels);

  PeaksManager.setZoomLevel(idx, optionalStartTime);

  const view = getSpecView();
  drawSpectrogram(view.viewStart, view.viewDuration);
  updateSpecPlayhead();
}

function applyRate(factor) {
  const r = Utils.clamp(factor, rateConfig.map.min, rateConfig.map.max);
  if (audio) audio.playbackRate = r;
  PeaksManager.setPlaybackRate(r);
}

// ==================== Zoom view 管理 ====================

function getZoomWindowDuration() {
  const sr = AudioManager.getSampleRate();
  if (!sr) return 0;
  const width = zoomviewContainer ? zoomviewContainer.clientWidth : 1;
  const spp = currentSamplesPerPixel();
  return (spp / sr) * width;
}

function getZoomWindowStart(viewDuration) {
  const st = PeaksManager.getZoomViewStartTime();
  if (Number.isFinite(st)) return st;

  const duration = audio.duration || 0;
  const center = audio.currentTime || 0;
  const maxStart = Math.max(0, duration - viewDuration);
  return Utils.clamp(center - viewDuration / 2, 0, maxStart);
}

function setZoomWindowStart(startTime) {
  const peaks = PeaksManager.getPeaksInstance();
  if (!peaks) return;

  const viewDuration = getZoomWindowDuration();
  const duration = audio.duration || 0;
  const targetStart = Utils.clamp(startTime, 0, Math.max(0, duration - viewDuration));

  PeaksManager.setZoomViewStartTime(targetStart);

  const specView = getSpecView();
  drawSpectrogram(specView.viewStart, specView.viewDuration);
  updateSpecPlayhead();

  return targetStart;
}

// ==================== スペクトログラム ====================

function setSpectrumStatus(text) {
  if (!spectrumStatus) return;
  spectrumStatus.textContent = text || '';
  spectrumStatus.style.display = text ? 'block' : 'none';
}

function resizeSpectrumCanvas() {
  if (!spectrumCanvas || !spectrumContainer) return;
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = spectrumContainer.getBoundingClientRect();
  const targetW = Math.max(1, Math.floor(width * dpr));
  const targetH = Math.max(1, Math.floor(height * dpr));
  if (spectrumCanvas.width !== targetW) spectrumCanvas.width = targetW;
  if (spectrumCanvas.height !== targetH) spectrumCanvas.height = targetH;
}

function clearSpectrumCanvas() {
  if (!spectrumCanvas) return;
  resizeSpectrumCanvas();
  const ctx = spectrumCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
}

function getSpecView() {
  const duration = Number.isFinite(audio?.duration) ? audio.duration : (spectrogram?.duration || 0);

  const st = PeaksManager.getZoomViewStartTime();
  const et = PeaksManager.getZoomViewEndTime();

  if (Number.isFinite(st) && Number.isFinite(et) && et > st) {
    const vs = Utils.clamp(st, 0, Math.max(0, duration));
    const vd = Utils.clamp(et - st, 0, duration);
    return { viewStart: vs, viewDuration: vd };
  }

  // フォールバック
  let viewDuration = getZoomWindowDuration();
  if (!Number.isFinite(viewDuration) || viewDuration <= 0) viewDuration = duration;
  viewDuration = Math.min(viewDuration, duration);
  let viewStart = getZoomWindowStart(viewDuration);
  viewStart = Utils.clamp(viewStart, 0, Math.max(0, duration - viewDuration));
  return { viewStart, viewDuration };
}

function shouldUseHiRes(ppsCss) {
  if (!spectrogram || !ppsCss) return false;
  const zoomedIn = currentSamplesPerPixel() < zoomConfig.baseSPP;
  if (!zoomedIn) return false;
  const baseStepSec = spectrogram.hopSize / spectrogram.sampleRate;
  return baseStepSec > (1 / ppsCss) * 0.8;
}

function hiResMatches(viewStart, viewDuration, hopSize) {
  if (!hiResSpec) return false;
  const eps = 1 / 60;
  return Math.abs(hiResSpec.viewStart - viewStart) < eps &&
         Math.abs(hiResSpec.viewDuration - viewDuration) < eps &&
         hiResSpec.hopSize === hopSize;
}

async function maybeRequestHiRes(viewStart, viewDuration, ppsCss) {
  if (!shouldUseHiRes(ppsCss)) return;
  const audioBuffer = AudioManager.getAudioBuffer();
  if (!audioBuffer) return;

  const duration = Number.isFinite(audio?.duration) ? audio.duration : (spectrogram?.totalDuration || 0);
  if (!(duration > 0)) return;

  const sr = AudioManager.getSampleRate();
  const hopTarget = Math.max(32, Math.min(4096, Utils.floorPow2(sr / ppsCss)));

  if (hiResMatches(viewStart, viewDuration, hopTarget)) return;
  if (hiResPending) return;

  const now = performance.now ? performance.now() : Date.now();
  if (now - lastHiResRequestedAt < 120) return;

  const pad = Math.min(viewDuration * 0.25, duration * 0.25);
  const start = Utils.clamp(viewStart - pad, 0, Math.max(0, duration - viewDuration));
  const dur = Math.min(viewDuration * 1.5, duration);

  await buildHiResSpectrogram(start, dur, ppsCss);
}

async function buildHiResSpectrogram(viewStart, viewDuration, ppsCss) {
  if (chkEnableSpec && !chkEnableSpec.checked) return;
  const audioBuffer = AudioManager.getAudioBuffer();
  if (!audioBuffer || !ppsCss || !(viewDuration > 0)) return;
  if (hiResPending) return;

  const sr = AudioManager.getSampleRate();
  const hopTarget = Math.max(32, Math.min(4096, Utils.floorPow2(sr / ppsCss)));
  if (hiResMatches(viewStart, viewDuration, hopTarget)) return;

  const token = ++hiResRequestId;
  hiResPending = true;
  lastHiResRequestedAt = performance.now ? performance.now() : Date.now();

  try {
    const spec = await SpectrogramModule.computeSpectrogram({
      audioBuffer,
      start: viewStart,
      duration: viewDuration,
      hopSize: hopTarget,
      fftSize: 1024
    }, preferWebGPU);

    if (token !== hiResRequestId) return;
    hiResSpec = spec;
    const v = getSpecView();
    drawSpectrogram(v.viewStart, v.viewDuration);
  } catch (e) {
    console.warn('hi-res spectrogram failed', e);
  } finally {
    hiResPending = false;
  }
}

async function buildSpectrogram(audioBuffer) {
  const token = ++spectrogramRequestId;

  if (chkEnableSpec && !chkEnableSpec.checked) {
    setSpectrumStatus('（スペクトログラム計算オフ）');
    return;
  }

  setSpectrumStatus('スペクトログラム解析中…');
  spectrogram = null;
  hiResSpec = null;
  clearSpectrumCanvas();

  let spec = null;
  try {
    const sr = audioBuffer.sampleRate;
    spec = await SpectrogramModule.computeSpectrogram({
      audioBuffer,
      start: 0,
      duration: audioBuffer.duration,
      hopSize: Math.max(256, Math.floor(sr * 0.02)),
      fftSize: 1024
    }, preferWebGPU);
  } catch (e) {
    console.error('Failed to compute spectrogram:', e);
  }

  if (token !== spectrogramRequestId) return;
  spectrogram = spec;
  setSpectrumStatus(spec ? '' : 'スペクトログラム作成に失敗しました');

  const view = getSpecView();
  drawSpectrogram(view.viewStart, view.viewDuration);
  updateSpecPlayhead();
}

function drawSpectrogram(viewStart, viewDuration) {
  if (!spectrumCanvas) return;
  resizeSpectrumCanvas();

  const ctx = spectrumCanvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = spectrumContainer.getBoundingClientRect().width || 1;
  const width = spectrumCanvas.width;
  const height = spectrumCanvas.height;

  ctx.clearRect(0, 0, width, height);

  if (!spectrogram || !spectrogram.data || spectrogram.frames === 0 || spectrogram.bins === 0) {
    return;
  }

  const ppsCss = currentPixelsPerSecond();
  if (!ppsCss) return;

  if (shouldUseHiRes(ppsCss)) {
    maybeRequestHiRes(viewStart, viewDuration, ppsCss);
  }

  const sr = AudioManager.getSampleRate();
  const useHiRes = shouldUseHiRes(ppsCss) && hiResMatches(viewStart, viewDuration, Math.max(32, Math.min(4096, Utils.floorPow2(sr / ppsCss))));
  const spec = useHiRes && hiResSpec ? hiResSpec : spectrogram;
  const { data, frames, bins, hopSize, sampleRate, duration, sliceStart = 0, sliceDuration = duration, totalDuration = duration } = spec;

  const image = ctx.createImageData(width, height);
  const dest = image.data;
  const timePerFrame = hopSize / sampleRate;

  let vs = Number.isFinite(viewStart) ? viewStart : 0;
  let vd = Number.isFinite(viewDuration) && viewDuration > 0 ? viewDuration : totalDuration;
  vd = Math.min(vd, totalDuration);
  vs = Utils.clamp(vs, 0, Math.max(0, totalDuration - vd));
  specViewStart = vs;
  specViewDuration = vd;

  const ppsCssEff = ppsCss || (cssWidth / Math.max(1e-6, vd));
  const ppsDev = ppsCssEff * dpr;

  const drawWidth = Math.min(width, Math.round(vd * ppsDev));
  const binScale = bins > 1 ? (bins - 1) / Math.max(1, height - 1) : 0;

  for (let x = 0; x < drawWidth; x++) {
    const t = vs + x / ppsDev;
    const frameIdx = Utils.clamp(Math.round((t - sliceStart) / timePerFrame), 0, frames - 1);
    const frameBase = frameIdx * bins;

    for (let y = 0; y < height; y++) {
      const bin = bins - 1 - Math.min(bins - 1, Math.round(y * binScale));
      const v = data[frameBase + bin] || 0;
      const lut = HEAT_LUT[Math.min(255, Math.max(0, Math.floor(v * 255)))];
      const p = (y * width + x) * 4;
      dest[p] = lut[0];
      dest[p + 1] = lut[1];
      dest[p + 2] = lut[2];
      dest[p + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

function updateSpecPlayhead(forceHide = false) {
  if (!specPlayhead) return;

  if (forceHide || !spectrogram || !Number.isFinite(audio.duration) || audio.duration <= 0) {
    specPlayhead.style.display = 'none';
    return;
  }

  const rect = spectrumContainer.getBoundingClientRect();
  const ppsCss = currentPixelsPerSecond();
  if (!ppsCss) {
    specPlayhead.style.display = 'none';
    return;
  }

  const maxX = Math.min(rect.width, (specViewDuration || audio.duration) * ppsCss);
  const x = Utils.clamp((audio.currentTime - specViewStart) * ppsCss, 0, maxX);
  const phw = (specPlayhead.offsetWidth || 1);
  const xAligned = Utils.clamp(x - phw * 0.5, 0, Math.max(0, maxX - phw));

  specPlayhead.style.display = 'block';
  specPlayhead.style.transform = `translateX(${xAligned}px)`;
}

function maybeRedrawSpecOnViewChange() {
  const view = getSpecView();
  if (!view) return;
  const eps = Math.max(1e-4, (view.viewDuration || 1) * 1e-3);
  if (Math.abs(view.viewStart - specViewStart) > eps || Math.abs(view.viewDuration - specViewDuration) > eps) {
    drawSpectrogram(view.viewStart, view.viewDuration);
  }
}

function teardownSpectrum() {
  spectrogramRequestId++;
  spectrogram = null;
  clearSpectrumCanvas();
  const off = chkEnableSpec && !chkEnableSpec.checked;
  setSpectrumStatus(off ? 'スペクトログラム計算スキップ' : 'ファイル未選択');
  updateSpecPlayhead(true);
}

// ==================== キーフレームリスト表示 ====================

function renderKeyframeList() {
  if (!kfList) return;
  kfList.innerHTML = '';

  const filteredKfs = KeyframeManager.getFilteredKeyframes(filterLabel);
  const sortedKfs = KeyframeManager.sortKeyframes(filteredKfs, sortField, sortDir);

  // ヘッダー行
  const head = document.createElement('div');
  head.className = 'kf';
  head.style.fontWeight = '600';
  head.style.cursor = 'pointer';
  head.style.userSelect = 'none';
  head.style.background = 'rgba(255,255,255,0.03)';

  const arrow = (field) => {
    if (sortField !== field) return ' ';
    return sortDir === 1 ? '▲' : '▼';
  };

  const createSortHeader = (text, field) => {
    const h = document.createElement('div');
    h.textContent = `${text} ${arrow(field)}`;
    h.style.fontSize = '12px';
    h.style.color = sortField === field ? '#ffd166' : 'var(--muted)';
    h.addEventListener('click', () => {
      if (sortField === field) {
        sortDir = -sortDir;
      } else {
        sortField = field;
        sortDir = 1;
      }
      renderKeyframeList();
    });
    return h;
  };

  head.appendChild(createSortHeader('ID', 'id'));
  head.appendChild(createSortHeader('時間', 'time'));
  head.appendChild(createSortHeader('ラベル', 'label'));

  const hComment = document.createElement('div');
  hComment.textContent = 'コメント';
  hComment.style.fontSize = '12px';
  hComment.style.color = 'var(--muted)';
  head.appendChild(hComment);

  const hAction = document.createElement('div');
  hAction.textContent = '操作';
  hAction.style.fontSize = '12px';
  hAction.style.color = 'var(--muted)';
  hAction.style.textAlign = 'right';
  head.appendChild(hAction);

  kfList.appendChild(head);

  if (sortedKfs.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'まだキーフレームがありません。';
    kfList.appendChild(p);
    return;
  }

  // キーフレーム行
  for (const kf of sortedKfs) {
    const row = document.createElement('div');
    row.className = 'kf';

    // ID列
    const idCell = document.createElement('div');
    idCell.textContent = kf.seq ?? '';
    idCell.style.fontVariantNumeric = 'tabular-nums';
    idCell.style.fontSize = '12px';
    row.appendChild(idCell);

    // 時間列（クリック編集・ドラッグ調整可能）
    const timeCell = createTimeCell(kf);
    row.appendChild(timeCell);

    // ラベル列
    const labelCell = createLabelCell(kf);
    row.appendChild(labelCell);

    // コメント列
    const commentCell = createCommentCell(kf);
    row.appendChild(commentCell);

    // 操作列
    const actionsCell = createActionsCell(kf);
    row.appendChild(actionsCell);

    kfList.appendChild(row);
  }
}

function createTimeCell(kf) {
  const t = document.createElement('time');
  t.textContent = Utils.formatTime(kf.time);
  t.style.cursor = 'text';
  t.title = 'クリックで時間を編集（例: 12.3 / 01:02.500 / +1 / -0.25）';

  const startKfTimeEdit = () => {
    if (!Number.isFinite(audio.duration)) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = Utils.formatTime(kf.time);
    input.style.all = 'unset';
    input.style.width = '90%';
    input.style.padding = '6px 8px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid rgba(255,255,255,0.25)';
    input.style.background = '#0a0f1b';
    input.style.color = 'var(--text)';
    input.style.fontSize = '12px';
    input.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace';
    input.style.textAlign = 'center';

    const parent = t.parentNode;
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.appendChild(input);
    if (parent) parent.replaceChild(container, t);

    let finished = false;
    const finish = (apply) => {
      if (finished) return;
      finished = true;
      if (apply) {
        const parsed = Utils.parseTimeInput(input.value, kf.time, audio.duration);
        if (Number.isFinite(parsed)) {
          KeyframeManager.updateKeyframe(kf.id, { time: parsed });
          if (kf.pointId) {
            PeaksManager.updatePoint(kf.pointId, { time: parsed });
          }
          renderKeyframeList();
          updateJson();
          return;
        }
      }
      if (parent) parent.replaceChild(t, container);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(0, input.value.length);
    }, 0);
  };

  t.addEventListener('click', (e) => {
    e.stopPropagation();
    if (t.dataset.skipClick === '1') { t.dataset.skipClick = '0'; return; }
    startKfTimeEdit();
  });

  UIControls.attachDragNudge(t, {
    getValue: () => kf.time,
    applyValue: (v, isFinal) => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      const next = Utils.clamp(v, 0, dur);
      KeyframeManager.updateKeyframe(kf.id, { time: next });
      if (kf.pointId) {
        PeaksManager.updatePoint(kf.pointId, { time: next });
      }
      t.textContent = Utils.formatTime(next);
      PeaksManager.refreshViews();
      updateSpecPlayhead();
      if (isFinal) {
        renderKeyframeList();
        updateJson();
      }
    },
    min: 0,
    max: () => Number.isFinite(audio.duration) ? audio.duration : Infinity,
    stepPerPx: 0.01
  });

  return t;
}

function createLabelCell(kf) {
  const labelWrap = document.createElement('div');
  labelWrap.className = 'krow';
  labelWrap.style.gap = '6px';

  const colorDot = document.createElement('span');
  colorDot.style.display = 'inline-block';
  colorDot.style.width = '10px';
  colorDot.style.height = '10px';
  colorDot.style.borderRadius = '50%';
  colorDot.style.backgroundColor = kf.label ? Utils.getLabelColor(kf.label) : '#888';
  colorDot.style.flexShrink = '0';

  const labelSelect = document.createElement('select');
  labelSelect.style.flex = '1';
  labelSelect.style.minWidth = '0';

  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '（なし）';
  labelSelect.appendChild(emptyOpt);

  for (const label of KeyframeManager.getAllLabels()) {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    labelSelect.appendChild(opt);
  }

  const newOpt = document.createElement('option');
  newOpt.value = '__NEW__';
  newOpt.textContent = '+ 新規作成';
  labelSelect.appendChild(newOpt);

  labelSelect.value = kf.label || '';

  labelSelect.addEventListener('click', (e) => e.stopPropagation());
  labelSelect.addEventListener('change', (e) => {
    e.stopPropagation();
    if (labelSelect.value === '__NEW__') {
      const newLabel = prompt('新しいラベル名を入力してください:');
      if (newLabel && newLabel.trim()) {
        KeyframeManager.updateKeyframe(kf.id, { label: newLabel.trim() });
        refreshLabelFilterOptions();
        updatePointColors();
        renderKeyframeList();
        updateJson();
      } else {
        labelSelect.value = kf.label || '';
      }
    } else {
      KeyframeManager.updateKeyframe(kf.id, { label: labelSelect.value });
      colorDot.style.backgroundColor = kf.label ? Utils.getLabelColor(kf.label) : '#888';
      updatePointColors();
      updateJson();
    }
  });

  labelWrap.appendChild(colorDot);
  labelWrap.appendChild(labelSelect);
  return labelWrap;
}

function createCommentCell(kf) {
  const commentWrap = document.createElement('div');
  commentWrap.className = 'krow';

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'コメント（例: サビ開始 / カット点）';
  inp.value = kf.comment ?? '';
  inp.addEventListener('click', (e) => e.stopPropagation());
  inp.addEventListener('input', () => {
    KeyframeManager.updateKeyframe(kf.id, { comment: inp.value });
    updateJson();
  });

  commentWrap.appendChild(inp);
  return commentWrap;
}

function createActionsCell(kf) {
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'krow';
  actionsWrap.style.gap = '6px';
  actionsWrap.style.justifyContent = 'flex-end';

  const btnJump = document.createElement('button');
  btnJump.className = 'small';
  btnJump.textContent = 'ジャンプ';
  btnJump.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.currentTime = kf.time;
    audio.pause();
    updateTimeBadge();
    updateSpecPlayhead();
  });

  const btnSetNow = document.createElement('button');
  btnSetNow.className = 'small';
  btnSetNow.textContent = '現在位置を設定';
  btnSetNow.addEventListener('click', (e) => {
    e.stopPropagation();
    const tnow = audio.currentTime;
    KeyframeManager.updateKeyframe(kf.id, { time: tnow });
    if (kf.pointId) {
      PeaksManager.updatePoint(kf.pointId, { time: tnow });
    }
    renderKeyframeList();
    updateJson();
  });

  const btnDel = document.createElement('button');
  btnDel.className = 'small danger';
  btnDel.textContent = '削除';
  btnDel.addEventListener('click', (e) => {
    e.stopPropagation();
    if (kf.pointId) {
      PeaksManager.removePoint(kf.pointId);
    }
    KeyframeManager.removeKeyframe(kf.id);
    refreshLabelFilterOptions();
    renderKeyframeList();
    updateJson();
  });

  actionsWrap.appendChild(btnJump);
  actionsWrap.appendChild(btnSetNow);
  actionsWrap.appendChild(btnDel);

  return actionsWrap;
}

// ==================== ファイルロード ====================

async function destroyAll() {
  PeaksManager.destroyPeaks();
  KeyframeManager.clearKeyframes();
  hiResSpec = null;
  hiResRequestId++;
  teardownSpectrum();
  await AudioManager.cleanup(); // メモリリーク対策: AudioContextも破棄
}

async function loadFile(file) {
  if (!file || !AudioManager.isAudioFile(file)) {
    alert('対応している音声ファイルを選択してください (mp3 / wav / ogg など)');
    return;
  }

  const keyframes = KeyframeManager.getKeyframes();
  if (keyframes.length > 0) {
    const ok = window.confirm('キーフレームが存在します。変更が破棄されますが、別の音源を読み込みますか？');
    if (!ok) {
      try { if (fileInput) fileInput.value = ''; } catch (_) {}
      return;
    }
  }

  setUiEnabled(false);
  try {
    await initWithFile(file);
    if (fileNameLabel) fileNameLabel.textContent = file.name || '';
  } catch (e) {
    console.error(e);
    alert('初期化に失敗しました（コンソールを確認してください）');
    if (fileNameLabel) fileNameLabel.textContent = '';
    setUiEnabled(false);
  }
}

async function initWithFile(file) {
  await destroyAll();
  KeyframeManager.clearKeyframes();
  refreshLabelFilterOptions();
  renderKeyframeList();
  updateJson();

  const objectUrl = AudioManager.createObjectURL(file);
  audio.src = objectUrl;

  const audioBuffer = await AudioManager.decodeAudioFile(file);

  const options = {
    overview: {
      container: overviewContainer,
      waveformColor: 'rgba(225,232,240,0.92)',
      playedWaveformColor: 'rgba(245,248,255,0.95)',
      playheadColor: '#ffd166',
      highlightColor: 'rgba(255,209,102,0.80)',
      highlightStrokeColor: 'rgba(255,209,102,0.95)',
      highlightStrokeWidth: 2
    },
    zoomview: {
      container: zoomviewContainer,
      playheadColor: '#ffd166',
      playheadClickTolerance: 10,
      showPlayheadTime: false
    },
    mediaElement: audio,
    webAudio: { audioBuffer },
    zoomLevels,
    keyboard: false
  };

  await PeaksManager.initPeaks(options);

  buildSpectrogram(audioBuffer);

  updateTimeBadge();

  // 初期ズーム: 1x
  zoomSlider.set(1);

  setUiEnabled(true);
  audio.pause();
  audio.currentTime = 0;
  rateSlider.set(1);
  updateTimeBadge();
  try { if (fileInput) fileInput.blur(); } catch (_) {}
}

// ==================== 時間表示のインライン編集 ====================

function exitTimeEdit(applyValue) {
  if (!isTimeEditing) return;
  const input = timeEditInput;
  if (input && applyValue) {
    const target = Utils.parseTimeInput(input.value, audio.currentTime, audio.duration);
    if (Number.isFinite(target)) {
      const wasPlaying = !audio.paused;
      audio.currentTime = target;
      updateSpecPlayhead();
      if (wasPlaying) audio.play().catch(() => {});
    } else {
      alert('時刻の形式が認識できません');
    }
  }
  if (input && input.parentNode) input.parentNode.removeChild(input);
  timeEditInput = null;
  isTimeEditing = false;
  if (timeBadge) timeBadge.style.visibility = 'visible';
  updateTimeBadge();
}

function startInlineTimeEdit() {
  if (!Number.isFinite(audio.duration) || isTimeEditing) return;
  isTimeEditing = true;
  const currentText = Utils.formatTime(audio.currentTime);
  const parent = timeBadge.parentNode;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'time-digi-edit';
  input.value = currentText;
  timeEditInput = input;
  if (timeBadge) timeBadge.style.visibility = 'hidden';
  parent.appendChild(input);

  const confirm = () => exitTimeEdit(true);
  const cancel = () => exitTimeEdit(false);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', confirm);

  setTimeout(() => {
    input.focus();
    input.setSelectionRange(0, input.value.length);
  }, 0);
}

// ==================== コマ送り・ステップ ====================

function stopStepPreview() {
  if (stepPreviewTimer) {
    clearTimeout(stepPreviewTimer);
    stepPreviewTimer = null;
  }
  isStepPreview = false;
}

function step(delta) {
  const wasPlaying = !audio.paused;
  const next = Utils.clamp(audio.currentTime + delta, 0, audio.duration || Infinity);
  stopStepPreview();
  audio.currentTime = next;
  audio.pause();
  updateTimeBadge();
  updateSpecPlayhead();

  if (wasPlaying) return;

  const previewMs = FRAME_SEC * 1000;
  isStepPreview = true;
  audio.play().catch(() => { isStepPreview = false; });
  stepPreviewTimer = setTimeout(() => {
    stepPreviewTimer = null;
    audio.pause();
    audio.currentTime = next;
    isStepPreview = false;
  }, previewMs);
}

// ==================== キーフレーム追加 ====================

function addKeyframe() {
  const peaks = PeaksManager.getPeaksInstance();
  if (!peaks) return;

  const time = audio.currentTime;
  const lastLabel = KeyframeManager.getLastEditedLabel();
  const point = PeaksManager.addPoint({
    time,
    labelText: `kf-temp`,
    editable: false,
    color: '#888888'
  });

  const kf = KeyframeManager.addKeyframe(time, lastLabel, '', point?.id);
  if (point) {
    PeaksManager.updatePoint(point.id, { labelText: kf.id });
  }

  refreshLabelFilterOptions();
  renderKeyframeList();
  updateJson();
}

// ==================== スクラブ・ホイール操作 ====================

function seekOverviewToClientX(clientX) {
  if (!Number.isFinite(audio.duration)) return;
  const rect = overviewContainer.getBoundingClientRect();
  const ratio = Utils.clamp((clientX - rect.left) / rect.width, 0, 1);
  const target = ratio * audio.duration;
  audio.currentTime = target;

  const viewDuration = getZoomWindowDuration();
  const newStart = Utils.clamp(target - viewDuration / 2, 0, Math.max(0, audio.duration - viewDuration));
  setZoomWindowStart(newStart);
  updateTimeBadge();
  updateSpecPlayhead();
}

function seekInZoomview(evt) {
  if (!Number.isFinite(audio.duration)) return;
  const rect = zoomviewContainer.getBoundingClientRect();
  const ratio = Utils.clamp((evt.clientX - rect.left) / rect.width, 0, 1);
  const viewDuration = getZoomWindowDuration();
  const start = getZoomWindowStart(viewDuration);
  audio.currentTime = Utils.clamp(start + ratio * viewDuration, 0, audio.duration);
  updateTimeBadge();
  updateSpecPlayhead();
}

function seekInSpectrum(evt) {
  if (!Number.isFinite(audio.duration)) return;
  const rect = spectrumContainer.getBoundingClientRect();
  const { viewStart, viewDuration } = getSpecView();
  const ppsCss = currentPixelsPerSecond() || 0;
  const contentWidth = Math.max(1, Math.min(rect.width, viewDuration * ppsCss));
  const relX = Utils.clamp(evt.clientX - rect.left, 0, contentWidth);
  const ratio = relX / contentWidth;
  audio.currentTime = Utils.clamp(viewStart + ratio * viewDuration, 0, audio.duration);
  updateTimeBadge();
  updateSpecPlayhead();
  maybeRedrawSpecOnViewChange();
}

function bindScrubHandlers() {
  // Overview: ドラッグでズーム窓をパン
  let ovStartX = 0;
  let ovStartWindow = 0;
  let ovMoved = false;

  overviewContainer.addEventListener('pointerdown', (e) => {
    if (!Number.isFinite(audio.duration)) return;
    isScrubbingOverview = true;
    ovStartX = e.clientX;
    ovStartWindow = getZoomWindowStart(getZoomWindowDuration());
    ovMoved = false;
    overviewContainer.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  overviewContainer.addEventListener('pointermove', (e) => {
    if (!isScrubbingOverview) return;
    const rect = overviewContainer.getBoundingClientRect();
    const pxToSec = (audio.duration || 0) / rect.width;
    const deltaSec = (e.clientX - ovStartX) * pxToSec;
    setZoomWindowStart(ovStartWindow + deltaSec);
    if (Math.abs(e.clientX - ovStartX) > 3) ovMoved = true;
    e.preventDefault();
  });

  const stopOverview = (e) => {
    if (!isScrubbingOverview) return;
    isScrubbingOverview = false;
    overviewContainer.releasePointerCapture?.(e.pointerId);
    if (!ovMoved) {
      seekOverviewToClientX(e.clientX);
    }
  };

  overviewContainer.addEventListener('pointerup', stopOverview);
  overviewContainer.addEventListener('pointerleave', stopOverview);
  overviewContainer.addEventListener('pointercancel', stopOverview);

  // Zoom view: ドラッグでシーク
  zoomviewContainer.addEventListener('pointerdown', (e) => {
    if (!Number.isFinite(audio.duration)) return;
    isScrubbingZoomview = true;
    startScrubSpecSync();
    seekInZoomview(e);
    zoomviewContainer.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  zoomviewContainer.addEventListener('pointermove', (e) => {
    if (isScrubbingZoomview) {
      seekInZoomview(e);
      maybeRedrawSpecOnViewChange();
      e.preventDefault();
    }
  });

  const stopZoom = (e) => {
    isScrubbingZoomview = false;
    zoomviewContainer.releasePointerCapture?.(e.pointerId);
    stopScrubSpecSync();
  };

  zoomviewContainer.addEventListener('pointerup', stopZoom);
  zoomviewContainer.addEventListener('pointerleave', stopZoom);
  zoomviewContainer.addEventListener('pointercancel', stopZoom);

  // Zoom view: ホイールで倍率変更
  zoomviewContainer.addEventListener('wheel', (e) => {
    if (!PeaksManager.getPeaksInstance() || !Number.isFinite(audio.duration)) return;
    e.preventDefault();

    const rect = zoomviewContainer.getBoundingClientRect();
    const ratio = Utils.clamp((e.clientX - rect.left) / rect.width, 0, 1);

    const viewDurationBefore = getZoomWindowDuration();
    const startBefore = getZoomWindowStart(viewDurationBefore);
    const targetTime = Utils.clamp(startBefore + ratio * viewDurationBefore, 0, audio.duration);

    const currentFactor = currentSliderFactor(elZoom, zoomConfig.map);
    const scale = Math.exp(-e.deltaY * 0.0015);
    let nextFactor = Utils.clamp(currentFactor * scale, zoomConfig.map.min, zoomConfig.map.max);
    let snapped = false;
    const SNAP_RANGE = 0.1;
    if (Math.abs(nextFactor - 1) <= SNAP_RANGE) {
      nextFactor = 1;
      snapped = true;
    }

    const sr = AudioManager.getSampleRate();
    const sppAfter = Math.round(zoomConfig.factorToSamplesPerPixel(nextFactor));
    const width = rect.width || 1;
    const viewDurationAfter = (sppAfter / sr) * width;
    const maxStart = Math.max(0, audio.duration - viewDurationAfter);
    const nextStart = Utils.clamp(targetTime - ratio * viewDurationAfter, 0, maxStart);

    const sliderVal = Utils.sliderFromFactor(nextFactor, zoomConfig.map);
    elZoom.value = String(sliderVal);
    UIControls.setFactorLabel(elZoomLabel, nextFactor, snapped);
    applyZoom(nextFactor, nextStart);
  }, { passive: false });

  // Overview: ホイールで水平スクロール
  overviewContainer.addEventListener('wheel', (e) => {
    if (!Number.isFinite(audio.duration)) return;
    const rect = overviewContainer.getBoundingClientRect();
    const pxToSec = (audio.duration || 0) / rect.width;
    const deltaPx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const viewDuration = getZoomWindowDuration();
    const start = getZoomWindowStart(viewDuration);
    setZoomWindowStart(start + deltaPx * pxToSec);
    e.preventDefault();
  }, { passive: false });

  // Spectrum: click/drag to seek
  spectrumContainer.addEventListener('pointerdown', (e) => {
    if (!Number.isFinite(audio.duration)) return;
    isScrubbingSpectrum = true;
    seekInSpectrum(e);
    spectrumContainer.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  spectrumContainer.addEventListener('pointermove', (e) => {
    if (isScrubbingSpectrum) {
      seekInSpectrum(e);
      e.preventDefault();
    }
  });

  const stopSpec = (e) => {
    isScrubbingSpectrum = false;
    spectrumContainer.releasePointerCapture?.(e.pointerId);
  };

  spectrumContainer.addEventListener('pointerup', stopSpec);
  spectrumContainer.addEventListener('pointerleave', stopSpec);
  spectrumContainer.addEventListener('pointercancel', stopSpec);

  // Spectrum: wheel zoom
  spectrumContainer.addEventListener('wheel', (e) => {
    if (!PeaksManager.getPeaksInstance() || !Number.isFinite(audio.duration)) return;
    e.preventDefault();

    const rect = spectrumContainer.getBoundingClientRect();
    const ratio = Utils.clamp((e.clientX - rect.left) / rect.width, 0, 1);

    const viewDurationBefore = getZoomWindowDuration();
    const startBefore = getZoomWindowStart(viewDurationBefore);
    const targetTime = Utils.clamp(startBefore + ratio * viewDurationBefore, 0, audio.duration);

    const currentFactor = currentSliderFactor(elZoom, zoomConfig.map);
    const scale = Math.exp(-e.deltaY * 0.0015);
    let nextFactor = Utils.clamp(currentFactor * scale, zoomConfig.map.min, zoomConfig.map.max);
    let snapped = false;
    const SNAP_RANGE = 0.1;
    if (Math.abs(nextFactor - 1) <= SNAP_RANGE) {
      nextFactor = 1;
      snapped = true;
    }

    const sr = AudioManager.getSampleRate();
    const sppAfter = Math.round(zoomConfig.factorToSamplesPerPixel(nextFactor));
    const width = rect.width || 1;
    const viewDurationAfter = (sppAfter / sr) * width;
    const maxStart = Math.max(0, audio.duration - viewDurationAfter);
    const nextStart = Utils.clamp(targetTime - ratio * viewDurationAfter, 0, maxStart);

    const sliderVal = Utils.sliderFromFactor(nextFactor, zoomConfig.map);
    elZoom.value = String(sliderVal);
    UIControls.setFactorLabel(elZoomLabel, nextFactor, snapped);
    applyZoom(nextFactor, nextStart);
  }, { passive: false });
}

// ==================== スペクトログラム同期 ====================

function startSpecSync() {
  if (specSyncRaf) return;
  const tick = () => {
    updateTimeBadge();
    updateSpecPlayhead();
    maybeRedrawSpecOnViewChange();
    specSyncRaf = requestAnimationFrame(tick);
  };
  specSyncRaf = requestAnimationFrame(tick);
}

function stopSpecSync() {
  if (specSyncRaf) cancelAnimationFrame(specSyncRaf);
  specSyncRaf = null;
}

function startScrubSpecSync() {
  if (specScrubRaf) return;
  const loop = () => {
    maybeRedrawSpecOnViewChange();
    updateSpecPlayhead();
    if (isScrubbingZoomview) {
      specScrubRaf = requestAnimationFrame(loop);
    } else {
      specScrubRaf = null;
    }
  };
  specScrubRaf = requestAnimationFrame(loop);
}

function stopScrubSpecSync() {
  if (specScrubRaf) cancelAnimationFrame(specScrubRaf);
  specScrubRaf = null;
  maybeRedrawSpecOnViewChange();
  updateSpecPlayhead();
}

// ==================== イベントリスナー ====================

// ファイル選択
if (fileInput) {
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    await loadFile(file);
  });
}

// 再生/停止
if (btnPlay) {
  btnPlay.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
    updatePlayButton();
  });
}

// コマ送り
if (btnStepBack) btnStepBack.addEventListener('click', () => step(-FRAME_SEC));
if (btnStepFwd) btnStepFwd.addEventListener('click', () => step(+FRAME_SEC));

// キーフレーム追加
if (btnAddKf) btnAddKf.addEventListener('click', addKeyframe);

// audio timeupdate
if (audio) {
  audio.addEventListener('timeupdate', updateTimeBadge);
  audio.addEventListener('play', () => {
    if (!isStepPreview) stopStepPreview();
    startSpecSync();
    updatePlayButton();
  });
  audio.addEventListener('pause', () => {
    stopSpecSync();
    if (isStepPreview) stopStepPreview();
    updatePlayButton();
  });
  audio.addEventListener('ended', stopSpecSync);
}

// JSONコピー
if (btnCopy) {
  btnCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(jsonArea.value);
      btnCopy.textContent = 'コピーしました';
      setTimeout(() => (btnCopy.textContent = 'コピー'), 900);
    } catch (e) {
      alert('クリップボードへのコピーに失敗しました。HTTPS or localhost が必要な場合があります。');
    }
  });
}

// JSON編集
if (jsonArea) {
  const scheduleJsonApply = () => {
    if (jsonApplyTimer) clearTimeout(jsonApplyTimer);
    jsonApplyTimer = setTimeout(() => {
      jsonApplyTimer = null;
      applyJsonToState();
    }, JSON_APPLY_DEBOUNCE_MS);
  };

  jsonArea.addEventListener('input', () => {
    if (isUpdatingJsonArea) return;
    scheduleJsonApply();
  });

  jsonArea.addEventListener('blur', () => {
    if (isUpdatingJsonArea) return;
    if (jsonApplyTimer) {
      clearTimeout(jsonApplyTimer);
      jsonApplyTimer = null;
    }
    applyJsonToState();
  });
}

// 時間表示クリック編集・ドラッグ調整
if (timeBadge) {
  timeBadge.addEventListener('click', () => {
    if (timeBadge.dataset.skipClick === '1') {
      timeBadge.dataset.skipClick = '0';
      return;
    }
    startInlineTimeEdit();
  });

  UIControls.attachDragNudge(timeBadge, {
    getValue: () => audio.currentTime || 0,
    applyValue: (v) => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      audio.currentTime = Utils.clamp(v, 0, dur);
      updateTimeBadge();
      updateSpecPlayhead();
      maybeRedrawSpecOnViewChange();
    },
    min: 0,
    max: () => Number.isFinite(audio.duration) ? audio.duration : Infinity,
    stepPerPx: 0.01
  });
}

// スペクトログラム有効/無効切り替え
if (chkEnableSpec) {
  chkEnableSpec.addEventListener('change', () => {
    if (!chkEnableSpec.checked) {
      rememberedWebGpu = chkWebGPU ? chkWebGPU.checked : rememberedWebGpu;
      if (chkWebGPU) {
        chkWebGPU.disabled = true;
        chkWebGPU.checked = false;
      }
      teardownSpectrum();
    } else {
      const audioBuffer = AudioManager.getAudioBuffer();
      if (chkWebGPU) {
        chkWebGPU.disabled = false;
        chkWebGPU.checked = rememberedWebGpu && SpectrogramModule.isWebGPUSupported();
        preferWebGPU = chkWebGPU.checked;
      }
      if (audioBuffer) {
        buildSpectrogram(audioBuffer);
      }
    }
  });

  // 初期状態
  if (!chkEnableSpec.checked && chkWebGPU) {
    rememberedWebGpu = chkWebGPU.checked;
    chkWebGPU.disabled = true;
    chkWebGPU.checked = false;
  }
}

// WebGPU切り替え
if (chkWebGPU) {
  chkWebGPU.checked = preferWebGPU;
  if (!SpectrogramModule.isWebGPUSupported()) {
    chkWebGPU.disabled = true;
    chkWebGPU.title = 'このブラウザは WebGPU に未対応です';
  }

  chkWebGPU.addEventListener('change', () => {
    preferWebGPU = chkWebGPU.checked && SpectrogramModule.isWebGPUSupported();
    hiResSpec = null;
    hiResRequestId++;
    spectrogramRequestId++;
    const audioBuffer = AudioManager.getAudioBuffer();
    if (audioBuffer) {
      buildSpectrogram(audioBuffer);
    } else {
      setSpectrumStatus('ファイル未選択');
    }
  });
}

// ラベルフィルター
if (labelFilter) {
  labelFilter.addEventListener('change', () => {
    filterLabel = labelFilter.value || '';
    renderKeyframeList();
  });
}

// リサイズハンドリング
window.addEventListener('resize', () => {
  const view = getSpecView();
  drawSpectrogram(view.viewStart, view.viewDuration);
  updateSpecPlayhead();
});

// beforeunload guard
window.addEventListener('beforeunload', (e) => {
  const keyframes = KeyframeManager.getKeyframes();
  if (keyframes.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// キーボードショートカット
window.addEventListener('keydown', (e) => {
  if (btnPlay && btnPlay.disabled) return;

  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  const type = (e.target && e.target.type) ? e.target.type.toLowerCase() : '';
  const isTextEntry = (tag === 'input' && type !== 'range') || tag === 'textarea';

  if (isTextEntry && e.code !== 'Space' && !['k', 'h', 'l'].includes(e.key.toLowerCase())) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
    return;
  }

  const mul = e.shiftKey ? 10 : 1;
  const key = e.key.toLowerCase();

  if (key === 'h') {
    e.preventDefault();
    step(-FRAME_SEC * mul);
    return;
  }

  if (key === 'l') {
    e.preventDefault();
    step(+FRAME_SEC * mul);
    return;
  }

  if (key === 'k') {
    e.preventDefault();
    addKeyframe();
    return;
  }
});

// ==================== UI Controlsセットアップ ====================

const zoomSlider = UIControls.bindBiLogSlider({
  inputEl: elZoom,
  labelEl: elZoomLabel,
  map: zoomConfig.map,
  onChange: (factor) => {
    if (!PeaksManager.getPeaksInstance()) return;
    applyZoom(factor);
  }
});

const rateSlider = UIControls.bindBiLogSlider({
  inputEl: selRate,
  labelEl: elRateLabel,
  map: rateConfig.map,
  onChange: (factor) => applyRate(factor)
});

// ラベルをインライン編集可能に
UIControls.makeInlineFactorEditable(elRateLabel, {
  map: rateConfig.map,
  getCurrent: () => currentSliderFactor(selRate, rateConfig.map),
  applyFactor: (f) => rateSlider.set(f)
});

UIControls.makeInlineFactorEditable(elZoomLabel, {
  map: zoomConfig.map,
  getCurrent: () => currentSliderFactor(elZoom, zoomConfig.map),
  applyFactor: (f) => zoomSlider.set(f)
});

// ラベルにドラッグナッジ機能を追加
UIControls.attachDragNudge(elRateLabel, {
  getValue: () => currentSliderFactor(selRate, rateConfig.map),
  applyValue: (v, isFinal) => {
    rateSlider.set(v);
    if (isFinal) UIControls.setFactorLabel(elRateLabel, v, Math.abs(v - 1) < 1e-6);
  },
  min: rateConfig.map.min,
  max: rateConfig.map.max,
  compute: (dx, start) => Utils.clamp(start * Math.exp(dx * 0.01), rateConfig.map.min, rateConfig.map.max)
});

UIControls.attachDragNudge(elZoomLabel, {
  getValue: () => currentSliderFactor(elZoom, zoomConfig.map),
  applyValue: (v, isFinal) => {
    zoomSlider.set(v);
    if (isFinal) UIControls.setFactorLabel(elZoomLabel, v, Math.abs(v - 1) < 1e-6);
  },
  min: zoomConfig.map.min,
  max: zoomConfig.map.max,
  compute: (dx, start) => Utils.clamp(start * Math.exp(dx * 0.01), zoomConfig.map.min, zoomConfig.map.max)
});

// ドラッグ＆ドロップ
UIControls.setupDragAndDrop(dropZone, async (files) => {
  const file = Array.from(files).find(AudioManager.isAudioFile) || files[0];
  if (file) {
    await loadFile(file);
  } else {
    alert('音声ファイルをドロップしてください (mp3 / wav / ogg など)');
  }
});

// ==================== 初期化 ====================

zoomSlider.set(1);
rateSlider.set(1);
setUiEnabled(false);
updateJson();
renderKeyframeList();
bindScrubHandlers();

const view = getSpecView();
drawSpectrogram(view.viewStart, view.viewDuration);

console.log('Keyframe Editor v1.0.0 initialized');
console.log('Improvements: Modularized, Input validation, Memory leak fixes');
