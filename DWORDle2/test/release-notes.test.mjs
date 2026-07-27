// リリースノートの組み立て（tools/bump-version.mjs）のテスト。
// 「遊ぶ人から見えない変更は 1 行にまとめる」「バージョン運用のコミットは出さない」が肝。
import assert from "node:assert/strict";

const { buildReleaseNotes, classifyCommit } = await import("../tools/bump-version.mjs");

// ---- 1 件ずつの分類 ----

// バージョン運用そのもの: ノートに出さないし、内部改善にも数えない
for (const subject of [
  "バージョンを v2.1.0 に更新",
  "バージョン表示のハッシュを更新",
  "DWORDle2: 更新ハッシュを反映",
  "DWORDle2: refresh source hash",
]) {
  assert.equal(classifyCommit({ subject, files: ["js/version.js", "sw.js"] }), "noise", subject);
}

// 内部ファイルだけを触ったコミットは、件名がどうであれ内部作業
assert.equal(
  classifyCommit({ subject: "DWORDle2: 公開用に minify ビルドを追加", files: [".github/workflows/pages.yml", "tools/build.mjs"] }),
  "internal"
);
assert.equal(classifyCommit({ subject: "DWORDle2: 履歴の検証を追加", files: ["test/ui-smoke.test.mjs"] }), "internal");
assert.equal(classifyCommit({ subject: "DWORDle2: 依存を更新", files: ["package.json", "package-lock.json"] }), "internal");

// 公開ファイルも触っているが、件名から内部作業と分かるもの
assert.equal(
  classifyCommit({ subject: "DWORDle2: 開発用スクリプトを tools/ へ移動し重複定義を削除", files: ["js/ui/icons.js", "tools/font-repro.mjs"] }),
  "internal"
);

// 遊ぶ人に見える変更はそのまま載せる
assert.equal(
  classifyCommit({ subject: "DWORDle2: プレイ中に戻るとき、中断か破棄かを選べるダイアログを追加", files: ["js/ui/game-screen.js"] }),
  "user"
);
// 「依存」「スクリプト」などが普通の文章として出てきただけなら、内部作業と誤判定しない
assert.equal(
  classifyCommit({ subject: "DWORDle2: 打ち消しを時刻に依存しない方式へ変更し、離脱ダイアログの文言を調整", files: ["js/ui/game-screen.js", "test/ui-smoke.test.mjs"] }),
  "user"
);

// ---- 箇条書きの組み立て ----

const notes = buildReleaseNotes([
  { subject: "DWORDle2: EXTRA SHOT を追加。", files: ["js/core/extra-shot.js"] },
  { subject: "バージョン表示のハッシュを更新", files: ["js/version.js"] },
  { subject: "DWORDle2: テストの不安定さを修正", files: ["test/ui-smoke.test.mjs"] },
  { subject: "DWORDle2: ビルドを整理", files: ["tools/build.mjs"] },
  { subject: "DWORDle2: EXTRA SHOT を追加。", files: ["js/core/extra-shot.js"] }, // 同じ件名は 1 行に
  { subject: "DWORDle2: 履歴の行間が消えていたのを修正", files: ["css/style.css"] },
]);
assert.equal(notes.internalCount, 2);
assert.deepEqual(notes.bullets, [
  "EXTRA SHOT を追加", // 接頭辞と末尾の句点は落とす
  "履歴の行間が消えていたのを修正",
  "安定性を向上（内部の改善 2 件）", // 内部改善は最後の 1 行にまとめる
]);

// 内部改善が無ければ「安定性を向上」の行は出さない
const userOnly = buildReleaseNotes([{ subject: "DWORDle2: 実績を追加", files: ["js/core/achievements.js"] }]);
assert.deepEqual(userOnly.bullets, ["実績を追加"]);
assert.equal(userOnly.internalCount, 0);

// 内部改善だけのリリースでも 1 行は残る
const internalOnly = buildReleaseNotes([
  { subject: "DWORDle2: テストを追加", files: ["test/audio.test.mjs"] },
  { subject: "バージョン表示のハッシュを更新", files: ["js/version.js"] },
]);
assert.deepEqual(internalOnly.bullets, ["安定性を向上（内部の改善 1 件）"]);

console.log("リリースノートテスト: OK");
