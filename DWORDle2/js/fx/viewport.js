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
