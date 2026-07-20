// localStorage の薄いラッパ。キーは全て "dwordle2." プレフィックスで名前空間を切る。

const PREFIX = "dwordle2.";

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("saveJSON failed:", key, e);
    return false;
  }
}

export function removeKey(key) {
  localStorage.removeItem(PREFIX + key);
}
