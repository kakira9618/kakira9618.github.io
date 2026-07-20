// 設定画面。テーマ・サウンド・履歴の移行 / エクスポート / 削除。
// ルート: #/settings

import { el, clear } from "./dom.js";
import { registerScreen, navigate } from "./app.js";
import { getSettings, setSetting } from "../core/settings.js";
import { importFromLocalStorage, importFromText, scanLegacyHistory } from "../core/migrate.js";
import { exportJSON, _reload } from "../core/records.js";
import { removeKey } from "../core/store.js";
import { checkOnEvent, getUnlocked, reconcileAchievementsFromHistory } from "../core/achievements.js";
import { BGM_TRACKS, bgmTracksUnlockedBy, playSfx } from "../audio/sound.js";
import { toast, achievementToast, bgmUnlockCelebration } from "./toast.js";
import { showModal, confirmModal } from "./modal.js";
import { icon } from "./icons.js";
import { APP_VERSION } from "../config.js";
import { currentLanguage, isEnglish, syncDocumentLanguage, tr } from "../core/i18n.js";

let root = null;

function build() {
  root = document.getElementById("screen-settings");
}

function settingRow(l1, l2, control) {
  return el("div", { class: "setting-row" }, el("div", { class: "label" }, el("div", { class: "l1" }, l1), el("div", { class: "l2" }, l2)), control);
}

function toggle(key) {
  const sw = el("button", {
    class: `switch ${getSettings()[key] ? "on" : ""}`,
    onclick: () => {
      playSfx("ui");
      const now = !getSettings()[key];
      setSetting(key, now);
      sw.classList.toggle("on", now);
    },
  });
  return sw;
}

function volumeSlider(key, label) {
  const value = getSettings()[key];
  const valueEl = el("span", { class: "volume-value", "aria-hidden": "true" }, `${value}%`);
  const input = el("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "1",
    value,
    "aria-label": label,
    "aria-valuetext": `${value}%`,
    oninput: (event) => {
      const next = Number(event.target.value);
      setSetting(key, next);
      event.target.setAttribute("aria-valuetext", `${next}%`);
      valueEl.textContent = `${next}%`;
    },
    onchange: () => {
      if (key === "sfxVolume") playSfx("ui");
    },
  });
  return el("div", { class: "volume-control" }, input, valueEl);
}

function afterImport(added) {
  _reload();
  const newly = [...reconcileAchievementsFromHistory(), ...checkOnEvent("migrate")];
  if (added > 0) {
    toast(tr(`${added} 件のプレイ履歴を移行しました`, `Imported ${added} play ${added === 1 ? "record" : "records"}`));
  } else if (newly.length > 0) {
    toast(
      tr(
        `既存の履歴から ${newly.length} 件の実績を復元しました`,
        `Restored ${newly.length} ${newly.length === 1 ? "achievement" : "achievements"} from existing history`
      )
    );
  } else {
    toast(tr("新しく移行できる履歴は見つかりませんでした", "No new play records were found"));
  }
  if (newly.length) {
    achievementToast(newly);
    const bgmUnlocks = bgmTracksUnlockedBy(newly);
    if (bgmUnlocks.length) bgmUnlockCelebration(bgmUnlocks, newly.length * 700 + 3400);
  }
  render();
}

