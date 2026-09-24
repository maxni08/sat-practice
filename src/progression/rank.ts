import type { ProgressMap, Question } from "../types";
import type { StudyState } from "../study/types";
import { MODULE_BLUEPRINT } from "../study/config";
import { starsEarned } from "./campaign";
export const RANKS = [
  ...["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Elite"].flatMap((t) =>
    ["III", "II", "I"].map((d) => `${t} ${d}`),
  ),
  "Master",
  "Grandmaster",
];
export const validModules = (s: StudyState) =>
  s.modules.filter(
    (m) =>
      m.meaningful &&
      m.novelFraction >= 0.5 &&
      m.session.finished &&
      !m.session.challenge &&
      !m.session.campaign &&
      m.session.questionIds.length === MODULE_BLUEPRINT[m.subject].count &&
      new Set(m.session.questionIds).size === m.session.questionIds.length &&
      m.answered >= Math.ceil(m.session.questionIds.length * 0.8) &&
      m.seconds >= m.session.questionIds.length * 3,
  );
export function rankMetrics(
  bank: Question[],
  progress: ProgressMap,
  s: StudyState,
) {
  const known = bank.filter(
    (q) => progress[q.id]?.attempts > 0 && progress[q.id].totalTimeSpent >= 3,
  );
  const recent = known
    .flatMap((q) => {
      const e = [...(s.evidence[q.id] ?? [])]
        .filter((e) => e.seconds >= 3)
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      return [
        {
          q,
          correct: e?.correct ?? progress[q.id].lastResult === true,
          at: e?.at ?? progress[q.id].lastAttemptDate ?? "",
        },
      ];
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  const ratio = (xs: typeof recent) =>
    xs.length ? (xs.filter((x) => x.correct).length / xs.length) * 100 : 0;
  const hard = recent.filter((x) => x.q.difficulty === "Hard"),
    medium = recent.filter((x) => x.q.difficulty !== "Easy");
  const mastery = (test: Question["test"]) => {
    const keys = [
      ...new Set(
        bank
          .filter((q) => q.test === test)
          .map((q) => `${q.test}::${q.skill}`.toLowerCase()),
      ),
    ];
    return (
      keys.reduce(
        (n, k) =>
          n +
          Math.max(
            0,
            ...Object.values(s.skills)
              .filter((v) => v.key.toLowerCase() === k)
              .map((v) => v.score),
          ),
        0,
      ) / Math.max(1, keys.length)
    );
  };
  const modules = validModules(s);
  const sections = modules.filter(
    (m) =>
      m.session.module?.number === 2 &&
      modules.some(
        (first) =>
          first.id === m.session.module?.previousModuleId &&
          first.session.module?.sectionId &&
          first.session.module.sectionId === m.session.module.sectionId &&
          first.subject === m.subject &&
          !first.session.questionIds.some((id) =>
            m.session.questionIds.includes(id),
          ),
      ),
  );
  return {
    distinct: known.length,
    hardEvidence: hard.length,
    mediumEvidence: medium.length,
    accuracy: ratio(recent.slice(0, 100)),
    hardAccuracy: ratio(hard.slice(0, 60)),
    mediumAccuracy: ratio(medium.slice(0, 100)),
    mathMastery: mastery("Math"),
    readingMastery: mastery("Reading and Writing"),
    modules: modules.length,
    moduleAccuracy:
      modules.slice(-10).reduce((n, m) => n + m.accuracy * 100, 0) /
      Math.max(1, Math.min(10, modules.length)),
    sections: sections.length,
    sectionAccuracy:
      sections.slice(-6).reduce((n, m) => {
        const first = modules.find(
          (f) => f.id === m.session.module!.previousModuleId,
        )!;
        return (
          n +
          ((m.score + first.score) /
            (m.session.questionIds.length + first.session.questionIds.length)) *
            100
        );
      }, 0) / Math.max(1, Math.min(6, sections.length)),
    stars: starsEarned(s.progression),
  };
}
export type RankMetrics = ReturnType<typeof rankMetrics>;
export const LABELS: Record<keyof RankMetrics, string> = {
  distinct: "Distinct questions",
  hardEvidence: "Distinct Hard questions",
  mediumEvidence: "Distinct Medium/Hard questions",
  accuracy: "Recent accuracy (%)",
  hardAccuracy: "Hard accuracy (%)",
  mediumAccuracy: "Medium/Hard accuracy (%)",
  mathMastery: "Math mastery",
  readingMastery: "Reading & Writing mastery",
  modules: "Valid modules",
  moduleAccuracy: "Recent module accuracy (%)",
  sections: "Full sections / mock sections",
  sectionAccuracy: "Recent section accuracy (%)",
  stars: "Campaign stars",
};
export function rankRequirements(index: number): Partial<RankMetrics> {
  if (index === 0) return {};
  return {
    distinct: [
      0, 25, 50, 80, 120, 160, 220, 280, 350, 450, 550, 650, 800, 950, 1100,
      1300, 1500, 1800, 2200, 2600,
    ][index],
    mediumEvidence: Math.round(index * index * 2 + 8),
    accuracy: 55 + index * 2,
    ...(index >= 2
      ? { hardEvidence: (index - 1) * 10, hardAccuracy: 50 + index * 2 }
      : {}),
    ...(index >= 3
      ? {
          mediumAccuracy: 55 + index * 2,
          mathMastery: Math.min(90, (index - 2) * 5),
          readingMastery: Math.min(90, (index - 2) * 5),
        }
      : {}),
    ...(index >= 4
      ? { modules: index - 3, moduleAccuracy: 55 + index * 2 }
      : {}),
    ...(index >= 8
      ? {
          sections: Math.ceil((index - 7) / 2),
          sectionAccuracy: 60 + index * 1.7,
        }
      : {}),
    ...(index >= 9 ? { stars: (index - 8) * 24 } : {}),
  };
}
export function calculateRank(metrics: RankMetrics, highest = 0) {
  let form = 0;
  for (let i = 1; i < RANKS.length; i++)
    if (
      Object.entries(rankRequirements(i)).every(
        ([k, v]) => metrics[k as keyof RankMetrics] >= v,
      )
    )
      form = i;
    else break;
  const current = Math.max(form, Math.min(19, highest)),
    next = Math.min(19, current + 1);
  const baseline = rankRequirements(current);
  const requirements = Object.entries(rankRequirements(next)).map(
    ([key, target]) => ({
      key,
      label: LABELS[key as keyof RankMetrics],
      value: metrics[key as keyof RankMetrics],
      target,
      baseline: baseline[key as keyof RankMetrics] ?? 0,
    }),
  );
  const missing =
    current === 19 ? [] : requirements.filter((r) => r.value < r.target);
  const intervalProgress = requirements.map((r) => {
    const span = r.target - r.baseline;
    return span <= 0
      ? Number(r.value >= r.target)
      : Math.max(0, Math.min(1, (r.value - r.baseline) / span));
  });
  return {
    current,
    form,
    next: current === 19 ? null : next,
    percent:
      current === 19
        ? 100
        : Math.min(
            missing.length ? 99 : 100,
            Math.floor(
            100 * Math.min(...intervalProgress),
            ),
          ),
    missing,
  };
}
