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
  // ハイコントラスト設定時の判定色（全テーマ共通・本家 Wordle 準拠）。
  // CSS の body.high-contrast の --tile-* 上書きと同期している。
  tileColorsHighContrast: { used: "#85c0f9", correct: "#f5793a" },
  // 判定オープン演出
  revealIntervalMs: 180, // タイルを 1 枚ずつ開く間隔
  revealFlipMs: 420, // 1 枚のフリップ所要時間
  afterRevealPauseMs: 350, // 全部開いてから次の行へ移るまで
  shakeMs: 500, // 無効入力時のシェイク
  popMs: 110, // 文字入力時のポップ
  toastMs: 2200, // トースト表示時間
};

// テーマ + ハイコントラスト設定から実際に使う判定色を得る（canvas 描画・パーティクル用）
export function tileColorsFor(theme, highContrast) {
  const base = UI.tileColors[theme] ?? UI.tileColors.cyber;
  return highContrast ? { ...base, ...UI.tileColorsHighContrast } : base;
}

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
  // Pop テーマの水玉背景（2D canvas）。ドットの半径が画面を横切る波に合わせて伸縮する
  popBg: {
    spacing: 34, // ドットの間隔 px
    baseRadius: 3.2, // 基本半径 px
    waveAmp: 0.6, // 半径の伸縮率（基本半径に対する比、0-1）
    wave1: { wavelengthPx: 460, angleDeg: -16, speed: 1.0 }, // 主波（speed は rad/s）
    wave2: { wavelengthPx: 260, angleDeg: 58, speed: -0.7 }, // 副波（逆向きに走らせて単調さを消す）
    wave2Mix: 0.35, // 副波の混合比
    scroll: { speedPx: 7, angleDeg: 28 }, // 水玉全体のゆっくりした斜めスクロール（px/s と進行方向）
    // 水玉は単色。裏（DWORDlie）は毒っ気のある深紅に切り替える
    colors: ["rgba(255, 79, 158, 0.18)"],
    colorsUso: ["rgba(224, 48, 90, 0.20)"],
    // 盤面タイル風の 1x5 ライン。ゆっくり回転しながら画面上から下へエンドレスに流れ落ちる
    tiles: {
      lineCount: 6, // ラインの総数（助走域にいる分もあるので、画面に見えるのは常時 4〜5 本程度）
      tilesPerLine: 5, // 1 ラインのタイル枚数
      spawnSpreadY: 0.6, // 生まれ直す位置を画面上端からこの割合（画面高さ比）まで上にランダムに離し、再登場タイミングを散らす
      pitchPx: 64, // タイル中心の間隔
      sizePx: 54, // タイルの 1 辺
      scale: [0.5, 0.8], // ラインごとの大きさ倍率 [最小, 最大]
      cornerPx: 12, // 角丸半径
      strokeWidthPx: 2, // 輪郭線の太さ
      fallSpeedPx: [14, 24], // 落下速度 px/s の [最小, 最大]（ラインごとにランダム）
      spinDegPerSec: [2.5, 7], // 回転の速さ deg/s の [最小, 最大]（向きはランダム）
      revealStartSec: [2, 8], // 画面に入って（または白に戻って）から判定が始まるまでの秒数 [最小, 最大]
      revealGapSec: [0.3, 0.9], // タイル 1 枚ごとの判定の時差 [最小, 最大]（端から順番）
      revealFlipSec: 0.55, // タイル 1 枚の反転アニメの時間
      revertDelaySec: [4, 12], // 全タイル判定後、白戻しが始まるまでの秒数 [最小, 最大]（ラインごとランダム。戻り自体は端から順番）
      revertSpinSec: 0.7, // 白戻し 1 枚のスピン（回転しながら色が抜ける）の時間
      revertGapSec: [0.1, 0.3], // 白戻しのタイル 1 枚ごとの時差 [最小, 最大]（判定よりずっと短くたたみかける）
      // 判定の瞬間に飛び散る小さなパーティクル（色は控えめのまま、広めに飛ばす）
      particle: { count: 10, speedPx: [60, 170], lifeSec: 0.9, sizePx: 3.5, gravityPx: 70, alpha: 0.8 },
      // 先頭が白（未判定）、続いて緑・黄・灰（判定色）。fill はごく薄く、stroke で輪郭を立たせる
      colorsTile: [
        { fill: "rgba(255, 255, 255, 0.5)", stroke: "rgba(168, 177, 189, 0.32)" },
        { fill: "rgba(45, 189, 110, 0.13)", stroke: "rgba(45, 189, 110, 0.3)" },
        { fill: "rgba(255, 182, 40, 0.13)", stroke: "rgba(255, 182, 40, 0.34)" },
        { fill: "rgba(168, 177, 189, 0.16)", stroke: "rgba(168, 177, 189, 0.36)" },
      ],
      // 裏（DWORDlie）の暗い背景では白フチ主体のガラス調に落とす
      colorsTileUso: [
        { fill: "rgba(255, 255, 255, 0.05)", stroke: "rgba(255, 240, 250, 0.18)" },
        { fill: "rgba(45, 189, 110, 0.1)", stroke: "rgba(45, 189, 110, 0.26)" },
        { fill: "rgba(255, 182, 40, 0.08)", stroke: "rgba(255, 182, 40, 0.24)" },
        { fill: "rgba(210, 167, 199, 0.08)", stroke: "rgba(210, 167, 199, 0.24)" },
      ],
    },
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
  // FINAL ANSWER（クリア後の追加推理タイム）の演出タイミング。
  // CSS 側のアニメーション時間（style.css の「FINAL ANSWER」セクション）と同期している。
  finalAnswer: {
    cutinMs: 2100, // カットイン全体の長さ（この後に入力可能になる）
    cutinReducedMs: 400, // reduce-motion 時の入力開始までの間
    drumrollMs: 1700, // Enter からドラムロールのタメを置いて判定オープンが始まるまで（SFX drumroll と同期）
    doubleClearMs: 2600, // DOUBLE CLEAR 演出の表示時間
    resultDelayMs: 2900, // 成功時に結果画面へ進むまでの待ち（doubleClearMs より少し後）
    burstColors: [0xffd166, 0xffe680, 0xffffff], // DOUBLE CLEAR の金色パーティクル
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
