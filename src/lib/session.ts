import { answerMatches, isValidAnswer } from "./answers";
import { emptyProgress } from "../types";
import type {
  ProgressMap,
  Question,
  QuestionProgress,
  Session,
  SessionFilters,
  SessionOptions,
} from "../types";

export function filterQuestions(
  questions: Question[],
  filters: SessionFilters,
  progress: ProgressMap = {},
): Question[] {
  return questions.filter((question) => {
    if (question.test !== filters.test) return false;
    if (filters.domains.length && !filters.domains.includes(question.domain))
      return false;
    if (filters.skills.length && !filters.skills.includes(question.skill))
      return false;
    if (
      filters.difficulties.length &&
      !filters.difficulties.includes(question.difficulty)
    )
      return false;
    const history = progress[question.id];
    switch (filters.history) {
      case "unanswered":
        return !history?.attempts;
      case "incorrect":
        return (history?.incorrectAttempts ?? 0) > 0;
      case "correct":
        return (history?.correctAttempts ?? 0) > 0;
      case "bookmarked":
        return history?.bookmark === true;
      default:
        return true;
    }
  });
}

export function shuffleQuestions<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.min(
      index,
      Math.max(0, Math.floor(random() * (index + 1))),
    );
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

export function createSession(
  questions: Question[],
  options: SessionOptions,
  progress: ProgressMap = {},
  now: number = Date.now(),
): Session {
  const candidates = filterQuestions(questions, options, progress);
  const ordered = options.randomize ? shuffleQuestions(candidates) : candidates;
  const count = Number.isFinite(options.count)
    ? Math.max(0, Math.floor(options.count))
    : 0;
  const questionIds = ordered.slice(0, count).map((question) => question.id);
  if (!questionIds.length)
    throw new Error("No questions match these session settings.");
  if (
    options.timerMode !== "none" &&
    (!Number.isFinite(options.timerSeconds) || options.timerSeconds <= 0)
  ) {
    throw new Error("Enter a timer duration greater than zero.");
  }
  const timerSeconds =
    options.timerMode === "none" ? 0 : Math.ceil(options.timerSeconds);
  return {
    id: crypto.randomUUID(),
    test: options.test,
    questionIds,
    index: 0,
    answers: {},
    drafts: {},
    eliminated: {},
    elapsed: {},
    timerMode: options.timerMode,
    timerSeconds,
    startedAt: now,
    deadline:
      options.timerMode === "session" ? now + timerSeconds * 1000 : null,
    timerHidden: false,
    finished: false,
  };
}

export function recordAttempt(
  question: Question,
  answer: string,
  timeSpent: number,
  previous: QuestionProgress = emptyProgress(),
  now: string = new Date().toISOString(),
): QuestionProgress {
  if (!isValidAnswer(question, answer))
    throw new Error("Enter a valid answer before submitting.");
  const correct = answerMatches(question, answer);
  const seconds = Number.isFinite(timeSpent) ? Math.max(0, timeSpent) : 0;
  return {
    ...previous,
    attempts: previous.attempts + 1,
    correctAttempts: previous.correctAttempts + Number(correct),
    incorrectAttempts: previous.incorrectAttempts + Number(!correct),
    lastAnswer: answer.trim(),
    lastResult: correct,
    totalTimeSpent: previous.totalTimeSpent + seconds,
    lastAttemptDate: now,
  };
}

/** Returns a new session and progress together for a single atomic persistence write. */
export function submitSessionAnswer(
  session: Session,
  question: Question,
  answer: string,
  previous: QuestionProgress = emptyProgress(),
  now: string = new Date().toISOString(),
): { session: Session; progress: QuestionProgress } {
  if (!session.questionIds.includes(question.id))
    throw new Error("Question is not part of this session.");
  if (session.answers[question.id])
    throw new Error(
      "This question has already been submitted in this session.",
    );
  if (session.finished) throw new Error("This practice session has ended.");
  const progress = recordAttempt(
    question,
    answer,
    session.elapsed[question.id] ?? 0,
    previous,
    now,
  );
  return {
    progress,
    session: {
      ...session,
      answers: {
        ...session.answers,
        [question.id]: {
          answer: progress.lastAnswer,
          correct: progress.lastResult === true,
          timeSpent: Math.max(0, session.elapsed[question.id] ?? 0),
          submittedAt: now,
        },
      },
    },
  };
}

export function remainingTimerSeconds(
  session: Session,
  questionId: string,
  now = Date.now(),
): number | null {
  if (session.timerMode === "none") return null;
  if (session.timerMode === "session")
    return Math.max(0, Math.ceil(((session.deadline ?? now) - now) / 1000));
  return Math.max(
    0,
    Math.ceil(session.timerSeconds - (session.elapsed[questionId] ?? 0)),
  );
}
