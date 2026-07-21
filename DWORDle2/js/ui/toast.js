// トースト表示と解放演出（実績・Extra BGM・隠しテーマ）。
//
// 実績解放は小さなトーストではなく、unlock-layer 上の大型セレブレーションで表示する。
// 複数の解放は共通キュー (enqueueUnlockDialog) で直列に表示され、
// 実績 → Extra BGM / テーマの順で自然に連結する。

import { el } from "./dom.js";
import { UI } from "../config.js";
import { playSfx } from "../audio/sound.js";
import { winBurst } from "../fx/effects.js";
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

// ---- 解放カードの共通土台 ----
// build(close) がカード要素を返す。背景クリック / Escape / autoCloseMs で閉じ、
// フォーカスをトラップしつつ、閉じたら元の要素へ戻す。
function openUnlockCard({ build, autoCloseMs = 0, closingMs = 450 }) {
  return new Promise((resolve) => {
    const root = unlockLayer();
    if (!root) {
      resolve();
      return;
    }
    const previousFocus = document.activeElement;
    let closed = false;
    let autoCloseTimer = null;
    let node = null;

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
      setTimeout(finishClose, selected ? closingMs + 50 : closingMs);
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

    node = build(close);
    node.setAttribute("tabindex", "-1");
    node.addEventListener("keydown", handleKeyDown);
    root.classList.add("is-active");
    root.addEventListener("click", handleBackdropClick);
    root.append(node);
    requestAnimationFrame(() => (node.querySelector(".btn-primary") ?? node).focus());
    if (autoCloseMs > 0) autoCloseTimer = setTimeout(() => close(), autoCloseMs);
  });
}

// カード内に舞う紙吹雪。CSS アニメーション（achConfettiFall）で落下・回転する。
function confettiPieces(count, colors) {
  return el(
    "div",
    { class: "ach-confetti", "aria-hidden": "true" },
    Array.from({ length: count }, (_, i) => {
      const color = colors[i % colors.length];
      const left = 4 + Math.random() * 92;
      const delay = Math.random() * 1.6;
      const duration = 2.4 + Math.random() * 1.8;
      const drift = (Math.random() - 0.5) * 90;
      const spin = 360 + Math.random() * 540;
      const size = 5 + Math.random() * 5;
      return el("i", {
        style:
          `left:${left}%;background:${color};animation-delay:${delay}s;` +
          `animation-duration:${duration}s;--dx:${drift.toFixed(0)}px;` +
          `--spin:${spin.toFixed(0)}deg;width:${size.toFixed(1)}px;height:${(size * 0.62).toFixed(1)}px;`,
      });
    })
  );
}

const CONFETTI_COLORS = ["#ffd166", "#ff5fa2", "#66e0ff", "#7bd88f", "#c9a0ff", "#ff9a5c"];