function showImportModal() {
  const ta = el("textarea", {
    placeholder: tr(
      '旧作の履歴 JSON（{"version": ..., "16xxx": {...}} の形式）を貼り付け',
      'Paste history JSON from the original games ({"version": ..., "16xxx": {...}})'
    ),
  });
  const fileInput = el("input", { type: "file", accept: ".json,application/json" });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    f.text().then((text) => {
      ta.value = text;
    });
  });
  showModal({
    title: tr("旧作から履歴を移行", "Import history from original games"),
    body: [
      el("p", { class: "hint" },
        tr("旧 DWORDle / DWORDlie の履歴を取り込みます。", "Import your history from the original DWORDle / DWORDlie."), el("br"),
        tr("① 同じブラウザでプレイしていた場合 →「自動検出」", "1. Played in this browser → use Auto-detect"), el("br"),
        tr("② 履歴 JSON がある場合 → 貼り付けかファイル選択", "2. Have a history JSON file → paste it or choose the file")),
      el("button", {
        class: "btn btn-primary",
        style: { width: "100%" },
        onclick: () => {
          const found = scanLegacyHistory();
          if (found.length === 0) {
            toast(tr("このブラウザに旧作の履歴が見つかりませんでした", "No history from the original games was found in this browser"));
            return;
          }
          afterImport(importFromLocalStorage());
        },
      }, icon("search"), tr("自動検出（このブラウザから）", "Auto-detect in this browser")),
      ta,
      fileInput,
    ],
    actions: [
      { label: tr("閉じる", "Close"), onClick: () => {} },
      {
        label: tr("取り込む", "Import"),
        primary: true,
        onClick: () => {
          if (!ta.value.trim()) {
            toast(tr("JSON を貼り付けてください", "Paste the JSON first"));
            return false;
          }
          try {
            const { added } = importFromText(ta.value);
            afterImport(added);
          } catch (e) {
            const englishMessage = e.message === "JSON として読み取れませんでした"
              ? "Could not parse this as JSON"
              : e.message === "DWORDle / DWORDlie の履歴形式ではないようです"
                ? "This does not appear to be DWORDle / DWORDlie history data"
                : "Could not import this history data";
            toast(tr(e.message, englishMessage));
            return false;
          }
        },
      },
    ],
  });
}

