import type {
  Difficulty,
  ProgressMap,
  Question,
  Session,
  TestSection,
} from "../types";
import type { StudyState } from "./types";
import { skillKey } from "./types";
import { createSession, shuffleQuestions } from "../lib/session";
import { quotas, seededRandom } from "./modules";

export interface LadderAttempt {
  id: string;
  level: number;
  questionIds: string[];
  accuracy: number;
  seconds: number;
  passed: boolean;
  date: string;
}
export interface LadderState {
  highestUnlocked: number;
  levels: Record<
    number,
    {
      attempts: number;
      bestAccuracy: number;
      bestTime: number;
      completedAt?: string;
    }
  >;
  history: LadderAttempt[];
}
export const CHALLENGES = Array.from({ length: 14 }, (_, i) => {
  const tier = Math.floor(i / 2),
    test: TestSection = i % 2 ? "Reading and Writing" : "Math";
  const count = [12, 15, 18, 20, 22, 22, test === "Math" ? 22 : 27][tier];
  const hard = [0, 0, 3, 5, 8, 11, 13][tier];
  const easy = [6, 4, 3, 2, 0, 0, 0][tier];
  return {
    level: i + 1,
    test,
    count,
    accuracy: [0.75, 0.8, 0.8, 0.85, 0.9, 0.9, 0.95][tier],
    hard,
    hardCorrect: [0, 0, 2, 3, 6, 9, 12][tier],
    noUnanswered: tier >= 2,
    seconds: Math.ceil(count * (tier < 4 ? 110 : test === "Math" ? 95 : 71)),
    mix: { Easy: easy, Medium: count - easy - hard, Hard: hard },
  };
});
export function generateChallenge(
  questions: Question[],
  progress: ProgressMap,
  study: StudyState,
  level: number,
  seed: string,
  now: number,
): Session {
  const rule = CHALLENGES[level - 1];
  if (!rule || level > (study.ladder?.highestUnlocked ?? 1))
    throw new Error("Complete the preceding challenge first.");
  const recent = new Set(
    (study.ladder?.history ?? []).slice(-3).flatMap((a) => a.questionIds),
  );
  const session = generateChallengeSet(
    questions,
    progress,
    study,
    rule,
    recent,
    seed,
    now,
  );
  session.challenge = { level };
  const best = study.ladder?.history
    .filter((a) => a.level === level)
    .sort((a, b) => b.accuracy - a.accuracy || a.seconds - b.seconds)[0];
  if (best)
    session.ghost = {
      correct: Math.round(best.accuracy * rule.count),
      total: rule.count,
      seconds: best.seconds,
    };
  return session;
}
export function generateChallengeSet(
  questions: Question[],
  progress: ProgressMap,
  study: StudyState,
  rule: {
    test: TestSection;
    count: number;
    seconds: number;
    mix: Record<Difficulty, number>;
  },
  recent: Set<string>,
  seed: string,
  now: number,
): Session {
  const random = seededRandom(seed),
    selected: Question[] = [],
    skills: Record<string, number> = {};
  for (const [difficulty, count] of Object.entries(
    quotas(rule.count, rule.mix),
  )) {
    const pool = questions.filter(
      (q) =>
        q.test === rule.test &&
        q.difficulty === difficulty &&
        !recent.has(q.id),
    );
    for (let i = 0; i < count; i++) {
      const ranked = pool
        .filter((q) => !selected.some((s) => s.id === q.id))
        .map((q) => ({
          q,
          rank:
            (progress[q.id]?.lastAttemptDate &&
            now - Date.parse(progress[q.id].lastAttemptDate!) < 86400000
              ? 10000
              : 0) +
            (skills[q.skill] ?? 0) * 1000 +
            (study.skills[skillKey(q)]?.score ?? 40) +
            random() * 60,
        }))
        .sort((a, b) => a.rank - b.rank);
      const q = ranked[0]?.q;
      if (!q)
        throw new Error(
          `Not enough fresh ${difficulty} questions for this challenge.`,
        );
      selected.push(q);
      skills[q.skill] = (skills[q.skill] ?? 0) + 1;
    }
  }
  const session = createSession(
    shuffleQuestions(selected, random),
    {
      test: rule.test,
      count: rule.count,
      randomize: false,
      domains: [],
      skills: [],
      difficulties: [] as Difficulty[],
      history: "all",
      timerMode: "session",
      timerSeconds: rule.seconds,
    },
    progress,
    now,
  );
  session.id = seed;
  session.mode = "module";
  session.module = { blueprint: "challenge-v1", route: "balanced", number: 1 };
  return session;
}
export function challengeResult(
  session: Session,
  questions: Question[],
  now: number,
) {
  const rule = CHALLENGES[(session.challenge?.level ?? 0) - 1];
  if (!rule) throw new Error("Unknown challenge.");
  const correct = Object.values(session.answers).filter(
    (a) => a.correct,
  ).length;
  const accuracy = correct / rule.count;
  const seconds = Math.max(0, (now - session.startedAt) / 1000);
  const hard = questions.filter(
    (q) =>
      session.questionIds.includes(q.id) &&
      q.difficulty === "Hard" &&
      session.answers[q.id]?.correct,
  ).length;
  const valid =
    session.finished &&
    session.questionIds.length === rule.count &&
    new Set(session.questionIds).size === rule.count &&
    session.questionIds.every((id) =>
      questions.some((q) => q.id === id && q.test === rule.test),
    );
  return {
    accuracy,
    seconds,
    passed:
      valid &&
      accuracy >= rule.accuracy &&
      hard >= rule.hardCorrect &&
      (!rule.noUnanswered ||
        Object.keys(session.answers).length === rule.count) &&
      seconds <= rule.seconds + 1,
  };
}
export function completeChallenge(
  study: StudyState,
  session: Session,
  questions: Question[],
  now: number,
): StudyState {
  if (!session.challenge) return study;
  const old = study.ladder ?? { highestUnlocked: 1, levels: {}, history: [] };
  if (old.history.some((a) => a.id === session.id)) return study;
  const level = session.challenge.level;
  if (level > old.highestUnlocked) throw new Error("Challenge is locked.");
  const result = challengeResult(session, questions, now);
  const previous = old.levels[level];
  const date = new Date(now).toISOString();
  return {
    ...study,
    ladder: {
      highestUnlocked: Math.max(
        old.highestUnlocked,
        result.passed ? Math.min(14, level + 1) : level,
      ),
      levels: {
        ...old.levels,
        [level]: {
          attempts: (previous?.attempts ?? 0) + 1,
          bestAccuracy: Math.max(previous?.bestAccuracy ?? 0, result.accuracy),
          bestTime: Math.min(previous?.bestTime ?? Infinity, result.seconds),
          completedAt:
            previous?.completedAt ?? (result.passed ? date : undefined),
        },
      },
      history: [
        ...old.history,
        {
          id: session.id,
          level,
          questionIds: session.questionIds,
          date,
          ...result,
        },
      ],
    },
  };
}
