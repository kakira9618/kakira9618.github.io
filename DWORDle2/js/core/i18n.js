// UI language helpers. The stored setting is the single source of truth.
// language 設定は "system" | "ja" | "en"。"system"（既定）はブラウザの言語に連動し、
// 日本語なら ja、それ以外はすべて en として扱う。

import { getSettings } from "./settings.js?v=20260803-a";
import { reveal } from "./secret.js?v=20260803-a";

// ブラウザ / OS の言語設定から表示言語を決める
function systemLanguage() {
  return String(navigator.language ?? "").toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function currentLanguage() {
  const language = getSettings().language;
  if (language === "en" || language === "ja") return language;
  return systemLanguage();
}

export function isEnglish() {
  return currentLanguage() === "en";
}

export function tr(ja, en) {
  return isEnglish() ? en : ja;
}

export function syncDocumentLanguage(language = currentLanguage()) {
  const resolved = language === "en" || language === "ja" ? language : systemLanguage();
  const english = resolved === "en";
  document.documentElement.lang = english ? "en" : "ja";
  // 前作 /DWORDle/ と並んだときに区別が付くよう、タブ・検索結果・ブックマークでも "2" を出す
  document.title = english ? "DWORDle 2 | A New Kind of Word Puzzle" : "DWORDle 2 | 新感覚ワードパズル";
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      "content",
      english
        ? "DWORDle 2 is Wordle with two answers. Find either answer within 10 Guesses!"
        : "DWORDle 2 | 答えが2つある新感覚ワードパズル。10手以内に「どちらか」を当てればあなたの勝利！"
    );
}

export function localizedLevel(level) {
  return {
    ...level,
    name: isEnglish() ? level.nameEn : level.name,
    desc: isEnglish() ? level.descEn : level.desc,
  };
}