function render() {
  if (!root) build();
  clear(root);

  const header = el(
    "div",
    { class: "header" },
    el("button", { class: "icon-btn", onclick: () => { playSfx("ui"); navigate("/"); } }, icon("arrowLeft")),
    el("div", { class: "title" }, tr("設定", "Settings"))
  );

  const s = getSettings();
  const unlocked = getUnlocked();
  const languageSeg = el(
    "div",
    { class: "seg", style: { width: "190px" }, role: "radiogroup", "aria-label": tr("言語", "Language") },
    [
      ["ja", "日本語"],
      ["en", "English"],
    ].map(([key, label]) =>
      el(
        "button",
        {
          class: currentLanguage() === key ? "active" : "",
          role: "radio",
          "aria-checked": String(currentLanguage() === key),
          onclick: () => {
            playSfx("ui");
            setSetting("language", key);
            syncDocumentLanguage(key);
            render();
          },
        },
        label
      )
    )
  );
  const themeSeg = el(
    "div",
    { class: "seg", style: { width: "190px" } },
    [
      ["cyber", tr("サイバー", "Cyber")],
      ["classic", tr("クラシック", "Classic")],
    ].map(([key, label]) =>
      el(
        "button",
        {
          class: s.theme === key ? "active" : "",
          onclick: () => {
            playSfx("ui");
            setSetting("theme", key);
            document.body.classList.toggle("theme-cyber", key === "cyber");
            document.body.classList.toggle("theme-classic", key === "classic");
            render();
          },
        },
        label
      )
    )
  );

  const body = el(
    "div",
    { class: "list-screen-body" },
    el(
      "div",
      { class: "card" },
      el("div", { style: { fontWeight: "800", marginBottom: "4px" } }, tr("表示", "Display")),
      settingRow(tr("言語", "Language"), tr("UIと「遊び方」の言語", "Language used by the UI and Guide"), languageSeg),
      settingRow(tr("テーマ", "Theme"), tr("サイバー: ネオン + 3D エフェクト / クラシック: 原作風", "Cyber: neon + 3D effects / Classic: original-style"), themeSeg),
      settingRow(
        tr("キーボードヒント", "Keyboard hints"),
        tr("DWORDleで、使用した文字を判定色で表示します", "Color used letters by their feedback in DWORDle"),
        toggle("keyboardHints")
      ),
      settingRow(
        tr("演出を軽くする", "Reduce effects"),
        tr("パーティクルを完全にオフにします（低スペック端末向け）", "Disable particles completely for lower-powered devices"),
        toggle("reduceFx")
      )
    ),
    el(
      "div",
      { class: "card" },
      el("div", { style: { fontWeight: "800", marginBottom: "4px" } }, tr("サウンド", "Sound")),
      settingRow(tr("効果音", "Sound effects"), tr("キー入力・判定・勝利ファンファーレなど", "Keys, feedback, win fanfare, and more"), toggle("sfx")),
      settingRow(
        tr("効果音の音量", "Sound effects volume"),
        tr("効果音だけの音量を調整します", "Adjust sound effects independently"),
        volumeSlider("sfxVolume", tr("効果音の音量", "Sound effects volume"))
      ),
      settingRow(
        tr("BGM", "BGM"),
        tr(
          "DWORDle / DWORDlie で再生する BGM を指定します",
          "Choose the BGM played in DWORDle / DWORDlie"
        ),
        toggle("bgm")
      ),
      settingRow(
        tr("BGMの音量", "BGM volume"),
        tr("BGMだけの音量を調整します", "Adjust BGM independently"),
        volumeSlider("bgmVolume", tr("BGMの音量", "BGM volume"))
      ),
      el(
        "div",
        { class: "bgm-picker", role: "radiogroup", "aria-label": tr("BGMを選択", "Choose BGM") },
        BGM_TRACKS.map((track) => {
          const isLocked = track.unlockAchievement && !unlocked[track.unlockAchievement];
          const isActive = s.bgmTrack === track.id;
          const name = isEnglish() ? (track.nameEn ?? track.name) : track.name;
          const desc = isEnglish() ? (track.descEn ?? track.desc) : track.desc;
          const unlockLabel = isEnglish() ? (track.unlockLabelEn ?? track.unlockLabel) : track.unlockLabel;
          return el(
            "button",
            {
              class: `bgm-choice ${isActive ? "active" : ""} ${isLocked ? "locked" : ""}`,
              role: "radio",
              "aria-checked": String(isActive),
              "aria-disabled": String(Boolean(isLocked)),
              onclick: () => {
                if (isLocked) {
                  playSfx("invalid");
                  toast(tr(`実績「${unlockLabel}」で解放されます`, `Unlocks with the “${unlockLabel}” achievement`));
                  return;
                }
                playSfx("ui");
                setSetting("bgmTrack", track.id);
                render();
              },
            },
            el("span", { class: "bgm-mark" }, isLocked ? icon("lock", 17) : isActive ? icon("music", 18) : "○"),
            el(
              "span",
              { class: "bgm-copy" },
              el("b", {}, name),
              el("small", {}, isLocked ? tr(`実績「${unlockLabel}」で解放`, `Unlock with “${unlockLabel}”`) : desc)
            )
          );
        })
      )
    ),
    el(
      "div",
      { class: "card" },
      el("div", { style: { fontWeight: "800", marginBottom: "4px" } }, tr("データ", "Data")),
      el("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" } },
        el("button", { class: "btn", onclick: showImportModal }, icon("box"), tr("旧作から履歴を移行", "Import history from original games")),
        el("button", {
          class: "btn",
          onclick: () => {
            const blob = new Blob([exportJSON()], { type: "application/json" });
            const a = el("a", { href: URL.createObjectURL(blob), download: `dwordle2_history_${Date.now()}.json` });
            a.click();
            toast(tr("履歴をダウンロードしました", "History downloaded"));
          },
        }, icon("download"), tr("履歴をエクスポート", "Export history")),
        el("button", {
          class: "btn",
          style: { borderColor: "var(--danger)", color: "#ff8888" },
          onclick: async () => {
            const ok = await confirmModal(
              tr("全データ削除", "Delete all data"),
              tr(
                "プレイ履歴・実績・設定をすべて削除します。\nこの操作は取り消せません。本当に削除しますか？",
                "This deletes all play history, achievements, and settings.\nThis cannot be undone. Continue?"
              )
            );
            if (!ok) return;
            for (const key of [
              "history",
              "achievements",
              "achievements.reconcileVersion",
              "settings",
              "current.normal",
              "current.uso",
              "mode",
              "lastPlayedMode",
            ]) {
              removeKey(key);
            }
            location.reload();
          },
        }, icon("trash"), tr("全データ削除", "Delete all data"))
      )
    ),
    el(
      "p",
      { class: "version-note", style: { textAlign: "center" } },
      tr(
        `DWORDle 2 v${APP_VERSION} ・ original by @kakira9618`,
        `DWORDle 2 v${APP_VERSION} — original by @kakira9618`
      )
    )
  );

  root.append(header, body);
}

registerScreen("settings", {
  get element() {
    if (!root) build();
    return root;
  },
  render,
});
