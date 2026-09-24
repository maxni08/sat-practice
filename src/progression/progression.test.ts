import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { emptyProgress, type Question, type Session } from "../types";
import { initializeStudy, rewardAttempt } from "../study/rewards";
import { gradeModule } from "../study/modules";
import { studyCompletion } from "../study/transitions";
import {
  CAMPAIGN,
  ASCENSION,
  generateCampaign,
  completeCampaign,
  campaignResult,
  stageLock,
  starsEarned,
} from "./campaign";
import {
  initializeProgression,
  refreshProgression,
  streak,
  dayKey,
  weekKey,
  prepareQuests,
} from "./engine";
import {
  calculateRank,
  rankMetrics,
  rankRequirements,
  RANKS,
  type RankMetrics,
} from "./rank";
const bank = JSON.parse(
  readFileSync("public/bank/questions.json", "utf8"),
) as Question[];
const now = Date.parse("2026-09-15T12:00:00Z");
const base = () =>
  initializeProgression(
    initializeStudy(bank, {}, now),
    bank,
    {},
    now,
    "America/Costa_Rica",
  );
const filled = (s: Session) => ({
  ...s,
  drafts: Object.fromEntries(
    s.questionIds.map((id) => [
      id,
      bank.find((q) => q.id === id)!.acceptedAnswers[0],
    ]),
  ),
  elapsed: Object.fromEntries(s.questionIds.map((id) => [id, 40])),
});
const graded = (s: Session) =>
  gradeModule(filled(s), bank, {}, s.startedAt + 600000).session;
