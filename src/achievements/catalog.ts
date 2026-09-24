import { LEGACY_ACHIEVEMENTS } from "./legacy";
export const CATALOG_VERSION = 2;
export const CATEGORIES = [
  "Accuracy",
  "Correct Questions",
  "Hard Difficulty",
  "Skill Mastery",
  "Error Recovery",
  "Adaptive Practice",
  "Practice Modules",
  "Full Sections",
  "Time Management",
  "Consistency",
  "Question Bank Exploration",
  "Levels / XP",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type Rarity = "Bronze" | "Silver" | "Gold" | "Diamond" | "Platinum";
export interface AchievementDefinition {
  id: string;
  name: string;
  hiddenName?: string;
  description: string;
  requirement: string;
  category: Category;
  rarity: Rarity;
  secret: boolean;
  countsTowardPlatinum: boolean;
  goal: number;
  progressTarget: number;
  metric: string;
  rule: string;
  xpReward: number;
  badge: string;
  stages?: { label: string; metric: string; target: number }[];
}
const oldCategory = (id: string): Category =>
  id === "first-question" || id.startsWith("correct-")
    ? "Correct Questions"
    : id.startsWith("hard-")
      ? "Hard Difficulty"
      : id.startsWith("mastery-")
        ? "Skill Mastery"
        : id.startsWith("level-")
          ? "Levels / XP"
          : id === "corrections-10"
            ? "Error Recovery"
            : id.includes("module")
              ? "Practice Modules"
              : "Accuracy";
const oldTier = (id: string): Rarity =>
  ["level-50", "mastery-5", "correct-1000"].includes(id)
    ? "Diamond"
    : [
          "correct-500",
          "level-25",
          "module-perfect",
          "perfect-25",
          "hard-50",
          "modules-10",
        ].includes(id)
      ? "Gold"
      : [
            "first-question",
            "correct-10",
            "modules-1",
            "module-math",
            "module-reading",
          ].includes(id)
        ? "Bronze"
        : "Silver";
const motif: Record<Category, string> = {
  Accuracy: "target",
  "Correct Questions": "check",
  "Hard Difficulty": "bolt",
  "Skill Mastery": "neural",
  "Error Recovery": "repair",
  "Adaptive Practice": "branch",
  "Practice Modules": "crown",
  "Full Sections": "book",
  "Time Management": "clock",
  Consistency: "shield",
  "Question Bank Exploration": "compass",
  "Levels / XP": "steps",
};
function define(
  id: string,
  name: string,
  category: Category,
  rarity: Rarity,
  metric: string,
  goal: number,
  requirement: string,
  secret = false,
  badge = motif[category],
): AchievementDefinition {
  return {
    id,
    name,
    category,
    rarity,
    metric,
    goal,
    progressTarget: goal,
    rule: metric,
    description: requirement,
    requirement,
    secret,
    hiddenName: secret ? "???" : undefined,
    countsTowardPlatinum: !secret && id !== "platinum",
    xpReward: { Bronze: 10, Silver: 25, Gold: 50, Diamond: 100, Platinum: 200 }[
      rarity
    ],
    badge,
  };
}
const added: AchievementDefinition[] = [
  define(
    "streak-15",
    "Clear Run",
    "Accuracy",
    "Silver",
    "streak",
    15,
    "Answer 15 distinct questions consecutively correctly in eligible attempts.",
  ),
  define(
    "streak-25",
    "Unbroken Focus",
    "Accuracy",
    "Gold",
    "streak",
    25,
    "Answer 25 distinct questions consecutively correctly in eligible attempts.",
  ),
  define(
    "hard-run-5",
    "Rising Voltage",
    "Hard Difficulty",
    "Silver",
    "hardStreak",
    5,
    "Answer five distinct consecutive Hard questions correctly.",
  ),
  define(
    "hard-run-10",
    "High Voltage",
    "Hard Difficulty",
    "Gold",
    "hardStreak",
    10,
    "Answer ten distinct consecutive Hard questions correctly.",
  ),
  define(
    "perfect-math-15",
    "Exact Thinking",
    "Accuracy",
    "Gold",
    "perfectMath15",
    1,
    "Complete a qualifying Math session of at least 15 questions perfectly.",
  ),
  define(
    "perfect-reading-15",
    "Close Reading",
    "Accuracy",
    "Gold",
    "perfectReading15",
    1,
    "Complete a qualifying Reading & Writing session of at least 15 questions perfectly.",
  ),
  define(
    "session-95",
    "Precision Standard",
    "Accuracy",
    "Gold",
    "session95",
    1,
    "Reach 95% accuracy in a qualifying session of at least 25 questions.",
  ),
  define(
    "sessions-90-5",
    "Reliable Results",
    "Consistency",
    "Gold",
    "sessions90",
    5,
    "Complete five qualifying sessions of at least 15 questions at 90% accuracy or better.",
  ),
  define(
    "hard-100",
    "Difficult Ground",
    "Hard Difficulty",
    "Gold",
    "hard",
    100,
    "Answer 100 distinct Hard questions correctly.",
  ),
  define(
    "hard-session",
    "Hard by Choice",
    "Hard Difficulty",
    "Gold",
    "hardSession",
    1,
    "Complete a qualifying session of at least 20 Hard questions with at least 85% accuracy.",
  ),
  define(
    "hard-skill",
    "Depth of Understanding",
    "Hard Difficulty",
    "Gold",
    "hardSkill",
    1,
    "Reach 90% across the latest 20 distinct Hard questions in one skill, all within 30 days.",
  ),
  define(
    "recovery-first",
    "A Better Answer",
    "Error Recovery",
    "Bronze",
    "corrections",
    1,
    "Correct an eligible previously missed question after the six-hour learning interval.",
  ),
  define(
    "recovery-25",
    "Lessons Applied",
    "Error Recovery",
    "Silver",
    "corrections",
    25,
    "Correct 25 distinct previously missed questions after eligible learning intervals.",
  ),
  define(
    "recovery-50",
    "Mistakes into Method",
    "Error Recovery",
    "Gold",
    "corrections",
    50,
    "Correct 50 distinct previously missed questions after eligible learning intervals.",
  ),
  define(
    "first-reviews-10",
    "First Return",
    "Error Recovery",
    "Gold",
    "firstReviews",
    10,
    "Correct ten distinct mistakes on their first recorded, due, meaningful review attempt.",
  ),
  define(
    "weak-strong",
    "Rebuilt Foundation",
    "Error Recovery",
    "Silver",
    "weakStrong",
    1,
    "Take an observed Weak skill with at least six questions and three distinct mistakes to Strong.",
  ),
  define(
    "weak-mastered",
    "From Weakness to Strength",
    "Error Recovery",
    "Gold",
    "weakMastered",
    1,
    "Take an observed, evidence-backed Weak skill to Mastered.",
  ),
  define(
    "weekly-repair",
    "A Week of Repair",
    "Error Recovery",
    "Gold",
    "weeklyRepairs",
    10,
    "Correct ten distinct due-for-review mistakes within seven days, after legitimate learning intervals.",
  ),
  define(
    "math-domain",
    "A Domain Understood",
    "Skill Mastery",
    "Gold",
    "mathDomains",
    1,
    "Master every tracked skill within one Math domain.",
    false,
    "graph",
  ),
  define(
    "reading-domain",
    "A Domain in Words",
    "Skill Mastery",
    "Gold",
    "readingDomains",
    1,
    "Master every tracked skill within one Reading & Writing domain.",
    false,
    "book",
  ),
  define(
    "domain-breadth",
    "Across Every Domain",
    "Skill Mastery",
    "Gold",
    "strongDomains",
    8,
    "Reach Strong or Mastered in at least one meaningfully practiced skill in every SAT domain.",
  ),
  define(
    "all-strong",
    "No Weak Links",
    "Skill Mastery",
    "Diamond",
    "allStrong",
    1,
    "Reach Strong or Mastered in every tracked SAT skill.",
  ),
  define(
    "master-math",
    "Master of Math",
    "Skill Mastery",
    "Diamond",
    "masterMath",
    1,
    "Master every tracked Math skill.",
    false,
    "graph",
  ),
  define(
    "master-reading",
    "Master of Language",
    "Skill Mastery",
    "Diamond",
    "masterReading",
    1,
    "Master every tracked Reading & Writing skill.",
    false,
    "book",
  ),
  define(
    "master-all",
    "Master of the SAT",
    "Skill Mastery",
    "Diamond",
    "masterAll",
    1,
    "Meet the mastery engine’s requirements for every tracked skill.",
    false,
    "neural-crown",
  ),
  define(
    "math-perfect-module",
    "Twenty-Two for Twenty-Two",
    "Practice Modules",
    "Gold",
    "perfectMathModule",
    1,
    "Score 22/22 in a valid Math Practice Module.",
    false,
    "graph-crown",
  ),
  define(
    "reading-perfect-module",
    "Twenty-Seven for Twenty-Seven",
    "Practice Modules",
    "Gold",
    "perfectReadingModule",
    1,
    "Score 27/27 in a valid Reading & Writing Practice Module.",
    false,
    "book-crown",
  ),
  define(
    "modules-50",
    "Module Veteran",
    "Practice Modules",
    "Diamond",
    "modules",
    50,
    "Complete 50 valid Practice Modules; the 25-module milestone is tracked along the way.",
  ),
  define(
    "module-consistency",
    "Steady Under Pressure",
    "Consistency",
    "Diamond",
    "moduleConsistency",
    3,
    "Achieve five consecutive valid modules at 90%, five valid modules at 95%, and ten consecutive valid modules with every question answered.",
  ),
  define(
    "math-section",
    "Math Section Standard",
    "Full Sections",
    "Gold",
    "mathSectionAccuracy",
    95,
    "Complete both Math modules sequentially with at least 95% combined raw accuracy.",
    false,
    "graph-shield",
  ),
  define(
    "reading-section",
    "Reading Section Standard",
    "Full Sections",
    "Gold",
    "readingSectionAccuracy",
    95,
    "Complete both Reading & Writing modules sequentially with at least 95% combined raw accuracy.",
    false,
    "book-shield",
  ),
  define(
    "math-perfect-section",
    "Perfect Math Section",
    "Full Sections",
    "Diamond",
    "perfectMathSection",
    1,
    "Answer all 44 questions correctly across a valid sequential Math section.",
    false,
    "graph-crown",
  ),
  define(
    "reading-perfect-section",
    "Perfect Reading Section",
    "Full Sections",
    "Diamond",
    "perfectReadingSection",
    1,
    "Answer all 54 questions correctly across a valid sequential Reading & Writing section.",
    false,
    "book-crown",
  ),
  define(
    "measured-pace",
    "Measured Pace",
    "Time Management",
    "Gold",
    "measuredPace",
    1,
    "Finish a valid module at 90% accuracy with all answers, using at most 80% of its time and meaningful active work.",
  ),
  define(
    "adaptive-first",
    "A Useful Challenge",
    "Adaptive Practice",
    "Bronze",
    "adaptiveSessions",
    1,
    "Complete an Adaptive Practice session of at least ten questions with meaningful new material.",
  ),
  define(
    "adaptive-10",
    "Practice with Direction",
    "Adaptive Practice",
    "Gold",
    "adaptiveSessions",
    10,
    "Complete ten qualifying Adaptive Practice sessions.",
  ),
  define(
    "adaptive-90",
    "Challenge Accepted",
    "Adaptive Practice",
    "Gold",
    "adaptive90",
    1,
    "Score at least 90% in a qualifying Adaptive Practice session of at least 20 questions.",
  ),
  define(
    "explore-250",
    "Beyond Familiar Ground",
    "Question Bank Exploration",
    "Silver",
    "attempted",
    250,
    "Attempt 250 distinct questions.",
  ),
  define(
    "explore-all",
    "The Complete Bank",
    "Question Bank Exploration",
    "Diamond",
    "attempted",
    3770,
    "Attempt all 3,770 validated questions. Quarter, halfway and three-quarter milestones are tracked.",
    false,
    "compass-crown",
  ),
];
const stages: Record<
  string,
  { label: string; metric: string; target: number }[]
> = {
  "modules-50": [
    { label: "25 valid modules", metric: "modules", target: 25 },
    { label: "50 valid modules", metric: "modules", target: 50 },
  ],
  "explore-all": [25, 50, 75, 100].map((n) => ({
    label: `${n}% of the bank`,
    metric: "attempted",
    target: Math.ceil((3770 * n) / 100),
  })),
  "module-consistency": [
    {
      label: "Five consecutive modules at 90%",
      metric: "moduleRun90",
      target: 5,
    },
    { label: "Five modules at 95%", metric: "modules95", target: 5 },
    {
      label: "Ten consecutive fully answered modules",
      metric: "moduleRunFull",
      target: 10,
    },
  ],
  "math-section": [
    { label: "Complete both Math modules", metric: "mathSections", target: 1 },
    {
      label: "90% combined accuracy",
      metric: "mathSectionAccuracy",
      target: 90,
    },
    {
      label: "95% combined accuracy",
      metric: "mathSectionAccuracy",
      target: 95,
    },
  ],
  "reading-section": [
    {
      label: "Complete both Reading & Writing modules",
      metric: "readingSections",
      target: 1,
    },
    {
      label: "90% combined accuracy",
      metric: "readingSectionAccuracy",
      target: 90,
    },
    {
      label: "95% combined accuracy",
      metric: "readingSectionAccuracy",
      target: 95,
    },
  ],
  "measured-pace": [
    {
      label: "90% accuracy within 90% of the time",
      metric: "pace90",
      target: 1,
    },
    {
      label: "90% accuracy within 80% of the time",
      metric: "measuredPace",
      target: 1,
    },
  ],
  "adaptive-10": [
    {
      label: "Ten meaningful adaptive sessions",
      metric: "adaptiveSessions",
      target: 10,
    },
    {
      label: "Recommended Weak skill becomes Strong",
      metric: "guidedStrong",
      target: 1,
    },
    {
      label: "Recommended Weak skill becomes Mastered",
      metric: "guidedMastered",
      target: 1,
    },
  ],
  "weekly-repair": [
    {
      label: "Ten due corrections in seven days",
      metric: "weeklyRepairs",
      target: 10,
    },
    {
      label: "Revisit a repeated Hard mistake successfully",
      metric: "hardRecovery",
      target: 1,
    },
  ],
  "sessions-90-5": [
    { label: "Five sessions at 90%", metric: "sessions90", target: 5 },
    {
      label: "Study on seven qualifying calendar days",
      metric: "studyDays",
      target: 7,
    },
  ],
};
const secrets = [
  define(
    "secret-return",
    "The Long Return",
    "Error Recovery",
    "Diamond",
    "longReturn",
    1,
    "After three legitimate misses on one question, complete three properly spaced successful reviews.",
    true,
    "repair-crown",
  ),
  define(
    "secret-wire",
    "Down to the Wire",
    "Time Management",
    "Gold",
    "lastMinute",
    1,
    "Finish a valid module with 30 seconds or less remaining, at least 90% accuracy and no unanswered questions.",
    true,
    "clock",
  ),
  define(
    "secret-comeback",
    "A Different Ending",
    "Accuracy",
    "Gold",
    "comeback",
    1,
    "In a qualifying 25+ question first-exposure set, recover from two errors in the first five to a perfect final ten and at least 90% overall.",
    true,
    "repair",
  ),
  define(
    "secret-lowest",
    "From the Ground Up",
    "Skill Mastery",
    "Diamond",
    "lowestMastered",
    1,
    "Take the recorded lowest-ranked meaningful Weak skill to Mastered.",
    true,
    "neural-crown",
  ),
  define(
    "secret-double",
    "Two Perfect Halves",
    "Practice Modules",
    "Diamond",
    "sameDayPerfectModules",
    1,
    "Complete perfect valid Math and Reading & Writing modules on the same recorded calendar day.",
    true,
    "crown",
  ),
  define(
    "secret-marathon",
    "A Complete Day",
    "Full Sections",
    "Diamond",
    "sameDaySections",
    1,
    "Complete a valid full section in each subject on the same day, each at least 90%.",
    true,
    "book-shield",
  ),
  define(
    "secret-first",
    "First Principles",
    "Hard Difficulty",
    "Diamond",
    "firstHard",
    1,
    "Correctly solve at least 15 previously unseen Hard questions in a qualifying 20+ question set with at least 95% overall accuracy.",
    true,
    "bolt",
  ),
  define(
    "secret-rebuild",
    "Reconstruction",
    "Skill Mastery",
    "Diamond",
    "weakStrong",
    3,
    "Bring three recorded Weak skills with substantial negative evidence to Strong or Mastered.",
    true,
    "neural",
  ),
  define(
    "secret-steady",
    "Steady to the Finish",
    "Time Management",
    "Gold",
    "balancedFinish",
    1,
    "Finish a valid module with all answers and 90% accuracy, spending meaningful time on every final-quarter question without a large final time spike.",
    true,
    "shield",
  ),
  define(
    "secret-rhythm",
    "Last Five",
    "Time Management",
    "Gold",
    "finalFive",
    1,
    "Answer at least three of the last five questions correctly in the final tenth of a valid module timer and finish at 90% with all questions answered.",
    true,
    "clock-crown",
  ),
];
export const ACHIEVEMENTS: AchievementDefinition[] = [
  ...LEGACY_ACHIEVEMENTS.map((a) => ({
    ...define(
      a.id,
      a.name,
      oldCategory(a.id),
      oldTier(a.id),
      a.metric,
      a.goal,
      a.description,
    ),
    xpReward: 0,
  })),
  ...added.map((a) => ({ ...a, stages: stages[a.id] })),
  define(
    "platinum",
    "SAT Practice Platinum",
    "Levels / XP",
    "Platinum",
    "platinum",
    63,
    "Unlock every other core achievement. Optional Secret Achievements are excluded.",
    false,
    "platinum",
  ),
  ...secrets,
];
export const CORE = ACHIEVEMENTS.filter((a) => !a.secret);
export const SECRETS = ACHIEVEMENTS.filter((a) => a.secret);
export function visibleAchievement(
  a: AchievementDefinition,
  unlocked: boolean,
) {
  return a.secret && !unlocked
    ? {
        id: a.id,
        name: "???",
        description: "Secret Achievement",
        requirement: "Discover this through meaningful study.",
        badge: "secret",
        secret: true,
      }
    : a;
}
