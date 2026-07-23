// 旧 FINAL ANSWER API の互換シム。新規コードは extra-shot.js を使用する。

export {
  EXTRA_SHOT_UNLOCK_PLAYS as FINAL_ANSWER_UNLOCK_PLAYS,
  isExtraShotUnlocked as isFinalAnswerUnlocked,
  extraShotRemainingPlays as finalAnswerRemainingPlays,
  isExtraShotEnabled as isFinalAnswerEnabled,
  claimExtraShotUnlockNotice as claimFinalAnswerUnlockNotice,
} from "./extra-shot.js?v=20260723-fa";
