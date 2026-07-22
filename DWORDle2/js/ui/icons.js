// SVG アイコンライブラリ（絵文字の代替）。
// 24x24 の stroke ベースで統一。色は currentColor を継承する。

const STROKE_ATTRS = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

// 各アイコンは 24x24 viewBox 内の SVG 断片
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9"/>',
  sunrise: '<path d="M4 17.5a8 8 0 0 1 16 0"/><path d="M2 21h20M12 3v4M5.2 8.2l1.9 1.9M18.8 8.2l-1.9 1.9M8.5 14.5 12 11l3.5 3.5"/>',
  gift: '<rect x="4" y="10" width="16" height="10.5" rx="1.5"/><path d="M3 6.5h18v3.5H3zM12 6.5v14M12 6.5C9.5 6.5 7 5.6 7 3.8 7 2.4 9 2 10 3c1 .9 2 3.5 2 3.5M12 6.5c2.5 0 5-.9 5-2.7C17 2.4 15 2 14 3c-1 .9-2 3.5-2 3.5"/>',
  arrowLeft: '<path d="M15 5 L8 12 L15 19"/>',
  arrowUp: '<path d="M12 20V5M5.5 11.5 12 5l6.5 6.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><g fill="currentColor" stroke="none"><circle cx="9" cy="9" r="1.4"/><circle cx="15" cy="9" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="9" cy="15" r="1.4"/><circle cx="15" cy="15" r="1.4"/></g>',
  hash: '<path d="M9.5 4 L7.5 20 M16.5 4 L14.5 20 M5 9.5 H20 M4 14.5 H19"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8.7 11 6.5 3h4L12 7l1.5-4h4L15.3 11"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9 16.9 7.1M7.1 16.9l-2.2 2.2"/>',
  chart: '<path d="M3 20h18M6.5 20v-8M11.5 20V6M16.5 20v-11"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="M14.8 14.8 20 20"/>',
  share: '<path d="M3 11 21 3l-7 18-3-8-8-2z"/><path d="M11 13 21 3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  flask: '<path d="M9.5 3h5M10.5 3v6L4.8 18a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L13.5 9V3"/><path d="M7.6 14h8.8"/>',
  retry: '<path d="M20 12a8 8 0 1 1-2.9-6.2"/><path d="M20 3v5h-5"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.2" r="3.8"/><path d="M8 7l1.6-3h4.8L16 7"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  trash: '<path d="M4 7h16M9.5 7V4h5v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5Z"/>',
  sound: '<path d="M4 9.5v5h3.5l4.5 4V5.5l-4.5 4Z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a8 8 0 0 1 0 10.8"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  unlock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.8"/>',
  soundOff: '<path d="M4 9.5v5h3.5l4.5 4V5.5l-4.5 4Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  mask: '<path d="M4 4.5c4 1.8 12 1.8 16 0V12a8 7.5 0 0 1-16 0Z"/><path d="M8 9.2c.6-.8 1.9-.8 2.5 0M13.5 9.2c.6-.8 1.9-.8 2.5 0M9 14.8c1.2-1.4 4.8-1.4 6 0"/>',
  star: '<path d="M12 3l2.4 5.9 6.1.5-4.7 4.1 1.5 6L12 16.2 6.7 19.5l1.5-6L3.5 9.4l6.1-.5Z"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0Z"/><path d="M16 5.5h3a3 3 0 0 1-3.4 4M8 5.5H5a3 3 0 0 0 3.4 4M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5z"/>',
  flame: '<path d="M12 3c.3 2.8-5 5-5 10a5 5 0 0 0 10 0c0-3-2.5-4.5-3.5-8-.5-1-.8-1.4-1.5-2Z"/><path d="M12 12.5c-.9 1.3-1.7 1.9-1.7 3.2a1.7 1.7 0 0 0 3.4 0c0-1.3-.8-1.9-1.7-3.2Z"/>',
  crown: '<path d="M4 18V8l5 4 3-6 3 6 5-4v10Z"/><path d="M4 18h16"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 9-13h-6Z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  mountain: '<path d="M3 20 10 7l4 6 3-5 4 12Z"/><path d="M8.2 10.5 10 12.5l1.5-2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2 13.2 13.2 8.2 15.8 10.8 10.8Z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5Z"/><path d="M3 12.5 12 17.5l9-5"/><path d="M3 16.7 12 21.7l9-5"/>',
  eye: '<path d="M2.5 12C6 6.5 18 6.5 21.5 12 18 17.5 6 17.5 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  hourglass: '<path d="M6.5 3h11M6.5 21h11M8 3c0 5 4 5.6 4 9s-4 4-4 9M16 3c0 5-4 5.6-4 9s4 4 4 9"/>',
  wave: '<path d="M2 14c2.5-4 5-4 7.5 0s5 4 7.5 0c1.5-2.4 3-3.3 5-2.6"/><path d="M2 19c2.5-4 5-4 7.5 0"/>',
  cloud: '<path d="M6.5 18a4.5 4.5 0 0 1 .8-8.9 5.5 5.5 0 0 1 10.5 1.6A3.8 3.8 0 0 1 17 18Z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.6 0 2-1.2 1.4-2.2-.8-1.4.1-2.8 1.6-2.8h2.5A3.5 3.5 0 0 0 21 12.5 9.5 9.5 0 0 0 12 3Z"/><g fill="currentColor" stroke="none"><circle cx="7.8" cy="10.5" r="1.2"/><circle cx="10.8" cy="7.3" r="1.2"/><circle cx="14.8" cy="7.6" r="1.2"/></g>',
  rocket: '<path d="M12 2.5c3 2 4.5 6 4 9.5l-4 4-4-4c-.5-3.5 1-7.5 4-9.5Z"/><circle cx="12" cy="8.5" r="1.7"/><path d="M8 12l-3 4 3.5-.5M16 12l3 4-3.5-.5M12 17v4.5"/>',
  swords: '<path d="M4 4l9 9M4 4h2.5M4 4v2.5M20 4l-9 9M20 4h-2.5M20 4v2.5M7 17l-3 3M17 17l3 3M6 14l4 4M18 14l-4 4"/>',
  gauge: '<path d="M4.5 19a9.5 9.5 0 1 1 15 0"/><path d="M12 14l4.5-4.5"/><circle cx="12" cy="14" r="1.5" fill="currentColor" stroke="none"/>',
  ghost: '<path d="M5 21V11a7 7 0 0 1 14 0v10l-2.4-2.3-2.3 2.3-2.3-2.3-2.3 2.3L7.4 18.7Z"/><g fill="currentColor" stroke="none"><circle cx="9.5" cy="11" r="1.3"/><circle cx="14.5" cy="11" r="1.3"/></g>',
  shuffle: '<path d="M3 7h4l10 10h4M18 14l3 3-3 3M3 17h4l2.5-2.5M14.5 9.5 17 7h4M18 4l3 3-3 3"/>',
  book: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5Z"/><path d="M5 4.5v17M19 19v2.5H7.5"/>',
  shield: '<path d="M12 3l7 3v5.5c0 5-3 8-7 9.5-4-1.5-7-4.5-7-9.5V6Z"/><path d="M9 11.5l2.3 2.5 4.2-4.5"/>',
  gem: '<path d="M7 4h10l4 5-9 11L3 9Z"/><path d="M3 9h18M9.5 9 12 20 14.5 9M7 4l2.5 5M17 4l-2.5 5"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5h11l-2.5 3L17 11H6"/>',
  skull: '<path d="M12 3a7.5 7 0 0 0-7.5 7c0 3 1.5 4.7 3 5.8V19h9v-3.2c1.5-1.1 3-2.8 3-5.8A7.5 7 0 0 0 12 3Z"/><g fill="currentColor" stroke="none"><circle cx="9" cy="10.5" r="1.6"/><circle cx="15" cy="10.5" r="1.6"/></g><path d="M12 12.8l-1 1.9h2ZM10 19v-2M14 19v-2"/>',
  type: '<path d="M4 7V4h16v3M12 4v16M9 20h6"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  sparkle: '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8Z"/><path d="M18.5 15.5l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8Z" fill="currentColor" stroke="none"/>',
  nightMoon: '<path d="M17 13.5A7 7 0 1 1 8.5 5 5.8 5.8 0 0 0 17 13.5Z"/><path d="M18 3.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9Z" fill="currentColor" stroke="none"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2.5 2.5"/><path d="M9.5 7.5 4 12l5.5 4.5ZM14.5 7.5 20 12l-5.5 4.5Z"/>',
  backspace: '<path d="M8.5 5H20a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H8.5L2.5 12Z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  music: '<path d="M9 18V6l10-2v12"/><ellipse cx="6.5" cy="18" rx="2.5" ry="2"/><ellipse cx="16.5" cy="16" rx="2.5" ry="2"/>',
  card: '<rect x="3" y="4.8" width="18" height="14.6" rx="2.5"/><circle cx="8.3" cy="10.8" r="1.9"/><path d="M5.7 16.4c.5-1.7 4.7-1.7 5.2 0M13.6 9.6h4.6M13.6 12.8h4.6M13.6 16h3.2"/>',
  play: '<path d="M7 4.5 19 12 7 19.5Z"/>',
  footprints: '<path d="M6.5 3.5C8.5 3.5 9.5 5.5 9.5 8c0 1.8-.6 2.5-1 4H5.3c-.3-1.5-.8-2.2-.8-4 0-2.5 1-4.5 2-4.5Z"/><path d="M5.5 14h3.6v1.8a1.8 1.8 0 0 1-3.6 0Z"/><path d="M17.5 8.5c2 0 3 2 3 4.5 0 1.8-.5 2.5-.8 4h-3.2c-.4-1.5-1-2.2-1-4 0-2.5 1-4.5 2-4.5Z"/><path d="M16.2 19h3.6v1.3a1.8 1.8 0 0 1-3.6 0Z"/>',
  triangleDown: '<path d="M5 8h14l-7 8.5Z" fill="currentColor" stroke="none"/>',
};

// SVG 要素を生成
export function icon(name, size = 20, className = "") {
  const span = document.createElement("span");
  span.className = `icon ${className}`;
  const frag = ICONS[name] ?? ICONS.sparkle;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${STROKE_ATTRS} aria-hidden="true">${frag}</svg>`;
  return span;
}

// canvas 描画用に raw SVG 文字列が欲しい場合
export function iconSvg(name, size = 20, color = "#fff") {
  const frag = ICONS[name] ?? ICONS.sparkle;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${frag}</svg>`;
}

export function hasIcon(name) {
  return name in ICONS;
}
