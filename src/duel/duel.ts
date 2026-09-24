import type { Difficulty, Question, TestSection } from "../types";
import { shuffleQuestions } from "../lib/session";
import { DIFFICULTY_MIX } from "../study/config";
import { quotas, seededRandom } from "../study/modules";

export type DuelSubject = TestSection | "Mixed";
export type DuelMode = "Regular" | "Hard";
export type DuelPlayer = "p1" | "p2";
export interface DuelSetup {
  subject: DuelSubject;
  mode: DuelMode;
  count: 5 | 10 | 15 | 20;
  timerSeconds: 0 | 30 | 45 | 60 | 90;
  p1Name: string;
  p2Name: string;
}
export interface DuelAnswer {
  answer: string;
  locked: boolean;
  responseMs?: number;
  correct?: boolean;
}
export interface DuelRound {
  p1: DuelAnswer;
  p2: DuelAnswer;
  revealed: boolean;
}
export interface DuelMatch {
  id: string;
  setup: DuelSetup;
  questionIds: string[];
  index: number;
  rounds: Record<string, DuelRound>;
  roundStartedAt: number;
  deadline: number | null;
  finished: boolean;
}
export interface DuelSummary {
  id: string;
  date: string;
  subject: DuelSubject;
  mode: DuelMode;
  count: number;
  p1: number;
  p2: number;
  p1CorrectMs: number;
  p2CorrectMs: number;
  p1Name: string;
  p2Name: string;
  winner: string;
}
export interface DuelHistory { version: 1; matches: DuelSummary[] }
export const emptyDuelHistory = (): DuelHistory => ({ version: 1, matches: [] });
export const duelName = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 20) : fallback;
const safeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
const correct = (value: unknown) => value === true;
const blankRound = (): DuelRound => ({
  p1: { answer: "", locked: false },
  p2: { answer: "", locked: false },
  revealed: false,
});

export function generateDuel(
  questions: Question[],
  setup: DuelSetup,
  seed: string,
  now: number,
): DuelMatch {
  const normalizedSetup = {
    ...setup,
    p1Name: duelName(setup.p1Name, "Player 1"),
    p2Name: duelName(setup.p2Name, "Player 2"),
  };
  const random = seededRandom(seed);
  const weights = DIFFICULTY_MIX[normalizedSetup.mode === "Hard" ? "harder" : "balanced"];
  const wanted = quotas(normalizedSetup.count, weights);
  const tests: TestSection[] = normalizedSetup.subject === "Mixed"
    ? ["Math", "Reading and Writing"]
    : [normalizedSetup.subject as TestSection];
  const selected: Question[] = [];
  for (const difficulty of ["Easy", "Medium", "Hard"] as Difficulty[]) {
    const pools = tests.map((test) =>
      shuffleQuestions(
        questions.filter((question) =>
          question.test === test &&
          question.questionType === "multiple-choice" &&
          question.difficulty === difficulty),
        random,
      ),
    );
    for (let i = 0; i < wanted[difficulty]; i++) {
      const preferred = normalizedSetup.subject === "Mixed" ? (selected.length + i) % 2 : 0;
      const question = pools[preferred].shift() ?? pools[1 - preferred]?.shift();
      if (!question) throw new Error(`Not enough ${difficulty} multiple-choice questions for Local 1v1.`);
      selected.push(question);
    }
  }
  const questionIds = shuffleQuestions(selected, random).map((question) => question.id);
  return {
    id: seed,
    setup: normalizedSetup,
    questionIds,
    index: 0,
    rounds: Object.fromEntries(questionIds.map((id) => [id, blankRound()])),
    roundStartedAt: now,
    deadline: normalizedSetup.timerSeconds ? now + normalizedSetup.timerSeconds * 1000 : null,
    finished: false,
  };
}

export function chooseDuelAnswer(match: DuelMatch, player: DuelPlayer, answer: string): DuelMatch {
  const id = match.questionIds[match.index], round = match.rounds[id];
  if (match.finished || round.revealed || round[player].locked) return match;
  return { ...match, rounds: { ...match.rounds, [id]: { ...round, [player]: { ...round[player], answer } } } };
}

function reveal(match: DuelMatch, question: Question, round: DuelRound): DuelMatch {
  const graded: DuelRound = {
    p1: { ...round.p1, correct: round.p1.answer === question.correctAnswer },
    p2: { ...round.p2, correct: round.p2.answer === question.correctAnswer },
    revealed: true,
  };
  return { ...match, rounds: { ...match.rounds, [question.id]: graded } };
}

