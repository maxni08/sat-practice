import type {
  Difficulty,
  ProgressMap,
  Question,
  Session,
  TestSection,
} from "../types";
import { createSession, recordAttempt } from "../lib/session";
import { answerMatches, isValidAnswer } from "../lib/answers";
import {
  BLUEPRINT_VERSION,
  DIFFICULTY_MIX,
  MODULE_BLUEPRINT,
  RULES,
} from "./config";
import type { BreakdownRow, ModuleRecord, StudyState } from "./types";

export function seededRandom(seed: string): () => number {
  let n = 2166136261;
  for (const char of seed) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function quotas(
  count: number,
  weights: Record<string, number>,
): Record<string, number> {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const entries = Object.entries(weights).map(([key, w], index) => ({
    key,
    raw: (count * w) / total,
    index,
  }));
  const result = Object.fromEntries(
    entries.map((x) => [x.key, Math.floor(x.raw)]),
  );
  const remaining = count - Object.values(result).reduce((a, b) => a + b, 0);
  entries
    .sort((a, b) => (b.raw % 1) - (a.raw % 1) || a.index - b.index)
    .slice(0, remaining)
    .forEach((x) => result[x.key]++);
  return result;
}
export function moduleRoute(
  correct: number,
  total: number,
): "easier" | "harder" {
  return total > 0 && correct / total >= RULES.routingThreshold
    ? "harder"
    : "easier";
}
export function generateModule(
  questions: Question[],
  test: TestSection,
  progress: ProgressMap,
  study: StudyState,
  options: {
    seed: string;
    now: number;
    route?: "balanced" | "easier" | "harder";
    sectionId?: string;
    number?: 1 | 2;
    previousModuleId?: string;
    exclude?: string[];
  },
): Session {
  const blueprint = MODULE_BLUEPRINT[test],
    route = options.route ?? "balanced",
    random = seededRandom(options.seed);
  const bank = questions.filter(
    (q) => q.test === test && !options.exclude?.includes(q.id),
  );
  const domainQuota = quotas(blueprint.count, blueprint.domains),
    difficultyQuota = quotas(blueprint.count, DIFFICULTY_MIX[route]);
  const used = new Set<string>(),
    skillCounts: Record<string, number> = {},
    selected: Question[] = [];
  const seen = new Map<string, { count: number; last: number }>();
  for (const m of study.modules)
    for (const id of m.session.questionIds) {
      const old = seen.get(id);
      seen.set(id, {
        count: (old?.count ?? 0) + 1,
        last: Math.max(old?.last ?? 0, Date.parse(m.date)),
      });
    }
  let numeric = 0;
  while (selected.length < blueprint.count) {
    const domains = Object.keys(domainQuota).filter((d) => domainQuota[d] > 0);
    const domain = domains[Math.floor(random() * domains.length)];
    const difficulties = Object.keys(difficultyQuota).filter(
      (d) => difficultyQuota[d] > 0,
    ) as Difficulty[];
    const difficulty = difficulties.sort(
      (a, b) => difficultyQuota[b] - difficultyQuota[a],
    )[0];
    const wantNumeric =
      Math.round(
        ((selected.length + 1) * blueprint.numericCount) / blueprint.count,
      ) > numeric;
    const domainSkills = new Set(
      bank.filter((q) => q.domain === domain).map((q) => q.skill),
    ).size;
    const skillCap =
      Math.ceil(
        quotas(blueprint.count, blueprint.domains)[domain] /
          Math.max(1, domainSkills),
      ) + 1;
    const pool = bank.filter(
      (q) =>
        q.domain === domain &&
        !used.has(q.id) &&
        difficultyQuota[q.difficulty] > 0,
    );
    const ranked = pool
      .map((q) => ({
        q,
        score:
          (q.difficulty === difficulty ? 0 : 100_000_000) +
          ((q.questionType === "numeric") === wantNumeric ? 0 : 10_000_000) +
          ((skillCounts[q.skill] ?? 0) >= skillCap ? 1_000_000_000 : 0) +
          (seen.get(q.id) && options.now - seen.get(q.id)!.last < 30 * RULES.day
            ? 1_000_000
            : 0) +
          (progress[q.id]?.lastAttemptDate &&
          options.now - Date.parse(progress[q.id].lastAttemptDate!) < RULES.day
            ? 100_000
            : 0) +
          (skillCounts[q.skill] ?? 0) * 10_000 +
          (seen.get(q.id)?.count ?? 0) * 1000 +
          random() * 100,
      }))
      .sort((a, b) => a.score - b.score);
    const next = ranked[0]?.q;
    if (!next)
      throw new Error(
        `The bank cannot satisfy the ${test} module blueprint for ${domain}.`,
      );
    selected.push(next);
    used.add(next.id);
    domainQuota[domain]--;
    difficultyQuota[next.difficulty]--;
    skillCounts[next.skill] = (skillCounts[next.skill] ?? 0) + 1;
    numeric += Number(next.questionType === "numeric");
  }
  // Fill the numeric quota by swapping within the same domain/difficulty cell.
  while (numeric !== blueprint.numericCount) {
    const wantNumeric = numeric < blueprint.numericCount;
    let swapped = false;
    for (let i = 0; i < selected.length; i++) {
      const old = selected[i];
      if ((old.questionType === "numeric") === wantNumeric) continue;
      const candidates = bank
        .filter(
          (q) =>
            !used.has(q.id) &&
            q.domain === old.domain &&
            q.difficulty === old.difficulty &&
            (q.questionType === "numeric") === wantNumeric,
        )
        .sort(
          (a, b) =>
            (seen.get(a.id)?.last ?? 0) - (seen.get(b.id)?.last ?? 0) ||
            (skillCounts[a.skill] ?? 0) - (skillCounts[b.skill] ?? 0),
        );
      const next = candidates[0];
      if (!next) continue;
      used.delete(old.id);
      used.add(next.id);
      selected[i] = next;
      skillCounts[old.skill]--;
      skillCounts[next.skill] = (skillCounts[next.skill] ?? 0) + 1;
      numeric += wantNumeric ? 1 : -1;
      swapped = true;
      break;
    }
    if (!swapped)
      throw new Error(
        "The bank cannot satisfy the module numeric-response quota.",
      );
  }
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  const session = createSession(
    selected,
    {
      test,
      domains: [],
      skills: [],
      difficulties: [],
      history: "all",
      count: blueprint.count,
      randomize: false,
      timerMode: "session",
      timerSeconds: blueprint.seconds,
    },
    progress,
    options.now,
  );
  session.id = options.seed;
  session.mode = "module";
  session.module = {
    blueprint: BLUEPRINT_VERSION,
    route,
    sectionId: options.sectionId,
    number: options.number ?? 1,
    previousModuleId: options.previousModuleId,
  };
  return session;
}
export function gradeModule(
  session: Session,
  questions: Question[],
  progress: ProgressMap,
  now: number,
): { session: Session; updates: ProgressMap } {
  if (session.mode !== "module")
    throw new Error("This is not a practice module.");
  if (session.finished) return { session, updates: {} };
  const answers: Session["answers"] = {},
    updates: ProgressMap = {};
  for (const id of session.questionIds) {
    const q = questions.find((q) => q.id === id);
    if (!q) throw new Error(`Missing module question ${id}`);
    const answer = (session.drafts[id] ?? "").trim();
    if (!isValidAnswer(q, answer)) continue;
    answers[id] = {
      answer,
      correct: answerMatches(q, answer),
      timeSpent: session.elapsed[id] ?? 0,
      submittedAt: new Date(now).toISOString(),
    };
    updates[id] = recordAttempt(
      q,
      answer,
      session.elapsed[id] ?? 0,
      progress[id],
      new Date(now).toISOString(),
    );
  }
  return {
    session: {
      ...session,
      finished: true,
      answers,
      module: {
        ...session.module!,
        completedAt: new Date(now).toISOString(),
        awaitingNext:
          !!session.module?.sectionId && session.module.number === 1,
      },
    },
    updates,
  };
}
export function makeModuleRecord(
  session: Session,
  questions: Question[],
  progress: ProgressMap,
  modules: ModuleRecord[],
): ModuleRecord {
  const bank = session.questionIds.map(
    (id) => questions.find((q) => q.id === id)!,
  );
  const oldIds = new Set(modules.flatMap((m) => m.session.questionIds));
  const novelFraction =
    bank.filter((q) => !oldIds.has(q.id)).length / bank.length;
  const answered = Object.keys(session.answers).length,
    score = Object.values(session.answers).filter((a) => a.correct).length;
  const breakdown = (
    key: "domain" | "skill" | "difficulty",
  ): BreakdownRow[] => {
    const rows = new Map<string, BreakdownRow>();
    for (const q of bank) {
      const row = rows.get(q[key]) ?? {
        name: q[key],
        correct: 0,
        total: 0,
        seconds: 0,
      };
      row.total++;
      row.correct += Number(session.answers[q.id]?.correct ?? false);
      row.seconds += session.elapsed[q.id] ?? 0;
      rows.set(q[key], row);
    }
    return [...rows.values()];
  };
  return {
    id: session.id,
    date: session.module?.completedAt ?? new Date().toISOString(),
    subject: session.test,
    session: structuredClone(session),
    score,
    accuracy: score / bank.length,
    answered,
    seconds: Object.values(session.elapsed).reduce((a, b) => a + b, 0),
    byDomain: breakdown("domain"),
    bySkill: breakdown("skill"),
    byDifficulty: breakdown("difficulty"),
    marked: bank.filter((q) => progress[q.id]?.bookmark).map((q) => q.id),
    meaningful: answered / bank.length >= 0.8 && novelFraction >= 0.5,
    novelFraction,
  };
}
export function sectionSession(
  first: ModuleRecord,
  second: ModuleRecord,
): Session {
  return {
    ...second.session,
    id: `section-${first.session.module?.sectionId}`,
    questionIds: [...first.session.questionIds, ...second.session.questionIds],
    drafts: { ...first.session.drafts, ...second.session.drafts },
    answers: { ...first.session.answers, ...second.session.answers },
    elapsed: { ...first.session.elapsed, ...second.session.elapsed },
    index: 0,
    module: {
      ...second.session.module!,
      awaitingNext: false,
      previousModuleId: undefined,
      sectionSummary: true,
      marked: [...first.marked, ...second.marked],
    },
  };
}
