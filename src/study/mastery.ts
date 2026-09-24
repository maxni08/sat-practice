import type { ProgressMap, Question } from "../types";
import { RULES } from "./config";
import { skillKey, type Mastery, type StudyState } from "./types";

const weight = { Easy: 1, Medium: 1.5, Hard: 2 };
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
export function calculateMastery(
  questions: Question[],
  progress: ProgressMap,
  evidence: StudyState["evidence"],
  now: number,
): Record<string, Mastery> {
  const groups = new Map<string, Question[]>();
  // Source exports contain capitalization aliases. Pool their evidence while
  // retaining every original persisted key in the returned map.
  for (const q of questions) {
    const identity = skillKey(q).toLowerCase();
    groups.set(identity, [...(groups.get(identity) ?? []), q]);
  }
  const result: Record<string, Mastery> = {};
  for (const [key, bank] of groups) {
    const practiced = bank.filter((q) => progress[q.id]?.attempts > 0);
    const latest = practiced
      .map((q) => {
        const p = progress[q.id];
        const records = evidence[q.id] ?? [];
        return {
          q,
          correct: p.lastResult === true,
          at: p.lastAttemptDate ?? "",
          seconds: records.at(-1)?.seconds ?? p.totalTimeSpent / p.attempts,
          records,
        };
      })
      .sort((a, b) => b.at.localeCompare(a.at) || a.q.id.localeCompare(b.q.id))
      .slice(0, 20);
    let historicalCorrect = 1.5,
      historicalTotal = 3;
    for (const q of practiced) {
      const p = progress[q.id];
      const effective = Math.min(p.attempts, 5) * weight[q.difficulty];
      historicalCorrect += (effective * p.correctAttempts) / p.attempts;
      historicalTotal += effective;
    }
    let recentCorrect = 1.5,
      recentTotal = 3;
    for (const item of latest) {
      const age = Math.max(0, (now - Date.parse(item.at)) / RULES.day) || 0;
      const w = weight[item.q.difficulty] * Math.max(0.25, Math.exp(-age / 60));
      recentCorrect += Number(item.correct) * w;
      recentTotal += w;
    }
    const mean = (items: typeof latest) =>
      items.length ? items.filter((x) => x.correct).length / items.length : 0.5;
    const trend =
      latest.length >= 8
        ? Math.round(
            (mean(latest.slice(0, 4)) - mean(latest.slice(4, 8))) * 100,
          )
        : 0;
    const corrections = latest.filter(
      (x) =>
        x.records.at(-1)?.correct &&
        x.records.slice(0, -1).some((e) => !e.correct),
    ).length;
    const repeatedMisses = latest.filter(
      (x) =>
        x.records.length >= 2 && x.records.slice(-2).every((e) => !e.correct),
    ).length;
    const lastPracticed = latest[0]?.at || null;
    const daysAway = lastPracticed
      ? Math.max(0, (now - Date.parse(lastPracticed)) / RULES.day)
      : 0;
    const slow = latest.filter(
      (x) => x.correct && x.seconds > (x.q.test === "Math" ? 95 : 71) * 2,
    ).length;
    let score = practiced.length
      ? clamp(
          Math.round(
            100 *
              ((0.65 * recentCorrect) / recentTotal +
                (0.35 * historicalCorrect) / historicalTotal) +
              Math.min(6, corrections * 2) -
              Math.min(10, repeatedMisses * 2) +
              clamp(trend / 25, -4, 4) -
              Math.min(15, Math.max(0, daysAway - 14) * 0.25) -
              (latest.length >= 5
                ? Math.min(3, (slow / latest.length) * 3)
                : 0),
          ),
          0,
          100,
        )
      : 0;
    const hardCorrect = practiced.filter(
      (q) => q.difficulty === "Hard" && progress[q.id].correctAttempts > 0,
    ).length;
    const mediumCorrect = practiced.filter(
      (q) => q.difficulty === "Medium" && progress[q.id].correctAttempts > 0,
    ).length;
    const state =
      score >= 85 &&
      practiced.length >= 12 &&
      hardCorrect >= 3 &&
      mediumCorrect >=
        Math.min(
          4,
          Math.max(1, bank.filter((q) => q.difficulty === "Medium").length),
        ) &&
      daysAway <= 14 &&
      mean(latest) >= 0.85
        ? "Mastered"
        : score >= 70 && practiced.length >= 6
          ? "Strong"
          : score >= 45 && practiced.length >= 3
            ? "Developing"
            : "Weak";
    const mastery: Mastery = {
      key,
      test: bank[0].test,
      domain: bank[0].domain,
      skill: bank[0].skill,
      score,
      state,
      samples: practiced.length,
      hardCorrect,
      trend,
      lastPracticed,
      calculatedAt: new Date(now).toISOString(),
    };
    for (const q of bank) {
      const alias = skillKey(q);
      if (!result[alias])
        result[alias] = {
          ...mastery,
          key: alias,
          skill: q.skill,
          domain: q.domain,
        };
    }
  }
  return result;
}