function hexToInt(hex) {
  const parsed = Number.parseInt(String(hex ?? "").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0xffd166;
}

// ---- 実績解放セレブレーション ----

// 1〜2 個は 1 個ずつ大きく祝う。3 個以上は 1 枚にまとめて一覧表示する。
export function achievementCelebration(achievements) {
  if (!Array.isArray(achievements) || achievements.length === 0) return;
  if (achievements.length <= 2) {
    for (const achievement of achievements) {
      enqueueUnlockDialog(() => showAchievementUnlockDialog([achievement]));
    }
  } else {
    enqueueUnlockDialog(() => showAchievementUnlockDialog(achievements));
  }
}

function showAchievementUnlockDialog(achievements) {
  playSfx("achievementBig");
  winBurst([hexToInt(achievements[0].color), 0xffd166, 0xffffff]);
  const multiple = achievements.length > 1;
  const first = localizedAchievement(achievements[0]);
  const anyHidden = achievements.some((achievement) => achievement.hidden);
  const titleId = `ach-unlock-title-${++unlockDialogSerial}`;
  const descId = `ach-unlock-desc-${unlockDialogSerial}`;

  const kickerText = anyHidden && !multiple
    ? tr("隠し実績解放！", "SECRET ACHIEVEMENT UNLOCKED!")
    : tr("実績解放！", "ACHIEVEMENT UNLOCKED!");

  return openUnlockCard({
    autoCloseMs: multiple ? 8000 : 5200,
    build: (close) =>
      el(
        "div",
        {
          class: `ach-unlock ${multiple ? "multiple" : ""}`,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": titleId,
          "aria-describedby": descId,
          style: `--ach-color:${achievements[0].color ?? "#ffd166"};`,
        },
        el("div", { class: "ach-unlock-rays", "aria-hidden": "true" }),
        confettiPieces(multiple ? 22 : 16, CONFETTI_COLORS),
        el("div", { class: "ach-unlock-kicker" }, kickerText),
        multiple
          ? [
              el("div", { class: "ach-unlock-title", id: titleId }, tr(`実績を ${achievements.length} 個解放！`, `${achievements.length} achievements unlocked!`)),
              el(
                "div",
                { class: "ach-unlock-grid", id: descId },
                achievements.map((achievement, index) => {
                  const localized = localizedAchievement(achievement);
                  return el(
                    "div",
                    { class: "ach-unlock-mini", style: `animation-delay:${Math.min(index, 12) * 60}ms;` },
                    el("span", { class: "ach-unlock-mini-icon", style: `color:${achievement.color};` }, icon(achievement.icon, 20)),
                    el("span", { class: "ach-unlock-mini-name" }, localized.name)
                  );
                })
              ),
            ]
          : [
              el(
                "div",
                { class: "ach-unlock-badge", "aria-hidden": "true" },
                el("span", { class: "ach-unlock-badge-icon" }, icon(achievements[0].icon, 44))
              ),
              el("div", { class: "ach-unlock-title", id: titleId }, first.name),
              el("div", { class: "ach-unlock-desc", id: descId }, first.desc),
            ],
        el(
          "div",
          { class: "ach-unlock-actions" },
          el("button", { class: "btn btn-primary", onclick: () => close() }, "OK")
        )
      ),
  });
}

// ---- Extra BGM 解放 ----

function showBgmUnlockDialog(track) {
  playSfx("achievement");
  const name = isEnglish() ? (track.nameEn ?? track.name) : track.name;
  const desc = isEnglish() ? (track.descEn ?? track.desc) : track.desc;
  const titleId = `bgm-unlock-title-${++unlockDialogSerial}`;
  const descId = `bgm-unlock-desc-${unlockDialogSerial}`;

  return openUnlockCard({
    autoCloseMs: 7200,
    closingMs: 450,
    build: (close) =>
      el(
        "div",
        {
          class: "bgm-unlock",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": titleId,
          "aria-describedby": descId,
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
      ),
  });
}

// Extra BGM を解放キューへ即時登録する。表示間隔はキュー側で一元管理する。
export function bgmUnlockCelebration(tracks) {
  tracks.forEach((track) => enqueueUnlockDialog(() => showBgmUnlockDialog(track)));
}

// ---- 隠しテーマ解放 ----

// theme: { id, name, desc } を受け取り、その場で切り替えられる解放カードを出す。
export function themeUnlockCelebration(theme) {
  enqueueUnlockDialog(() => {
    playSfx("achievement");
    const titleId = `theme-unlock-title-${++unlockDialogSerial}`;
    const descId = `theme-unlock-desc-${unlockDialogSerial}`;
    return openUnlockCard({
      autoCloseMs: 7200,
      build: (close) =>
        el(
          "div",
          {
            class: "bgm-unlock theme-unlock",
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": titleId,
            "aria-describedby": descId,
          },
          el("div", { class: "bgm-unlock-rays", "aria-hidden": "true" }),
          el("div", { class: "bgm-unlock-kicker" }, "EXTRA THEME UNLOCKED"),
          el("div", { class: "bgm-unlock-note", "aria-hidden": "true" }, icon("palette", 38)),
          el("div", { class: "bgm-unlock-title", id: titleId }, theme.name),
          el("div", { class: "bgm-unlock-desc", id: descId }, theme.desc),
          el(
            "div",
            { class: "bgm-unlock-actions" },
            el("button", { class: "btn btn-ghost", onclick: () => close() }, tr("あとで", "Later")),
            el(
              "button",
              {
                class: "btn btn-primary",
                onclick: () => {
                  setSetting("theme", theme.id);
                  close({ selected: true });
                },
              },
              tr("このテーマにする", "Use this theme")
            )
          )
        ),
    });
  });
}
