import type { ProgressMap, Question, Session } from "../types";
import { createSession, shuffleQuestions } from "../lib/session";

const RECENT_LIMIT = 120;
const base = () => ({ answered: 0, correct: 0, hardCorrect: 0, streak: 0, activeSeconds: 0, recent: [] as string[], cycles: 1 });

function pick(
  bank: Question[], progress: ProgressMap, used: readonly string[], recent: readonly string[], random: () => number,
) {
  const usedIds = new Set(used), recentIds = new Set(recent);
  let pool = bank.filter(q => !usedIds.has(q.id) && !recentIds.has(q.id));
  if (!pool.length) pool = bank.filter(q => !usedIds.has(q.id));
  if (!pool.length) return undefined;
  const unseen = pool.filter(q => !(progress[q.id]?.attempts));
  pool = unseen.length ? unseen : [...pool].sort((a,b) =>
    (Date.parse(progress[a.id]?.lastAttemptDate ?? "") || 0) - (Date.parse(progress[b.id]?.lastAttemptDate ?? "") || 0),
  );
  const shuffled = shuffleQuestions(pool, random);
  const math = used.filter(id => bank.find(q => q.id === id)?.test === "Math").length;
  const rw = used.length - math;
  const preferred = math > rw ? "Reading and Writing" : rw > math ? "Math" : undefined;
  return preferred ? shuffled.find(q => q.test === preferred) ?? shuffled[0] : shuffled[0];
}

export function createEndlessSession(bank: Question[], progress: ProgressMap, now = Date.now(), random = Math.random): Session {
  const first = pick(bank, progress, [], [], random);
  if (!first) throw new Error("No questions are available for Endless Practice.");
  const session = createSession([first], { test:first.test, domains:[], skills:[], difficulties:[], history:"all", count:1, randomize:false, timerMode:"none", timerSeconds:0 }, progress, now);
  return { ...session, mode:"endless", endless:{ ...base(), recent:[first.id] } };
}

export function continueEndlessSession(session: Session, bank: Question[], progress: ProgressMap, now = Date.now(), random = Math.random): Session {
  const endless = session.endless ?? base();
  let next = pick(bank, progress, session.questionIds, endless.recent, random);
  if (next) return { ...session, test:next.test, questionIds:[...session.questionIds, next.id], index:session.questionIds.length, endless:{ ...endless, recent:[...endless.recent, next.id].slice(-RECENT_LIMIT) } };
  next = pick(bank, progress, [], endless.recent, random);
  if (!next) throw new Error("No questions are available for Endless Practice.");
  return { ...createSession([next], { test:next.test, domains:[], skills:[], difficulties:[], history:"all", count:1, randomize:false, timerMode:"none", timerSeconds:0 }, progress, now), mode:"endless", endless:{ ...endless, cycles:endless.cycles+1, recent:[...endless.recent,next.id].slice(-RECENT_LIMIT) } };
}
