// トースト表示（通常メッセージ + 実績解放）。

import { el } from "./dom.js";
import { UI } from "../config.js";
import { playSfx } from "../audio/sound.js";
import { icon } from "./icons.js";
import { setSetting } from "../core/settings.js";
import { isEnglish, localizedAchievement, tr } from "../core/i18n.js";

const layer = () => document.getElementById("toast-layer");

function show(node, ms) {
  layer().append(node);
  setTimeout(() => {
    node.classList.add("closing");
    setTimeout(() => node.remove(), 350);
  }, ms);
}

export function toast(message) {
  show(el("div", { class: "toast" }, message), UI.toastMs);
}

// 実績解放の差し込み表示。複数同時解放は順番に少しずらして出す。
export function achievementToast(achievements) {
  achievements.forEach((ach, i) => {
    setTimeout(() => {
      const localized = localizedAchievement(ach);
      playSfx("achievement");
      show(
        el(
          "div",
          { class: "toast achievement" },
          el("span", { class: "ach-icon", style: { color: ach.color } }, icon(ach.icon, 24)),
          el("div", {},
            el("div", { class: "ach-label" }, ach.hidden ? tr("隠し実績解放！", "SECRET ACHIEVEMENT!") : tr("実績解放！", "ACHIEVEMENT UNLOCKED!")),
            el("div", {}, localized.name)
          )
        ),
        UI.achievementToastMs
      );
    }, i * 700);
  });
}

// Extra BGM の解放専用演出。実績トーストの後に、曲名を大きく見せて選択もできる。
export function bgmUnlockCelebration(tracks, delayMs = 0) {
  tracks.forEach((track, index) => {
    setTimeout(() => {
      playSfx("achievement");
      const name = isEnglish() ? (track.nameEn ?? track.name) : track.name;
      const desc = isEnglish() ? (track.descEn ?? track.desc) : track.desc;
      const node = el(
        "div",
        { class: "bgm-unlock" },
        el("div", { class: "bgm-unlock-rays", "aria-hidden": "true" }),
        el("div", { class: "bgm-unlock-kicker" }, "EXTRA BGM UNLOCKED"),
        el("div", { class: "bgm-unlock-note", "aria-hidden": "true" }, icon("music", 38)),
        el("div", { class: "bgm-unlock-title" }, name),
        el("div", { class: "bgm-unlock-desc" }, desc),
        el(
          "div",
          { class: "bgm-unlock-actions" },
          el("button", { class: "btn btn-ghost", onclick: () => node.remove() }, tr("あとで", "Later")),
          el(
            "button",
            {
              class: "btn btn-primary",
              onclick: () => {
                setSetting("bgm", true);
                setSetting("bgmTrack", track.id);
                node.classList.add("selected");
                setTimeout(() => node.remove(), 500);
              },
            },
            tr("この曲にする", "Use this track")
          )
        )
      );
      layer().append(node);
      setTimeout(() => {
        if (!node.isConnected) return;
        node.classList.add("closing");
        setTimeout(() => node.remove(), 500);
      }, 7200);
    }, delayMs + index * 7800);
  });
}
