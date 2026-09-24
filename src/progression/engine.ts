import type { ProgressMap, Question, Session, SessionAnswer } from "../types";
import type { StudyState } from "../study/types";
import type { Day, Progression, Quest } from "./types";
import { calculateRank, RANKS, rankMetrics, validModules } from "./rank";
import { CAMPAIGN, starsEarned } from "./campaign";
import { estimateSAT } from "../study/scoreEstimate";
const DAY = 86400000,
  INTERVAL = 6 * 3600000;
export function dayKey(at: number, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function weekKey(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const emptyDay = (): Day => ({
  questions: [],
  hard: [],
  repairs: [],
  modules: [],
  sessions: [],
  improved: [],
});
const add = (xs: string[], id: string) => {
  if (!xs.includes(id)) xs.push(id);
};
function questValue(p: Progression, q: Quest) {
  const weekly = q.id.startsWith("week:");
  return new Set(
    Object.entries(p.days)
      .filter(([d]) => (weekly ? weekKey(d) === q.period : d === q.period))
      .flatMap(([, v]) => v[q.kind]),
  ).size;
}
export function prepareQuests(
  p: Progression,
  s: StudyState,
  now: number,
  backfill = false,
) {
  const day = dayKey(now, p.timeZone),
    week = weekKey(day);
  const due = Object.values(s.reviews).filter(
    (r) => Date.parse(r.dueAt) <= now,
  ).length;
  const weak = Object.values(s.skills).some(
    (v) => v.samples >= 5 && v.state === "Weak",
  );
  const specs: [string, string, Quest["kind"], number, number][] = [
    ["day", day, "questions", 15, 15],
    ["day", day, due >= 2 ? "repairs" : "hard", due >= 2 ? 2 : 5, 20],
    ["week", week, "questions", 100, 50],
    ["week", week, weak ? "improved" : "modules", weak ? 1 : 2, 50],
  ];
  for (const [type, period, kind, target, xp] of specs) {
    // Freeze each period's needs-based objectives once created.
    const slot = `${type}:${period}:${type === "day" ? (kind === "questions" ? 0 : 1) : kind === "questions" ? 0 : 1}`;
    if (!p.quests[slot]) {
      const q: Quest = {
        id: slot,
        period,
        kind,
        target,
        xp,
        offset: 0,
        progress: 0,
      };
      q.offset = backfill ? questValue(p, q) : 0;
      p.quests[slot] = q;
    }
  }
}
export function streak(p: Progression, now: number) {
  const days = Object.entries(p.days)
    .filter(
      ([, d]) =>
        d.questions.length >= 15 ||
        d.modules.length > 0 ||
        d.sessions.length > 0,
    )
    .map(([d]) => d)
    .sort();
  let longest = 0,
    run = 0,
    previous = "";
  for (const d of days) {
    run =
      previous && Date.parse(d) - Date.parse(previous) === DAY ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = d;
  }
  const today = dayKey(now, p.timeZone),
    gap = (Date.parse(today) - Date.parse(previous)) / DAY;
  return {
    current: gap <= 1 ? run : 0,
    longest,
    milestones: [3, 7, 14, 30, 60, 100],
    qualified: days,
  };
}
export const RECORD_LABELS: Record<string, string> = {
  correctRun: "Longest correct streak",
  hardRun: "Longest Hard streak",
  mathModule: "Best Math module (%)",
  readingModule: "Best Reading & Writing module (%)",
  mock: "Best estimated SAT mock",
  fastModule: "Fastest ≥90% module (seconds)",
  dailyQuestions: "Most distinct questions in a day",
  dailyHard: "Most Hard correct in a day",
  weeklyRepairs: "Most mistakes repaired in a week",
  stage: "Campaign stages cleared",
  stars: "Campaign stars",
};
function records(s: StudyState, p: Progression, now: number, silent: boolean) {
  const ms = validModules(s),
    max = (a: number[]) => Math.max(0, ...a);
  const mocks = [
    ...new Set(ms.map((m) => m.session.mock?.id).filter(Boolean)),
  ].flatMap((id) => {
    const group = ms
      .filter((m) => m.session.mock?.id === id)
      .sort((a, b) => a.session.mock!.stage - b.session.mock!.stage);
    if (
      group.length !== 4 ||
      !group.every((m, i) => m.session.mock!.stage === i) ||
      new Set(group.flatMap((m) => m.session.questionIds)).size !== 98
    )
      return [];
    return [
      estimateSAT(
        group[0].score + group[1].score,
        group[2].score + group[3].score,
      ).total.midpoint,
    ];
  });
  const weeks = [...new Set(Object.keys(p.days).map(weekKey))];
  const values: Record<string, number> = {
    correctRun: s.trophies?.bestRun ?? 0,
    hardRun: s.trophies?.bestHardRun ?? 0,
    mathModule: max(
      ms.filter((m) => m.subject === "Math").map((m) => m.accuracy * 100),
    ),
    readingModule: max(
      ms.filter((m) => m.subject !== "Math").map((m) => m.accuracy * 100),
    ),
    mock: max(mocks),
    dailyQuestions: max(Object.values(p.days).map((d) => d.questions.length)),
    dailyHard: max(Object.values(p.days).map((d) => d.hard.length)),
    weeklyRepairs: max(
      weeks.map(
        (w) =>
          new Set(
            Object.entries(p.days)
              .filter(([d]) => weekKey(d) === w)
              .flatMap(([, v]) => v.repairs),
          ).size,
      ),
    ),
    stage: CAMPAIGN.filter((st) => (p.stages[st.id]?.stars ?? 0) > 0).length,
    stars: starsEarned(p),
  };
  const fast = ms
    .filter(
      (m) => m.accuracy >= 0.9 && m.answered === m.session.questionIds.length,
    )
    .map((m) => m.seconds);
  if (fast.length) values.fastModule = Math.min(...fast);
  for (const [id, value] of Object.entries(values)) {
    const old = p.records[id];
    if (
      value > 0 &&
      (!old || (id === "fastModule" ? value < old.value : value > old.value))
    ) {
      p.records[id] = { value, at: new Date(now).toISOString() };
      if (!silent && !p.notice)
        p.notice = {
          id: `record:${now}:${id}`,
          title: "NEW PERSONAL BEST",
          detail: `${RECORD_LABELS[id]}: ${Math.round(value)}`,
        };
    }
  }
}
export function refreshProgression(
  study: StudyState,
  bank: Question[],
  progress: ProgressMap,
  now: number,
  silent = false,
): StudyState {
  if (!study.progression) return study;
  const p = structuredClone(study.progression);
  let xp = study.xp;
  prepareQuests(p, study, now, silent);
  const today = dayKey(now, p.timeZone),
    week = weekKey(today);
  for (const q of Object.values(p.quests)) {
    q.progress = Math.max(
      q.progress,
      Math.min(q.target, Math.max(0, questValue(p, q) - q.offset)),
    );
    if (
      !silent &&
      !q.paidAt &&
      q.progress >= q.target &&
      (q.id.startsWith("day:") ? q.period === today : q.period === week)
    ) {
      q.paidAt = new Date(now).toISOString();
      xp += q.xp;
    }
  }
  records(study, p, now, silent);
  const rank = calculateRank(
    rankMetrics(bank, progress, { ...study, progression: p }),
    p.rank.highest,
  );
  if (rank.current > p.rank.highest) {
    const old = p.rank.highest;
    for (let promoted = old + 1; promoted <= rank.current; promoted++) {
      p.rank.previous = promoted - 1;
      p.rank.highest = promoted;
      p.rank.history.push({
        rank: promoted,
        at: new Date(now).toISOString(),
        backfilled: silent || undefined,
      });
    }
    if (!silent)
      p.notice = {
        id: `rank:${now}:${rank.current}`,
        title: "RANK UP",
        detail: `${RANKS[old]} → ${RANKS[rank.current]}`,
      };
  }
  return { ...study, xp, progression: p };
}
export function initializeProgression(
  study: StudyState,
  bank: Question[],
  progress: ProgressMap,
  now: number,
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): StudyState {
  if (study.progression)
    return refreshProgression(study, bank, progress, now, true);
  const p: Progression = {
    version: 1,
    since: new Date(now).toISOString(),
    timeZone: zone,
    rank: {
      highest: 0,
      previous: 0,
      history: [{ rank: 0, at: new Date(now).toISOString(), backfilled: true }],
    },
    stages: {},
    runs: [],
    days: {},
    quests: {},
    records: {},
  };
  for (const q of bank) {
    let last = -Infinity;
    for (const e of [...(study.evidence[q.id] ?? [])].sort((a, b) =>
      a.at.localeCompare(b.at),
    )) {
      const at = Date.parse(e.at);
      if (e.seconds < 3 || !Number.isFinite(at) || at - last < INTERVAL)
        continue;
      last = at;
      const d = (p.days[dayKey(at, zone)] ??= emptyDay());
      add(d.questions, q.id);
      if (e.correct && q.difficulty === "Hard") add(d.hard, q.id);
    }
  }
  for (const [id, date] of Object.entries(study.trophies?.dueRepairs ?? {})) {
    const d = (p.days[dayKey(Date.parse(date), zone)] ??= emptyDay());
    add(d.repairs, id);
  }
  for (const m of validModules(study)) {
    const d = (p.days[dayKey(Date.parse(m.date), zone)] ??= emptyDay());
    add(d.modules, m.id);
  }
  for (const s of study.trophies?.sessions ?? [])
    if (s.eligible && s.count >= 15 && s.correct / s.count >= 0.5) {
      const d = (p.days[dayKey(Date.parse(s.at), zone)] ??= emptyDay());
      add(d.sessions, s.id);
    }
  return refreshProgression(
    { ...study, progression: p },
    bank,
    progress,
    now,
    true,
  );
}
export function progressionAttempt(
  result: StudyState,
  before: StudyState,
  previous: ProgressMap,
  q: Question,
  answer: SessionAnswer,
  bank: Question[],
  next: ProgressMap,
  now: number,
): StudyState {
  if (!result.progression) return result;
  const p = structuredClone(result.progression);
  p.notice = undefined;
  prepareQuests(p, before, now);
  const last = previous[q.id]?.lastAttemptDate;
  if (answer.timeSpent >= 3 && (!last || now - Date.parse(last) >= INTERVAL)) {
    const d = (p.days[dayKey(now, p.timeZone)] ??= emptyDay());
    if (!(q.difficulty === "Easy" && before.credits[q.id]?.base))
      add(d.questions, q.id);
    if (answer.correct && q.difficulty === "Hard") add(d.hard, q.id);
    const review = before.reviews[q.id];
    if (
      answer.correct &&
      review &&
      Date.parse(review.dueAt) <= now &&
      previous[q.id]?.incorrectAttempts > 0
    )
      add(d.repairs, q.id);
    for (const [key, w] of Object.entries(result.trophies?.weak ?? {}))
      if (w.strong && !before.trophies?.weak[key]?.strong) add(d.improved, key);
  }
  return refreshProgression({ ...result, progression: p }, bank, next, now);
}
export function progressionCompletion(
  study: StudyState,
  session: Session,
  bank: Question[],
  progress: ProgressMap,
  now: number,
): StudyState {
  if (!study.progression) return study;
  const p = structuredClone(study.progression),
    d = (p.days[dayKey(now, p.timeZone)] ??= emptyDay());
  const module = validModules(study).find((m) => m.id === session.id);
  if (module) add(d.modules, module.id);
  const answers = Object.values(session.answers);
  if (
    session.finished &&
    session.questionIds.length >= 15 &&
    answers.length === session.questionIds.length &&
    answers.filter((a) => a.firstCredit && a.timeSpent >= 3).length >=
      Math.ceil(answers.length * 0.6) &&
    answers.filter((a) => a.correct).length / answers.length >= 0.5
  )
    add(d.sessions, session.id);
  return refreshProgression({ ...study, progression: p }, bank, progress, now);
}
