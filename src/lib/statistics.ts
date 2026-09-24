import type { ProgressMap, Question, Session } from "../types";

export interface StatGroup {
  label: string;
  attemptedQuestions: number;
  attempts: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  totalTime: number;
  averageTime: number;
}

export interface Statistics {
  total: StatGroup;
  byTest: StatGroup[];
  byDomain: StatGroup[];
  bySkill: StatGroup[];
  byDifficulty: StatGroup[];
  weakestSkills: StatGroup[];
  incorrectQuestions: Question[];
}

interface Contribution {
  question: Question;
  attempts: number;
  correct: number;
  time: number;
}

function summarize(label: string, rows: Contribution[]): StatGroup {
  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
  const correct = rows.reduce((sum, row) => sum + row.correct, 0);
  const totalTime = rows.reduce((sum, row) => sum + row.time, 0);
  return {
    label,
    attemptedQuestions: rows.filter((row) => row.attempts > 0).length,
    attempts,
    correct,
    incorrect: attempts - correct,
    accuracy: attempts ? (correct / attempts) * 100 : 0,
    totalTime,
    averageTime: attempts ? totalTime / attempts : 0,
  };
}

function groups(
  rows: Contribution[],
  field: "test" | "domain" | "skill" | "difficulty",
): StatGroup[] {
  const grouped = new Map<string, Contribution[]>();
  for (const row of rows) {
    const label = row.question[field];
    const group = grouped.get(label) ?? [];
    group.push(row);
    grouped.set(label, group);
  }
  const results = [...grouped].map(([label, entries]) =>
    summarize(label, entries),
  );
  if (field === "difficulty") {
    const order = ["Easy", "Medium", "Hard"];
    return results.sort(
      (a, b) => order.indexOf(a.label) - order.indexOf(b.label),
    );
  }
  return results.sort((a, b) => a.label.localeCompare(b.label));
}

function compile(
  rows: Contribution[],
  incorrectQuestions: Question[],
): Statistics {
  const bySkill = groups(rows, "skill");
  return {
    total: summarize("Overall", rows),
    byTest: groups(rows, "test"),
    byDomain: groups(rows, "domain"),
    bySkill,
    byDifficulty: groups(rows, "difficulty"),
    weakestSkills: bySkill
      .filter((skill) => skill.attempts > 0)
      .sort(
        (a, b) =>
          a.accuracy - b.accuracy ||
          b.attempts - a.attempts ||
          a.label.localeCompare(b.label),
      )
      .slice(0, 8),
    incorrectQuestions,
  };
}

/** Accuracy is attempt-weighted; unique attempted question count is reported independently. */
export function buildStatistics(
  questions: Question[],
  progress: ProgressMap,
): Statistics {
  const rows = questions.map((question) => ({
    question,
    attempts: progress[question.id]?.attempts ?? 0,
    correct: progress[question.id]?.correctAttempts ?? 0,
    time: progress[question.id]?.totalTimeSpent ?? 0,
  }));
  return compile(
    rows,
    questions.filter(
      (question) => (progress[question.id]?.incorrectAttempts ?? 0) > 0,
    ),
  );
}

export interface SessionStatistics extends Statistics {
  totalQuestions: number;
  submittedQuestions: number;
  correctQuestions: number;
  sessionAccuracy: number;
  unansweredQuestions: Question[];
}

export function buildSessionStatistics(
  questions: Question[],
  session: Session,
): SessionStatistics {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const included = session.questionIds
    .map((id) => byId.get(id))
    .filter((question): question is Question => !!question);
  const submitted = included.filter((question) => session.answers[question.id]);
  const rows = submitted.map((question) => ({
    question,
    attempts: 1,
    correct: Number(session.answers[question.id].correct),
    time: session.answers[question.id].timeSpent,
  }));
  const compiled = compile(
    rows,
    submitted.filter((question) => !session.answers[question.id].correct),
  );
  return {
    ...compiled,
    totalQuestions: included.length,
    submittedQuestions: submitted.length,
    correctQuestions: compiled.total.correct,
    sessionAccuracy: included.length
      ? (compiled.total.correct / included.length) * 100
      : 0,
    unansweredQuestions: included.filter(
      (question) => !session.answers[question.id],
    ),
  };
}
