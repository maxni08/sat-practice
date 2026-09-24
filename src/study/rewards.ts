import type { ProgressMap, Question, Session, SessionAnswer } from "../types";
import { RULES } from "./config";
import { calculateMastery } from "./mastery";
import { makeModuleRecord } from "./modules";
import { scheduleReview } from "./review";
import { skillKey, type StudyState } from "./types";
import { progressionAttempt } from '../progression/engine';

export function xpForLevel(level: number): number {
  return 25 * Math.max(0, level - 1) * Math.max(1, level);
}
export function levelProgress(xp: number) {
  xp = Math.max(0, Number.isFinite(xp) ? Math.floor(xp) : 0);
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2));
  const floor = xpForLevel(level),
    next = xpForLevel(level + 1);
  return {
    level,
    xp,
    current: xp - floor,
    required: next - floor,
    next,
    remaining: next - xp,
    ratio: (xp - floor) / (next - floor),
  };
}
export { ACHIEVEMENTS } from "../achievements/catalog";
import {
  evaluateAchievements,
  recordAchievementAttempt,
  recordAchievementSession,
  upgradeAchievements,
} from "../achievements/engine";
export function achievementMetrics(
  study: StudyState,
  questions: Question[],
  progress: ProgressMap,
): Record<string, number> {
  const meaningful = study.modules.filter((m) => m.meaningful);
  return {
    ...study.milestones,
    attempted: questions.filter((q) => progress[q.id]?.attempts > 0).length,
    correct: questions.filter((q) => progress[q.id]?.correctAttempts > 0)
      .length,
    hard: questions.filter(
      (q) => q.difficulty === "Hard" && progress[q.id]?.correctAttempts > 0,
    ).length,
    corrections: Object.values(study.credits).filter((c) => c.correction)
      .length,
    modules: meaningful.length,
    perfectModules: meaningful.filter((m) => m.accuracy === 1).length,
    mathModules: meaningful.filter((m) => m.subject === "Math").length,
    readingModules: meaningful.filter(
      (m) => m.subject === "Reading and Writing",
    ).length,
    mastered: Object.values(study.skillAwards).filter((a) => a.mastered).length,
    level: levelProgress(study.xp).level,
  };
}
export function unlockAchievements(
  study: StudyState,
  questions: Question[],
  progress: ProgressMap,
  now: number,
): StudyState {
  return evaluateAchievements(
    study,
    questions,
    progress,
    now,
    achievementMetrics(study, questions, progress),
  );
}

