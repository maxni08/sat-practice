export interface TrophyQuestion {
  lastAt: number;
  misses: number;
  reviewTries: number;
  known: boolean;
  recoveryRun: number;
}
export interface WeakEvidence {
  at: string;
  lowest: boolean;
  recommended: boolean;
  strong?: string;
  mastered?: string;
}
export interface TrophySession {
  id: string;
  at: string;
  day: string;
  subject: string;
  mode: string;
  count: number;
  correct: number;
  eligible: boolean;
  hard: number;
  hardCorrect: number;
  freshHard: number;
  openingWrong: number;
  endingCorrect: number;
}
export interface TrophyLedger {
  version: 2;
  since: string;
  timeZone: string;
  questions: Record<string, TrophyQuestion>;
  run: string[];
  hardRun: string[];
  bestRun: number;
  bestHardRun: number;
  repaired: Record<string, string>;
  firstReviews: Record<string, string>;
  dueRepairs: Record<string, string>;
  weak: Record<string, WeakEvidence>;
  sessions: TrophySession[];
  sessionIds: Record<string, true>;
  counters: Record<string, number>;
  backfilled: Record<string, true>;
  awardedXp: Record<string, number>;
}
