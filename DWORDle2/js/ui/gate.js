// エントリーゲート（扉絵）。すべてのページロードで最初に表示され、
// 「開始」タップというユーザー操作でブラウザの音声自動再生制限を解錠してから
// 本来の画面へ入る（ハッシュはそのままなので、リロード・ディープリンクでも
// 行きたかったページへ直通する）。
// 初回訪問でも「いきなり基本ルールモーダル」ではなく、まず扉絵で迎える体裁になる。

import { el } from "./dom.js";
import { getAppMode } from "./app.js?v=20260723-lang-bgm";
import { APP_VERSION } from "../config.js?v=20260723-lang-bgm";
import { SOURCE_HASH } from "../version.js?v=20260723-lang-bgm";
import { getSettings } from "../core/settings.js?v=20260723-lang-bgm";
import { unlockAudio } from "../audio/sound.js?v=20260723-lang-bgm";
import { muteAllSounds } from "./sound-toggle.js?v=20260723-lang-bgm";
import { shouldReduceMotion } from "../core/motion.js?v=20260723-lang-bgm";
import { tr } from "../core/i18n.js?v=20260723-lang-bgm";

// 退場フェードの長さ（CSS の #entry-gate transition と同期）
const GATE_EXIT_MS = 340;

// 扉絵を表示する。いずれかのボタンで閉じたあと onEnter() を呼ぶ。
export function showEntryGate(onEnter) {
  const isUso = getAppMode() === "uso";
  const settings = getSettings();
  const soundOn = settings.bgm || settings.sfx;
  let entered = false;

  const enter = () => {
    if (entered) return;
    entered = true;
    // 扉絵の間はグローバルの解錠（main.js の pointerdown）を止めているため、
    // ボタン操作のユーザー操作スタック内でここが明示的に解錠する
    unlockAudio({ restartBgm: true });
    gate.classList.add("leaving");
    const finish = () => {
      gate.remove();
      onEnter();
    };
    if (shouldReduceMotion()) finish();
    else setTimeout(finish, GATE_EXIT_MS);
  };

  const startBtn = el("button", { class: "btn btn-primary entry-gate-start", onclick: enter }, tr("開始", "Start"));
  let mutedBtn = null;
  if (soundOn) {
    mutedBtn = el(
      "button",
      { class: "btn btn-ghost entry-gate-muted", onclick: () => { muteAllSounds(); enter(); } },
      tr("音無しで開始", "Start muted")
    );
    // 全体の音声解錠は pointerdown（main.js）で走るため、それより先にミュートして
    // BGM が一瞬だけ鳴るのを防ぐ（click はキーボード操作時の保険）
    mutedBtn.addEventListener("pointerdown", muteAllSounds);
  }

  const gate = el(
    "div",
    { id: "entry-gate", role: "dialog", "aria-modal": "true", "aria-label": isUso ? "DWORDlie 2" : "DWORDle 2" },
    el(
      "div",
      { class: "entry-gate-card" },
      el("div", { class: "logo", "aria-hidden": "true" }, isUso ? "DWORDlie" : "DWORDle", el("span", { class: "two" }, " 2")),
      el(
        "p",
        { class: "entry-gate-note" },
        soundOn
          ? tr("このゲームは音が出ます（BGM・効果音）", "This game plays sound (BGM & sound effects)")
          : tr("音はオフに設定されています", "Sound is currently muted")
      ),
      startBtn,
      mutedBtn
    ),
    // 扉絵の段階でもバージョンとソースハッシュを確認できるようにする
    el("div", { class: "app-version", title: "DWORDle 2 version" }, `v${APP_VERSION} (${SOURCE_HASH})`)
  );
  document.body.append(gate);
  requestAnimationFrame(() => startBtn.focus());
}
