// 設定画面。テーマ・サウンド・履歴の移行 / エクスポート / 削除。
// ルート: #/settings

import { el, clear } from "./dom.js";
import { registerScreen, navigate } from "./app.js?v=20260722-pop-lines";
import { getSettings, setSetting, HIDDEN_THEMES } from "../core/settings.js";
import { importFromLocalStorage, importFromText, scanLegacyHistory } from "../core/migrate.js";
import { exportJSON } from "../core/records.js";
import { removeKey } from "../core/store.js";
import { getUnlocked } from "../core/achievements.js?v=20260722-pop-lines";
import { BGM_TRACKS, playSfx } from "../audio/sound.js";
import { toast } from "./toast.js?v=20260722-pop-lines";
import { showModal, confirmModal } from "./modal.js";
import { icon } from "./icons.js";
import { finishHistoryImport } from "./history-import.js?v=20260722-pop-lines";
import { APP_VERSION } from "../config.js";
import { currentLanguage, isEnglish, syncDocumentLanguage, tr } from "../core/i18n.js";
import { isDebugMode, tryEnableDebugMode } from "../core/debug.js";

let root = null;
let debugEntryTaps = 0;
let debugEntryResetTimer = null;

function build() {
  root = document.getElementById("screen-settings");
}

function settingRow(l1, l2, control) {
  return el("div", { class: "setting-row" }, el("div", { class: "label" }, el("div", { class: "l1" }, l1), el("div", { class: "l2" }, l2)), control);
}

