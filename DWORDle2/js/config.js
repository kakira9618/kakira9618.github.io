// UI・演出のチューニング用定数。見た目の調整はこのファイルにまとめる。

export const APP_VERSION = "2.0.0";

// 公開 URL（シェア文言・スクリーンショットに入る）
export const SHARE_URL = "https://kakira9618.github.io/DWORDle2/";

export const UI = {
  // タイル判定色（テーマ別）。CSS 変数 (--tile-*) と同期している。
  tileColors: {
    classic: { unused: "#787c7e", used: "#c9b458", correct: "#6aaa64" },
    cyber: { unused: "#3a4356", used: "#ffc233", correct: "#00e68a" },
    pop: { unused: "#a8b1bd", used: "#ffb628", correct: "#2dbd6e" },
  },
  // 判定オープン演出
  revealIntervalMs: 180, // タイルを 1 枚ずつ開く間隔
  revealFlipMs: 420, // 1 枚のフリップ所要時間
  afterRevealPauseMs: 350, // 全部開いてから次の行へ移るまで
  shakeMs: 500, // 無効入力時のシェイク
  popMs: 110, // 文字入力時のポップ
  toastMs: 2200, // トースト表示時間
};

export const FX = {
  // Three.js 背景（cyber テーマ）
  bg: {
    gridColor: 0x00c8ff,
    gridColorUso: 0xff2255,
    gridDivisions: 60,
    gridSize: 260,
    gridOpacity: 0.2,
    // 蛍の層: 強く光る芯 + ぼんやりした暈を持ち、明滅しながら漂って軌跡を残す
    firefly: {
      count: 36,
      size: [3.4, 6.8], // 頭の光のワールドサイズ [最小, 最大]
      opacity: 0.8, // 発光ピーク時の明るさ（盤面が見えなくなるほど上げない）
      baseGlow: 0.2, // ぼんやり期の明るさ（発光ピーク比）
      blinkSpeed: [0.06, 0.16], // 明滅の速さ（1 秒あたりの周期数）
      wanderRadius: [4, 11], // 漂いの振幅（ワールド単位）
      wanderSpeed: [0.07, 0.2], // 漂いの角速度
      trailPoints: 14, // 軌跡の点数（頭を除く）
      trailSpacingSec: 0.45, // 軌跡 1 点あたりの時間差（詰めるほど滑らかな尾になる）
      trailSize: 0.7, // 軌跡のサイズ（頭に対する比）
      trailGlow: 0.5, // 軌跡の明るさ（頭に対する比。末尾へさらに減衰）
    },
    // 細かい塵の層（ゆっくり上昇）
    dustCount: 200,
    dustSize: [0.5, 1.3],
    dustOpacity: 0.55,
    dustRise: 0.55, // 上昇速度
    particleColors: [0x66e0ff, 0xb08cff, 0x6fffc9, 0xffffff],
    particleColorsUso: [0xff5577, 0xff9955, 0xc766ff, 0xffffff],
    horizonColor: 0x0a3a55, // 地平線の発光色
    horizonColorUso: 0x55081e,
    cameraDrift: 2.2, // カメラの揺らぎ幅
    scrollSpeed: 7.0, // グリッドの流れる速さ
    // 空に浮かぶ大きくふわっとした光。ゆっくり漂い、呼吸するように明滅する
    skyGlow: {
      count: 7,
      opacity: 0.19,
      scale: [70, 160], // ワールド単位の [最小, 最大]
      colors: [0x3d6dff, 0x8a55ff, 0x1fb8d8, 0xe055b0],
      colorsUso: [0xff3d5e, 0xff7744, 0xa03dff, 0xcc2244],
    },
    hueDriftAmp: 0.05, // 色相のゆっくりした揺らぎ幅（0-1 の色相環比）
    hueDriftSpeed: 0.021, // 揺らぎの速さ（小さいほどじわじわ変わる）
  },
  // 新しい行のタイルが 3D で集合してくる演出（fx3d キャンバス上の本物の 3D 面）
  gather: {
    durationMs: 650, // 1 枚の飛行時間
    staggerMs: 60, // タイルごとの開始ずれ
    startDist: [0.3, 0.55], // 開始距離（画面長辺に対する割合の [最小, 最大]）
    depthRange: [-700, 150], // 開始時の奥行き (z)。負が奥
    maxTiltDeg: 150, // 開始時の回転量の上限（各軸）
    faceFill: "rgba(10, 16, 32, 0.8)", // タイル面の色
    edgeNormal: "rgba(0, 213, 255, 0.75)", // 枠の色（表）
    edgeUso: "rgba(255, 43, 94, 0.75)", // 枠の色（裏）
  },
  // タイル開示時のパーティクルバースト
  burst: {
    countPerTile: { correct: 26, used: 16, unused: 7 },
    countWin: 420,
    speed: 260, // px/s
    gravity: 340,
    lifeMs: 900,
    sizePx: 3.2,
  },
};

export const AUDIO = {
  masterGain: 0.5,
  bgmGain: 0.16,
  sfxGain: 0.5,
  bgmCrossfadeSec: 1.4, // 表 / 裏切替時の BGM クロスフェード時間
};
