// プレイヤー ID の表示（タップでクリップボードへコピー）。
// バックアップからの復旧を頼むときに使うので、設定画面とプレイヤーカード画面の両方に置く。

import { el } from "./dom.js?v=20260806-a";
import { icon } from "./icons.js?v=20260806-a";
import { toast } from "./toast.js?v=20260806-a";
import { playSfx } from "../audio/sound.js?v=20260806-a";
import { tr } from "../core/i18n.js?v=20260806-a";

export function playerIdCopyButton(id) {
  return el(
    "button",
    {
      type: "button",
      class: "player-id-copy",
      "aria-label": tr(`プレイヤー ID ${id} をコピー`, `Copy player ID ${id}`),
      onclick: async () => {
        playSfx("ui");
        try {
          await navigator.clipboard.writeText(id);
          toast(tr("クリップボードにコピーしました", "Copied to clipboard"));
        } catch {
          toast(tr("コピーに失敗しました", "Copy failed"));
        }
      },
    },
    tr(`プレイヤー ID: ${id}`, `Player ID: ${id}`),
    icon("copy", 13)
  );
}
