// トースト表示（通常メッセージ + 実績解放）。

import { el } from "./dom.js";
import { UI } from "../config.js";
import { playSfx } from "../audio/sound.js";
import { icon } from "./icons.js";
import { setSetting } from "../core/settings.js";
import { isEnglish, localizedAchievement, tr } from "../core/i18n.js";

const layer = () => document.getElementById("toast-layer");
const unlockLayer = () => document.getElementById("unlock-layer");
const unlockDialogQueue = [];
let unlockDialogActive = false;
let unlockDialogSerial = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// 今後 BGM 以外の大型解放演出も同じ仕組みで直列表示できる共通キュー。
export function enqueueUnlockDialog(showDialog) {
  if (typeof showDialog !== "function") return;
  unlockDialogQueue.push(showDialog);
  void drainUnlockDialogQueue();
}

async function drainUnlockDialogQueue() {
  if (unlockDialogActive) return;
  unlockDialogActive = true;
  // 結果画面などの遷移を先に描画しつつ、待たされた印象にならない短い間だけ空ける。
  await wait(350);
  while (unlockDialogQueue.length > 0) {
    const showDialog = unlockDialogQueue.shift();
    try {
      await showDialog();
    } catch (error) {
      console.error("Failed to show unlock dialog", error);
    }
    if (unlockDialogQueue.length > 0) await wait(140);
  }
  unlockDialogActive = false;
}

function showBgmUnlockDialog(track) {
  return new Promise((resolve) => {
    playSfx("achievement");
    const root = unlockLayer();
    if (!root) {
      resolve();
      return;
    }

    const name = isEnglish() ? (track.nameEn ?? track.name) : track.name;
    const desc = isEnglish() ? (track.descEn ?? track.desc) : track.desc;
    const titleId = `bgm-unlock-title-${++unlockDialogSerial}`;
    const descId = `bgm-unlock-desc-${unlockDialogSerial}`;
    const previousFocus = document.activeElement;
    let closed = false;
    let autoCloseTimer = null;
    let node;

    const finishClose = () => {
      node.remove();
      root.classList.remove("is-active");
      root.removeEventListener("click", handleBackdropClick);
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve();
    };
    const close = ({ selected = false } = {}) => {
      if (closed) return;
      closed = true;
      clearTimeout(autoCloseTimer);
      if (selected) node.classList.add("selected");
      node.classList.add("closing");
      setTimeout(finishClose, selected ? 500 : 450);
    };
    const handleBackdropClick = (event) => {
      if (event.target === root) close();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [...node.querySelectorAll("button:not([disabled])")];
      if (buttons.length === 0) {
        event.preventDefault();
        node.focus();
      } else if (event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
        event.preventDefault();
        buttons[0].focus();
      }
    };

    node = el(
      "div",
      {
        class: "bgm-unlock",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "aria-describedby": descId,
        tabindex: "-1",
        onkeydown: handleKeyDown,
      },
      el("div", { class: "bgm-unlock-rays", "aria-hidden": "true" }),
      el("div", { class: "bgm-unlock-kicker" }, "EXTRA BGM UNLOCKED"),
      el("div", { class: "bgm-unlock-note", "aria-hidden": "true" }, icon("music", 38)),
      el("div", { class: "bgm-unlock-title", id: titleId }, name),
      el("div", { class: "bgm-unlock-desc", id: descId }, desc),
      el(
        "div",
        { class: "bgm-unlock-actions" },
        el("button", { class: "btn btn-ghost", onclick: () => close() }, tr("あとで", "Later")),
        el(
          "button",
          {
            class: "btn btn-primary",
            onclick: () => {
              setSetting("bgm", true);
              setSetting("bgmTrack", track.id);
              close({ selected: true });
            },
          },
          tr("この曲にする", "Use this track")
        )
      )
    );

    root.classList.add("is-active");
    root.addEventListener("click", handleBackdropClick);
    root.append(node);
    requestAnimationFrame(() => node.querySelector(".btn-primary")?.focus());
    autoCloseTimer = setTimeout(() => close(), 7200);
  });
}

// Extra BGM を解放キューへ即時登録する。表示間隔はキュー側で一元管理する。
export function bgmUnlockCelebration(tracks) {
  tracks.forEach((track) => enqueueUnlockDialog(() => showBgmUnlockDialog(track)));
}
