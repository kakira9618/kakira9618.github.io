/**
 * スペクトログラム計算（WebGPU / CPU）
 */

import { clamp, nearestPow2, floorPow2, yieldFrame } from './utils.js';

let webgpuDevice = null;
let webgpuQueue = null;
let webgpuPipeline = null;
const webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;

/**
 * WebGPUデバイスを初期化
 * @returns {Promise<GPUDevice|null>}
 */
async function ensureWebGPU() {
  if (!webgpuSupported) return null;
  if (webgpuDevice) return webgpuDevice;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    webgpuDevice = await adapter.requestDevice();
    webgpuQueue = webgpuDevice.queue;
    return webgpuDevice;
  } catch (e) {
    console.warn('WebGPU init failed, fallback to CPU', e);
    return null;
  }
}

/**
 * WebGPU FFTシェーダーを生成
 * @returns {string} WGSLシェーダーコード
 */
function getFftShader() {
  return /* wgsl */`
  struct InBuf { data: array<f32>, };
  struct OutBuf { data: array<f32>, };
  @group(0) @binding(0) var<storage, read>  inBuf : InBuf;
  @group(0) @binding(1) var<storage, read_write> outBuf : OutBuf;

  const FFT_SIZE : u32 = 1024u;
  const BINS : u32 = 512u;
  const PI2 : f32 = 6.283185307179586;
  const LOGN : u32 = 10u; // log2(1024)

  var<workgroup> realBuf : array<f32, FFT_SIZE>;
  var<workgroup> imagBuf : array<f32, FFT_SIZE>;

  fn bitrev(v : u32, bits : u32) -> u32 {
    var r : u32 = 0u;
    var i : u32 = 0u;
    loop {
      if (i >= bits) { break; }
      r = (r << 1u) | ((v >> i) & 1u);
      i = i + 1u;
    }
    return r;
  }

  @compute @workgroup_size(256)
  fn main(@builtin(workgroup_id) wg_id : vec3<u32>,
          @builtin(local_invocation_id) lid : vec3<u32>) {
    let frame = wg_id.x;
    let base = frame * FFT_SIZE;

    // load to shared
    var i = lid.x;
    loop {
      if (i >= FFT_SIZE) { break; }
      realBuf[i] = inBuf.data[base + i];
      imagBuf[i] = 0.0;
      i = i + 256u;
    }
    workgroupBarrier();

    // bit-reversal permutation
    i = lid.x;
    loop {
      if (i >= FFT_SIZE) { break; }
      let j = bitrev(i, LOGN);
      if (j > i) {
        let tr = realBuf[i];
        let ti = imagBuf[i];
        realBuf[i] = realBuf[j];
        imagBuf[i] = imagBuf[j];
        realBuf[j] = tr;
        imagBuf[j] = ti;
      }
      i = i + 256u;
    }
    workgroupBarrier();

    // iterative radix-2 Cooley-Tukey
    var m : u32 = 2u;
    loop {
      if (m > FFT_SIZE) { break; }
      let half = m >> 1u;
      let angStep = PI2 / f32(m);
      var k = lid.x;
      loop {
        if (k >= FFT_SIZE) { break; }
        let j = k & (m - 1u);
        if (j < half) {
          let tw = f32(j);
          let ang = -angStep * tw;
          let cs = cos(ang);
          let sn = sin(ang);
          let block = k - j;
          let idx = block + j;
          let idx2 = idx + half;
          let tre = realBuf[idx2] * cs - imagBuf[idx2] * sn;
          let tim = realBuf[idx2] * sn + imagBuf[idx2] * cs;
          realBuf[idx2] = realBuf[idx] - tre;
          imagBuf[idx2] = imagBuf[idx] - tim;
          realBuf[idx] = realBuf[idx] + tre;
          imagBuf[idx] = imagBuf[idx] + tim;
        }
        k = k + 256u;
      }
      workgroupBarrier();
      m = m << 1u;
    }

    // write magnitudes
    var b = lid.x;
    loop {
      if (b >= BINS) { break; }
      let re = realBuf[b];
      let im = imagBuf[b];
      outBuf.data[frame * BINS + b] = sqrt(re * re + im * im);
      b = b + 256u;
    }
  }`;
}

