import type { Difficulty, TestSection } from "../types";

// Official counts/timing and domain weights, verified 2026-09-08. Difficulty
// mixtures, SPR target and routing below are transparent practice approximations.
export const BLUEPRINT_VERSION = "2026-09-08-v1";
export const MODULE_BLUEPRINT: Record<
  TestSection,
  {
    count: number;
    seconds: number;
    numericCount: number;
    domains: Record<string, number>;
  }
> = {
  Math: {
    count: 22,
    seconds: 35 * 60,
    numericCount: 5,
    domains: {
      Algebra: 35,
      "Advanced Math": 35,
      "Problem-Solving and Data Analysis": 15,
      "Geometry and Trigonometry": 15,
    },
  },
  "Reading and Writing": {
    count: 27,
    seconds: 32 * 60,
    numericCount: 0,
    domains: {
      "Information and Ideas": 26,
      "Craft and Structure": 28,
      "Expression of Ideas": 20,
      "Standard English Conventions": 26,
    },
  },
};
export const DIFFICULTY_MIX: Record<
  "balanced" | "easier" | "harder",
  Record<Difficulty, number>
> = {
  balanced: { Easy: 30, Medium: 40, Hard: 30 },
  easier: { Easy: 45, Medium: 40, Hard: 15 },
  harder: { Easy: 15, Medium: 40, Hard: 45 },
};
export const RULES = {
  day: 86_400_000,
  baseXp: { Easy: 8, Medium: 15, Hard: 25 } as Record<Difficulty, number>,
  correctionXp: 20,
  weakCorrectXp: 5,
  improvedSkillXp: 25,
  masteryXp: 60,
  customCompletionXp: 20,
  moduleCompletionXp: 60,
  excellentModuleXp: 40,
  correctionCooldownHours: 6,
  adaptiveCooldownHours: 24,
  reviewIntervalsDays: [3, 7, 14, 30, 60],
  routingThreshold: 0.7,
};
