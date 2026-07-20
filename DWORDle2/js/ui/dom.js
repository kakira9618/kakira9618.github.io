// 小さな DOM ヘルパ。

// el("div", {class: "card", onclick: fn}, child1, "text", ...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else if (k === "class") {
      node.className = v;
    } else if (k === "dataset") {
      Object.assign(node.dataset, v);
    } else if (k === "style" && typeof v === "object") {
      Object.assign(node.style, v);
    } else {
      node.setAttribute(k, v === true ? "" : v);
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function clear(node) {
  node.textContent = "";
  return node;
}

export function fmtDateTime(unixSec) {
  const d = new Date(unixSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
