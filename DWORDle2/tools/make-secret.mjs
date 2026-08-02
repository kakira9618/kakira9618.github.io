// 隠し要素の文字列を符号化し、キーワードの指紋を計算する（js/core/secret.js と対）。
//
// 使い方:
//   node tools/make-secret.mjs encode "隠し実績の説明"   -> reveal() に渡す文字列
//   node tools/make-secret.mjs decode "BASE64"           -> 元の文字列
//   node tools/make-secret.mjs fingerprint "KEYWORD"     -> 一致判定に置く指紋
//
// 隠し実績の名前・説明や、デバッグモードのキーワードを足し引きするときに使う。
// ソースに平文を残さないため、結果だけをコードへ貼ること。
import { conceal, reveal, fingerprint } from "../js/core/secret.js?v=20260803-a";

const [command, value] = process.argv.slice(2);
if (!command || value === undefined) {
  console.error("usage: node tools/make-secret.mjs <encode|decode|fingerprint> <text>");
  process.exit(1);
}
if (command === "encode") console.log(conceal(value));
else if (command === "decode") console.log(reveal(value));
else if (command === "fingerprint") console.log(fingerprint(value));
else {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}
