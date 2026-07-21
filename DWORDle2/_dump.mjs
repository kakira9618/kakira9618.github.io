import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8642/";
const browser = await chromium.launch();

async function dump(name, playCount, seen) {
  const ctx = await browser.newContext({ viewport: { width: 440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(([pc, seen]) => {
    localStorage.setItem("dwordle2.settings", JSON.stringify({ theme: "cyber", sfx: false, bgm: false, language: "ja" }));
    localStorage.setItem("dwordle2.legacyImportPrompted", "true");
    localStorage.setItem("dwordle2.tutorialSeen", "true");
    localStorage.setItem("dwordle2.playCount", String(pc));
    localStorage.setItem("dwordle2.menuUnlockSeen", String(seen));
  }, [playCount, seen]);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const items = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("#screen-title button").forEach((b) => {
      const cls = b.className;
      const dis = b.disabled ? "[DISABLED]" : (b.getAttribute("aria-disabled") === "true" ? "[aria-disabled]" : "[enabled]");
      const label = (b.getAttribute("aria-label") || b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      out.push(`${dis} ${cls} :: ${label}`);
    });
    return out;
  });
  console.log(`\n=== ${name} (play=${playCount}, seen=${seen}) ===`);
  items.forEach((s) => console.log("  " + s));
  await ctx.close();
}

await dump("0プレイ（全ロック）", 0, 0);
await dump("1プレイ直後（裏以外すべて新規解放）", 1, 0);
await dump("2プレイ（裏モード新規解放）", 2, 1);
await dump("2プレイ（seen 済み・モーダル出ない）", 2, 2);

await browser.close();
