// モーダルダイアログ。

import { el, clear } from "./dom.js";
import { playSfx } from "../audio/sound.js";
import { tr } from "../core/i18n.js";

const layer = () => document.getElementById("modal-layer");
const openCloseFns = new Set(); // closeAllModals 用

// showModal({ title, body, actions: [{label, primary, danger, onClick}] })
// onClick が false を返さない限り閉じる。戻り値は close()。
export function showModal({ title, body, actions = [], onClose = null }) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const close = () => {
    openCloseFns.delete(close);
    backdrop.remove();
    onClose?.();
  };
  openCloseFns.add(close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  const actionBtns = actions.map((a) =>
    el(
      "button",
      {
        class: `btn ${a.primary ? "btn-primary" : ""}`,
        style: a.danger ? { borderColor: "var(--danger)", color: "#ff8888" } : {},
        onclick: async () => {
          playSfx("ui");
          const ret = await a.onClick?.();
          if (ret !== false) close();
        },
      },
      a.label
    )
  );
  const modal = el(
    "div",
    { class: "modal" },
    title ? el("h2", {}, title) : null,
    el("div", { class: "modal-body" }, body),
    actions.length ? el("div", { class: "modal-actions" }, actionBtns) : null
  );
  backdrop.append(modal);
  layer().append(backdrop);
  return close;
}

export function confirmModal(title, message) {
  return new Promise((resolve) => {
    showModal({
      title,
      body: el("div", { class: "hint", style: { fontSize: "14px", whiteSpace: "pre-wrap" } }, message),
      actions: [
        { label: tr("キャンセル", "Cancel"), onClick: () => resolve(false) },
        { label: "OK", primary: true, onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

export function closeAllModals() {
  for (const close of [...openCloseFns]) close();
  clear(layer());
}