/**
 * FFTパイプラインを確保
 * @param {GPUDevice} device
 * @returns {Promise<GPUComputePipeline>}
 */
async function ensureFftPipeline(device) {
  if (webgpuPipeline) return webgpuPipeline;
  const module = device.createShaderModule({ code: getFftShader() });
  webgpuPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' }
  });
  return webgpuPipeline;
}

/**
 * Hann窓を生成
 * @param {number} fftSize - FFTサイズ
 * @returns {Float32Array}
 */
function buildHann(fftSize) {
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }
  return hann;
}

/**
 * WebGPUでスペクトログラムを計算
 * @param {Object} opts - オプション
 * @returns {Promise<Object|null>}
 */
async function computeSpectrogramWebGPU({ audioBuffer, start = 0, duration = audioBuffer.duration, hopSize, fftSize = 1024 }) {
  const device = await ensureWebGPU();
  if (!device || fftSize !== 1024) return null; // シェーダーは1024固定

  const sampleRate = audioBuffer.sampleRate;
  const channelCount = audioBuffer.numberOfChannels;
  const startSample = Math.max(0, Math.floor(start * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil((start + duration) * sampleRate));
  const segmentLen = Math.max(0, endSample - startSample);
  const bins = fftSize / 2;
  const frames = Math.max(1, Math.floor((segmentLen - fftSize) / hopSize) + 1);

  if (frames <= 0 || segmentLen < fftSize) return null;

  const hann = buildHann(fftSize);
  const frameData = new Float32Array(frames * fftSize);

  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const idx = startSample + offset + i;
      let sample = 0;
      if (idx < endSample) {
        let s = 0;
        for (let ch = 0; ch < channelCount; ch++) {
          s += audioBuffer.getChannelData(ch)[idx];
        }
        sample = s / channelCount;
      }
      frameData[frame * fftSize + i] = sample * hann[i];
    }
  }

  const inputSize = frameData.byteLength;
  const outputSize = frames * bins * 4;

  const inputBuffer = device.createBuffer({
    size: inputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const outputBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  });
  const readbackBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });

  webgpuQueue.writeBuffer(inputBuffer, 0, frameData.buffer, frameData.byteOffset, frameData.byteLength);
  const pipeline = await ensureFftPipeline(device);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } }
    ]
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(frames);
  pass.end();
  encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, outputSize);
  device.queue.submit([encoder.finish()]);

  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const mapped = readbackBuffer.getMappedRange();
  const outData = new Float32Array(mapped.slice(0));
  readbackBuffer.unmap();

  // 正規化
  let peak = 1e-9;
  for (let i = 0; i < outData.length; i++) {
    if (outData[i] > peak) peak = outData[i];
  }
  const minDb = -85;
  const spanDb = -minDb;
  for (let i = 0; i < outData.length; i++) {
    const db = 20 * Math.log10(outData[i] / peak + 1e-12);
    outData[i] = clamp((db - minDb) / spanDb, 0, 1);
  }

  return {
    data: outData,
    frames,
    bins,
    hopSize,
    sampleRate,
    duration: audioBuffer.duration,
    totalDuration: audioBuffer.duration,
    sliceStart: start,
    sliceDuration: duration,
    viewStart: start,
    viewDuration: duration
  };
}

/**
 * FFT実装（CPU）
 * @param {number} size - FFTサイズ（2のべき乗）
 * @returns {Object} FFTオブジェクト
 */
