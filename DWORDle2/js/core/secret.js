// 隠し要素（デバッグモードのキーワード、隠し実績の名前と条件）を、ソースの全文検索で
// そのまま拾えないようにするための符号化ユーティリティ。
//
// あくまで「ソースを眺めたり grep したりしただけでは分からない」程度の目隠しで、
// 暗号ではない（実行時には必ず平文に戻るので、開発者ツールを使えば読める）。
// 符号化した文字列とキーワードの指紋は tools/make-secret.mjs で作る。

const XOR_KEY = [0x3b, 0x7d, 0x52, 0xa9, 0x16, 0xc4, 0x68, 0x91];

// Base64 + XOR で符号化した文字列を元に戻す
export function reveal(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) ^ XOR_KEY[i % XOR_KEY.length];
  return new TextDecoder().decode(bytes);
}

// reveal の逆。ツールとテストから使う（実行時の UI では使わない）
export function conceal(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ^ XOR_KEY[i % XOR_KEY.length]);
  return btoa(binary);
}

// 文字列の指紋。キーワードを平文で置かずに一致判定するためだけに使う。
// 別々の 2 種類のハッシュを繋げて、偶然の衝突を実用上無視できるようにする。
export function fingerprint(text) {
  const value = String(text);
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (const character of value) {
    const code = character.codePointAt(0);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ code) >>> 0;
  }
  return `${fnv.toString(36)}.${djb.toString(36)}`;
}