export function lockDuelAnswer(match: DuelMatch, player: DuelPlayer, question: Question, now: number): DuelMatch {
  const round = match.rounds[question.id];
  if (match.finished || round.revealed || round[player].locked || !round[player].answer) return match;
  const nextRound = {
    ...round,
    [player]: { ...round[player], locked: true, responseMs: Math.max(0, now - match.roundStartedAt) },
  };
  const next = { ...match, rounds: { ...match.rounds, [question.id]: nextRound } };
  return nextRound.p1.locked && nextRound.p2.locked ? reveal(next, question, nextRound) : next;
}

export function expireDuelRound(match: DuelMatch, question: Question, now: number): DuelMatch {
  const round = match.rounds[question.id];
  if (match.finished || round.revealed) return match;
  const elapsed = Math.max(0, now - match.roundStartedAt);
  const expired: DuelRound = {
    p1: round.p1.locked ? round.p1 : { ...round.p1, locked: true, responseMs: elapsed },
    p2: round.p2.locked ? round.p2 : { ...round.p2, locked: true, responseMs: elapsed },
    revealed: false,
  };
  return reveal({ ...match, rounds: { ...match.rounds, [question.id]: expired } }, question, expired);
}

export function advanceDuel(match: DuelMatch, now: number): DuelMatch {
  const id = match.questionIds[match.index];
  if (!match.rounds[id].revealed) return match;
  if (match.index === match.questionIds.length - 1) return { ...match, finished: true };
  return {
    ...match,
    index: match.index + 1,
    roundStartedAt: now,
    deadline: match.setup.timerSeconds ? now + match.setup.timerSeconds * 1000 : null,
  };
}

export function summarizeDuel(match: DuelMatch, now: number): DuelSummary {
  const rounds = Object.values(match.rounds);
  const p1 = rounds.filter((round) => correct(round.p1.correct)).length;
  const p2 = rounds.filter((round) => correct(round.p2.correct)).length;
  const p1CorrectMs = rounds.filter((round) => correct(round.p1.correct)).reduce((sum, round) => sum + safeNumber(round.p1.responseMs), 0);
  const p2CorrectMs = rounds.filter((round) => correct(round.p2.correct)).reduce((sum, round) => sum + safeNumber(round.p2.responseMs), 0);
  const p1Name = duelName(match.setup.p1Name, "Player 1"), p2Name = duelName(match.setup.p2Name, "Player 2");
  const winner = p1 > p2 ? p1Name : p2 > p1 ? p2Name : p1CorrectMs < p2CorrectMs ? p1Name : p2CorrectMs < p1CorrectMs ? p2Name : "Draw";
  return { id: match.id, date: new Date(now).toISOString(), subject: match.setup.subject, mode: match.setup.mode, count: match.questionIds.length, p1, p2, p1CorrectMs, p2CorrectMs, p1Name, p2Name, winner };
}

export function sanitizeDuelHistory(raw: unknown): DuelHistory {
  const source = raw && typeof raw === "object" && Array.isArray((raw as DuelHistory).matches)
    ? (raw as DuelHistory).matches : [];
  return { version: 1, matches: source.slice(-200).filter((item): item is DuelSummary => !!item && typeof item === "object").map((item) => {
    const p1Name = duelName(item.p1Name, "Player 1"), p2Name = duelName(item.p2Name, "Player 2");
    const p1 = safeNumber(item.p1), p2 = safeNumber(item.p2), p1CorrectMs = safeNumber(item.p1CorrectMs), p2CorrectMs = safeNumber(item.p2CorrectMs);
    const winner = p1 > p2 ? p1Name : p2 > p1 ? p2Name : p1CorrectMs < p2CorrectMs ? p1Name : p2CorrectMs < p1CorrectMs ? p2Name : "Draw";
    return { ...item, p1Name, p2Name, p1, p2, p1CorrectMs, p2CorrectMs, winner };
  }) };
}

export function recordDuel(history: DuelHistory, match: DuelMatch, now: number): DuelHistory {
  const clean = sanitizeDuelHistory(history);
  if (!match.finished || clean.matches.some((item) => item.id === match.id)) return clean;
  return { version: 1, matches: [...clean.matches, summarizeDuel(match, now)].slice(-200) };
}
