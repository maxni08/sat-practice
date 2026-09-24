import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACHIEVEMENTS,
  CORE,
  SECRETS,
  CATEGORIES,
  visibleAchievement,
} from "./catalog";
import { LEGACY_ACHIEVEMENTS } from "./legacy";
import {
  achievementMetrics,
  evaluateAchievements,
  upgradeAchievements,
  recordAchievementAttempt,
  recordAchievementSession,
  completion,
} from "./engine";
import { initializeStudy, levelProgress } from "../study/rewards";
import {
  generateModule,
  gradeModule,
  makeModuleRecord,
} from "../study/modules";
import {
  emptyProgress,
  type Question,
  type ProgressMap,
  type SessionAnswer,
} from "../types";
import { skillKey, type StudyState } from "../study/types";
import { calculateMastery } from "../study/mastery";
import { rewardAttempt } from "../study/rewards";
const bank = JSON.parse(
  readFileSync("public/bank/questions.json", "utf8"),
) as Question[];
const now = Date.parse("2026-09-09T12:00:00Z"),
  day = 86400000,
  stamp = new Date(now).toISOString();
const base = () => initializeStudy(bank, {}, now);
const stats = (s: StudyState, p: ProgressMap = {}) =>
  achievementMetrics(s, bank, p, now);
const progress = (qs: Question[], correct = true): ProgressMap =>
  Object.fromEntries(
    qs.map((q) => [
      q.id,
      {
        ...emptyProgress(),
        attempts: 1,
        correctAttempts: Number(correct),
        incorrectAttempts: Number(!correct),
        lastResult: correct,
        lastAttemptDate: stamp,
      },
    ]),
  );
