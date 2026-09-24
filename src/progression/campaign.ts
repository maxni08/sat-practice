import type {
  Difficulty,
  ProgressMap,
  Question,
  Session,
  TestSection,
} from "../types";
import type { StudyState } from "../study/types";
import { MODULE_BLUEPRINT } from "../study/config";
import { generateChallengeSet } from "../study/ladder";
import type { Progression, Run } from "./types";

export interface Stage {
  id: string;
  region: string;
  index: number;
  name: string;
  test: TestSection;
  domain?: string;
  count: number;
  seconds: number;
  mix: Record<Difficulty, number>;
  accuracy: number;
  boss: boolean;
  ascension?: number;
}
export const CAMPAIGN: Stage[] = Object.entries(MODULE_BLUEPRINT).flatMap(
  ([test, blueprint], subject) =>
    Object.keys(blueprint.domains).flatMap((domain, region) =>
      Array.from({ length: 12 }, (_, i) => {
        const count = [8, 10, 10, 12, 12, 15, 15, 18, 18, 20, 22, 25][i];
        const hard = [0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12][i],
          easy = i < 5 ? Math.max(0, 5 - i) : 0;
        return {
          id: `${subject}-${region}-${i + 1}`,
          region: `${subject}-${region}`,
          index: i + 1,
          name:
            i === 11
              ? `Boss — ${domain} Mastery`
              : `${domain} — Stage ${i + 1}`,
          test: test as TestSection,
          domain,
          count,
          seconds: count * (i < 4 ? 110 : test === "Math" ? 95 : 71),
          mix: { Easy: easy, Medium: count - easy - hard, Hard: hard },
          accuracy: [
            0.7, 0.75, 0.75, 0.8, 0.8, 0.8, 0.85, 0.85, 0.85, 0.88, 0.88, 0.88,
          ][i],
          boss: i === 11,
        };
      }),
    ),
);
export const ASCENSION: Stage[] = Array.from({ length: 6 }, (_, i) => {
  const test: TestSection = i % 2 ? "Reading and Writing" : "Math",
    count = MODULE_BLUEPRINT[test].count,
    hard = Math.round(count * (0.6 + i * 0.08));
  return {
    id: `ascension-${i + 1}`,
    region: "ascension",
    index: i + 1,
    ascension: i + 1,
    name: `Ascension ${["I", "II", "III", "IV", "V", "VI"][i]}`,
    test,
    count,
    seconds: MODULE_BLUEPRINT[test].seconds,
    mix: { Easy: 0, Medium: count - hard, Hard: hard },
    accuracy: [0.85, 0.88, 0.9, 0.92, 0.95, 0.95][i],
    boss: false,
  };
});
export const STAGES = [...CAMPAIGN, ...ASCENSION];
export const starsEarned = (p?: Progression) =>
  CAMPAIGN.reduce((n, s) => n + (p?.stages[s.id]?.stars ?? 0), 0);
export const campaignComplete = (p?: Progression) =>
  CAMPAIGN.every((s) => (p?.stages[s.id]?.stars ?? 0) > 0);
