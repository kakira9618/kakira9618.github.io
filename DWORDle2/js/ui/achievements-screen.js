// 実績閲覧モード。通常実績 + 隠し実績（未解放は内容非公開）。
// ルート: #/achievements

import { el, clear, fmtDateTime } from "./dom.js";
import { registerScreen, navigate } from "./app.js?v=20260723-card-badges";
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, getUnlocked } from "../core/achievements.js?v=20260723-card-badges";
import { playSfx } from "../audio/sound.js?v=20260723-card-badges";
import { soundToggleButton } from "./sound-toggle.js?v=20260723-card-badges";
import { icon } from "./icons.js";
import { localizedAchievement, tr } from "../core/i18n.js?v=20260723-card-badges";

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
            tr(`解除: ${fmtDateTime(unlockedAt)}`, `Unlocked: ${fmtDateTime(unlockedAt)}`)
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
    el("h1", { class: "title" }, tr("実績", "Achievements")),
    el("span", { class: "spacer" }),
    el("span", { class: "sub" }, `${count} / ${ACHIEVEMENTS.length}`),
    soundToggleButton()
  );

  // カードがすべて非フォーカス要素のため、スクロール領域自体をキーボードで
  // フォーカス・スクロールできるようにする（axe: scrollable-region-focusable）
  const body = el("div", {
    class: "list-screen-body",
    tabindex: "0",
    role: "region",
    "aria-label": tr("実績一覧", "Achievements list"),
  });
  body.append(
    el("div", { class: "bar-wrap" },
      el("div", { class: "bar-track" },
        el("div", { class: "bar-fill", style: { width: `${(100 * count) / ACHIEVEMENTS.length}%` } })
      ),
      el("span", { class: "bar-value" }, `${Math.round((100 * count) / ACHIEVEMENTS.length)}%`)
    ),
    el(
      "p",
      { class: "card hint achievement-count-note" },
      tr(
        "カウント系実績と隠し実績は、同じ日に同じ問題 No. を複数回プレイした場合、モードを問わず最初の 1 回だけを対象にします。同日の別問題と、別日の同じ問題はそれぞれ対象になります。",
        "Count-based and secret achievements only consider the first play of the same puzzle number on the same day, regardless of mode. A different puzzle on that day or the same puzzle on another day counts separately."
      )
    )
  );
  // 通常実績はカテゴリごとに見出し + 解放数を付けて並べる
  for (const category of ACHIEVEMENT_CATEGORIES) {
    const items = normal.filter((a) => a.cat === category.id);
    if (items.length === 0) continue;
    body.append(
      el("div", { class: "progress-note", style: { marginTop: "8px" } },
        `${tr(category.ja, category.en)}  ${items.filter((a) => unlocked[a.id]).length} / ${items.length}`),
      el("div", { class: "ach-grid" }, items.map((a) => achCard(a, unlocked[a.id])))
    );
  }
  body.append(
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
