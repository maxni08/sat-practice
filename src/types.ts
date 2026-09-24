export type TestSection = "Math" | "Reading and Writing";
export type Difficulty = "Easy" | "Medium" | "Hard";
export type TimerMode = "none" | "question" | "session";

export interface Choice {
  label: string;
  text: string;
  assets?: string[];
}

export interface Question {
  id: string;
  questionId: string;
  test: TestSection;
  domain: string;
  skill: string;
  difficulty: Difficulty;
  questionType: "multiple-choice" | "numeric";
  passage: string;
  stem: string;
  choices: Choice[];
  acceptedAnswers: string[];
  correctAnswer: string;
  rationale: string;
  assets: string[];
  rationaleAssets: string[];
  sourcePages: number[];
  issues?: string[];
  passageAssets?: string[];
  passageUnderlines?: { start: number; end: number }[];
  requiresOriginalFormat?: boolean;
  assetDpi?: number;
  sourceAssets?: string[];
}

export interface Highlight {
  field: "passage" | "stem";
  start: number;
  end: number;
  color: string;
}

export interface QuestionProgress {
  attempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  lastAnswer: string;
  lastResult: boolean | null;
  totalTimeSpent: number;
  lastAttemptDate: string | null;
  bookmark: boolean;
  notes: string;
  highlights: Highlight[];
}

export type ProgressMap = Record<string, QuestionProgress>;
export type HistoryFilter =
  | "all"
  | "unanswered"
  | "incorrect"
  | "correct"
  | "bookmarked";

export interface SessionFilters {
  test: TestSection;
  domains: string[];
  skills: string[];
  difficulties: Difficulty[];
  history: HistoryFilter;
}

export interface SessionOptions extends SessionFilters {
  count: number;
  randomize: boolean;
  timerMode: TimerMode;
  timerSeconds: number;
}

export interface SessionAnswer {
  answer: string;
  correct: boolean;
  timeSpent: number;
  submittedAt: string;
  xpAwarded?: number;
  firstCredit?: boolean;
}

export interface Session {
  campaign?: { stage: string; stars?: number };
  ghost?: { correct: number; total: number; seconds: number };
  mock?: { id: string; stage: number; moduleIds: string[]; complete?: boolean };
  challenge?: { level: number; passed?: boolean };
  id: string;
  test: TestSection;
  questionIds: string[];
  index: number;
  answers: Record<string, SessionAnswer>;
  drafts: Record<string, string>;
  draftTimes?: Record<string, number>;
  eliminated: Record<string, string[]>;
  elapsed: Record<string, number>;
  timerMode: TimerMode;
  timerSeconds: number;
  startedAt: number;
  deadline: number | null;
  timerHidden: boolean;
  finished: boolean;
  mode?: "custom" | "adaptive" | "module" | "endless";
  endless?: {
    answered: number;
    correct: number;
    hardCorrect: number;
    streak: number;
    activeSeconds: number;
    recent: string[];
    cycles: number;
  };
  adaptive?: {
    level: Difficulty;
    correctRun: number;
    recent: boolean[];
    seen: string[];
  };
  module?: {
    blueprint: string;
    route: "balanced" | "easier" | "harder";
    sectionId?: string;
    number: 1 | 2;
    previousModuleId?: string;
    awaitingNext?: boolean;
    completedAt?: string;
    sectionSummary?: boolean;
    marked?: string[];
  };
}

export interface AppState {
  progress: ProgressMap;
  session: Session | null;
}

export function emptyProgress(): QuestionProgress {
  return {
    attempts: 0,
    correctAttempts: 0,
    incorrectAttempts: 0,
    lastAnswer: "",
    lastResult: null,
    totalTimeSpent: 0,
    lastAttemptDate: null,
    bookmark: false,
    notes: "",
    highlights: [],
  };
}