function createFFT(size) {
  if (size & (size - 1)) throw new Error('FFT size must be power of 2');
  const levels = Math.log2(size);
  const rev = new Uint32Array(size);

  for (let i = 0; i < size; i++) {
    let x = i, y = 0;
    for (let j = 0; j < levels; j++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = y;
  }

  const sinTable = new Float32Array(size / 2);
  const cosTable = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    const ang = -2 * Math.PI * i / size;
    sinTable[i] = Math.sin(ang);
    cosTable[i] = Math.cos(ang);
  }

  return {
    transform(re, im) {
      const n = size;
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          const tr = re[i]; re[i] = re[j]; re[j] = tr;
          const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
      }

      for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const step = size / len;
        for (let i = 0; i < n; i += len) {
          for (let j = 0; j < half; j++) {
            const k = j * step;
            const cos = cosTable[k];
            const sin = sinTable[k];
            const tre = re[i + j + half] * cos - im[i + j + half] * sin;
            const tim = re[i + j + half] * sin + im[i + j + half] * cos;
            re[i + j + half] = re[i + j] - tre;
            im[i + j + half] = im[i + j] - tim;
            re[i + j] += tre;
            im[i + j] += tim;
          }
        }
      }
      return { re, im };
    }
  };
}

/**
 * CPUでスペクトログラムを計算
 * @param {Object} opts - オプション
 * @returns {Promise<Object>}
 */
async function computeSpectrogramCPU({ audioBuffer, start = 0, duration = audioBuffer.duration, hopSize, fftSize = 1024 }) {
  const sampleRate = audioBuffer.sampleRate;
  const channelCount = audioBuffer.numberOfChannels;
  const startSample = Math.max(0, Math.floor(start * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil((start + duration) * sampleRate));
  const segmentLen = Math.max(0, endSample - startSample);

  if (segmentLen < fftSize) {
    throw new Error('Audio segment too short for FFT size');
  }

  const mono = new Float32Array(segmentLen);
  for (let ch = 0; ch < channelCount; ch++) {
    const src = audioBuffer.getChannelData(ch);
    for (let i = 0; i < segmentLen; i++) mono[i] += src[startSample + i];
  }
  const invCh = 1 / Math.max(1, channelCount);
  for (let i = 0; i < segmentLen; i++) mono[i] *= invCh;

  const bins = fftSize / 2;
  const frames = Math.floor((segmentLen - fftSize) / hopSize) + 1;
  if (frames <= 0) {
    throw new Error('Insufficient audio length for spectrogram');
  }

  const hann = buildHann(fftSize);
  const fft = createFFT(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const data = new Float32Array(frames * bins);

  let peak = 1e-9;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const idx = offset + i;
      re[i] = (idx < mono.length ? mono[idx] : 0) * hann[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    const base = frame * bins;
    for (let b = 0; b < bins; b++) {
      const mag = Math.hypot(re[b], im[b]);
      data[base + b] = mag;
      if (mag > peak) peak = mag;
    }
    if (frame % 500 === 0) await yieldFrame();
  }

  const minDb = -85;
  const spanDb = -minDb;
  for (let i = 0; i < data.length; i++) {
    const mag = data[i];
    const db = 20 * Math.log10(mag / peak + 1e-12);
    data[i] = clamp((db - minDb) / spanDb, 0, 1);
    if (i % 131072 === 0) await yieldFrame();
  }

  return {
    data,
    frames,
    bins,
    sampleRate,
    hopSize,
    duration: audioBuffer.duration,
    totalDuration: audioBuffer.duration,
    sliceStart: start,
    sliceDuration: duration
  };
}

/**
 * スペクトログラムを計算（自動選択: WebGPU優先）
 * @param {Object} opts - オプション
 * @param {boolean} preferWebGPU - WebGPUを優先するか
 * @returns {Promise<Object>}
 */
export async function computeSpectrogram(opts, preferWebGPU = true) {
  if (preferWebGPU) {
    try {
      const gpuSpec = await computeSpectrogramWebGPU(opts);
      if (gpuSpec) return gpuSpec;
    } catch (e) {
      console.warn('WebGPU spectrogram failed, fallback to CPU', e);
    }
  }
  return computeSpectrogramCPU(opts);
}

/**
 * WebGPUのサポート状況を取得
 * @returns {boolean}
 */
export function isWebGPUSupported() {
  return webgpuSupported;
}

/**
 * WebGPUリソースをクリーンアップ
 */
export function cleanupWebGPU() {
  webgpuPipeline = null;
  webgpuQueue = null;
  if (webgpuDevice) {
    // GPUDeviceには明示的なcloseメソッドがないため、参照を解放するのみ
    webgpuDevice = null;
  }
}
