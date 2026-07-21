// ユーザー設定と OS のアクセシビリティ設定をまとめた動きの抑制判定。

import { getSettings } from "./settings.js?v=20260722-oldchrome-colormix";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function mediaQuery() {
  return typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

export function shouldReduceMotion(settings = getSettings(), osPrefersReducedMotion = mediaQuery()?.matches ?? false) {
  return Boolean(settings.reduceFx || osPrefersReducedMotion);
}

export function onMotionPreferenceChange(listener) {
  const query = mediaQuery();
  if (!query) return () => {};
  const handler = () => listener(shouldReduceMotion());
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }
  query.addListener?.(handler);
  return () => query.removeListener?.(handler);
}