export function stageLock(stage: Stage, p?: Progression): string | null {
  if (stage.ascension && !campaignComplete(p))
    return "Clear all 96 campaign stages.";
  const region = STAGES.filter((s) => s.region === stage.region);
  if (stage.index > 1 && !p?.stages[region[stage.index - 2].id]?.stars)
    return "Clear the previous stage.";
  const needed = stage.boss
    ? 18
    : !stage.ascension && stage.index >= 7
      ? stage.index
      : 0;
  const stars = region.reduce((n, s) => n + (p?.stages[s.id]?.stars ?? 0), 0);
  return stars < needed
    ? `Earn ${needed} stars in this region (${stars}/${needed}).`
    : null;
}
export function generateCampaign(
  questions: Question[],
  progress: ProgressMap,
  study: StudyState,
  id: string,
  seed: string,
  now: number,
): Session {
  const rule = STAGES.find((s) => s.id === id);
  if (!rule) throw Error("Unknown campaign stage.");
  const locked = stageLock(rule, study.progression);
  if (locked) throw Error(locked);
  const recent = new Set(
    (study.progression?.runs ?? [])
      .filter(
        (r) => STAGES.find((s) => s.id === r.stage)?.region === rule.region,
      )
      .slice(-2)
      .flatMap((r) => r.questionIds),
  );
  const bank = questions.filter(
    (q) => q.test === rule.test && (!rule.domain || q.domain === rule.domain),
  );
  const session = generateChallengeSet(
    bank,
    progress,
    study,
    rule,
    recent,
    seed,
    now,
  );
  session.campaign = { stage: id };
  session.module!.blueprint = "campaign-v1";
  const best = study.progression?.stages[id]?.best;
  if (best)
    session.ghost = {
      correct: best.correct,
      total: best.total,
      seconds: best.seconds,
    };
  return session;
}
export function campaignResult(
  session: Session,
  questions: Question[],
  now: number,
): Run {
  const rule = STAGES.find((s) => s.id === session.campaign?.stage);
  if (!rule) throw Error("Unknown campaign stage.");
  const bank = session.questionIds.map((id) =>
    questions.find((q) => q.id === id),
  );
  const answers = session.questionIds.map((id) => session.answers[id]);
  const correct = answers.filter((a) => a?.correct).length,
    accuracy = correct / rule.count;
  const seconds = Math.max(0, (now - session.startedAt) / 1000);
  const hard = bank.filter(
    (q) => q?.difficulty === "Hard" && session.answers[q.id]?.correct,
  ).length;
  const valid =
    session.finished &&
    session.timerMode === "session" &&
    session.timerSeconds === rule.seconds &&
    session.questionIds.length === rule.count &&
    new Set(session.questionIds).size === rule.count &&
    bank.every(
      (q) =>
        q && q.test === rule.test && (!rule.domain || q.domain === rule.domain),
    ) &&
    Object.entries(rule.mix).every(
      ([d, n]) => bank.filter((q) => q?.difficulty === d).length === n,
    ) &&
    answers.filter((a) => a && a.timeSpent >= 3).length >=
      Math.ceil(rule.count * 0.8) &&
    seconds >= rule.count * 3 &&
    seconds <= rule.seconds + 1;
  let stars = 0;
  if (
    valid &&
    accuracy >= rule.accuracy &&
    hard >= Math.ceil(rule.mix.Hard * 0.65)
  )
    stars = 1;
  if (
    stars &&
    accuracy >= Math.min(0.96, rule.accuracy + 0.08) &&
    answers.every(Boolean) &&
    hard >= Math.ceil(rule.mix.Hard * 0.85) &&
    seconds <= rule.seconds * 0.95
  )
    stars = 2;
  if (
    stars === 2 &&
    accuracy >= (rule.index < 5 && !rule.ascension ? 0.95 : 1) &&
    hard === rule.mix.Hard &&
    seconds <= rule.seconds * 0.9
  )
    stars = 3;
  return {
    id: session.id,
    stage: rule.id,
    date: new Date(now).toISOString(),
    questionIds: session.questionIds,
    correct,
    total: rule.count,
    seconds,
    stars,
  };
}
export function completeCampaign(
  study: StudyState,
  session: Session,
  questions: Question[],
  now: number,
): StudyState {
  if (!session.campaign || !study.progression) return study;
  const p = structuredClone(study.progression);
  if (p.runs.some((r) => r.id === session.id)) return study;
  const rule = STAGES.find((s) => s.id === session.campaign!.stage)!;
  const lock = stageLock(rule, p);
  if (lock) throw Error(lock);
  const result = campaignResult(session, questions, now),
    old = p.stages[rule.id];
  const best =
    !old ||
    result.stars > old.best.stars ||
    (result.stars === old.best.stars &&
      (result.correct > old.best.correct ||
        (result.correct === old.best.correct &&
          result.seconds < old.best.seconds)))
      ? result
      : old.best;
  p.stages[rule.id] = {
    stars: Math.max(old?.stars ?? 0, result.stars),
    attempts: (old?.attempts ?? 0) + 1,
    best,
    completedAt: old?.completedAt ?? (result.stars ? result.date : undefined),
  };
  p.runs.push(result);
  if (result.stars > (old?.stars ?? 0))
    p.notice = {
      id: session.id,
      title: rule.boss ? "BOSS CLEARED" : "STAGE CLEARED",
      detail: `${rule.name} · ${result.stars}/3 stars`,
    };
  if (!campaignComplete(study.progression) && campaignComplete(p))
    p.notice = {
      id: session.id,
      title: "ASCENSION UNLOCKED",
      detail: "All campaign regions complete. Six advanced tiers await.",
    };
  return { ...study, progression: p };
}
