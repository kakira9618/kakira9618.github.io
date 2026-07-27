// プレイ履歴のインポート（移行）。旧作 DWORDle / DWORDlie の履歴に加え、
// 本作のエクスポート JSON（端末間の移行用）も取り込める。
//
// 旧作は Tonyu2 ランタイム上で動いており、履歴は localStorage 上の仮想 FS
// (/Tonyu/Projects/dwordle/history.json, history_2.json, ...) に保存されている。
// 両作とも同じファイルに書き込み、レコードの gameMode ("normal" / "uso") で区別される。
//
// 移行手段は 2 系統:
//   1. 自動検出: 同一オリジン (kakira9618.github.io) に旧作がある場合、
//      localStorage を走査して履歴らしき JSON を見つけて取り込む
//   2. 手動: 旧作の履歴 JSON（クリップボードダンプ）または本作のエクスポート JSON を貼り付け

import { addImportedGames } from "./records.js?v=20260725-b";
import { isValidPID } from "./problems.js?v=20260725-b";
import { CELL } from "./logic.js?v=20260725-b";
import { signatureAvailable, verifyPayload } from "./signature.js?v=20260725-b";

// オブジェクトが旧作の 1 ゲームレコードかどうか
function looksLikeGame(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.problemID === "number" &&
    Array.isArray(v.guessWord)
  );
}

// 実際に取り込んでよいレコードかどうか。壊れた PID（No.0 エイリアスや範囲外）や
// 5 文字の英単語でない Guess が混ざった行を履歴へ持ち込まない。
function isImportableGame(v) {
  return (
    looksLikeGame(v) &&
    isValidPID(v.problemID) &&
    v.guessWord.every((w) => typeof w === "string" && /^[a-z]{5}$/.test(w))
  );
}

// 本作のエクスポート形式は startTime をそのまま履歴のキーに使うため、数値であることを要求する。
// 非数値が混ざると履歴のソートと結果画面 URL (#/result/<mode>/<startTime>) が壊れる。
function hasUsableStartTime(v) {
  const startTime = Number(v?.startTime);
  return Number.isFinite(startTime) && startTime > 0;
}

// 手で編集された JSON が未知の gameMode を持ち込むと、MODES[gameMode] を引く画面
// （履歴一覧など）が例外で開けなくなる。旧作形式と同じ規則で必ず 2 値へ正規化する。
function normalizeGameMode(gameMode) {
  return gameMode === "uso" ? "uso" : "normal";
}

const CELL_STATES = new Set([CELL.UNUSED, CELL.USED, CELL.CORRECT]);

// uso の「表示された嘘の判定」。履歴のミニ盤面・結果・分析画面はこの各行を
// 5 要素の配列として反復するので、行が配列でない/長さ違い/未知の状態を含む
// レコードを持ち込むと画面が例外で開けなくなる。形が完全なものだけ通し、
// 壊れていれば undefined にして真の判定へフォールバックさせる
// （usoResults を持たない旧作インポートと同じ扱い）。
function usableUsoResults(game) {
  const rows = game.usoResults;
  if (!Array.isArray(rows) || rows.length !== game.guessWord.length) return undefined;
  const wellFormed = rows.every(
    (row) => Array.isArray(row) && row.length === 5 && row.every((state) => CELL_STATES.has(state))
  );
  return wellFormed ? rows.map((row) => row.slice()) : undefined;
}

// オブジェクトが旧作の履歴ファイル（{ version, <time>: game, ... }）かどうか
function looksLikeHistoryFile(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const games = Object.entries(obj).filter(([k]) => k !== "version").map(([, v]) => v);
  return games.length > 0 && games.every(looksLikeGame);
}

