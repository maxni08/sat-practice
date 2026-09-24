import type {
  Difficulty,
  ProgressMap,
  Question,
  Session,
  TestSection,
} from "../types";

export type MasteryState = "Weak" | "Developing" | "Strong" | "Mastered";
export interface Evidence {
  at: string;
  correct: boolean;
  seconds: number;
  mode: string;
}
export interface Mastery {
  key: string;
  test: TestSection;
  domain: string;
  skill: string;
  score: number;
  state: MasteryState;
  samples: number;
  hardCorrect: number;
  trend: number;
  lastPracticed: string | null;
  calculatedAt: string;
}
export interface ReviewSchedule {
  dueAt: string;
  streak: number;
  misses: number;
  lastAt: string;
}
export interface Credit {
  base: boolean;
  correction: boolean;
}
export interface AdaptiveDifficulty {
  level: Difficulty;
  correctRun: number;
  recent: boolean[];
}
export interface BreakdownRow {
  name: string;
  total: number;
  correct: number;
  seconds: number;
}
export interface ModuleRecord {
  id: string;
  date: string;
  subject: TestSection;
  session: Session;
  score: number;
  accuracy: number;
  answered: number;
  seconds: number;
  byDomain: BreakdownRow[];
  bySkill: BreakdownRow[];
  byDifficulty: BreakdownRow[];
  marked: string[];
  meaningful: boolean;
  novelFraction: number;
}
export interface StudyState {
  progression?: import('../progression/types').Progression;
  ladder?: import('./ladder').LadderState;
  trophies?: import('../achievements/types').TrophyLedger;
  version: 2;
  revision: number;
  initializedAt: string;
  xp: number;
  credits: Record<string, Credit>;
  evidence: Record<string, Evidence[]>;
  skills: Record<string, Mastery>;
  reviews: Record<string, ReviewSchedule>;
  adaptive: Record<string, AdaptiveDifficulty>;
  achievements: Record<string, string>;
  skillAwards: Record<string, { improved?: boolean; mastered?: boolean }>;
  completedSessions: Record<string, string>;
  milestones: Record<string, number>;
  modules: ModuleRecord[];
}
export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  test: TestSection;
  kind: "adaptive" | "review" | "targeted";
  skill?: string;
  count: number;
}
export interface StudyContext {
  questions: Question[];
  progress: ProgressMap;
  study: StudyState;
  now: number;
}
export const skillKey = (q: Pick<Question, "test" | "skill">) =>
  `${q.test}::${q.skill}`;
