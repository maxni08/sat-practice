export interface Achievement {
  id: string;
  name: string;
  description: string;
  goal: number;
  metric: string;
}
export const LEGACY_ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-question",
    name: "First Question",
    description: "Submit your first practice answer.",
    goal: 1,
    metric: "attempted",
  },
  {
    id: "first-perfect",
    name: "First Perfect Session",
    description:
      "Answer every question correctly in a completed set of at least five.",
    goal: 1,
    metric: "perfectSessions",
  },
  {
    id: "perfect-10",
    name: "Perfect Ten",
    description: "Complete a perfect session of at least 10 questions.",
    goal: 1,
    metric: "perfect10",
  },
  {
    id: "perfect-25",
    name: "Perfect Twenty-Five",
    description: "Complete a perfect session of at least 25 questions.",
    goal: 1,
    metric: "perfect25",
  },
  ...[10, 50, 100, 500, 1000].map((n) => ({
    id: `correct-${n}`,
    name: `${n.toLocaleString()} Correct`,
    description: `Answer ${n.toLocaleString()} distinct questions correctly.`,
    goal: n,
    metric: "correct",
  })),
  ...[10, 50].map((n) => ({
    id: `hard-${n}`,
    name: `${n} Hard Questions Correct`,
    description: `Solve ${n} distinct Hard questions.`,
    goal: n,
    metric: "hard",
  })),
  {
    id: "corrections-10",
    name: "Mistakes Repaired",
    description:
      "Correct 10 previously missed questions after a six-hour learning interval.",
    goal: 10,
    metric: "corrections",
  },
  ...[1, 5, 10].map((n) => ({
    id: `modules-${n}`,
    name: n === 1 ? "First Full Practice Module" : `${n} Practice Modules`,
    description:
      "Complete modules with at least 80% answered and at least half the questions new to your module history.",
    goal: n,
    metric: "modules",
  })),
  {
    id: "module-perfect",
    name: "Perfect Practice Module",
    description: "Answer an entire meaningful module correctly.",
    goal: 1,
    metric: "perfectModules",
  },
  {
    id: "module-math",
    name: "Math Module Complete",
    description: "Complete a meaningful Math module.",
    goal: 1,
    metric: "mathModules",
  },
  {
    id: "module-reading",
    name: "Reading & Writing Module Complete",
    description: "Complete a meaningful Reading & Writing module.",
    goal: 1,
    metric: "readingModules",
  },
  ...[1, 5].map((n) => ({
    id: `mastery-${n}`,
    name: n === 1 ? "Master One Skill" : `Master ${n} Skills`,
    description:
      "Demonstrate mastery with recent success across varied difficulty.",
    goal: n,
    metric: "mastered",
  })),
  ...[5, 10, 25, 50].map((n) => ({
    id: `level-${n}`,
    name: `Level ${n}`,
    description: `Earn enough improvement XP to reach level ${n}.`,
    goal: n,
    metric: "level",
  })),
];
