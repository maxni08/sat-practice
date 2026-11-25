import type { ProgressMap, Question, Session } from '../types';
import type { StudyState } from './types';
import { generateModule, moduleRoute } from './modules';
import { uniqueMockBank, assertUniqueMockQuestions } from './mockIdentity';

export function generateMock(questions: Question[], progress: ProgressMap, study: StudyState, seed: string, now: number, previous?: Session): Session {
  if (previous && (!previous.mock || !previous.finished || !previous.module?.awaitingNext || previous.mock.stage >= 3))
    throw new Error('Finish the current mock module before continuing.');
  const stage = previous ? previous.mock!.stage + 1 : 0;
  const id = previous?.mock?.id ?? seed;
  const moduleIds = previous?.mock?.moduleIds ?? [];
  const test = stage < 2 ? 'Reading and Writing' : 'Math';
  const second = stage % 2 === 1;
  // The active mock carries its own exclusion ledger across saves/restarts.
  // Legacy sessions recover their ledger from module history and the current module.
  const usedQuestionIds = [...new Set([
    ...(previous?.mock?.usedQuestionIds ?? []),
    ...(previous?.questionIds ?? []),
    ...study.modules.filter(m => moduleIds.includes(m.id)).flatMap(m => m.session.questionIds),
  ])];
  const excluded = new Set([
    ...usedQuestionIds,
    ...study.modules.filter(m => m.session.mock).flatMap(m => m.session.questionIds),
  ]);
  const fresh = uniqueMockBank(questions, excluded);
  let session: Session;
  try { session = generateModule(fresh, test, progress, study, {
    seed, now, number: second ? 2 : 1, sectionId: `${id}:${test}`,
    previousModuleId: second ? previous!.id : undefined,
    route: second ? moduleRoute(Object.values(previous!.answers).filter(a => a.correct).length, previous!.questionIds.length) : 'balanced',
    exclude: [...excluded],
  }); } catch {
    throw new Error("Not enough unused mock questions to satisfy this module's blueprint. Previously used mock questions will not be silently repeated. Your progress is safe; use Custom Practice or review while more fresh questions become available.");
  }
  assertUniqueMockQuestions(questions, [...usedQuestionIds, ...session.questionIds]);
  session.mock = { id, stage, moduleIds, usedQuestionIds: [...usedQuestionIds, ...session.questionIds] };
  return session;
}
export function completeMock(session: Session, study: StudyState, questions: Question[]): Session {
  if (!session.mock) return session;
  const moduleIds = [...session.mock.moduleIds, session.id];
  if (session.mock.stage < 3) return { ...session, mock: { ...session.mock, moduleIds }, module: { ...session.module!, awaitingNext: true } };
  const modules = moduleIds.map(id => study.modules.find(m => m.id === id));
  if (modules.length !== 4 || modules.some(m => !m)) throw new Error('Incomplete mock history.');
  const sessions = modules.map(m => m!.session);
  const ids = sessions.flatMap(s => s.questionIds);
  assertUniqueMockQuestions(questions, ids);
  return {
    ...session, id: `mock-${session.mock.id}`, index: 0,
    questionIds: sessions.flatMap(s => s.questionIds),
    answers: Object.assign({}, ...sessions.map(s => s.answers)),
    drafts: Object.assign({}, ...sessions.map(s => s.drafts)),
    elapsed: Object.assign({}, ...sessions.map(s => s.elapsed)),
    mock: { ...session.mock, moduleIds, complete: true },
    module: { ...session.module!, awaitingNext: false, sectionSummary: true, marked: sessions.flatMap(s => s.module?.marked ?? []) },
  };
}
