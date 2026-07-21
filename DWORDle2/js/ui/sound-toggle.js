// どの画面からもワンタップで音（BGM + 効果音）をまとめてオン/オフするボタン。
// オフにする前の個別設定（BGM だけオン等）を覚えておき、復帰時にそのまま戻す。

import { el } from "./dom.js";
import { getSettings, setSetting, onSettingsChange } from "../core/settings.js?v=20260722-uso-modal-hint";
import { loadJSON, saveJSON } from "../core/store.js";
import { playSfx } from "../audio/sound.js?v=20260722-uso-modal-hint";
import { icon } from "./icons.js";
import { tr } from "../core/i18n.js?v=20260722-uso-modal-hint";

const isSoundOn = (s = getSettings()) => s.bgm || s.sfx;

function toggleSound() {
  const s = getSettings();
  if (isSoundOn(s)) {
    saveJSON("soundRestore", { bgm: s.bgm, sfx: s.sfx });
    setSetting("bgm", false);
    setSetting("sfx", false);
  } else {
    const saved = loadJSON("soundRestore", null);
    const restore = saved && (saved.bgm || saved.sfx) ? saved : { bgm: true, sfx: true };
    // ユーザー操作中に設定を戻すことで、Safari でも BGM がそのまま再開できる
    setSetting("sfx", !!restore.sfx);
    setSetting("bgm", !!restore.bgm);
    playSfx("ui");
  }
}

// 音のオン/オフを 1 タップで切り替えるアイコンボタン。他画面・設定画面での変更にも追従する。
export function soundToggleButton() {
  const btn = el("button", { class: "icon-btn", onclick: toggleSound });
  const sync = (s = getSettings()) => {
    const on = isSoundOn(s);
    const label = on ? tr("音をオフにする", "Mute sounds") : tr("音をオンにする", "Unmute sounds");
    btn.replaceChildren(icon(on ? "sound" : "soundOff"));
    btn.title = label;
    btn.setAttribute("aria-label", label);
  };
  sync();
  // 画面の再描画でボタンが作り直されたら、切り離された古いボタンの購読は次の通知で解除する
  const unsubscribe = onSettingsChange((s, key) => {
    if (key !== "bgm" && key !== "sfx") return;
    if (!btn.isConnected) {
      unsubscribe();
      return;
    }
    sync(s);
  });
  return btn;
}