// 隠し実績の行は、日本語側（js/core/achievements.js）と同じく reveal() で包む。
// 平文をソースに残さないための目隠しで、`node tools/make-secret.mjs encode` で作る。
const ACHIEVEMENT_EN = {
  "first-play": ["First Step", "Finish your first game"],
  "first-clear": ["First Win", "Clear a game for the first time"],
  "daily-clear": ["Daily Dose", "Clear a Daily puzzle"],
  "extreme-clear": ["Vocabulary Abyss", "Clear any one Extreme puzzle (No.10000–19999)"],
  "level-clear": ["Trailblazer", "Clear any one level puzzle (No.20000–39999)"],
  "uso-clear": ["See Through the Lie", "Clear DWORDlie"],
  "uso-5": ["Lie Master", "Win 5 DWORDlie games"],
  "one-shot": ["Divine Guess", "Clear a game on the first Guess"],
  "two-shot": ["Mind Reader", "Clear a game within 2 Guesses"],
  "within-4": ["Quick Solver", "Clear a game within 4 Guesses"],
  "last-gasp": ["Last Gasp", "Clear a game on the final Guess"],
  "streak-3": ["On a Roll", "Win 3 games in a row"],
  "streak-5": ["Winning Road", "Win 5 games in a row"],
  "streak-10": ["Invincible", "Win 10 games in a row"],
  "wins-10": ["Win Collector", "Win 10 games total"],
  "wins-50": ["Veteran", "Win 50 games total"],
  "wins-100": ["Legend", "Win 100 games total"],
  "plays-100": ["Practice Makes Perfect", "Finish 100 games total"],
  "all-gray": ["Complete Miss", "Get five gray tiles in one Guess"],
  rainbow: ["Three Colors", "Get green, yellow, and gray in one Guess"],
  "green-start": ["Rocket Start", "Get at least 3 green tiles on the first Guess"],
  "green-zero": ["Great Comeback", "Win in 3 or more Guesses with no green tiles before the final Guess"],
  revenge: ["Revenge", "Clear a puzzle you previously lost"],
  "speed-60": ["Speed Star", "Clear a game within 60 seconds"],
  "slow-10": ["Deep Thinker", "Take at least 10 minutes to clear a game"],
  "night-owl": ["Midnight DWORDler", "Clear a game between 0:00 and 3:59"],
  "daily-7": ["Perfect Week", "Clear Daily puzzles 7 days in a row"],
  "early-bird": ["Early Bird", "Clear a game between 5:00 and 7:59"],
  "new-year": ["First Sunrise", "Clear a game on January 1"],
  christmas: ["Holy Night Gift", "Clear a game on December 25"],
  weekend: ["Weekend DWORDler", "Clear games on both a Saturday and a Sunday (any weeks)"],
  "same-day-5": ["On Fire Today", "Clear 5 games in a single day"],
  "play-days-30": ["Consistency Pays", "Play on 30 different days"],
  "daily-30": ["Daily Regular", "Clear 30 Daily puzzles total"],
  "plays-300": ["Board Resident", "Finish 300 games total"],
  "guesses-1000": ["A Thousand Words", "Make 1,000 Guesses total"],
  "uso-20": ["Lie Detector", "Win 20 DWORDlie games"],
  analyst: ["Analyst", "Use Analysis mode"],
  migrator: ["Move Complete", "Import play history"],
  collector: ["Achievement Hunter", "Unlock 30 achievements"],
  "h-mirror": [reveal("dhQg23m2SMZUDzY="), reveal("fAg32mXkCbFLHD7AeKAa/lYY")],
  "h-phantom": ["Phantom Answer", "Get five green tiles with a word that is not an answer"],
  "h-anagram": [reveal("ehMzzmSlBbF2HDXAdQ=="), reveal("fAg32mXkCf8bHDzIcbYJ/BsSNIlvqx3jGw0gzGCtB+RIXRXcc7cb")],
  "h-alphabet": [reveal("ehEiwXemDeUbMDPbd7AA/lU="), reveal("eBE3yGTkAf8bSHLGZOQF/kkYcu5joRviXg5y3n+wALFeCzfbb+Qf/kkZcsp+pQH/Xhlyz2SrBbFPFTeJZrYN51ISJ9o2swfjX1ohiXqlG+UbETfdYqEa")],
  "h-noreuse": [reveal("dRJy+3O0DfBPDg=="), reveal("eBE3yGTkAf8bTnLGZOQF/kkYcu5joRviXg5y3n+wAP5OCXLbc7Eb+FUacsh4vUj9XgkmzGQ=")],
  "h-zorome": [reveal("aRgizHewAf9cXRbAca0c4g=="), reveal("eBE3yGTkWaEbGTvPcKEa9FUJctljvhL9Xl0cxmXqSPxaGTeJeaJI8E9dPsx3txyxCF07zXOqHPhYHD6Jcq0P+E8O")],
  "h-uso-green": [reveal("ehE+hFG2DfRVXR7Acw=="), reveal("fBgmiXCtHvQbGTvaZqgJ6F4Zcs5koQ3/Gwk7xXO3SPhVXRb+WZYs/VIY")],
  "h-abyss": [reveal("dBM3iUWwGvhQGHLAeLAHsU8VN4lXphHiSA=="), reveal("eBE3yGTkCf8bOCrdZKEF9BsNJ9NsqA2xTBQmwX+qSKUbOifMZbcN4g==")],
  "h-lightning": [reveal("dxQ1wWKqAf9cXRTIZbA="), reveal("eBE3yGTkCbFcHD/MNq0GsQhdPds2qQfjXl0V3HO3G/RIXTPHcuQf+E8VO8c29VixSBgxxnigGw==")],
  "h-lexicon": [reveal("fRInx2KlAf8bEjSJQasa9Ug="), reveal("bg43iSfoWKELXTbAcKIN414TJolRsQ3iSF0lxmSgG7FPEibIeg==")],
  "wins-200": ["Living Legend", "Win 200 games total"],
  "play-streak-3": ["Three Days Straight", "Play on 3 consecutive days"],
  "play-streak-7": ["One-Week Habit", "Play on 7 consecutive days"],
  "play-streak-14": ["Two-Week Fever", "Play on 14 consecutive days"],
  "daily-streak-14": ["Perfect Fortnight", "Clear Daily puzzles 14 days in a row"],
  "play-days-100": ["A Hundred Days", "Play on 100 different days"],
  "plays-30": ["Getting the Hang of It", "Finish 30 games total"],
  "plays-500": ["Master of the Board", "Finish 500 games total"],
  "guesses-3000": ["Three Thousand Words", "Make 3,000 Guesses total"],
  "all-letters": [reveal("el0mxjae"), reveal("bg43iXOyDeNCXT7MYrAN4xsSNIlirA2xWhEiwXemDeUbCjvdfq0GsVQTN4lxpQX0")],
  "h-plays-1000": [reveal("fhM2xXO3G7FrCCDaY60c"), reveal("fRQ8wGWsSKAXTWKZNqMJ/F4Oct15sAn9")],
  "h-uso-800": [reveal("fhQ1wWLkIORVGSDMcuQk+F4O"), reveal("bBQ8iS70WLF/Kh37UqgB9BsaM8Rztw==")],
  "h-play-days-365": [reveal("dhQgyHWoDbFUG3KaIPFI1VoEIQ=="), reveal("axEz0DarBrEIS2eJcq0O914PN8di5AzwQg4=")],
  "h-play-streak-30": [reveal("el0fxniwALZIXQTGYQ=="), reveal("axEz0DarBrEITXLKeaob9FgIJsBgoUj1WgQh")],
  "h-double-clear": [reveal("bwo7xzaQGvhOECLB"), reveal("aAgxynOhDLFaCXLsTpA60BsuGuZC5A7+SV0ziVKLPdN3OHLqWoEpww==")],
  "h-double-uso": [reveal("ehE+hEWhDfhVGnLsb6E="), reveal("fBgmiXfkLN5uPx7sNock1HovcsB45CzGdC8WxX+hSLlIGDeJYqwa/k4aOolirA2xVxQ32jawB7FZEibBNqUG4kwYINo/")],
  "h-double-oneshot": [reveal("fxQkwHihSNVUCDDFcw=="), reveal("bwggxzalSPdSDyHdO4Md9EgOcsp6oQnjGxQ83XnkCbF/MgfrWoFI0nc4E/s27Ar+TxVyyHi3H/RJDnLAeORasXwIN9ploRu4")],
  "h-double-10": [reveal("eBwmyn6hGrFUG3LrebAAsXMcIMxl"), reveal("eh46wHOyDbEKTXLtWZEq3X5dEeVThTriGwk93Xeo")],
  "h-double-abyss": [reveal("fxIny3qhSPdJEj+JYqwNsXofK9pl"), reveal("fBgmiXfkLN5uPx7sNock1HovcsZ45An/Gzgq3WShBfQbDSfTbKgNsRMzPYcn9FihC5/SOif9UagCVA==")],
  "h-double-streak-3": [reveal("eBUzwHjkB/cbLTPAZLc="), reveal("fBgmiXfkLN5uPx7sNock1HovcsB45FuxXBw/zGXkAf8bHHLbebM=")],
};

export function localizedAchievement(achievement) {
  const english = ACHIEVEMENT_EN[achievement.id];
  return {
    ...achievement,
    name: isEnglish() ? (english?.[0] ?? achievement.name) : achievement.name,
    desc: isEnglish() ? (english?.[1] ?? achievement.desc) : achievement.desc,
  };
}
