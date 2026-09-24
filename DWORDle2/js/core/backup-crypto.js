// リモートバックアップの暗号化（ブラウザと tools/fetch-backup.mjs の両方で使う）。
//
// - 保存キー: プレイヤー ID の SHA-256。サーバーには ID そのものを渡さない。
// - 本文: エクスポート JSON を gzip してから AES-256-GCM で暗号化する。
//   鍵はプレイヤー ID から PBKDF2 で作る。GCM は改ざんされると復号に失敗するので、
//   ID を知らない第三者が中身を書き換えた（すり替えた）バックアップは取り出し時に弾ける。
// - 追加認証データに保存キーと日付を混ぜ、別の枠へ移し替えた暗号文も弾く。
//
// ID は 8 桁 16 進なので総当たりへの強さは限られる。狙いは「リクエストを簡単には
// 書き換えられない・サーバー側で中身を読まない」まで。
// 下の定数を変えると既存のバックアップが一切読めなくなるので変えない。

export const BACKUP_FORMAT = 1;
const SLOT_SALT = "dwordle2.backup.slot.v1:";
const KEY_SALT = "dwordle2.backup.key.v1";
const KEY_ITERATIONS = 100000;

const encoder = new TextEncoder();

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("crypto.subtle is unavailable");
  return api;
}

export function backupCryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle);
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function toBase64(bytes) {
  let binary = "";
  // 一度に大量の引数を渡すとスタックあふれになるので分割する
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipeBytes(bytes, stream) {
  const body = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

const canGzip = () => typeof CompressionStream === "function";

// ID の表記ゆれ（小文字・前後の空白）は同じ ID として扱う
const normalizeId = (playerId) => String(playerId ?? "").trim().toUpperCase();

// サーバー上の保存キー（16 進 64 桁）
export async function backupSlotId(playerId) {
  const digest = await subtle().digest("SHA-256", encoder.encode(SLOT_SALT + normalizeId(playerId)));
  return toHex(new Uint8Array(digest));
}

async function deriveKey(playerId) {
  const base = await subtle().importKey("raw", encoder.encode(normalizeId(playerId)), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: encoder.encode(KEY_SALT), iterations: KEY_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

const additionalData = (id, day) => encoder.encode(`${BACKUP_FORMAT}|${id}|${day}`);

// 送信する封筒 { v, id, day, c, iv, data }。c は圧縮方式（"gzip" | "none"）。
export async function encryptBackup(playerId, day, text) {
  const id = await backupSlotId(playerId);
  const plain = encoder.encode(text);
  const c = canGzip() ? "gzip" : "none";
  const packed = c === "gzip" ? await pipeBytes(plain, new CompressionStream("gzip")) : plain;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(id, day) },
    await deriveKey(playerId),
    packed
  );
  return { v: BACKUP_FORMAT, id, day, c, iv: toBase64(iv), data: toBase64(new Uint8Array(sealed)) };
}

// 封筒を復号してエクスポート JSON の文字列に戻す。ID 違い・改ざんは例外になる。
export async function decryptBackup(playerId, envelope) {
  if (envelope?.v !== BACKUP_FORMAT) throw new Error(`unsupported backup format: ${envelope?.v}`);
  const id = await backupSlotId(playerId);
  if (envelope.id !== id) throw new Error("this backup belongs to another player ID");
  const packed = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(envelope.iv), additionalData: additionalData(id, envelope.day) },
    await deriveKey(playerId),
    fromBase64(envelope.data)
  );
  const bytes =
    envelope.c === "gzip" ? await pipeBytes(new Uint8Array(packed), new DecompressionStream("gzip")) : new Uint8Array(packed);
  return new TextDecoder().decode(bytes);
}
