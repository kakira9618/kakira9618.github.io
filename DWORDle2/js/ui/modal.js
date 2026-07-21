// モーダルダイアログ。

import { el, clear } from "./dom.js";
import { playSfx } from "../audio/sound.js?v=20260722-pop-locale-scale";
import { tr } from "../core/i18n.js?v=20260722-pop-locale-scale";

const layer = () => document.getElementById("modal-layer");
const openCloseFns = new Set(); // closeAllModals 用
let modalSerial = 0;

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// showModal({ title, body, actions: [{label, primary, danger, onClick}] })
// onClick が false を返さない限り閉じる。戻り値は close()。
export function showModal({ title, body, actions = [], onClose = null }) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const previousFocus = document.activeElement;
  const titleId = `modal-title-${++modalSerial}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCloseFns.delete(close);
    backdrop.remove();
    onClose?.();
    if (!layer().querySelector(".modal-backdrop") && previousFocus?.isConnected) {
      previousFocus.focus();
    }
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
    {
      class: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": title ? titleId : null,
      "aria-label": title ? null : tr("ダイアログ", "Dialog"),
      tabindex: "-1",
    },
    title ? el("h2", { id: titleId }, title) : null,
    el("div", { class: "modal-body" }, body),
    actions.length ? el("div", { class: "modal-actions" }, actionBtns) : null
  );
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    // 入力欄での Enter は primary アクションで確定する（番号入力→Enter の定番操作）
    if (event.key === "Enter" && event.target.matches?.("input")) {
      const primary = modal.querySelector(".modal-actions .btn-primary");
      if (primary) {
        event.preventDefault();
        primary.click();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  modal.addEventListener("keydown", onKeyDown);
  backdrop.append(modal);
  layer().append(backdrop);
  requestAnimationFrame(() => {
    const initialFocus =
      modal.querySelector("[autofocus]") ??
      modal.querySelector("input, select, textarea") ??
      modal.querySelector(".btn-primary") ??
      modal.querySelector(FOCUSABLE);
    (initialFocus ?? modal).focus();
  });
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
