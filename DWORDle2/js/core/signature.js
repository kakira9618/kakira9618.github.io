// エクスポートした JSON が、書き出したあとで手を入れられていないかを調べるための署名。
//
// HMAC-SHA-256（Web Crypto の crypto.subtle）。鍵はソースに埋め込んであるので、
// その気になれば正しい署名を作り直せる。狙いは「メモ帳で数字を書き換えた JSON を
// そのまま取り込まない」ところまでで、なりすましを防ぐものではない。
//
// 署名の対象は「signature 以外のフィールド」を canonical 化した文字列。
// キーの順番や空白・インデントを変えても結果が変わらないようにしてある
// （整形し直しただけの JSON を「改ざん」と言わないため）。

const HMAC_KEY = "dwordle2.history.v1.6f2a9c47";

let keyPromise = null;

function subtle() {
  const api = globalThis.crypto?.subtle;
  // file:// や古い環境では crypto.subtle が無い。そのときは署名なしで通す
  if (!api) throw new Error("crypto.subtle is unavailable");
  return api;
}

async function hmacKey() {
  if (!keyPromise) {
    keyPromise = subtle().importKey(
      "raw",
      new TextEncoder().encode(HMAC_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
  return keyPromise;
}

// キーの順番に依存しない JSON 文字列化（署名の対象を一意に決めるため）
export function canonicalJSON(value) {
  if (value === undefined || value === null || typeof value === "function") return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => typeof value[key] !== "undefined" && typeof value[key] !== "function")
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// 署名が使える環境か（file:// などで crypto.subtle が無いことがある）
export function signatureAvailable() {
  return Boolean(globalThis.crypto?.subtle);
}

// 値の署名（16 進 64 桁）
export async function signPayload(value) {
  const bytes = new TextEncoder().encode(canonicalJSON(value));
  const signature = await subtle().sign("HMAC", await hmacKey(), bytes);
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 署名の照合。長さの違う値や壊れた署名でも例外にせず false を返す。
export async function verifyPayload(value, signature) {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return (await signPayload(value)) === signature;
}
