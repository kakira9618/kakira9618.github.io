// プライバシーポリシーと About は JS 無効でも読める独立ページ
import assert from "node:assert/strict";
import { assertNoSeriousA11yViolations } from "./harness.mjs";

export default [
  {
    name: "pages",
    async run({ page, baseUrl }) {
      await page.goto(`${baseUrl}privacy.html`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "プライバシーポリシー", exact: true }).waitFor();
      // Google アナリティクス利用時に必須の開示リンク
      assert.equal(
        await page.getByRole("link", { name: "Googleのサービスを使用するサイトやアプリから収集した情報のGoogleによる使用", exact: true }).getAttribute("href"),
        "https://policies.google.com/technologies/partner-sites?hl=ja"
      );
      // 連絡先はアドレスを直に晒さず、リンクで案内する
      assert.equal(await page.getByText("kurokuro917@gmail.com", { exact: false }).count(), 0, "the raw contact address should not be printed");
      await assertNoSeriousA11yViolations(page, "Privacy page");

      await page.goto(`${baseUrl}about.html`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "このゲームについて・クレジット", exact: true }).waitFor();
      await page.getByRole("link", { name: "powerlanguage/word-lists", exact: true }).first().waitFor();
      await assertNoSeriousA11yViolations(page, "About page");
    },
  },
];
