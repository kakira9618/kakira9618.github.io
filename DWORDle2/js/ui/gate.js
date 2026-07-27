// エントリーゲート（扉絵）。すべてのページロードで最初に表示され、
// 「開始」タップというユーザー操作でブラウザの音声自動再生制限を解錠してから
// 本来の画面へ入る（ハッシュはそのままなので、リロード・ディープリンクでも
// 行きたかったページへ直通する）。
// 背景・ロゴは前回選択していたモード（DWORDle / DWORDlie）のテーマで表示し、
// 「開始」でそのままそのモードへ直行する。
// ボタンは音設定にかかわらず常に「開始 / 音無しで開始」の 2 択:
// 「開始」は音無し状態からでも音を復帰させて入場 SE を鳴らし、BGM は必ず曲頭から再生する。
// 「音無しで開始」は音を止めたまま入る。
// 初回訪問でも「いきなり基本ルールモーダル」ではなく、まず扉絵で迎える体裁になる。

import { el } from "./dom.js?v=20260728-a";
import { getAppMode } from "./app.js?v=20260728-a";
import { APP_VERSION } from "../config.js?v=20260728-a";
import { SOURCE_HASH } from "../version.js?v=20260728-a";
import { playSfx, rewindBgm, unlockAudio } from "../audio/sound.js?v=20260728-a";
import { muteAllSounds, unmuteAllSounds } from "./sound-toggle.js?v=20260728-a";
import { shouldReduceMotion } from "../core/motion.js?v=20260728-a";
import { tr } from "../core/i18n.js?v=20260728-a";

// 退場フェードの長さ（CSS の #entry-gate transition と同期）
const GATE_EXIT_MS = 340;

// 扉絵を表示する。いずれかのボタンで閉じたあと onEnter() を呼ぶ。
// ready: アプリ本体の読み込み完了を表す Promise。扉絵はこれが解決するまで退場しない
//   （main.js が画面モジュールを動的 import するため、即タップされると未完了でありうる）。
//   多くの場合ボタンを読むより先に解決するので、待ち表示は実際にはほぼ出ない。
export function showEntryGate(onEnter, { ready = Promise.resolve() } = {}) {
  const isUso = getAppMode() === "uso";
  let entered = false;

  const enter = async (pressedBtn) => {
    if (entered) return;
    entered = true;
    pressedBtn?.classList.add("entry-gate-pressed"); // 待ち表示は押されたボタンに出す
    // 扉絵の間はグローバルの解錠（main.js の pointerdown）を止めているため、
    // ボタン操作のユーザー操作スタック内でここが明示的に解錠する。
    // 自動再生制限の解除はユーザー操作スタック内での同期実行が必須なので、
    // ready の await より必ず前に行う（await をまたぐとジェスチャ扱いされなくなる）。
    // 音復帰の設定変更（unmuteAllSounds）で BGM が先に走り出して小節位置が
    // 進んでいることがあるため、曲頭へ巻き戻してから再生し直す
    rewindBgm();
    unlockAudio({ restartBgm: true });
    playSfx("swoosh"); // 入場 SE（音無しで開始のときは sfx オフ済みなので鳴らない）
    gate.classList.add("waiting"); // 押した手応え（読み込み待ちならスピナーも出る）
    try {
      await ready;
    } catch {
      // 本体の読み込みに失敗したら扉絵は閉じない。閉じても空の画面になるだけなので、
      // 再読み込みを促してここで止める。
      gate.classList.remove("waiting");
      pressedBtn?.classList.remove("entry-gate-pressed");
      gate.classList.add("load-failed");
      note.textContent = tr(
        "読み込みに失敗しました。再読み込みしてください",
        "Loading failed. Please reload the page."
      );
      entered = false;
      return;
    }
    gate.classList.remove("waiting");
    gate.classList.add("leaving");
    const finish = () => {
      gate.remove();
      onEnter();
    };
    if (shouldReduceMotion()) finish();
    else setTimeout(finish, GATE_EXIT_MS);
  };

  const startBtn = el(
    "button",
    { class: "btn btn-primary entry-gate-start", onclick: () => { unmuteAllSounds(); enter(startBtn); } },
    tr("開始", "Start")
  );
  const mutedBtn = el(
    "button",
    { class: "btn btn-ghost entry-gate-muted", onclick: () => { muteAllSounds(); enter(mutedBtn); } },
    tr("音無しで開始", "Start muted")
  );

  const note = el(
    "p",
    { class: "entry-gate-note" },
    tr("このゲームは音が出ます", "This game plays sound")
  );

  const gate = el(
    "div",
    { id: "entry-gate", role: "dialog", "aria-modal": "true", "aria-label": isUso ? "DWORDlie 2" : "DWORDle 2" },
    el(
      "div",
      { class: "entry-gate-card" },
      el("div", { class: "logo", "aria-hidden": "true" }, isUso ? "DWORDlie" : "DWORDle", el("span", { class: "two" }, " 2")),
      note,
      startBtn,
      mutedBtn,
      el(
        "p",
        { class: "entry-gate-credit" },
        "DWORDle 2 by ",
        el(
          "a",
          {
            href: "https://x.com/kakira9618",
            target: "_blank",
            rel: "noopener noreferrer",
            "aria-label": "kakira9618 on X",
          },
          "kakira9618"
        )
      )
    ),
    // 扉絵の段階でもバージョンとソースハッシュを確認できるようにする
    el("div", { class: "app-version", title: "DWORDle 2 version" }, `v${APP_VERSION} (${SOURCE_HASH})`)
  );
  document.body.append(gate);
  requestAnimationFrame(() => startBtn.focus());
}