function attempt(
  s: StudyState,
  q: Question,
  correct = true,
  p: ProgressMap = {},
  at = now,
  next = s,
) {
  const answer: SessionAnswer = {
    answer: "A",
    correct,
    timeSpent: 60,
    submittedAt: new Date(at).toISOString(),
  };
  return recordAchievementAttempt(next, s, bank, p, p, q, answer, "custom", at);
}
function module(
  subject: Question["test"] = "Math",
  seed = "fixture",
  start = now,
  prior: StudyState = base(),
) {
  let session = generateModule(bank, subject, {}, prior, { seed, now: start });
  session.drafts = Object.fromEntries(
    session.questionIds.map((id) => [
      id,
      bank.find((q) => q.id === id)!.acceptedAnswers[0],
    ]),
  );
  session.elapsed = Object.fromEntries(
    session.questionIds.map((id) => [id, 60]),
  );
  session = gradeModule(
    session,
    bank,
    {},
    start + session.questionIds.length * 60000,
  ).session;
  return makeModuleRecord(session, bank, {}, prior.modules);
}
describe("achievement catalog and legacy compatibility", () => {
  it("has 64 core, 10 secrets, 74 unique IDs and every category", () => {
    expect(CORE).toHaveLength(64);
    expect(SECRETS).toHaveLength(10);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(74);
    expect(new Set(CORE.map((a) => a.category))).toEqual(new Set(CATEGORIES));
  });
  it("preserves all 24 original rules and IDs", () => {
    expect(LEGACY_ACHIEVEMENTS).toHaveLength(24);
    for (const old of LEGACY_ACHIEVEMENTS) {
      expect(ACHIEVEMENTS.find((a) => a.id === old.id)).toMatchObject(old);
    }
  });
  it("has positive attainable targets, valid artwork, and only one Platinum tier", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.goal).toBeGreaterThan(0);
      expect(a.progressTarget).toBe(a.goal);
      expect(a.rule).toBe(a.metric);
      expect(a.badge.length).toBeGreaterThan(0);
      expect(a.xpReward).toBeGreaterThanOrEqual(0);
    }
    expect(
      ACHIEVEMENTS.filter((a) => a.rarity === "Platinum").map((a) => a.id),
    ).toEqual(["platinum"]);
  });
  it("excludes all secrets and Platinum itself from the required core", () => {
    expect(CORE.filter((a) => a.countsTowardPlatinum)).toHaveLength(63);
    expect(SECRETS.every((a) => !a.countsTowardPlatinum)).toBe(true);
    expect(CORE.find((a) => a.id === "platinum")!.countsTowardPlatinum).toBe(
      false,
    );
  });
  it("redacts every locked secret field that could reveal its requirement", () => {
    for (const a of SECRETS) {
      const v = visibleAchievement(a, false);
      expect(v.name).toBe("???");
      expect(v.badge).toBe("secret");
      for (const key of [
        "rarity",
        "category",
        "metric",
        "goal",
        "xpReward",
        "rule",
      ])
        expect(v).not.toHaveProperty(key);
      expect(JSON.stringify(v)).not.toContain(a.requirement);
    }
  });
  it("reveals secret metadata after unlocking", () => {
    for (const a of SECRETS) expect(visibleAchievement(a, true)).toEqual(a);
  });
});
describe("upgrade, XP and durable one-time rewards", () => {
  it("preserves existing XP, level and every old unlock date during backfill", () => {
    const s = base();
    delete s.trophies;
    s.xp = 1234;
    s.achievements = Object.fromEntries(
      LEGACY_ACHIEVEMENTS.map((a, i) => [
        a.id,
        new Date(now - i * day).toISOString(),
      ]),
    );
    const old = structuredClone(s);
    const next = upgradeAchievements(
      s,
      bank,
      progress(bank.slice(0, 1000)),
      now,
    );
    expect(next.xp).toBe(old.xp);
    expect(levelProgress(next.xp)).toEqual(levelProgress(old.xp));
    for (const a of LEGACY_ACHIEVEMENTS)
      expect(next.achievements[a.id]).toBe(old.achievements[a.id]);
    expect(next.achievements["explore-250"]).toBe(stamp);
    expect(next.trophies!.backfilled["explore-250"]).toBe(true);
    expect(next.trophies!.awardedXp).toEqual({});
  });
  it("does not later pay rewards for backfilled unlocks", () => {
    const s = base();
    delete s.trophies;
    const p = progress(bank.slice(0, 1000));
    const next = upgradeAchievements(s, bank, p, now);
    const again = evaluateAchievements(
      JSON.parse(JSON.stringify(next)),
      bank,
      p,
      now + day,
    );
    expect(again.xp).toBe(next.xp);
    expect(again.achievements).toEqual(next.achievements);
  });
  it("awards a new achievement exactly once, including after serialization/restart", () => {
    const s = base(),
      p = progress(bank.slice(0, 250));
    const next = evaluateAchievements(s, bank, p, now);
    expect(next.xp).toBeGreaterThan(s.xp);
    expect(next.xp - s.xp).toBe(
      Object.values(next.trophies!.awardedXp).reduce((a, b) => a + b, 0),
    );
    const again = evaluateAchievements(
      JSON.parse(JSON.stringify(next)),
      bank,
      p,
      now + day,
    );
    expect(again).toEqual(next);
    expect(again.achievements["explore-250"]).toBe(stamp);
  });
  it("never pays again for a preexisting unlock without a reward ledger", () => {
    const s = base();
    s.achievements["explore-250"] = "2026-01-01T00:00:00Z";
    const a = ACHIEVEMENTS.filter((a) => a.id === "explore-250");
    expect(
      evaluateAchievements(
        s,
        bank,
        progress(bank.slice(0, 300)),
        now,
        undefined,
        false,
        a,
      ).xp,
    ).toBe(s.xp);
  });
  it("uses proven historical module dates and no retroactive XP", () => {
    const s = base();
    delete s.trophies;
    const m = module();
    s.modules = [m];
    const next = upgradeAchievements(s, bank, {}, now + day);
    expect(next.achievements["math-perfect-module"]).toBe(m.date);
    expect(next.xp).toBe(s.xp);
    expect(next.trophies!.backfilled["math-perfect-module"]).toBeUndefined();
  });
  it("does not invent historical streaks, weak transitions or spaced reviews", () => {
    const s = base();
    delete s.trophies;
    const next = upgradeAchievements(
      s,
      bank,
      progress(bank.slice(0, 1000)),
      now,
    );
    expect(next.trophies!.bestRun).toBe(0);
    expect(next.trophies!.firstReviews).toEqual({});
    expect(stats(next).weakMastered).toBe(0);
  });
  it("keeps progression thresholds unchanged", () => {
    for (const n of [1, 5, 10, 25, 50]) {
      const xp = 25 * (n - 1) * n;
      expect(levelProgress(xp).level).toBe(n);
      if (n > 1) expect(levelProgress(xp - 1).level).toBe(n - 1);
    }
  });
});
describe("distinct practice and recovery validity", () => {
  it("counts distinct questions instead of repeated attempts", () => {
    const p = progress([bank[0]]);
    p[bank[0].id].attempts = 10000;
    p[bank[0].id].correctAttempts = 10000;
    expect(stats(base(), p).attempted).toBe(1);
    expect(stats(base(), p).correct).toBe(1);
  });
  it("records accuracy and Hard streaks from distinct consecutive answers", () => {
    let s = base();
    for (const q of bank.filter((q) => q.difficulty === "Hard").slice(0, 25))
      s = attempt(s, q);
    expect(stats(s).streak).toBe(25);
    expect(stats(s).hardStreak).toBe(10);
    const next = evaluateAchievements(s, bank, {}, now);
    expect(next.achievements["streak-25"]).toBe(stamp);
    expect(next.achievements["hard-run-10"]).toBe(stamp);
  });
  it("does not farm runs by repeating the same question even after the interval", () => {
    let s = base();
    for (let i = 0; i < 30; i++)
      s = attempt(s, bank[0], true, {}, now + i * day);
    expect(stats(s).streak).toBe(1);
  });
  it("a wrong answer breaks both runs", () => {
    let s = attempt(base(), bank[0]);
    s = attempt(s, bank[1], false);
    expect(s.trophies!.run).toEqual([]);
    expect(s.trophies!.hardRun).toEqual([]);
  });
  it("recent replay cannot become eligible from an older ledger timestamp", () => {
    let s = attempt(base(), bank[0], false);
    const p = progress([bank[0]], false);
    p[bank[0].id].lastAttemptDate = new Date(now + day - 1000).toISOString();
    s = attempt(s, bank[0], true, p, now + day);
    expect(stats(s).corrections).toBe(0);
  });
  it("requires six hours before a previously missed question counts as repaired", () => {
    const p = progress([bank[0]], false);
    expect(
      stats(attempt(base(), bank[0], true, p, now + 1000)).corrections,
    ).toBe(0);
    expect(
      stats(attempt(base(), bank[0], true, p, now + 6 * 3600000)).corrections,
    ).toBe(1);
  });
  it("counts only due first meaningful reviews and does not double count", () => {
    const q = bank[0];
    let s = attempt(base(), q, false);
    s.reviews[q.id] = {
      dueAt: new Date(now + day).toISOString(),
      streak: 0,
      misses: 1,
      lastAt: stamp,
    };
    const p = progress([q], false);
    expect(stats(attempt(s, q, true, p, now + 7 * 3600000)).firstReviews).toBe(
      0,
    );
    s = attempt(s, q, true, p, now + day);
    expect(stats(s).firstReviews).toBe(1);
    expect(stats(attempt(s, q, true, p, now + day + 1000)).firstReviews).toBe(
      1,
    );
  });
  it("the long recovery secret requires three genuine misses and three spaced due corrections", () => {
    const q = bank.find((q) => q.difficulty === "Hard")!;
    let s = base();
    for (let i = 0; i < 6; i++) {
      s.reviews[q.id] = {
        dueAt: new Date(now + i * day).toISOString(),
        streak: 0,
        misses: 3,
        lastAt: stamp,
      };
      s = attempt(s, q, i >= 3, {}, now + i * day);
      if (i < 5) expect(stats(s).longReturn ?? 0).toBe(0);
    }
    expect(stats(s).longReturn).toBe(1);
    expect(stats(s).hardRecovery).toBe(1);
  });
  it("tracks ten distinct due corrections within seven days", () => {
    let s = base();
    for (const q of bank.slice(0, 10)) {
      s.reviews[q.id] = { dueAt: stamp, streak: 0, misses: 1, lastAt: stamp };
      s = attempt(s, q, true, {}, now + day);
    }
    expect(stats(s).weeklyRepairs).toBe(10);
  });
  it("tracks the fixed 3,770-question exploration denominator", () => {
    const s = base();
    expect(stats(s, progress(bank)).attempted).toBe(3770);
    const a = CORE.find((a) => a.id === "explore-all")!;
    expect(a.stages!.map((x) => x.target)).toEqual([943, 1885, 2828, 3770]);
  });
});
describe("mastery evidence and Platinum", () => {
  it("every actual bank skill can reach Mastered with sufficient successful evidence", () => {
    const p = progress(bank),
      skills = calculateMastery(bank, p, {}, now);
    expect(
      Object.values(skills)
        .filter((s) => s.state !== "Mastered")
        .map((s) => s.key),
    ).toEqual([]);
    const aliases = Object.values(skills).filter(
      (s) => s.skill.toLowerCase() === "cross-text connections",
    );
    expect(aliases).toHaveLength(2);
    expect(aliases.every((s) => s.samples === 61)).toBe(true);
    expect(Object.keys(skills)).toEqual(
      expect.arrayContaining([...new Set(bank.map(skillKey))]),
    );
  });
  it("capitalization aliases cannot double-pay mastery XP", () => {
    const q = bank.find((q) => q.skill === "Cross-text Connections")!,
      other = "Reading and Writing::Cross-Text Connections",
      p = progress(bank),
      s = base();
    s.skills = calculateMastery(bank, p, {}, now);
    s.skillAwards[other] = { mastered: true, improved: true };
    s.credits[q.id] = { base: true, correction: true };
    const answer = {
      answer: q.acceptedAnswers[0],
      correct: true,
      timeSpent: 60,
      submittedAt: new Date(now + day).toISOString(),
    };
    const result = rewardAttempt(s, bank, p, p, q, answer, "custom", now + day);
    expect(result.xp).toBe(0);
    expect(result.study.skillAwards[other]).toEqual(s.skillAwards[other]);
  });
  it.each(["Strong", "Mastered"] as const)(
    "requires a recorded evidence-backed Weak transition to %s",
    (state) => {
      const s = base(),
        key = skillKey(bank[0]),
        qs = bank.filter((q) => skillKey(q) === key).slice(0, 6),
        p = progress(qs, false);
      s.skills[key] = {
        ...s.skills[key],
        state: "Weak",
        score: 20,
        samples: 6,
      };
      const next = structuredClone(s);
      next.skills[key] = {
        ...next.skills[key],
        state,
        score: state === "Strong" ? 75 : 90,
        samples: 16,
      };
      const result = attempt(s, qs[0], true, p, now + day, next);
      expect(stats(result).weakStrong).toBe(1);
      expect(stats(result).weakMastered).toBe(Number(state === "Mastered"));
      expect(stats(result).guidedStrong).toBe(1);
    },
  );
  it("does not credit a weak skill with insufficient negative evidence", () => {
    const s = base(),
      key = skillKey(bank[0]);
    s.skills[key] = { ...s.skills[key], state: "Weak", samples: 6 };
    const next = structuredClone(s);
    next.skills[key].state = "Mastered";
    expect(stats(attempt(s, bank[0], true, {}, now, next)).weakMastered).toBe(
      0,
    );
  });
  it("uses real mastery states for entire subjects, domains and the bank", () => {
    const s = base();
    for (const key in s.skills)
      s.skills[key] = {
        ...s.skills[key],
        state: "Mastered",
        samples: 20,
        score: 90,
      };
    expect(stats(s)).toMatchObject({
      mathDomains: 4,
      readingDomains: 4,
      strongDomains: 8,
      allStrong: 1,
      masterMath: 1,
      masterReading: 1,
      masterAll: 1,
    });
  });
  it("does not unlock Platinum early even with every secret", () => {
    const s = base();
    for (const a of ACHIEVEMENTS)
      if (a.id !== "platinum" && a.id !== "master-all")
        s.achievements[a.id] = stamp;
    expect(
      evaluateAchievements(s, bank, {}, now).achievements.platinum,
    ).toBeUndefined();
  });
  it("unlocks Platinum automatically with all 63 required core and zero secrets", () => {
    const s = base();
    for (const a of CORE.filter((a) => a.countsTowardPlatinum))
      s.achievements[a.id] = stamp;
    const next = evaluateAchievements(s, bank, {}, now);
    expect(next.achievements.platinum).toBe(stamp);
    expect(next.xp - s.xp).toBe(200);
    expect(completion(next)).toMatchObject({
      core: 64,
      secrets: 0,
      platinum: 100,
    });
    expect(evaluateAchievements(next, bank, {}, now + day).xp).toBe(next.xp);
  });
});
describe("module, session and timing accomplishments", () => {
  it.each(["Math", "Reading and Writing"] as const)(
    "recognizes a real complete perfect %s module",
    (subject) => {
      const s = base();
      s.modules = [module(subject)];
      const next = evaluateAchievements(s, bank, {}, now + day);
      expect(
        next.achievements[
          subject === "Math" ? "math-perfect-module" : "reading-perfect-module"
        ],
      ).toBeDefined();
    },
  );
  it.each(["empty", "repeated", "wrong-count", "unfinished"])(
    "rejects %s modules",
    (kind) => {
      const s = base(),
        m = module();
      if (kind === "empty") m.answered = 0;
      if (kind === "repeated") m.novelFraction = 0.1;
      if (kind === "wrong-count") m.session.questionIds.pop();
      if (kind === "unfinished") m.session.finished = false;
      s.modules = [m];
      expect(stats(s).perfectMathModule).toBe(0);
    },
  );
  it("requires linked, sequential, non-overlapping full modules", () => {
    const s = base(),
      a = module(),
      b = module("Math", "second", now + day, { ...s, modules: [a] });
    a.session.module = {
      ...a.session.module!,
      sectionId: "section",
      number: 1,
    };
    b.session.module = {
      ...b.session.module!,
      sectionId: "section",
      number: 2,
      previousModuleId: a.id,
    };
    s.modules = [a, b];
    expect(stats(s).perfectMathSection).toBe(1);
    b.session.module.sectionId = "different";
    expect(stats(s).perfectMathSection).toBe(0);
  });
  it("awards controlled pace for accurate active work, never instant clicking", () => {
    const s = base(),
      m = module();
    s.modules = [m];
    expect(stats(s).measuredPace).toBe(1);
    m.seconds = 5;
    expect(stats(s).measuredPace).toBe(0);
    m.seconds = 1320;
    m.accuracy = 0.5;
    expect(stats(s).measuredPace).toBe(0);
  });
  it("recognizes a near-deadline strong finish only with no blanks", () => {
    const s = base(),
      m = module();
    m.date = new Date(now + 2090000).toISOString();
    m.seconds = 2000;
    s.modules = [m];
    expect(stats(s).lastMinute).toBe(1);
    m.answered--;
    expect(stats(s).lastMinute).toBe(0);
  });
  it("tracks meaningful adaptive completions once and rejects tiny/reused sessions", () => {
    let s = base();
    const m = module(),
      session = { ...m.session, mode: "adaptive" as const };
    for (const a of Object.values(session.answers)) a.firstCredit = true;
    s = recordAchievementSession(s, session, bank, {}, now);
    expect(stats(s).adaptiveSessions).toBe(1);
    expect(stats(s).adaptive90).toBe(1);
    expect(recordAchievementSession(s, session, bank, {}, now + day)).toBe(s);
    for (const a of Object.values(session.answers)) a.firstCredit = false;
    session.id = "reused";
    s = recordAchievementSession(s, session, bank, {}, now);
    expect(stats(s).adaptiveSessions).toBe(1);
  });
  it("secret exceptional first exposure requires substantial unseen Hard material", () => {
    let s = base();
    const qs = bank.filter((q) => q.difficulty === "Hard").slice(0, 20),
      m = module(),
      session = {
        ...m.session,
        mode: "custom" as const,
        questionIds: qs.map((q) => q.id),
        answers: Object.fromEntries(
          qs.map((q) => [
            q.id,
            {
              answer: "A",
              correct: true,
              timeSpent: 60,
              submittedAt: stamp,
              firstCredit: true,
            },
          ]),
        ),
      };
    s = recordAchievementSession(s, session, bank, progress(qs), now);
    expect(stats(s).firstHard).toBe(1);
    expect(
      evaluateAchievements(s, bank, progress(qs), now).achievements[
        "secret-first"
      ],
    ).toBe(stamp);
  });
});
