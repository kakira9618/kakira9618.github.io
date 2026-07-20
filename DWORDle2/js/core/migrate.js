// 旧作 DWORDle / DWORDlie からのプレイ履歴移行。
//
// 旧作は Tonyu2 ランタイム上で動いており、履歴は localStorage 上の仮想 FS
// (/Tonyu/Projects/dwordle/history.json, history_2.json, ...) に保存されている。
// 両作とも同じファイルに書き込み、レコードの gameMode ("normal" / "uso") で区別される。
//
// 移行手段は 2 系統:
//   1. 自動検出: 同一オリジン (kakira9618.github.io) に旧作がある場合、
//      localStorage を走査して履歴らしき JSON を見つけて取り込む
//   2. 手動: 旧作の履歴 JSON（クリップボードダンプ）を貼り付け

import { addImportedGames } from "./records.js";

// オブジェクトが旧作の 1 ゲームレコードかどうか
function looksLikeGame(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.problemID === "number" &&
    Array.isArray(v.guessWord)
  );
}

// オブジェクトが旧作の履歴ファイル（{ version, <time>: game, ... }）かどうか
function looksLikeHistoryFile(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const games = Object.entries(obj).filter(([k]) => k !== "version").map(([, v]) => v);
  return games.length > 0 && games.every(looksLikeGame);
}

// 旧作履歴ファイル → 本作レコード配列
function convertHistoryFile(obj, importedTag) {
  const records = [];
  for (const [key, game] of Object.entries(obj)) {
    if (key === "version" || !looksLikeGame(game)) continue;
    if (!game.complete || game.guessWord.length === 0) continue; // 途中放棄は取り込まない
    records.push({
      startTime: Number(game.startTime ?? key),
      endTime: Number(game.endTime ?? game.startTime ?? key),
      gameMode: game.gameMode === "uso" ? "uso" : "normal",
      problemID: game.problemID,
      guessWord: game.guessWord.slice(),
      usoResults: Array.isArray(game.usoResults) ? game.usoResults : undefined,
      imported: importedTag,
    });
  }
  return records;
}

// localStorage 全体を走査して旧作の履歴ファイルを探す。
// Tonyu FS のキー形式に依存しないよう、値の形だけで判定する。
export function scanLegacyHistory() {
  const found = []; // { key, games: n, obj }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith("dwordle2.")) continue; // 本作自身のデータは除外
    const raw = localStorage.getItem(key);
    if (!raw || raw[0] !== "{") continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    // Tonyu FS はファイル内容を JSON 文字列のまま持つ場合とラップする場合があるため、
    // 1 段だけ中身も見る
    const candidates = [obj];
    if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) {
        if (typeof v === "string" && v[0] === "{") {
          try {
            candidates.push(JSON.parse(v));
          } catch { /* 無視 */ }
        }
      }
    }
    for (const cand of candidates) {
      if (looksLikeHistoryFile(cand)) {
        found.push({ key, obj: cand, games: Object.keys(cand).filter((k) => k !== "version").length });
        break;
      }
    }
  }
  return found;
}

// 自動検出 → 取り込み。追加された件数を返す。
export function importFromLocalStorage() {
  let added = 0;
  for (const { obj } of scanLegacyHistory()) {
    added += addImportedGames(convertHistoryFile(obj, "auto"));
  }
  return added;
}

// テキスト（旧作の履歴 JSON / 本作のエクスポート JSON）からの取り込み。
// 成功時 { added, total }、解釈できなければ Error を投げる。
export function importFromText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("JSON として読み取れませんでした");
  }
  if (obj && obj.app === "dwordle2" && Array.isArray(obj.history)) {
    // 本作のエクスポート形式
    const records = obj.history.filter(looksLikeGame).map((g) => ({ ...g, imported: g.imported ?? "json" }));
    return { added: addImportedGames(records), total: records.length };
  }
  if (looksLikeHistoryFile(obj)) {
    const records = convertHistoryFile(obj, "json");
    return { added: addImportedGames(records), total: records.length };
  }
  throw new Error("DWORDle / DWORDlie の履歴形式ではないようです");
}
