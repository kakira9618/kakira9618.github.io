// 実績閲覧モード。通常実績 + 隠し実績（解放済みのものだけを並べる）。
// 隠し実績は用意されている個数も伏せるため、一覧にも進捗にも未解放分は出さない。
// ルート: #/achievements

import { el, clear, fmtDateTime } from "./dom.js?v=20260725-b";
import { registerScreen, navigate } from "./app.js?v=20260725-b";
import {
  ACHIEVEMENT_CATEGORIES,
  HIDDEN_ACHIEVEMENTS,
  NORMAL_ACHIEVEMENTS,
  achievementProgress,
  formatAchievementProgress,
  getUnlocked,
} from "../core/achievements.js?v=20260725-b";
import { playSfx } from "../audio/sound.js?v=20260725-b";
import { soundToggleButton } from "./sound-toggle.js?v=20260725-b";
import { icon } from "./icons.js?v=20260725-b";
import { localizedAchievement, tr } from "../core/i18n.js?v=20260725-b";

let root = null;

function build() {
  root = document.getElementById("screen-achievements");
}

// 隠し実績は解放済みのものしか渡ってこないので、内容非公開のカードは通常実績には無い
function achCard(ach, unlockedAt) {
  const localized = localizedAchievement(ach);
  return el(
    "div",
    {
      // glow（系列の最上位）は解除後だけ光らせる。未解除で光ると隠し実績のヒントになる
      class: `card ach-card ${unlockedAt ? "unlocked" : "locked"} ${ach.glow && unlockedAt ? "ach-top" : ""}`,
    },
    el("div", { class: "badge-icon", style: { color: ach.color } }, icon(ach.icon, 22)),
    el(
      "div",
      {},
      el("div", { class: "name" }, localized.name),
      el("div", { class: "desc" }, localized.desc),
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
  const progress = achievementProgress(unlocked);
  const normal = NORMAL_ACHIEVEMENTS;
  // 隠し実績は解放済みだけを、解放が早かった順に並べる（未解放の存在は数も含めて伏せる）
  const revealedHidden = HIDDEN_ACHIEVEMENTS
    .filter((a) => unlocked[a.id] !== undefined)
    .sort((a, b) => unlocked[a.id] - unlocked[b.id]);
  const normalPercent = Math.round((100 * progress.normalUnlocked) / progress.normalTotal);

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
    el("span", { class: "sub" }, formatAchievementProgress(progress)),
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
  // バーは通常実績の進捗。隠し実績は総数を伏せるので割合に混ぜない
  body.append(
    el("div", { class: "bar-wrap" },
      el("div", { class: "bar-track" },
        el("div", { class: "bar-fill", style: { width: `${(100 * progress.normalUnlocked) / progress.normalTotal}%` } })
      ),
      el("span", { class: "bar-value" }, `${normalPercent}%`)
    ),
    el(
      "p",
      { class: "card hint achievement-count-note" },
      tr(
        "右上の数は「通常実績 / 通常実績の総数 + 解放した隠し実績」です。隠し実績がいくつ用意されているかは秘密で、一覧にも解放したものだけが並びます。\nカウント系実績・隠し実績と、1 手/2 手クリアなど答えを知っていると狙える実績は、同じ日に同じ問題 No. を複数回プレイした場合、モードを問わず最初の 1 回だけを対象にします。同日の別問題と、別日の同じ問題はそれぞれ対象になります。\n連勝の実績は、同じモード（DWORDle / DWORDlie）内での連勝を数えます。",
        "The count at the top right is “normal achievements / total normal achievements + secret achievements unlocked”. How many secret achievements exist is a secret, and only the ones you have unlocked appear in the list.\nCount-based achievements, secret achievements, and achievements you could aim for once you know the answer (such as clearing in 1 or 2 Guesses) only consider the first play of the same puzzle number on the same day, regardless of mode. A different puzzle on that day or the same puzzle on another day counts separately.\nWin-streak achievements count consecutive wins within the same mode (DWORDle / DWORDlie)."
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
  // 隠し実績: 用意されている個数は伏せ、解放したものだけを並べる
  body.append(
    el("div", { class: "progress-note", style: { marginTop: "8px" } },
      tr(`隠し実績  ${progress.hiddenUnlocked}`, `Secret achievements  ${progress.hiddenUnlocked}`)),
    revealedHidden.length > 0
      ? el("div", { class: "ach-grid" }, revealedHidden.map((a) => achCard(a, unlocked[a.id])))
      : el(
          "p",
          { class: "card hint ach-hidden-empty" },
          tr("まだ解放した隠し実績はありません。", "No secret achievements unlocked yet.")
        )
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
