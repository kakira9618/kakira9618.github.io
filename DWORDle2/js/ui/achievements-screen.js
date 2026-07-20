// 実績閲覧モード。通常実績 + 隠し実績（未解放は内容非公開）。
// ルート: #/achievements

import { el, clear, fmtDateTime } from "./dom.js";
import { registerScreen, navigate } from "./app.js?v=20260721-runtime";
import { ACHIEVEMENTS, getUnlocked } from "../core/achievements.js?v=20260721-runtime";
import { playSfx } from "../audio/sound.js";
import { icon } from "./icons.js";
import { localizedAchievement, tr } from "../core/i18n.js";

let root = null;

function build() {
  root = document.getElementById("screen-achievements");
}

function achCard(ach, unlockedAt) {
  const localized = localizedAchievement(ach);
  const isHiddenLocked = ach.hidden && !unlockedAt;
  return el(
    "div",
    { class: `card ach-card ${unlockedAt ? "unlocked" : "locked"} ${isHiddenLocked ? "hidden-locked" : ""}` },
    el("div", { class: "badge-icon", style: { color: ach.color } }, icon(isHiddenLocked ? "sparkle" : ach.icon, 22)),
    el(
      "div",
      {},
      el("div", { class: "name" }, isHiddenLocked ? "???" : localized.name),
      el("div", { class: "desc" }, isHiddenLocked ? tr("隠し実績。条件は秘密…", "Secret achievement. Conditions unknown…") : localized.desc),
      unlockedAt
        ? el(
            "div",
            { class: "desc", style: { color: "var(--tile-correct)" } },
            tr(`解放: ${fmtDateTime(unlockedAt)}`, `Unlocked: ${fmtDateTime(unlockedAt)}`)
          )
        : null
    )
  );
}

function render() {
  if (!root) build();
  clear(root);
  const unlocked = getUnlocked();
  const count = Object.keys(unlocked).length;
  const normal = ACHIEVEMENTS.filter((a) => !a.hidden);
  const hidden = ACHIEVEMENTS.filter((a) => a.hidden);

  const header = el(
    "div",
    { class: "header" },
    el(
      "button",
      { class: "icon-btn", "aria-label": tr("タイトルへ戻る", "Back to title"), onclick: () => { playSfx("ui"); navigate("/"); } },
      icon("arrowLeft")
    ),
    el("div", { class: "title" }, tr("実績", "Achievements")),
    el("span", { class: "spacer" }),
    el("span", { class: "sub" }, `${count} / ${ACHIEVEMENTS.length}`)
  );

  const body = el("div", { class: "list-screen-body" });
  body.append(
    el("div", { class: "bar-wrap" },
      el("div", { class: "bar-track" },
        el("div", { class: "bar-fill", style: { width: `${(100 * count) / ACHIEVEMENTS.length}%` } })
      ),
      el("span", { class: "bar-value" }, `${Math.round((100 * count) / ACHIEVEMENTS.length)}%`)
    ),
    el("div", { class: "ach-grid" }, normal.map((a) => achCard(a, unlocked[a.id]))),
    el("div", { class: "progress-note", style: { marginTop: "8px" } },
      tr(
        `隠し実績 ${hidden.filter((a) => unlocked[a.id]).length} / ${hidden.length}`,
        `Secret achievements ${hidden.filter((a) => unlocked[a.id]).length} / ${hidden.length}`
      )),
    el("div", { class: "ach-grid" }, hidden.map((a) => achCard(a, unlocked[a.id])))
  );
  root.append(header, body);
}

registerScreen("achievements", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
