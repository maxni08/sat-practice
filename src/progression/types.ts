export interface Run {
  id: string;
  stage: string;
  date: string;
  questionIds: string[];
  correct: number;
  total: number;
  seconds: number;
  stars: number;
}
export interface StageProgress {
  stars: number;
  attempts: number;
  completedAt?: string;
  best: Run;
}
export interface Day {
  questions: string[];
  hard: string[];
  repairs: string[];
  modules: string[];
  sessions: string[];
  improved: string[];
}
export interface Quest {
  id: string;
  period: string;
  kind: "questions" | "hard" | "repairs" | "modules" | "improved";
  target: number;
  xp: number;
  offset: number;
  progress: number;
  paidAt?: string;
}
export interface Progression {
  version: 1;
  since: string;
  timeZone: string;
  rank: {
    highest: number;
    previous: number;
    history: { rank: number; at: string; backfilled?: boolean }[];
  };
  stages: Record<string, StageProgress>;
  runs: Run[];
  days: Record<string, Day>;
  quests: Record<string, Quest>;
  records: Record<string, { value: number; at: string }>;
  notice?: { id: string; title: string; detail: string };
}