describe("SAT rank", () => {
  it("has twenty attainable monotonic rank gates, no XP dependency", () => {
    expect(RANKS).toHaveLength(20);
    for (let i = 1; i < 20; i++) {
      const r = rankRequirements(i);
      expect(r.distinct).toBeLessThanOrEqual(bank.length);
      expect(r.hardEvidence ?? 0).toBeLessThanOrEqual(
        bank.filter((q) => q.difficulty === "Hard").length,
      );
      for (const [key, value] of Object.entries(rankRequirements(i - 1)))
        expect(r[key as keyof RankMetrics]).toBeGreaterThanOrEqual(value);
    }
  });
  it("blocks Easy farming even with enormous XP", () => {
    const s = base();
    s.xp = 1000000;
    const p = Object.fromEntries(
      bank
        .filter((q) => q.difficulty === "Easy")
        .map((q) => [
          q.id,
          {
            ...emptyProgress(),
            attempts: 100,
            correctAttempts: 100,
            lastResult: true,
            totalTimeSpent: 10000,
          },
        ]),
    );
    const rank = calculateRank(rankMetrics(bank, p, s));
    expect(rank.current).toBe(0);
    expect(rank.missing.some((r) => r.key === "mediumEvidence")).toBe(true);
  });
  it("reports exact missing requirements and permanent highest rank", () => {
    const m = rankMetrics(bank, {}, base());
    const r = calculateRank(m, 8);
    expect(r.current).toBe(8);
    expect(r.form).toBe(0);
    expect(r.next).toBe(9);
    expect(r.percent).toBe(0);
    expect(r.missing.find((x) => x.key === "distinct")?.target).toBe(450);
  });
  it("normalizes progress inside the current rank and resets after promotion", () => {
    const metrics = rankMetrics(bank, {}, base());
    const atRank = (rank: number) => Object.fromEntries(
      Object.keys(metrics).map((key) => [key, rankRequirements(rank)[key as keyof RankMetrics] ?? 0]),
    ) as RankMetrics;
    const silverThree = atRank(3);
    expect(calculateRank(silverThree, 3).percent).toBe(0);
    expect(calculateRank({ ...atRank(4), distinct: 100 }, 3).percent).toBe(50);
    expect(calculateRank({ ...atRank(4), distinct: 86 }, 3).percent).toBe(15);
    const promoted = calculateRank(atRank(4), 3);
    expect(promoted.current).toBe(4);
    expect(promoted.percent).toBe(0);
  });
  it("never reports 100% until every transition gate passes", () => {
    const metrics = Object.fromEntries(
      Object.keys(rankMetrics(bank, {}, base())).map((key) => [key, 10_000]),
    ) as RankMetrics;
    metrics.mediumEvidence = rankRequirements(4).mediumEvidence! - 1;
    const rank = calculateRank(metrics, 3);
    expect(rank.current).toBe(3);
    expect(rank.percent).toBeLessThan(100);
    expect(rank.missing.map((item) => item.key)).toContain("mediumEvidence");
  });
  it("records every intermediate promotion during a multi-rank jump", () => {
    const study = base();
    study.progression!.rank.highest = 0;
    study.progression!.rank.history = [study.progression!.rank.history[0]];
    const progress = Object.fromEntries(bank.slice(0, 220).map((question) => [question.id, {
      ...emptyProgress(), attempts: 1, correctAttempts: 1, lastResult: true,
      totalTimeSpent: 10, lastAttemptDate: new Date(now).toISOString(),
    }]));
    const next = refreshProgression(study, bank, progress, now + 1);
    const reached = next.progression!.rank.highest;
    expect(reached).toBeGreaterThan(1);
    expect(next.progression!.rank.history.slice(-reached).map((entry) => entry.rank)).toEqual(
      Array.from({ length: reached }, (_, index) => index + 1),
    );
    expect(next.progression!.rank.previous).toBe(reached - 1);
  });
  it("reaches Grandmaster only when every evidence gate is met", () => {
    const m = Object.fromEntries(
      Object.keys(rankMetrics(bank, {}, base())).map((k) => [k, 4000]),
    ) as RankMetrics;
    expect(calculateRank(m).current).toBe(19);
    expect(calculateRank({ ...m, hardEvidence: 0 }).current).toBe(1);
  });
  it("backfills rank without modifying XP, keys, dates, or old state", () => {
    const old = initializeStudy(bank, {}, now);
    old.xp = 299;
    old.achievements = { "first-question": "2026-09-01" };
    const copy = structuredClone(old);
    const s = initializeProgression(old, bank, {}, now, "UTC");
    expect(old).toEqual(copy);
    expect(s.xp).toBe(299);
    expect(s.achievements).toEqual(copy.achievements);
    expect(s.progression?.stages).toEqual({});
    expect(initializeProgression(s, bank, {}, now, "UTC")).toEqual(s);
  });
});
describe("Campaign and Ascension", () => {
  it("has 96 stages, eight bosses, 288 stars and six bounded endgame tiers", () => {
    expect(CAMPAIGN).toHaveLength(96);
    expect(CAMPAIGN.filter((s) => s.boss)).toHaveLength(8);
    expect(ASCENSION).toHaveLength(6);
    expect(new Set([...CAMPAIGN, ...ASCENSION].map((s) => s.id)).size).toBe(
      102,
    );
  });
  it("generates every real-bank stage and ascension with exact feasible quotas and perfect stars", () => {
    let s = base();
    for (const rule of [...CAMPAIGN, ...ASCENSION]) {
      const session = generateCampaign(
        bank,
        {},
        s,
        rule.id,
        `all-${rule.id}`,
        now,
      );
      expect(session.questionIds).toHaveLength(rule.count);
      expect(session.answers).toEqual({});
      const done = graded(session);
      expect(campaignResult(done, bank, now + 600000).stars).toBe(3);
      s = completeCampaign(s, done, bank, now + 600000);
    }
    expect(starsEarned(s.progression)).toBe(288);
  }, 20000);
  it("requires sequence and regional bonus stars before bosses", () => {
    const s = base();
    expect(() =>
      generateCampaign(bank, {}, s, CAMPAIGN[1].id, "locked", now),
    ).toThrow(/previous/);
    expect(stageLock(ASCENSION[0], s.progression)).toMatch(/96/);
    for (const r of CAMPAIGN.slice(0, 11))
      s.progression!.stages[r.id] = {
        stars: 1,
        attempts: 1,
        best: {
          id: r.id,
          stage: r.id,
          questionIds: [],
          date: "",
          correct: 1,
          total: 1,
          seconds: 1,
          stars: 1,
        },
      };
    expect(stageLock(CAMPAIGN[11], s.progression)).toMatch(/18 stars/);
  });
  it("excludes the last two regional sets and attaches only personal ghost data", () => {
    let s = base();
    const seen: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const session = generateCampaign(
        bank,
        {},
        s,
        CAMPAIGN[0].id,
        `repeat-${i}`,
        now,
      );
      expect(session.questionIds.some((id) => seen.flat().includes(id))).toBe(
        false,
      );
      if (i) expect(session.ghost?.correct).toBe(8);
      seen.push(session.questionIds);
      s = completeCampaign(s, graded(session), bank, now + 600000);
    }
    expect(s.progression!.stages[CAMPAIGN[0].id].attempts).toBe(3);
  });
  it("awards no stars for rushing, forged difficulty, wrong domains, unfinished or overtime", () => {
    const s = base(),
      session = generateCampaign(bank, {}, s, CAMPAIGN[0].id, "invalid", now),
      done = graded(session);
    expect(
      campaignResult({ ...done, finished: false }, bank, now + 600000).stars,
    ).toBe(0);
    expect(campaignResult(done, bank, now + 1000).stars).toBe(0);
    expect(
      campaignResult(done, bank, now + session.timerSeconds * 1000 + 2000)
        .stars,
    ).toBe(0);
    const bad = {
      ...done,
      questionIds: [
        bank.find((q) => q.test !== "Math")!.id,
        ...done.questionIds.slice(1),
      ],
    };
    expect(campaignResult(bad, bank, now + 600000).stars).toBe(0);
  });
  it("keeps stars permanent and completions idempotent across JSON restart", () => {
    const s = base(),
      session = generateCampaign(bank, {}, s, CAMPAIGN[0].id, "once", now),
      done = graded(session);
    let next = completeCampaign(s, done, bank, now + 600000);
    const copy = JSON.parse(JSON.stringify(next));
    expect(completeCampaign(copy, done, bank, now + 600000)).toEqual(copy);
    const retry = generateCampaign(
      bank,
      {},
      next,
      CAMPAIGN[0].id,
      "fail",
      now + 700000,
    );
    next = completeCampaign(
      next,
      { ...retry, finished: true },
      bank,
      now + 800000,
    );
    expect(next.progression!.stages[CAMPAIGN[0].id].stars).toBe(3);
  });
  it("uses existing deferred grading without counting campaign as a Practice Module", () => {
    const s = base(),
      session = generateCampaign(bank, {}, s, CAMPAIGN[0].id, "flow", now);
    expect(session.answers).toEqual({});
    const done = studyCompletion(filled(session), bank, {}, s, now + 600000);
    expect(done.session.campaign?.stars).toBe(3);
    expect(done.study.modules).toHaveLength(0);
    expect(Object.keys(done.session.answers)).toHaveLength(8);
    expect(done.study.progression!.stages[CAMPAIGN[0].id].best.correct).toBe(8);
  });
});
describe("quests, streak and records", () => {
  it("creates stable needs-based daily/weekly objectives", () => {
    const s = base(),
      p = s.progression!;
    expect(Object.keys(p.quests)).toHaveLength(4);
    const before = structuredClone(p.quests);
    s.reviews = {
      a: { dueAt: "2020-01-01", streak: 0, misses: 1, lastAt: "" },
      b: { dueAt: "2020-01-01", streak: 0, misses: 1, lastAt: "" },
    };
    prepareQuests(p, s, now);
    expect(p.quests).toEqual(before);
    prepareQuests(p, s, now + 86400000);
    expect(Object.values(p.quests).some((q) => q.kind === "repairs")).toBe(
      true,
    );
  });
  it("pays XP only once, persists and never pays historical backfill", () => {
    let s = base();
    const p = s.progression!,
      day = dayKey(now, p.timeZone);
    p.days[day] = {
      questions: Array.from({ length: 15 }, (_, i) => String(i)),
      hard: [],
      repairs: [],
      modules: [],
      sessions: [],
      improved: [],
    };
    const old = s.xp;
    s = refreshProgression(s, bank, {}, now);
    expect(s.xp).toBe(old + 15);
    const again = refreshProgression(
      JSON.parse(JSON.stringify(s)),
      bank,
      {},
      now + 1000,
    );
    expect(again.xp).toBe(s.xp);
    expect(again.progression!.quests).toEqual(s.progression!.quests);
  });
  it("blocks immediate repetition and previously credited Easy quest farming", () => {
    let s = base();
    const q = bank.find((q) => q.difficulty === "Easy")!,
      previous = {
        [q.id]: {
          ...emptyProgress(),
          attempts: 1,
          lastResult: true,
          lastAttemptDate: new Date(now - 86400000).toISOString(),
        },
      };
    s.credits[q.id] = { base: true, correction: false };
    s = rewardAttempt(
      s,
      bank,
      previous,
      previous,
      q,
      {
        answer: q.acceptedAnswers[0],
        correct: true,
        timeSpent: 40,
        submittedAt: new Date(now).toISOString(),
      },
      "custom",
      now,
    ).study;
    expect(
      Object.values(s.progression!.days).flatMap((d) => d.questions),
    ).not.toContain(q.id);
  });
  it("requires meaningful study days and respects local calendar/midnight", () => {
    const p = base().progression!;
    for (let i = 0; i < 4; i++)
      p.days[`2026-09-${12 + i}`] = {
        questions: Array.from({ length: i === 0 ? 1 : 15 }, (_, j) =>
          String(j),
        ),
        hard: [],
        repairs: [],
        modules: [],
        sessions: [],
        improved: [],
      };
    expect(streak(p, now).current).toBe(3);
    expect(streak(p, now + 2 * 86400000).current).toBe(0);
    expect(streak(p, now).longest).toBe(3);
    expect(dayKey(Date.parse("2026-09-15T02:00Z"), "America/Costa_Rica")).toBe(
      "2026-09-14",
    );
    expect(weekKey("2026-09-13")).toBe("2026-09-07");
  });
  it("establishes conservative records and survives serialization without fake history", () => {
    const s = base();
    s.trophies!.bestRun = 18;
    const next = refreshProgression(s, bank, {}, now);
    expect(next.progression!.records.correctRun.value).toBe(18);
    expect(next.progression!.notice?.title).toBe("NEW PERSONAL BEST");
    expect(next.progression!.records.mock).toBeUndefined();
    expect(
      refreshProgression(JSON.parse(JSON.stringify(next)), bank, {}, now),
    ).toEqual(next);
  });
});