export function initializeStudy(
  questions: Question[],
  progress: ProgressMap,
  now: number,
): StudyState {
  const study: StudyState = {
    version: 2,
    revision: 0,
    initializedAt: new Date(now).toISOString(),
    xp: 0,
    credits: {},
    evidence: {},
    skills: {},
    reviews: {},
    adaptive: {},
    achievements: {},
    skillAwards: {},
    completedSessions: {},
    milestones: {},
    modules: [],
  };
  for (const q of questions) {
    const p = progress[q.id];
    if (!p?.attempts) continue;
    study.credits[q.id] = { base: p.correctAttempts > 0, correction: false };
    if (p.correctAttempts > 0) study.xp += RULES.baseXp[q.difficulty];
    if (p.incorrectAttempts > 0) {
      const at = p.lastAttemptDate ? Date.parse(p.lastAttemptDate) : now;
      study.reviews[q.id] = {
        dueAt: new Date(at + RULES.day).toISOString(),
        streak: 0,
        misses: p.incorrectAttempts,
        lastAt: p.lastAttemptDate ?? new Date(now).toISOString(),
      };
    }
  }
  study.skills = calculateMastery(questions, progress, study.evidence, now);
  // Legacy history counts toward initial XP, but historical dates, attempts and
  // corrections are never invented from aggregate counters.
  return upgradeAchievements(study, questions, progress, now);
}
export function rewardAttempt(
  study: StudyState,
  questions: Question[],
  previous: ProgressMap,
  next: ProgressMap,
  q: Question,
  answer: SessionAnswer,
  mode: string,
  now: number,
): { study: StudyState; xp: number; firstCredit: boolean } {
  let result: StudyState = {
    ...study,
    credits: { ...study.credits },
    evidence: { ...study.evidence },
    reviews: { ...study.reviews },
    skillAwards: { ...study.skillAwards },
  };
  const before = previous[q.id],
    credit = { ...(study.credits[q.id] ?? { base: false, correction: false }) };
  const oldSkill = study.skills[skillKey(q)];
  const spaced =
    !before?.lastAttemptDate ||
    now - Date.parse(before.lastAttemptDate) >=
      RULES.correctionCooldownHours * 3_600_000;
  let xp = 0,
    firstCredit = false;
  if (answer.correct && spaced) {
    if (!credit.base) {
      xp += RULES.baseXp[q.difficulty];
      credit.base = true;
      firstCredit = true;
      if (oldSkill?.samples >= 3 && oldSkill.score < 45)
        xp += RULES.weakCorrectXp;
    }
    if (
      before?.lastResult === false &&
      before.incorrectAttempts > 0 &&
      !credit.correction
    ) {
      xp += RULES.correctionXp;
      credit.correction = true;
    }
  }
  result.credits[q.id] = credit;
  result.evidence[q.id] = [
    ...(study.evidence[q.id] ?? []),
    {
      at: new Date(now).toISOString(),
      correct: answer.correct,
      seconds: answer.timeSpent,
      mode,
    },
  ].slice(-8);
  const review = scheduleReview(study.reviews[q.id], answer.correct, now);
  if (review) result.reviews[q.id] = review;
  result.skills = calculateMastery(questions, next, result.evidence, now);
  const current = result.skills[skillKey(q)],
    awards = { ...(study.skillAwards[skillKey(q)] ?? {}) };
  const aliasAwards = Object.entries(study.skillAwards)
    .filter(([key]) => key.toLowerCase() === skillKey(q).toLowerCase())
    .map(([, value]) => value);
  if (
    answer.correct &&
    spaced &&
    current?.state === "Mastered" &&
    !aliasAwards.some((value) => value.mastered)
  ) {
    xp += RULES.masteryXp;
    awards.mastered = true;
  }
  if (
    answer.correct &&
    spaced &&
    oldSkill?.samples >= 3 &&
    oldSkill.score < 70 &&
    current?.score >= 70 &&
    !aliasAwards.some((value) => value.improved)
  ) {
    xp += RULES.improvedSkillXp;
    awards.improved = true;
  }
  result.skillAwards[skillKey(q)] = awards;
  result.xp += xp;
  result = recordAchievementAttempt(
    result,
    study,
    questions,
    previous,
    next,
    q,
    answer,
    mode,
    now,
  );
  result = progressionAttempt(result, study, previous, q, answer, questions, next, now);
  result = unlockAchievements(result, questions, next, now);
  return { study: result, xp, firstCredit };
}
export function rewardCompletion(
  study: StudyState,
  session: Session,
  questions: Question[],
  progress: ProgressMap,
  now: number,
): StudyState {
  if (study.completedSessions[session.id]) return study;
  const answers = Object.values(session.answers),
    total = session.questionIds.length;
  let result: StudyState = {
    ...study,
    completedSessions: {
      ...study.completedSessions,
      [session.id]: new Date(now).toISOString(),
    },
    milestones: { ...study.milestones },
  };
  if (
    answers.length === total &&
    total >= 5 &&
    answers.every((a) => a.correct)
  ) {
    result.milestones.perfectSessions =
      (result.milestones.perfectSessions ?? 0) + 1;
    if (total >= 10) result.milestones.perfect10 = 1;
    if (total >= 25) result.milestones.perfect25 = 1;
  }
  if (session.mode === "module" && !session.challenge && !session.campaign) {
    const record = makeModuleRecord(
      session,
      questions,
      progress,
      study.modules,
    );
    result.modules = [...study.modules, record];
    if (record.meaningful)
      result.xp +=
        RULES.moduleCompletionXp +
        (record.accuracy >= 0.9 ? RULES.excellentModuleXp : 0);
  } else if (
    total >= 10 &&
    answers.length === total &&
    answers.filter((a) => a.firstCredit).length / total >= 0.6
  ) {
    result.xp += RULES.customCompletionXp;
  }
  result = recordAchievementSession(result, session, questions, progress, now);
  return unlockAchievements(result, questions, progress, now);
}
