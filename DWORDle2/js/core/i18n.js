// UI language helpers. The stored setting is the single source of truth.

import { getSettings } from "./settings.js?v=20260722-wipe-card";

export function currentLanguage() {
  return getSettings().language === "en" ? "en" : "ja";
}

export function isEnglish() {
  return currentLanguage() === "en";
}

export function tr(ja, en) {
  return isEnglish() ? en : ja;
}

export function syncDocumentLanguage(language = currentLanguage()) {
  const english = language === "en";
  document.documentElement.lang = english ? "en" : "ja";
  document.title = english ? "DWORDle 2 | Wordle with two answers" : "DWORDle 2 | 答えが2つある Wordle";
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      "content",
      english
        ? "DWORDle 2 is Wordle with two answers. Find either answer within 10 Guesses!"
        : "DWORDle 2 | 答えが2つある Wordle 強化版。10手以内に「どちらか」を当てればあなたの勝利！"
    );
}

export function localizedLevel(level) {
  return {
    ...level,
    name: isEnglish() ? level.nameEn : level.name,
    desc: isEnglish() ? level.descEn : level.desc,
  };
}

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
  "green-zero": ["Great Comeback", "Win after having no green tiles before the final Guess"],
  revenge: ["Revenge", "Clear a puzzle you previously lost"],
  "speed-60": ["Speed Star", "Clear a game within 60 seconds"],
  "slow-10": ["Deep Thinker", "Take at least 10 minutes to clear a game"],
  "night-owl": ["Midnight DWORDler", "Clear a game between midnight and 4 a.m."],
  "daily-7": ["Perfect Week", "Clear Daily puzzles 7 days in a row"],
  "early-bird": ["Early Bird", "Clear a game between 5 a.m. and 8 a.m."],
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
  migrator: ["Move Complete", "Import play history from the original games"],
  collector: ["Achievement Hunter", "Unlock 30 achievements"],
  "h-mirror": ["Mirror Word", "Guess a palindrome"],
  "h-phantom": ["Phantom Answer", "Get five green tiles with a word that is not an answer"],
  "h-anagram": ["Anagram Magic", "Guess an anagram of your previous Guess"],
  "h-alphabet": ["Alphabet Marathon", "Clear in 5 or more Guesses with every word chained from the previous word's last letter"],
  "h-noreuse": ["No Repeats", "Clear in 3 or more Guesses without reusing any letter"],
  "h-zorome": ["Repeating Digits", "Clear 10 different puzzle Nos. made of at least 3 identical digits"],
  "h-uso-green": ["All-Green Lie", "Get five displayed green tiles in DWORDlie"],
  "h-abyss": ["One Strike into the Abyss", "Clear an Extreme puzzle within 4 Guesses"],
  "h-lightning": ["Lightning Fast", "Clear a game in 3 or more Guesses and within 10 seconds"],
  "h-lexicon": ["Fountain of Words", "Use 1,000 different Guess words total"],
  "wins-200": ["Living Legend", "Win 200 games total"],
  "play-streak-3": ["Three Days Straight", "Play on 3 consecutive days"],
  "play-streak-7": ["One-Week Habit", "Play on 7 consecutive days"],
  "play-streak-14": ["Two-Week Fever", "Play on 14 consecutive days"],
  "daily-streak-30": ["Perfect Month", "Clear Daily puzzles 30 days in a row"],
  "play-days-100": ["A Hundred Days", "Play on 100 different days"],
  "plays-30": ["Getting the Hang of It", "Finish 30 games total"],
  "plays-500": ["Master of the Board", "Finish 500 games total"],
  "guesses-3000": ["Three Thousand Words", "Make 3,000 Guesses total"],
  "all-letters": ["A to Z", "Use every letter of the alphabet within one game"],
  "h-plays-5000": ["Endless Pursuit", "Finish 5,000 games total"],
  "h-uso-800": ["Eight Hundred Lies", "Win 800 DWORDlie games"],
  "h-play-days-365": ["365 Days of Footprints", "Play on 365 different days"],
  "h-play-streak-365": ["A Year's Vow", "Play on 365 consecutive days"],
  "h-play-days-1095": ["Thousand-Day Training", "Play on 1,095 different days (about 3 years)"],
  "h-play-days-1825": ["Five-Year Legend", "Play on 1,825 different days (about 5 years)"],
};

export function localizedAchievement(achievement) {
  const english = ACHIEVEMENT_EN[achievement.id];
  return {
    ...achievement,
    name: isEnglish() ? (english?.[0] ?? achievement.name) : achievement.name,
    desc: isEnglish() ? (english?.[1] ?? achievement.desc) : achievement.desc,
  };
}
