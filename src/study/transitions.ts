import type { ProgressMap, Question, Session } from "../types";
import { submitSessionAnswer } from "../lib/session";
import { adaptRemaining } from "./adaptive";
import { gradeModule, sectionSession } from "./modules";
import { rewardAttempt, rewardCompletion, unlockAchievements } from "./rewards";
import type { StudyState } from "./types";
import { completeMock } from './mock';
import { completeChallenge } from './ladder';
import { completeCampaign } from '../progression/campaign';
import { progressionCompletion } from '../progression/engine';

export function studySubmission(
  current: Session,
  q: Question,
  questions: Question[],
  progress: ProgressMap,
  study: StudyState,
  now: number,
) {
  if (current.mode === "module")
    throw new Error("Module answers are graded only when the module finishes.");
  const result = submitSessionAnswer(
    current,
    q,
    current.drafts[q.id] ?? "",
    progress[q.id],
    new Date(now).toISOString(),
  );
  const nextProgress = { ...progress, [q.id]: result.progress };
  if (current.mode === "endless") {
    const prior = current.endless ?? { answered: 0, correct: 0, hardCorrect: 0, streak: 0, activeSeconds: 0, recent: [], cycles: 1 };
    const correct = result.session.answers[q.id].correct;
    result.session.endless = {
      ...prior,
      answered: prior.answered + 1,
      correct: prior.correct + Number(correct),
      hardCorrect: prior.hardCorrect + Number(correct && q.difficulty === "Hard"),
      streak: correct ? prior.streak + 1 : 0,
      activeSeconds: prior.activeSeconds + result.session.answers[q.id].timeSpent,
    };
  }
  const award = rewardAttempt(
    study,
    questions,
    progress,
    nextProgress,
    q,
    result.session.answers[q.id],
    current.mode ?? "custom",
    now,
  );
  result.session.answers[q.id] = {
    ...result.session.answers[q.id],
    xpAwarded: award.xp,
    firstCredit: award.firstCredit,
  };
  const session = adaptRemaining(
    result.session,
    { questions, progress: nextProgress, study: award.study, now },
    result.session.answers[q.id].correct,
  );
  const nextStudy = { ...award.study, revision: study.revision + 1 };
  if (session.adaptive)
    nextStudy.adaptive = {
      ...nextStudy.adaptive,
      [session.test]: {
        level: session.adaptive.level,
        correctRun: session.adaptive.correctRun,
        recent: session.adaptive.recent,
      },
    };
  return {
    study: nextStudy,
    session,
    progress: nextProgress,
    updates: { [q.id]: result.progress },
    eventId: `${current.id}:answer:${q.id}`,
  };
}
export function studyCompletion(
  current: Session,
  questions: Question[],
  progress: ProgressMap,
  study: StudyState,
  now: number,
) {
  if (current.finished) throw new Error("This session is already complete.");
  let session = { ...current, finished: true },
    nextStudy = study,
    nextProgress = { ...progress },
    updates: ProgressMap = {};
  if (current.mode === "module") {
    const graded = gradeModule(current, questions, progress, now);
    session = graded.session;
    updates = graded.updates;
    session.module = {
      ...session.module!,
      marked: current.questionIds.filter((id) => progress[id]?.bookmark),
    };
    for (const id of current.questionIds) {
      const answer = session.answers[id];
      if (!answer) continue;
      const previous = nextProgress;
      nextProgress = { ...nextProgress, [id]: updates[id] };
      const q = questions.find((q) => q.id === id)!;
      const award = rewardAttempt(
        nextStudy,
        questions,
        previous,
        nextProgress,
        q,
        answer,
        "module",
        now,
      );
      nextStudy = award.study;
      session.answers[id] = {
        ...answer,
        xpAwarded: award.xp,
        firstCredit: award.firstCredit,
      };
    }
  }
  nextStudy = rewardCompletion(
    nextStudy,
    session,
    questions,
    nextProgress,
    now,
  );
  if (
    !session.mock &&
    session.mode === "module" &&
    session.module?.number === 2 &&
    session.module.previousModuleId
  ) {
    const first = nextStudy.modules.find(
        (m) => m.id === session.module!.previousModuleId,
      ),
      second = nextStudy.modules.find((m) => m.id === session.id);
    if (first && second) session = sectionSession(first, second);
  }
  if (session.challenge) {
    nextStudy = completeChallenge(nextStudy, session, questions, now);
    session = { ...session, challenge: { ...session.challenge, passed: nextStudy.ladder!.history.find(a => a.id === session.id)!.passed } };
  }
  session = completeMock(session, nextStudy);
  nextStudy = completeCampaign(nextStudy, session, questions, now);
  if(session.campaign) session={...session,campaign:{...session.campaign,stars:nextStudy.progression?.runs.find(r=>r.id===session.id)?.stars??0}};
  nextStudy = progressionCompletion(nextStudy,session,questions,nextProgress,now);
  nextStudy = unlockAchievements(nextStudy, questions, nextProgress, now);
  return {
    study: { ...nextStudy, revision: study.revision + 1 },
    session,
    progress: nextProgress,
    updates,
    eventId: `${current.id}:complete`,
  };
}