// 旧作履歴ファイル → 本作レコード配列。
// withAchievements=false なら noAchievements を付け、実績判定から恒久的に除外する
// （後からの再集計 reconcileAchievementsFromHistory でも解除されない）。
function convertHistoryFile(obj, importedTag, withAchievements = true) {
  const records = [];
  for (const [key, game] of Object.entries(obj)) {
    if (key === "version" || !isImportableGame(game)) continue;
    if (!game.complete || game.guessWord.length === 0) continue; // 途中放棄は取り込まない
    // 旧作形式でも startTime は履歴のキーになるので、本作エクスポートと同じ強さで検証する
    // （非数値キーで startTime も無いレコードは NaN → 保存後 null になり、結果画面から開けない）
    const startTime = Number(game.startTime ?? key);
    if (!hasUsableStartTime({ startTime })) continue;
    const gameMode = normalizeGameMode(game.gameMode);
    records.push({
      startTime,
      endTime: Number.isFinite(Number(game.endTime)) ? Number(game.endTime) : startTime,
      gameMode,
      problemID: game.problemID,
      guessWord: game.guessWord.slice(),
      usoResults: gameMode === "uso" ? usableUsoResults(game) : undefined,
      imported: importedTag,
      ...(withAchievements ? {} : { noAchievements: true }),
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
    // 走査中に別タブがキーを消すと key は null になり得る（仕様）
    if (key === null || key.startsWith("dwordle2.")) continue; // 本作自身のデータは除外
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
// 原作の履歴が対象なので署名の照合はしない
export function importFromLocalStorage({ withAchievements = true } = {}) {
  let added = 0;
  for (const { obj } of scanLegacyHistory()) {
    added += addImportedGames(convertHistoryFile(obj, "auto", withAchievements));
  }
  return added;
}

// エクスポート JSON の署名を照合する。返す値の意味:
//   "ok"       署名があり、書き出したときのままだった
//   "invalid"  署名はあるが合わない（あとから中身に手が入っている）
//   "missing"  署名が無い（署名を入れる前のエクスポート、または手で作った JSON）
//   "skipped"  照合しない（旧 DWORDle / DWORDlie の履歴、または crypto.subtle が無い環境）
async function checkExportSignature(obj) {
  if (!signatureAvailable()) return "skipped";
  const { signature, ...payload } = obj;
  if (typeof signature !== "string") return "missing";
  return (await verifyPayload(payload, signature)) ? "ok" : "invalid";
}

// 貼り付けたテキストからの取り込み。本作のエクスポート JSON 専用
// （旧作の履歴は署名を持たないので自動検出だけを入り口にする）。
// 成功時 { added, total, signature }、解釈できなければ Error を投げる。
// signature は checkExportSignature の戻り値（呼び出し側が警告表示に使う）。
export async function importFromText(text, { withAchievements = true } = {}) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("JSON として読み取れませんでした");
  }
  if (obj && obj.app === "dwordle2" && Array.isArray(obj.history)) {
    // 署名は取り込みの前に見る（結果は呼び出し側が伝える。取り込み自体は止めない）
    const signature = await checkExportSignature(obj);
    // 本作のエクスポート形式。レコード既存の noAchievements（過去の選択）は維持する。
    // 手で編集された JSON も想定し、履歴のキーになる startTime と gameMode、
    // 画面が配列として反復する usoResults を検証・正規化してから取り込む。
    const records = obj.history
      .filter((g) => isImportableGame(g) && hasUsableStartTime(g))
      .map((g) => {
        const gameMode = normalizeGameMode(g.gameMode);
        return {
          ...g,
          startTime: Number(g.startTime),
          endTime: Number.isFinite(Number(g.endTime)) ? Number(g.endTime) : Number(g.startTime),
          gameMode,
          usoResults: gameMode === "uso" ? usableUsoResults(g) : undefined,
          imported: g.imported ?? "json",
          ...(withAchievements ? {} : { noAchievements: true }),
        };
      });
    return { added: addImportedGames(records), total: records.length, signature };
  }
  // 貼り付けからの取り込みは本作のエクスポート JSON 専用。
  // 原作 DWORDle / DWORDlie の履歴は署名を持たないので、自動検出（同一オリジンの
  // localStorage を読む importFromLocalStorage）だけを入り口にする。
  if (looksLikeHistoryFile(obj)) {
    throw new Error("旧 DWORDle / DWORDlie の履歴は「自動検出」から取り込んでください");
  }
  throw new Error("DWORDle 2 のエクスポート JSON ではないようです");
}
