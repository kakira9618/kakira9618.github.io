// 背景・エフェクトのキャンバスが使うビューポート寸法。
//
// window.innerWidth / innerHeight を使ってはいけない。iOS Safari では、この 2 つは
// ピンチズーム中「今見えている範囲」（視覚ビューポート）を返す。拡大すると値が縮み、
// resize が飛んでキャンバスのバッファだけが小さくなるため、CSS 上は画面いっぱいのまま
// 引き伸ばされて背景の描画が崩れる（ズーム禁止をやめて初めて表に出た）。
//
// 背景キャンバスは position: fixed; inset: 0 なのでレイアウトビューポートに広がる。
// documentElement のクライアント領域がちょうどその寸法で、ズームでは変化しない。
export function viewportWidth() {
  return document.documentElement?.clientWidth || window.innerWidth;
}

export function viewportHeight() {
  return document.documentElement?.clientHeight || window.innerHeight;
}

// 大画面での UI 全体拡大率（style.css の --app-zoom）。
// 背景・エフェクトのキャンバスは #app の zoom の外にあるため、px 指定の
// オブジェクトサイズ・速度をこの倍率で拡大して、拡大された UI と見た目を揃える。
// 倍率はメディアクエリでしか変わらないので、頻繁に読む側は resize 時に取り直せばよい。
export function uiZoom() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--app-zoom");
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
