import type { Difficulty, Question, Session, TestSection } from "../types";
import { createSession } from "../lib/session";
import { RULES } from "./config";
import { seededRandom, quotas } from "./modules";
import {
  skillKey,
  type AdaptiveDifficulty,
  type Recommendation,
  type StudyContext,
} from "./types";

const levels: Difficulty[] = ["Easy", "Medium", "Hard"];
export function startingDifficulty(
  context: StudyContext,
  test: TestSection,
): Difficulty {
  if (context.study.adaptive[test]) return context.study.adaptive[test].level;
  const rows = levels.map((level) => {
    const questions = context.questions.filter(
      (q) =>
        q.test === test &&
        q.difficulty === level &&
        context.progress[q.id]?.attempts,
    );
    return {
      count: questions.length,
      accuracy: questions.length
        ? questions.filter((q) => context.progress[q.id].lastResult).length /
          questions.length
        : 0,
    };
  });
  if (rows[0].count >= 5 && rows[0].accuracy < 0.55) return "Easy";
  if (
    rows[1].count >= 5 &&
    rows[1].accuracy >= 0.8 &&
    (rows[2].count < 5 || rows[2].accuracy >= 0.55)
  )
    return "Hard";
  return "Medium";
}
export function advanceDifficulty(
  previous: AdaptiveDifficulty,
  correct: boolean,
): AdaptiveDifficulty {
  const recent = [...previous.recent, correct].slice(-4),
    correctRun = correct ? previous.correctRun + 1 : 0;
  let index = levels.indexOf(previous.level);
  if (correctRun >= 3 && index < 2)
    return { level: levels[index + 1], correctRun: 0, recent: [] };
  if (recent.length >= 4 && recent.filter((x) => !x).length >= 3 && index > 0)
    return { level: levels[index - 1], correctRun: 0, recent: [] };
  return { level: previous.level, correctRun, recent };
}
export function selectAdaptive(
  context: StudyContext,
  test: TestSection,
  count: number,
  seed: string,
  exclude: string[] = [],
  skill?: string,
): Question[] {
  const { questions, progress, study, now } = context,
    random = seededRandom(seed),
    target = startingDifficulty(context, test);
  const excluded = new Set(exclude);
  const bank = questions.filter(
    (q) =>
      q.test === test && !excluded.has(q.id) && (!skill || q.skill === skill),
  );
  const cooldown = RULES.adaptiveCooldownHours * 3_600_000;
  const available = bank.filter(
    (q) =>
      !progress[q.id]?.lastAttemptDate ||
      now - Date.parse(progress[q.id].lastAttemptDate!) >= cooldown ||
      Date.parse(study.reviews[q.id]?.dueAt ?? "") <= now,
  );
  const pool =
    available.length >= count
      ? available
      : [
          ...available,
          ...bank
            .filter((q) => !available.includes(q))
            .sort(
              (a, b) =>
                Date.parse(progress[a.id]?.lastAttemptDate ?? "1970") -
                Date.parse(progress[b.id]?.lastAttemptDate ?? "1970"),
            ),
        ];
  const chosen: Question[] = [],
    skillCounts: Record<string, number> = {};
  const mix = quotas(count, { weak: 60, developing: 25, retention: 15 });
  const buckets = Object.entries(mix).flatMap(([bucket, n]) =>
    Array.from({ length: n }, () => bucket),
  );
  for (const bucket of buckets) {
    const ranked = pool
      .filter((q) => !chosen.includes(q))
      .map((q) => {
        const m = study.skills[skillKey(q)],
          score = m?.score ?? 0;
        const category =
          score < 45 ? "weak" : score < 75 ? "developing" : "retention";
        const due = Date.parse(study.reviews[q.id]?.dueAt ?? "") <= now;
        const last = progress[q.id]?.lastAttemptDate;
        const recent = last && now - Date.parse(last) < cooldown && !due;
        const mistakes = progress[q.id]?.incorrectAttempts ?? 0;
        return {
          q,
          rank:
            (category === bucket ? 0 : 100_000) +
            (recent ? 1_000_000 : 0) +
            (skillCounts[q.skill] ?? 0) * 2000 +
            Math.abs(levels.indexOf(q.difficulty) - levels.indexOf(target)) *
              300 +
            (due ? -600 : 0) -
            Math.min(mistakes, 5) * 35 +
            score * 2 -
            (m?.lastPracticed
              ? Math.min(
                  60,
                  Math.max(0, (now - Date.parse(m.lastPracticed)) / RULES.day),
                )
              : 30) +
            random() * 100,
        };
      })
      .sort((a, b) => a.rank - b.rank);
    if (!ranked[0]) break;
    const q = ranked[0].q;
    chosen.push(q);
    skillCounts[q.skill] = (skillCounts[q.skill] ?? 0) + 1;
  }
  return chosen;
}
export function createAdaptiveSession(
  context: StudyContext,
  test: TestSection,
  count: number,
  seed: string,
  skill?: string,
): Session {
  const bank = selectAdaptive(context, test, count, seed, [], skill);
  const session = createSession(
    bank,
    {
      test,
      domains: [],
      skills: [],
      difficulties: [],
      history: "all",
      count,
      randomize: false,
      timerMode: "none",
      timerSeconds: 0,
    },
    context.progress,
    context.now,
  );
  session.id = seed;
  session.mode = "adaptive";
  session.adaptive = {
    ...(context.study.adaptive[test] ?? {
      level: startingDifficulty(context, test),
      correctRun: 0,
      recent: [],
    }),
    seen: [bank[0].id],
  };
  return session;
}
export function adaptRemaining(
  session: Session,
  context: StudyContext,
  correct: boolean,
): Session {
  if (session.mode !== "adaptive" || !session.adaptive) return session;
  const next = advanceDifficulty(session.adaptive, correct);
  const result = {
    ...session,
    adaptive: {
      ...next,
      seen: [
        ...new Set([
          ...session.adaptive.seen,
          session.questionIds[session.index],
        ]),
      ],
    },
  };
  if (next.level === session.adaptive.level) return result;
  const ids = [...session.questionIds],
    excluded = [...ids];
  for (let i = session.index + 1; i < ids.length; i++) {
    if (
      result.adaptive.seen.includes(ids[i]) ||
      session.drafts[ids[i]] ||
      session.answers[ids[i]]
    )
      continue;
    const original = context.questions.find((q) => q.id === ids[i]);
    if (!original) continue;
    const adjusted = {
      ...context,
      study: {
        ...context.study,
        adaptive: { ...context.study.adaptive, [session.test]: next },
      },
    };
    const replacement = selectAdaptive(
      adjusted,
      session.test,
      1,
      `${session.id}-${i}-${next.level}`,
      excluded,
      original.skill,
    )[0];
    if (replacement) {
      ids[i] = replacement.id;
      excluded.push(replacement.id);
    }
  }
  return { ...result, questionIds: ids };
}
export function recommendations(context: StudyContext): Recommendation[] {
  const { study, now } = context,
    result: Recommendation[] = [];
  for (const test of ["Math", "Reading and Writing"] as const) {
    const due = context.questions.filter(
      (q) =>
        q.test === test && Date.parse(study.reviews[q.id]?.dueAt ?? "") <= now,
    ).length;
    if (due)
      result.push({
        id: `review-${test}`,
        title: `${due} mistakes due for review`,
        detail: `${test} · spaced correction practice`,
        test,
        kind: "review",
        count: Math.min(12, due),
      });
  }
  const skills = Object.values(study.skills)
    .filter((s) => s.samples > 0)
    .sort((a, b) => a.score - b.score || b.samples - a.samples);
  const weakest = skills[0];
  if (weakest)
    result.push({
      id: `skill-${weakest.key}`,
      title: `Practice ${weakest.skill}`,
      detail: `${weakest.state} · ${weakest.score}/100 mastery${weakest.trend < 0 ? " · recent accuracy declined" : ""} · 12 questions`,
      test: weakest.test,
      kind: "targeted",
      skill: weakest.skill,
      count: 12,
    });
  if (!result.length)
    result.push({
      id: "start-adaptive",
      title: "Find your starting point",
      detail:
        "12 varied questions to begin identifying your strongest and weakest skills.",
      test: "Math",
      kind: "adaptive",
      count: 12,
    });
  return result.slice(0, 3);
}
export function sessionFromRecommendation(
  context: StudyContext,
  recommendation: Recommendation,
  seed: string,
): Session {
  if (recommendation.kind !== "review")
    return createAdaptiveSession(
      context,
      recommendation.test,
      recommendation.count,
      seed,
      recommendation.skill,
    );
  const due = context.questions
    .filter(
      (q) =>
        q.test === recommendation.test &&
        Date.parse(context.study.reviews[q.id]?.dueAt ?? "") <= context.now,
    )
    .sort(
      (a, b) =>
        Date.parse(context.study.reviews[a.id].dueAt) -
        Date.parse(context.study.reviews[b.id].dueAt),
    );
  const session = createSession(
    due,
    {
      test: recommendation.test,
      domains: [],
      skills: [],
      difficulties: [],
      history: "all",
      count: recommendation.count,
      randomize: false,
      timerMode: "none",
      timerSeconds: 0,
    },
    context.progress,
    context.now,
  );
  session.id = seed;
  return session;
}
