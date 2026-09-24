import type { ProgressMap, Question, Session, SessionAnswer } from "../types";
import type { StudyState } from "../study/types";
import { skillKey } from "../study/types";
import { MODULE_BLUEPRINT } from "../study/config";
import {
  ACHIEVEMENTS,
  CATALOG_VERSION,
  CORE,
  type AchievementDefinition,
} from "./catalog";
import type { TrophyLedger } from "./types";

const DAY = 86_400_000,
  INTERVAL = 6 * 3_600_000;
const date = (now: number) => new Date(now).toISOString();
const level = (xp: number) =>
  Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2));
export function newLedger(now: number, timeZone = "UTC"): TrophyLedger {
  return {
    version: 2,
    since: date(now),
    timeZone,
    questions: {},
    run: [],
    hardRun: [],
    bestRun: 0,
    bestHardRun: 0,
    repaired: {},
    firstReviews: {},
    dueRepairs: {},
    weak: {},
    sessions: [],
    sessionIds: {},
    counters: {},
    backfilled: {},
    awardedXp: {},
  };
}
function dayAt(at: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}
function ledger(study: StudyState, now: number) {
  return structuredClone(study.trophies ?? newLedger(now));
}
function observeWeak(
  t: TrophyLedger,
  study: StudyState,
  questions: Question[],
  progress: ProgressMap,
  now: number,
) {
  const ranked = Object.values(study.skills)
    .filter((s) => s.samples >= 6)
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
  const recommended = Object.values(study.skills)
    .filter((s) => s.samples > 0)
    .sort((a, b) => a.score - b.score || b.samples - a.samples)[0]?.key;
  for (const s of ranked) {
    const identity = s.key.toLowerCase();
    const mistakes = questions.filter(
      (q) =>
        skillKey(q).toLowerCase() === identity &&
        (progress[q.id]?.incorrectAttempts ?? 0) > 0,
    ).length;
    if (s.state === "Weak" && mistakes >= 3 && !t.weak[identity])
      t.weak[identity] = {
        at: date(now),
        lowest: identity === ranked[0]?.key.toLowerCase(),
        recommended: identity === recommended?.toLowerCase(),
      };
    const w = t.weak[identity];
    if (!w) continue;
    if (identity === recommended?.toLowerCase()) w.recommended = true;
    if ((s.state === "Strong" || s.state === "Mastered") && !w.strong)
      w.strong = date(now);
    if (s.state === "Mastered" && !w.mastered) w.mastered = date(now);
  }
}
export function recordAchievementAttempt(
  result: StudyState,
  before: StudyState,
  questions: Question[],
  previous: ProgressMap,
  next: ProgressMap,
  q: Question,
  answer: SessionAnswer,
  mode: string,
  now: number,
): StudyState {
  const t = ledger(before, now),
    p = previous[q.id];
  observeWeak(t, before, questions, previous, now);
  const old = t.questions[q.id] ?? {
    lastAt: p?.lastAttemptDate ? Date.parse(p.lastAttemptDate) : 0,
    misses: 0,
    reviewTries: 0,
    known: !p?.attempts,
    recoveryRun: 0,
  };
  const lastAt = Math.max(
    old.lastAt,
    Date.parse(p?.lastAttemptDate ?? "") || 0,
  );
  const eligible = !lastAt || now - lastAt >= INTERVAL;
  if (!answer.correct) {
    t.run = [];
    t.hardRun = [];
  }
  if (eligible) {
    if (answer.correct) {
      if (!t.run.includes(q.id)) t.run = [...t.run, q.id].slice(-25);
      if (q.difficulty === "Hard") {
        if (!t.hardRun.includes(q.id))
          t.hardRun = [...t.hardRun, q.id].slice(-10);
      } else t.hardRun = [];
      t.bestRun = Math.max(t.bestRun, t.run.length);
      t.bestHardRun = Math.max(t.bestHardRun, t.hardRun.length);
      if (p?.lastResult === false && p.incorrectAttempts > 0)
        t.repaired[q.id] ??= date(now);
    } else {
      old.misses++;
      old.recoveryRun = 0;
    }
    const due =
      before.reviews[q.id] && Date.parse(before.reviews[q.id].dueAt) <= now;
    if (due) {
      if (answer.correct) {
        t.dueRepairs[q.id] = date(now);
        if (old.known && old.reviewTries === 0 && old.misses > 0)
          t.firstReviews[q.id] ??= date(now);
        if (old.misses >= 3) {
          old.recoveryRun++;
          if (old.recoveryRun >= 3) t.counters.longReturn = 1;
        }
        if (q.difficulty === "Hard" && old.misses >= 2)
          t.counters.hardRecovery = 1;
      }
      old.reviewTries++;
    }
    old.lastAt = now;
    t.questions[q.id] = old;
  }
  // Immediate replay never extends a streak or review count, but a mistake still breaks a run.
  observeWeak(t, result, questions, next, now);
  const times = Object.values(t.dueRepairs)
    .map(Date.parse)
    .sort((a, b) => a - b);
  for (let i = 0; i < times.length; i++)
    t.counters.weeklyRepairs = Math.max(
      t.counters.weeklyRepairs ?? 0,
      times.filter((x) => x >= times[i] && x - times[i] <= 7 * DAY).length,
    );
  return { ...result, trophies: t };
}
export function recordAchievementSession(
  study: StudyState,
  session: Session,
  questions: Question[],
  progress: ProgressMap,
  now: number,
): StudyState {
  const t = ledger(study, now);
  if (t.sessionIds[session.id]) return study;
  t.sessionIds[session.id] = true;
  const bank = session.questionIds
      .map((id) => questions.find((q) => q.id === id)!)
      .filter(Boolean),
    answers = bank.map((q) => session.answers[q.id]);
  const correct = answers.filter((a) => a?.correct).length,
    all = answers.every(Boolean),
    fresh = answers.filter((a) => a?.firstCredit).length;
  const record = study.modules.find((m) => m.id === session.id);
  const eligible =
    session.finished &&
    bank.length >= 10 &&
    all &&
    (session.mode === "module"
      ? !!record?.meaningful
      : fresh / bank.length >= 0.6) &&
    correct / bank.length >= 0.5;
  let ending = 0;
  for (let i = answers.length - 1; i >= 0 && answers[i]?.correct; i--) ending++;
  t.sessions.push({
    id: session.id,
    at: date(now),
    day: dayAt(date(now), t.timeZone),
    subject: session.test,
    mode: session.mode ?? "custom",
    count: bank.length,
    correct,
    eligible,
    hard: bank.filter((q) => q.difficulty === "Hard").length,
    hardCorrect: bank.filter(
      (q) => q.difficulty === "Hard" && session.answers[q.id]?.correct,
    ).length,
    freshHard: bank.filter(
      (q) =>
        q.difficulty === "Hard" &&
        session.answers[q.id]?.correct &&
        session.answers[q.id]?.firstCredit &&
        (progress[q.id]?.attempts ?? 0) === 1,
    ).length,
    openingWrong: answers.slice(0, 5).filter((a) => a && !a.correct).length,
    endingCorrect: ending,
  });
  return { ...study, trophies: t };
}
export function achievementMetrics(
  study: StudyState,
  questions: Question[],
  progress: ProgressMap,
  now: number,
): Record<string, number> {
  const t = study.trophies ?? newLedger(now),
    skills = Object.values(study.skills),
    modules = [...study.modules].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    ),
    valid = modules.filter(
      (m) =>
        m.meaningful &&
        m.session.finished &&
        m.session.questionIds.length === MODULE_BLUEPRINT[m.subject].count &&
        new Set(m.session.questionIds).size === m.session.questionIds.length &&
        m.answered / m.session.questionIds.length >= 0.8 &&
        m.novelFraction >= 0.5,
    );
  const sessions = t.sessions.filter((s) => s.eligible),
    has = (test: (s: (typeof sessions)[number]) => boolean) =>
      Number(sessions.some(test));
  const allSkills = (test: string) => {
    const group = skills.filter((s) => s.test === test);
    return group.length > 0 && group.every((s) => s.state === "Mastered");
  };
  const domains = [...new Set(skills.map((s) => `${s.test}::${s.domain}`))];
  const domainGroups = domains.map((d) =>
    skills.filter((s) => `${s.test}::${s.domain}` === d),
  );
  const moduleStat = valid.map((m) => {
    const total = m.session.questionIds.length,
      wall = (Date.parse(m.date) - m.session.startedAt) / 1000,
      limit = MODULE_BLUEPRINT[m.subject].seconds;
    const all = m.answered === total,
      accurate = m.accuracy >= 0.9,
      work =
        m.seconds >= total * 10 &&
        wall >= m.seconds * 0.9 &&
        m.seconds >= wall * 0.7 &&
        wall <= limit + 1;
    const last = m.session.questionIds.slice(-Math.ceil(total / 4)),
      times = last.map((id) => m.session.elapsed[id] ?? 0);
    const draftTimes = m.session.draftTimes;
    return {
      m,
      all,
      accurate,
      work,
      wall,
      limit,
      day: dayAt(m.date, t.timeZone),
      balanced:
        work &&
        times.every((x) => x >= 3) &&
        Math.max(...times) <= Math.max(20, (3 * m.seconds) / total),
      final:
        !!draftTimes &&
        m.session.questionIds
          .slice(-5)
          .filter(
            (id) =>
              m.session.answers[id]?.correct &&
              (draftTimes[id] ?? 0) >= m.session.startedAt + limit * 900,
          ).length >= 3,
    };
  });
  const sections = valid
    .filter(
      (m) =>
        m.session.module?.number === 2 && m.session.module.previousModuleId,
    )
    .flatMap((second) => {
      const first = valid.find(
        (m) => m.id === second.session.module?.previousModuleId,
      );
      if (
        !first ||
        !first.session.module?.sectionId ||
        first.session.module.sectionId !== second.session.module?.sectionId ||
        first.subject !== second.subject ||
        first.session.questionIds.some((id) =>
          second.session.questionIds.includes(id),
        ) ||
        Date.parse(first.date) > second.session.startedAt
      )
        return [];
      return [
        {
          subject: second.subject,
          day: dayAt(second.date, t.timeZone),
          accuracy:
            (first.score + second.score) /
            (first.session.questionIds.length +
              second.session.questionIds.length),
          at: second.date,
        },
      ];
    });
  let run90 = 0,
    best90 = 0,
    runFull = 0,
    bestFull = 0;
  for (const m of modules) {
    run90 = m.meaningful && m.accuracy >= 0.9 ? run90 + 1 : 0;
    runFull =
      m.meaningful && m.answered === m.session.questionIds.length
        ? runFull + 1
        : 0;
    best90 = Math.max(best90, run90);
    bestFull = Math.max(bestFull, runFull);
  }
  const bySubject = (test: string) =>
      sections.filter((s) => s.subject === test),
    maxAccuracy = (test: string) =>
      Math.max(0, ...bySubject(test).map((s) => s.accuracy * 100));
  const hardSkills = [...new Set(questions.map(skillKey))].some((k) => {
    const qs = questions
      .filter(
        (q) =>
          skillKey(q) === k &&
          q.difficulty === "Hard" &&
          progress[q.id]?.attempts &&
          now - Date.parse(progress[q.id].lastAttemptDate ?? "") <= 30 * DAY,
      )
      .sort((a, b) =>
        (progress[b.id].lastAttemptDate ?? "").localeCompare(
          progress[a.id].lastAttemptDate ?? "",
        ),
      )
      .slice(0, 20);
    return (
      qs.length === 20 &&
      qs.filter((q) => progress[q.id].lastResult).length >= 18
    );
  });
  const corrections = new Set([
    ...Object.keys(t.repaired),
    ...Object.keys(study.credits).filter((id) => study.credits[id].correction),
  ]).size;
  return {
    ...study.milestones,
    ...t.counters,
    attempted: questions.filter((q) => progress[q.id]?.attempts > 0).length,
    correct: questions.filter((q) => progress[q.id]?.correctAttempts > 0)
      .length,
    hard: questions.filter(
      (q) => q.difficulty === "Hard" && progress[q.id]?.correctAttempts > 0,
    ).length,
    corrections,
    modules: valid.length,
    perfectModules: valid.filter((m) => m.accuracy === 1).length,
    mathModules: valid.filter((m) => m.subject === "Math").length,
    readingModules: valid.filter((m) => m.subject !== "Math").length,
    mastered: Object.values(study.skillAwards).filter((s) => s.mastered).length,
    level: level(study.xp),
    streak: t.bestRun,
    hardStreak: t.bestHardRun,
    firstReviews: Object.keys(t.firstReviews).length,
    perfectMath15: has(
      (s) => s.subject === "Math" && s.count >= 15 && s.correct === s.count,
    ),
    perfectReading15: has(
      (s) => s.subject !== "Math" && s.count >= 15 && s.correct === s.count,
    ),
    session95: has((s) => s.count >= 25 && s.correct / s.count >= 0.95),
    sessions90: sessions.filter(
      (s) => s.count >= 15 && s.correct / s.count >= 0.9,
    ).length,
    hardSession: has(
      (s) => s.count >= 20 && s.hard === s.count && s.correct / s.count >= 0.85,
    ),
    hardSkill: Number(hardSkills),
    weakStrong: Object.values(t.weak).filter((w) => w.strong).length,
    weakMastered: Object.values(t.weak).filter((w) => w.mastered).length,
    guidedStrong: Object.values(t.weak).filter((w) => w.recommended && w.strong)
      .length,
    guidedMastered: Object.values(t.weak).filter(
      (w) => w.recommended && w.mastered,
    ).length,
    mathDomains: domainGroups.filter(
      (g) => g[0]?.test === "Math" && g.every((s) => s.state === "Mastered"),
    ).length,
    readingDomains: domainGroups.filter(
      (g) => g[0]?.test !== "Math" && g.every((s) => s.state === "Mastered"),
    ).length,
    strongDomains: domainGroups.filter((g) =>
      g.some((s) => s.state === "Strong" || s.state === "Mastered"),
    ).length,
    allStrong: Number(
      skills.length > 0 &&
        skills.every((s) => s.state === "Strong" || s.state === "Mastered"),
    ),
    masterMath: Number(allSkills("Math")),
    masterReading: Number(allSkills("Reading and Writing")),
    masterAll: Number(
      skills.length > 0 && skills.every((s) => s.state === "Mastered"),
    ),
    perfectMathModule: valid.filter(
      (m) => m.subject === "Math" && m.score === 22 && m.answered === 22,
    ).length,
    perfectReadingModule: valid.filter(
      (m) => m.subject !== "Math" && m.score === 27 && m.answered === 27,
    ).length,
    moduleRun90: best90,
    moduleRunFull: bestFull,
    modules95: valid.filter((m) => m.accuracy >= 0.95).length,
    moduleConsistency:
      Number(best90 >= 5) +
      Number(bestFull >= 10) +
      Number(valid.filter((m) => m.accuracy >= 0.95).length >= 5),
    mathSections: bySubject("Math").length,
    readingSections: bySubject("Reading and Writing").length,
    mathSectionAccuracy: maxAccuracy("Math"),
    readingSectionAccuracy: maxAccuracy("Reading and Writing"),
    perfectMathSection: Number(maxAccuracy("Math") === 100),
    perfectReadingSection: Number(maxAccuracy("Reading and Writing") === 100),
    pace90: Number(
      moduleStat.some(
        (s) => s.all && s.accurate && s.work && s.wall <= s.limit * 0.9,
      ),
    ),
    measuredPace: Number(
      moduleStat.some(
        (s) => s.all && s.accurate && s.work && s.wall <= s.limit * 0.8,
      ),
    ),
    lastMinute: Number(
      moduleStat.some(
        (s) =>
          s.all &&
          s.accurate &&
          s.work &&
          s.limit - s.wall >= 0 &&
          s.limit - s.wall <= 30,
      ),
    ),
    balancedFinish: Number(
      moduleStat.some((s) => s.all && s.accurate && s.balanced),
    ),
    finalFive: Number(
      moduleStat.some((s) => s.all && s.accurate && s.work && s.final),
    ),
    adaptiveSessions: sessions.filter((s) => s.mode === "adaptive").length,
    adaptive90: has(
      (s) =>
        s.mode === "adaptive" && s.count >= 20 && s.correct / s.count >= 0.9,
    ),
    studyDays: new Set(sessions.map((s) => s.day)).size,
    lowestMastered: Number(
      Object.values(t.weak).some((w) => w.lowest && w.mastered),
    ),
    sameDayPerfectModules: Number(
      moduleStat.some(
        (a) =>
          a.m.accuracy === 1 &&
          moduleStat.some(
            (b) =>
              b.m.subject !== a.m.subject &&
              b.day === a.day &&
              b.m.accuracy === 1,
          ),
      ),
    ),
    sameDaySections: Number(
      sections.some(
        (a) =>
          a.accuracy >= 0.9 &&
          sections.some(
            (b) =>
              a.day === b.day && a.subject !== b.subject && b.accuracy >= 0.9,
          ),
      ),
    ),
    firstHard: has(
      (s) => s.count >= 20 && s.freshHard >= 15 && s.correct / s.count >= 0.95,
    ),
    comeback: has(
      (s) =>
        s.count >= 25 &&
        s.openingWrong >= 2 &&
        s.endingCorrect >= 10 &&
        s.correct / s.count >= 0.9 &&
        s.freshHard >= 5,
    ),
    platinum: CORE.filter(
      (a) => a.countsTowardPlatinum && study.achievements[a.id],
    ).length,
  };
}
function provenDate(a: AchievementDefinition, study: StudyState, now: number) {
  if (
    a.metric === "modules" ||
    a.metric === "perfectMathModule" ||
    a.metric === "perfectReadingModule"
  ) {
    const ms = study.modules
      .filter(
        (m) =>
          m.meaningful &&
          (a.metric === "modules" ||
            (a.metric === "perfectMathModule"
              ? m.subject === "Math" && m.score === 22
              : m.subject !== "Math" && m.score === 27)),
      )
      .sort((x, y) => x.date.localeCompare(y.date));
    return ms[a.goal - 1]?.date ?? date(now);
  }
  return date(now);
}
export function evaluateAchievements(
  study: StudyState,
  questions: Question[],
  progress: ProgressMap,
  now: number,
  _legacy?: Record<string, number>,
  backfill = false,
  catalog = ACHIEVEMENTS,
): StudyState {
  let result = {
    ...study,
    achievements: { ...study.achievements },
    trophies: ledger(study, now),
  };
  for (let pass = 0; pass < catalog.length; pass++) {
    let changed = false;
    const metrics = achievementMetrics(result, questions, progress, now);
    for (const a of catalog) {
      if (result.achievements[a.id]) continue;
      const value =
        a.id === "platinum"
          ? catalog.filter(
              (x) =>
                x.countsTowardPlatinum &&
                !x.secret &&
                result.achievements[x.id],
            ).length
          : (metrics[a.metric] ?? 0);
      const goal =
        a.id === "platinum"
          ? catalog.filter((x) => x.countsTowardPlatinum && !x.secret).length
          : a.goal;
      if (value < goal) continue;
      result.achievements[a.id] = backfill
        ? provenDate(a, result, now)
        : date(now);
      if (backfill && result.achievements[a.id] === date(now))
        result.trophies.backfilled[a.id] = true;
      // A catalog upgrade acknowledges proven accomplishments without changing
      // existing XP or levels. The persisted unlock consumes eligibility even when
      // no reward is issued; only a new live unlock can award XP.
      if (!backfill && a.xpReward > 0 && !result.trophies.awardedXp[a.id]) {
        result.xp += a.xpReward;
        result.trophies.awardedXp[a.id] = a.xpReward;
      }
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}
export function upgradeAchievements(
  study: StudyState,
  questions: Question[],
  progress: ProgressMap,
  now: number,
  timeZone = "UTC",
): StudyState {
  if (study.trophies?.version === CATALOG_VERSION) return study;
  const t = newLedger(now, timeZone);
  observeWeak(t, study, questions, progress, now);
  let result: StudyState = { ...study, trophies: t };
  // Only saved module responses establish past sessions; aggregate counters cannot prove streaks, timing of reviews or weakness transitions.
  for (const m of [...study.modules].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    result = recordAchievementSession(
      result,
      m.session,
      questions,
      progress,
      Date.parse(m.date),
    );
  }
  return evaluateAchievements(
    result,
    questions,
    progress,
    now,
    undefined,
    true,
  );
}
export function completion(study: StudyState) {
  const core = CORE.filter((a) => study.achievements[a.id]).length,
    secrets = ACHIEVEMENTS.filter(
      (a) => a.secret && study.achievements[a.id],
    ).length,
    required = CORE.filter((a) => a.countsTowardPlatinum);
  return {
    core,
    total: CORE.length,
    secrets,
    secretTotal: ACHIEVEMENTS.length - CORE.length,
    percent: Math.round((core / CORE.length) * 100),
    platinum: Math.floor(
      (required.filter((a) => study.achievements[a.id]).length /
        required.length) *
        100,
    ),
  };
}