function toggle(key, label) {
  const sw = el("button", {
    class: `switch ${getSettings()[key] ? "on" : ""}`,
    role: "switch",
    "aria-label": label,
    "aria-checked": String(Boolean(getSettings()[key])),
    onclick: () => {
      playSfx("ui");
      const now = !getSettings()[key];
      setSetting(key, now);
      sw.classList.toggle("on", now);
      sw.setAttribute("aria-checked", String(now));
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

function updateBgmSelection(selectedTrack) {
  for (const choice of root.querySelectorAll(".bgm-choice")) {
    if (choice.classList.contains("locked")) continue;
    const isActive = choice.dataset.track === selectedTrack;
    choice.classList.toggle("active", isActive);
    choice.setAttribute("aria-checked", String(isActive));
    choice.querySelector(".bgm-mark")?.replaceChildren(isActive ? icon("music", 18) : "○");
  }
}

function restoreScrollPosition(scroller, scrollTop) {
  if (!scroller) return;
  const restore = () => {
    scroller.scrollTop = scrollTop;
  };
  restore();
  // iOS Safari はクリック完了後にフォーカス位置へ遅れてスクロールするため、
  // 次とその次の描画タイミングでも元の位置を復元する。
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}

function showDebugKeywordModal() {
  if (isDebugMode()) {
    toast("DEBUG ON");
    return;
  }
  const input = el("input", {
    type: "password",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: tr("キーワード", "Keyword"),
    "aria-label": tr("秘密のキーワード", "Secret keyword"),
  });
  let closeModal = () => {};
  const activate = () => {
    if (!tryEnableDebugMode(input.value)) {
      playSfx("invalid");
      toast(tr("キーワードが違います", "Incorrect keyword"));
      input.select();
      return false;
    }
    render();
    toast(tr("DEBUG ON：実績と隠し要素を一時的に全開放しました", "DEBUG ON: achievements and hidden content are temporarily unlocked"));
    return true;
  };
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (activate()) closeModal();
  });
  closeModal = showModal({
    title: tr("シークレット", "Secret"),
    body: [input],
    actions: [
      { label: tr("キャンセル", "Cancel"), onClick: () => {} },
      { label: tr("入力", "Enter"), primary: true, onClick: activate },
    ],
  });
}

function handleDebugEntryTap() {
  debugEntryTaps++;
  clearTimeout(debugEntryResetTimer);
  if (debugEntryTaps >= 5) {
    debugEntryTaps = 0;
    showDebugKeywordModal();
    return;
  }
  debugEntryResetTimer = setTimeout(() => {
    debugEntryTaps = 0;
  }, 2000);
}

function showImportModal() {
  const ta = el("textarea", {
    placeholder: tr(
      '旧作の履歴 JSON（{"version": ..., "16xxx": {...}} の形式）を貼り付け',
      'Paste history JSON from the original games ({"version": ..., "16xxx": {...}})'
    ),
  });
  let closeModal = () => {};
  const complete = (added) => {
    closeModal();
    finishHistoryImport(added);
    render();
  };
  const manualImport = () => {
    playSfx("ui");
    if (!ta.value.trim()) {
      toast(tr("JSON を貼り付けてください", "Paste the JSON first"));
      return;
    }
    try {
      const { added } = importFromText(ta.value);
      complete(added);
    } catch (e) {
      const englishMessage = e.message === "JSON として読み取れませんでした"
        ? "Could not parse this as JSON"
        : e.message === "DWORDle / DWORDlie の履歴形式ではないようです"
          ? "This does not appear to be DWORDle / DWORDlie history data"
          : "Could not import this history data";
      toast(tr(e.message, englishMessage));
    }
  };
  closeModal = showModal({
    title: tr("旧作から履歴を移行", "Import history from original games"),
    body: [
      el(
        "p",
        { class: "hint" },
        tr(
          "旧 DWORDle / DWORDlie のプレイ履歴を、現在の DWORDle 2 の履歴にマージします。既存の履歴は上書きされません。",
          "Merge play history from the original DWORDle / DWORDlie into your current DWORDle 2 history. Existing records are never overwritten."
        ),
        el("br"),
        tr(
          "履歴の条件を満たす実績も自動で解放されます。",
          "Achievements supported by the imported history are unlocked automatically."
        )
      ),
      el(
        "p",
        { class: "hint" },
        tr(
          "自動検出は、このブラウザに保存された旧 DWORDle と DWORDlie の両方に対応しています。",
          "Auto-detect supports both the original DWORDle and DWORDlie histories saved in this browser."
        )
      ),
      el("button", {
        class: "btn btn-primary",
        style: { width: "100%" },
        onclick: () => {
          const found = scanLegacyHistory();
          if (found.length === 0) {
            toast(tr("このブラウザに旧作の履歴が見つかりませんでした", "No history from the original games was found in this browser"));
            return;
          }
          complete(importFromLocalStorage());
        },
      }, icon("search"), tr("DWORDle / DWORDlie を自動検出", "Auto-detect DWORDle / DWORDlie")),
      el(
        "details",
        { class: "import-json-details" },
        el("summary", {}, tr("JSONから手動で取り込む", "Import manually from JSON")),
        el(
          "div",
          { class: "import-json-body" },
          el(
            "p",
            { class: "hint" },
            tr(
              "自動検出を使えない場合は、旧作または DWORDle 2 の履歴 JSON を貼り付けてください。",
              "If auto-detect is unavailable, paste history JSON from an original game or DWORDle 2."
            )
          ),
          ta,
          el("button", { class: "btn", style: { width: "100%" }, onclick: manualImport }, tr("JSONを取り込む", "Import JSON"))
        )
      ),
    ],
    actions: [{ label: tr("閉じる", "Close"), primary: true, onClick: () => {} }],
  });
}

function render() {
  if (!root) build();
  clear(root);

  const header = el(
    "div",
    { class: "header" },
    el(
      "button",
      { class: "icon-btn", "aria-label": tr("タイトルへ戻る", "Back to title"), onclick: () => { playSfx("ui"); navigate("/"); } },
      icon("arrowLeft")
    ),
    el("div", { class: "title" }, tr("設定", "Settings")),
    el("span", { class: "spacer" }),
    isDebugMode() ? el("span", { class: "debug-status" }, "DEBUG ON") : null
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
  const hiddenTheme = HIDDEN_THEMES[0];
  const hiddenThemeUnlocked = Boolean(unlocked[hiddenTheme.unlockAchievement]);
  const hiddenThemeUnlockLabel = isEnglish() ? (hiddenTheme.unlockLabelEn ?? hiddenTheme.unlockLabel) : hiddenTheme.unlockLabel;
  const themeSeg = el(
    "div",
    { class: "seg", style: { width: "230px" }, role: "radiogroup", "aria-label": tr("テーマ", "Theme") },
    [
      ["cyber", tr("サイバー", "Cyber"), true],
      ["classic", tr("クラシック", "Classic"), true],
      [hiddenTheme.id, hiddenThemeUnlocked ? hiddenTheme.name : "???", hiddenThemeUnlocked],
    ].map(([key, label, available]) =>
      el(
        "button",
        {
          class: s.theme === key ? "active" : "",
          role: "radio",
          "aria-checked": String(s.theme === key),
          "aria-disabled": String(!available),
          onclick: () => {
            if (!available) {
              playSfx("invalid");
              toast(tr(`実績「${hiddenThemeUnlockLabel}」で解放されます`, `Unlocks with the “${hiddenThemeUnlockLabel}” achievement`));
              return;
            }
            playSfx("ui");
            setSetting("theme", key);
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
      settingRow(tr("言語", "Language"), tr("UIの言語を設定", "Set the UI language"), languageSeg),
      settingRow(
        tr("テーマ", "Theme"),
        tr("UIや背景のテーマを設定", "Set the UI and background theme"),
        themeSeg
      ),
      settingRow(
        tr("キーボードヒント", "Keyboard hints"),
        tr("DWORDleで、使用した文字を判定色で表示します", "Color used letters by their feedback in DWORDle"),
        toggle("keyboardHints", tr("キーボードヒント", "Keyboard hints"))
      ),
      settingRow(
        tr("演出を軽くする", "Reduce effects"),
        tr("パーティクルを完全にオフにします", "Disable particles completely"),
        toggle("reduceFx", tr("演出を軽くする", "Reduce effects"))
      )
    ),
    el(
      "div",
      { class: "card" },
      el("div", { style: { fontWeight: "800", marginBottom: "4px" } }, tr("サウンド", "Sound")),
      settingRow(
        tr("効果音", "Sound effects"),
        tr("キー入力・判定・勝利ファンファーレなど", "Keys, feedback, win fanfare, and more"),
        toggle("sfx", tr("効果音", "Sound effects"))
      ),
      settingRow(
        tr("効果音の音量", "Sound effects volume"),
        tr("効果音だけの音量を調整します", "Adjust sound effects independently"),
        volumeSlider("sfxVolume", tr("効果音の音量", "Sound effects volume"))
      ),
      settingRow(
        tr("BGM", "BGM"),
        tr(
          "プレイ中のBGM再生のON / OFFを切り替えます",
          "Turn BGM playback during games on or off"
        ),
        toggle("bgm", "BGM")
      ),
      settingRow(
        tr("BGMの音量", "BGM volume"),
        tr("BGMだけの音量を調整します", "Adjust BGM independently"),
        volumeSlider("bgmVolume", tr("BGMの音量", "BGM volume"))
      ),
      settingRow(
        el("span", { id: "bgm-picker-label" }, tr("BGM選択", "BGM selection")),
        tr("プレイ中に再生する曲を選びます", "Choose the track played during games"),
        null
      ),
      el(
        "div",
        { class: "bgm-picker", role: "radiogroup", "aria-labelledby": "bgm-picker-label", tabindex: "0" },
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
              dataset: { track: track.id },
              role: "radio",
              "aria-checked": String(isActive),
              "aria-disabled": String(Boolean(isLocked)),
              onclick: (event) => {
                if (isLocked) {
                  playSfx("invalid");
                  toast(tr(`実績「${unlockLabel}」で解放されます`, `Unlocks with the “${unlockLabel}” achievement`));
                  return;
                }
                const scroller = event.currentTarget.closest(".list-screen-body");
                const scrollTop = scroller?.scrollTop ?? 0;
                playSfx("ui");
                setSetting("bgmTrack", track.id);
                updateBgmSelection(track.id);
                event.currentTarget.blur();
                restoreScrollPosition(scroller, scrollTop);
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
                "DWORDle 2 のプレイ履歴・実績・設定をすべて削除します。\n旧作 DWORDle / DWORDlie のデータは削除されません。\nこの操作は取り消せません。本当に削除しますか？",
                "This deletes all DWORDle 2 play history, achievements, and settings.\nData from the original DWORDle / DWORDlie will not be deleted.\nThis cannot be undone. Continue?"
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
              "legacyImportPrompted",
              "tutorialSeen",
              "tutorialSeenUso",
            ]) {
              removeKey(key);
            }
            history.replaceState(null, "", "#/");
            location.reload();
          },
        }, icon("trash"), tr("全データ削除", "Delete all data"))
      )
    ),
    el(
      "p",
      { class: "version-note", style: { textAlign: "center" } },
      el(
        "button",
        {
          class: "debug-entry",
          type: "button",
          title: "DWORDle 2 version",
          "aria-label": tr(`DWORDle 2 バージョン ${APP_VERSION}`, `DWORDle 2 version ${APP_VERSION}`),
          onclick: handleDebugEntryTap,
        },
        `DWORDle 2 v${APP_VERSION}`
      ),
      tr(" ・ by ", " — by "),
      el(
        "a",
        {
          href: "https://x.com/kakira9618",
          target: "_blank",
          rel: "noopener noreferrer",
          "aria-label": "@kakira9618 on X",
        },
        "@kakira9618"
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
