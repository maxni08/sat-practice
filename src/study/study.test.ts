import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  emptyProgress,
  type ProgressMap,
  type Question,
  type Session,
} from "../types";
import { recordAttempt } from "../lib/session";
import {
  initializeStudy,
  rewardAttempt,
  rewardCompletion,
  levelProgress,
  xpForLevel,
  achievementMetrics,
} from "./rewards";
import { calculateMastery } from "./mastery";
import { scheduleReview } from "./review";
import {
  advanceDifficulty,
  selectAdaptive,
  recommendations,
  startingDifficulty,
  createAdaptiveSession,
  adaptRemaining,
  sessionFromRecommendation,
} from "./adaptive";
import {
  generateModule,
  gradeModule,
  makeModuleRecord,
  moduleRoute,
  quotas,
  sectionSession,
} from "./modules";
import { studyCompletion, studySubmission } from "./transitions";
import { MODULE_BLUEPRINT, DIFFICULTY_MIX, RULES } from "./config";
import { skillKey, type StudyState } from "./types";

const bank = JSON.parse(
  readFileSync("public/bank/questions.json", "utf8"),
) as Question[];
const now = Date.parse("2026-09-08T12:00:00Z");
const stamp = new Date(now).toISOString();
const first = (difficulty: Question["difficulty"]) =>
  bank.find((q) => q.difficulty === difficulty)!;
const correct = (q: Question) => q.acceptedAnswers[0];
const wrong = (q: Question) =>
  q.questionType === "numeric"
    ? "-987654321"
    : q.choices.find((c) => c.label !== q.correctAnswer)!.label;
const base = () => initializeStudy(bank, {}, now);
function attempt(
  q: Question,
  answer: string,
  previous: ProgressMap = {},
  study = base(),
  at = now,
) {
  const p = recordAttempt(
    q,
    answer,
    60,
    previous[q.id],
    new Date(at).toISOString(),
  );
  const progress = { ...previous, [q.id]: p };
  const record = {
    answer,
    correct: p.lastResult === true,
    timeSpent: 60,
    submittedAt: new Date(at).toISOString(),
  };
  return {
    progress,
    ...rewardAttempt(study, bank, previous, progress, q, record, "custom", at),
  };
}
function answered(session: Session, allCorrect = true): Session {
  return {
    ...session,
    drafts: Object.fromEntries(
      session.questionIds.map((id) => {
        const q = bank.find((q) => q.id === id)!;
        return [id, allCorrect ? correct(q) : wrong(q)];
      }),
    ),
    elapsed: Object.fromEntries(session.questionIds.map((id) => [id, 65])),
  };
}

describe("XP, levels and meaningful achievements", () => {
  it.each(["Easy", "Medium", "Hard"] as const)(
    "awards configured first-correct XP for %s",
    (difficulty) =>
      expect(attempt(first(difficulty), correct(first(difficulty))).xp).toBe(
        RULES.baseXp[difficulty],
      ),
  );
  it("does not award XP for a wrong answer", () =>
    expect(attempt(first("Hard"), wrong(first("Hard"))).xp).toBe(0));
  it("prevents repeated Easy XP even on later days", () => {
    const q = first("Easy");
    let result = attempt(q, correct(q));
    const earned = result.study.xp;
    for (let n = 1; n <= 15; n++)
      result = attempt(
        q,
        correct(q),
        result.progress,
        result.study,
        now + n * RULES.day,
      );
    expect(result.study.xp).toBe(earned);
  });
  it("requires a learning interval before awarding correction XP", () => {
    const q = first("Medium"),
      miss = attempt(q, wrong(q));
    const rapid = attempt(q, correct(q), miss.progress, miss.study, now + 1000);
    expect(rapid.xp).toBe(0);
    const corrected = attempt(
      q,
      correct(q),
      miss.progress,
      miss.study,
      now + RULES.day,
    );
    expect(corrected.xp).toBe(RULES.baseXp.Medium + RULES.correctionXp);
    expect(corrected.study.credits[q.id].correction).toBe(true);
  });
  it("awards correction credit only once per question", () => {
    const q = first("Hard");
    let r = attempt(q, wrong(q));
    r = attempt(q, correct(q), r.progress, r.study, now + RULES.day);
    const earned = r.study.xp;
    r = attempt(q, wrong(q), r.progress, r.study, now + 2 * RULES.day);
    r = attempt(q, correct(q), r.progress, r.study, now + 3 * RULES.day);
    expect(r.study.xp).toBe(earned);
  });
  it.each([1, 2, 5, 10, 25, 50])(
    "has an exact progressive level %i boundary",
    (level) => {
      const floor = xpForLevel(level);
      expect(levelProgress(floor).level).toBe(level);
      expect(levelProgress(floor).ratio).toBe(0);
      if (level > 1) expect(levelProgress(floor - 1).level).toBe(level - 1);
      expect(levelProgress(floor).required).toBe(level * 50);
    },
  );
  it("clamps invalid XP safely", () =>
    expect(levelProgress(NaN).level).toBe(1));
  it("unlocks First Question on an attempt and preserves its date", () => {
    const q = first("Easy"),
      r = attempt(q, wrong(q));
    expect(r.study.achievements["first-question"]).toBe(stamp);
    const again = attempt(q, wrong(q), r.progress, r.study, now + RULES.day);
    expect(again.study.achievements["first-question"]).toBe(stamp);
  });
  it("counts distinct correct questions rather than repeated attempts", () => {
    const q = first("Easy"),
      r = attempt(q, correct(q));
    r.progress[q.id].attempts = 100;
    r.progress[q.id].correctAttempts = 100;
    expect(achievementMetrics(r.study, bank, r.progress).correct).toBe(1);
  });
  it("initializes legacy credits once without mutating old progress", () => {
    const q = first("Hard"),
      progress = { [q.id]: recordAttempt(q, correct(q), 80, undefined, stamp) },
      before = JSON.stringify(progress);
    const learning = initializeStudy(bank, progress, now);
    expect(learning.xp).toBe(25);
    expect(learning.credits[q.id].base).toBe(true);
    expect(JSON.stringify(progress)).toBe(before);
    expect(learning.evidence).toEqual({});
    expect(attempt(q, correct(q), progress, learning, now + RULES.day).xp).toBe(
      0,
    );
  });
  it("does not reward a one-question perfect-session loop", () => {
    const q = first("Easy"),
      study = base();
    const s = {
      id: "one",
      questionIds: [q.id],
      answers: {
        [q.id]: {
          answer: correct(q),
          correct: true,
          timeSpent: 10,
          submittedAt: stamp,
        },
      },
      mode: "custom",
    } as Session;
    const completed = rewardCompletion(study, s, bank, {}, now);
    expect(completed.xp).toBe(0);
    expect(completed.achievements["first-perfect"]).toBeUndefined();
  });
});

describe("deterministic skill mastery", () => {
  const template = first("Medium");
  const questions = Array.from(
    { length: 18 },
    (_, i) =>
      ({
        ...template,
        id: `mastery-${i}`,
        questionId: `mastery-${i}`,
        difficulty: i < 6 ? "Easy" : i < 12 ? "Medium" : "Hard",
      }) as Question,
  );
  const successful = Object.fromEntries(
    questions.map((q) => [
      q.id,
      recordAttempt(q, correct(q), 65, undefined, stamp),
    ]),
  );
  const key = skillKey(template);
  it("is deterministic and requires evidence for mastery", () => {
    const a = calculateMastery(questions, successful, {}, now);
    expect(a).toEqual(calculateMastery(questions, successful, {}, now));
    expect(a[key].state).toBe("Mastered");
    expect(a[key].samples).toBe(18);
  });
  it("does not equate repeated Easy accuracy with mastery", () => {
    const q = questions[0],
      p = { ...successful[q.id], attempts: 500, correctAttempts: 500 };
    expect(
      calculateMastery(questions, { [q.id]: p }, {}, now)[key].state,
    ).not.toBe("Mastered");
  });
  it("requires Medium and Hard evidence, even with many correct Easy questions", () => {
    const easy = questions.map((q) => ({ ...q, difficulty: "Easy" as const }));
    expect(calculateMastery(easy, successful, {}, now)[key].state).not.toBe(
      "Mastered",
    );
  });
  it("lets mastery decline with time away", () => {
    const fresh = calculateMastery(questions, successful, {}, now)[key],
      stale = calculateMastery(questions, successful, {}, now + 90 * RULES.day)[
        key
      ];
    expect(stale.score).toBeLessThan(fresh.score);
    expect(stale.state).not.toBe("Mastered");
  });
  it("penalizes repeated mistakes and considers recent outcomes", () => {
    const p = structuredClone(successful),
      e: StudyState["evidence"] = {};
    for (const q of questions.slice(0, 8)) {
      p[q.id] = {
        ...p[q.id],
        attempts: 3,
        incorrectAttempts: 2,
        lastResult: false,
        lastAttemptDate: new Date(now + 1000).toISOString(),
      };
      e[q.id] = [0, 1].map(() => ({
        at: stamp,
        correct: false,
        seconds: 65,
        mode: "custom",
      }));
    }
    expect(
      calculateMastery(questions, p, e, now + 1000)[key].score,
    ).toBeLessThan(calculateMastery(questions, successful, {}, now)[key].score);
  });
  it("uses response time only as a small supporting signal", () => {
    const slow = structuredClone(successful);
    for (const p of Object.values(slow)) p.totalTimeSpent = 1000;
    const a = calculateMastery(questions, successful, {}, now)[key].score,
      b = calculateMastery(questions, slow, {}, now)[key].score;
    expect(a - b).toBeGreaterThanOrEqual(0);
    expect(a - b).toBeLessThanOrEqual(3);
  });
  it("includes every imported skill, even if unpracticed", () => {
    const skills = calculateMastery(bank, {}, {}, now);
    expect(Object.keys(skills).length).toBe(new Set(bank.map(skillKey)).size);
    expect(
      Object.values(skills).every((s) => s.samples === 0 && s.score === 0),
    ).toBe(true);
  });
});

describe("spaced review and recommendations", () => {
  it("schedules the first mistake for tomorrow", () =>
    expect(Date.parse(scheduleReview(undefined, false, now)!.dueAt)).toBe(
      now + RULES.day,
    ));
  it("brings repeated mistakes back after six hours", () => {
    const a = scheduleReview(undefined, false, now)!;
    expect(Date.parse(scheduleReview(a, false, now + RULES.day)!.dueAt)).toBe(
      now + 1.25 * RULES.day,
    );
  });
  it("lengthens successful due-review intervals", () => {
    let r = scheduleReview(undefined, false, now)!;
    for (const days of [3, 7, 14, 30, 60]) {
      const at = Date.parse(r.dueAt);
      r = scheduleReview(r, true, at)!;
      expect(Date.parse(r.dueAt) - at).toBe(days * RULES.day);
    }
  });
  it("does not advance the schedule through immediate repeated correct answers", () => {
    const r = scheduleReview(undefined, false, now)!;
    expect(scheduleReview(r, true, now + 1000)).toEqual(r);
    expect(scheduleReview(undefined, true, now)).toBeUndefined();
  });
  it("makes an actionable due-review recommendation from real mistakes", () => {
    const q = first("Hard"),
      r = attempt(q, wrong(q));
    const context = {
      questions: bank,
      progress: r.progress,
      study: r.study,
      now: now + RULES.day,
    };
    const rec = recommendations(context).find((r) => r.kind === "review")!;
    expect(rec.count).toBe(1);
    expect(
      sessionFromRecommendation(context, rec, "review").questionIds,
    ).toEqual([q.id]);
  });
});

describe("adaptive practice", () => {
  it("does not reduce difficulty for one wrong answer", () =>
    expect(
      advanceDifficulty({ level: "Hard", correctRun: 0, recent: [] }, false)
        .level,
    ).toBe("Hard"));
  it("steps up only after three successes", () => {
    let d = { level: "Easy" as const, correctRun: 0, recent: [] } as Parameters<
      typeof advanceDifficulty
    >[0];
    d = advanceDifficulty(d, true);
    d = advanceDifficulty(d, true);
    expect(d.level).toBe("Easy");
    expect(advanceDifficulty(d, true).level).toBe("Medium");
  });
  it("steps down after three mistakes across four answers", () => {
    let d = { level: "Hard", correctRun: 0, recent: [] } as Parameters<
      typeof advanceDifficulty
    >[0];
    for (const result of [false, true, false, false])
      d = advanceDifficulty(d, result);
    expect(d.level).toBe("Medium");
  });
  it("avoids recently used individual questions when alternatives exist", () => {
    const progress: ProgressMap = {};
    for (const q of bank.filter((q) => q.test === "Math").slice(0, 100))
      progress[q.id] = recordAttempt(q, correct(q), 50, undefined, stamp);
    const study = initializeStudy(bank, progress, now),
      chosen = selectAdaptive(
        { questions: bank, progress, study, now },
        "Math",
        20,
        "fresh",
      );
    expect(chosen).toHaveLength(20);
    expect(chosen.every((q) => !progress[q.id])).toBe(true);
    expect(new Set(chosen.map((q) => q.id)).size).toBe(20);
  });
  it("uses a 60/25/15 allocation when all mastery bands are available", () => {
    const template = first("Medium"),
      questions = Array.from({ length: 90 }, (_, i) => ({
        ...template,
        id: `mix-${i}`,
        skill:
          i < 30 ? "Weak skill" : i < 60 ? "Developing skill" : "Strong skill",
      }));
    const study = initializeStudy(questions, {}, now);
    for (const s of Object.values(study.skills))
      s.score =
        s.skill === "Weak skill"
          ? 20
          : s.skill === "Developing skill"
            ? 60
            : 90;
    const chosen = selectAdaptive(
      { questions, progress: {}, study, now },
      template.test,
      20,
      "mix",
    );
    expect(chosen.filter((q) => q.skill === "Weak skill")).toHaveLength(12);
    expect(chosen.filter((q) => q.skill === "Developing skill")).toHaveLength(
      5,
    );
    expect(chosen.filter((q) => q.skill === "Strong skill")).toHaveLength(3);
  });
  it("uses historical difficulty breakdown to choose an initial challenge", () => {
    const qs = bank
        .filter((q) => q.test === "Math" && q.difficulty === "Easy")
        .slice(0, 6),
      progress = Object.fromEntries(
        qs.map((q) => [q.id, recordAttempt(q, wrong(q), 70, undefined, stamp)]),
      );
    expect(
      startingDifficulty(
        {
          questions: bank,
          progress,
          study: initializeStudy(bank, progress, now),
          now,
        },
        "Math",
      ),
    ).toBe("Easy");
  });
  it("never replaces seen or drafted questions during difficulty adaptation", () => {
    const study = base(),
      context = { questions: bank, progress: {}, study, now };
    const s = createAdaptiveSession(context, "Math", 12, "adaptive");
    s.adaptive!.correctRun = 2;
    s.adaptive!.seen.push(s.questionIds[1]);
    s.drafts[s.questionIds[2]] = "A";
    const changed = adaptRemaining(s, context, true);
    expect(changed.adaptive!.level).toBe("Hard");
    expect(changed.questionIds.slice(0, 3)).toEqual(s.questionIds.slice(0, 3));
    expect(new Set(changed.questionIds).size).toBe(12);
  });
});

describe("SAT-style module generation and grading", () => {
  it.each(["Math", "Reading and Writing"] as const)(
    "uses the official count and time for %s",
    (test) => {
      const s = generateModule(bank, test, {}, base(), { seed: test, now });
      expect(s.questionIds).toHaveLength(MODULE_BLUEPRINT[test].count);
      expect(s.timerSeconds).toBe(MODULE_BLUEPRINT[test].seconds);
      expect(s.deadline).toBe(now + s.timerSeconds * 1000);
      expect(s.answers).toEqual({});
    },
  );
  it.each(["balanced", "easier", "harder"] as const)(
    "balances domains, skills, question types and the %s difficulty mixture",
    (route) => {
      for (const test of ["Math", "Reading and Writing"] as const) {
        const s = generateModule(bank, test, {}, base(), {
            seed: `${test}-${route}`,
            now,
            route,
          }),
          qs = s.questionIds.map((id) => bank.find((q) => q.id === id)!);
        const counts = (field: "domain" | "difficulty") =>
          Object.fromEntries(
            [...new Set(qs.map((q) => q[field]))].map((value) => [
              value,
              qs.filter((q) => q[field] === value).length,
            ]),
          );
        expect(counts("domain")).toEqual(
          quotas(qs.length, MODULE_BLUEPRINT[test].domains),
        );
        expect(counts("difficulty")).toEqual(
          quotas(qs.length, DIFFICULTY_MIX[route]),
        );
        expect(qs.filter((q) => q.questionType === "numeric")).toHaveLength(
          MODULE_BLUEPRINT[test].numericCount,
        );
        expect(new Set(s.questionIds).size).toBe(qs.length);
        if (test === "Math")
          expect(
            Math.max(
              ...[...new Set(qs.map((q) => q.skill))].map(
                (skill) => qs.filter((q) => q.skill === skill).length,
              ),
            ),
          ).toBeLessThanOrEqual(4);
      }
    },
  );
  it("is deterministic with the same seed and input state", () =>
    expect(
      generateModule(bank, "Math", {}, base(), { seed: "fixed", now }),
    ).toEqual(
      generateModule(bank, "Math", {}, base(), { seed: "fixed", now }),
    ));
  it("avoids reusing the last module when fresh questions exist", () => {
    const study = base(),
      s = generateModule(bank, "Math", {}, study, { seed: "previous", now }),
      done = gradeModule(answered(s), bank, {}, now);
    study.modules = [makeModuleRecord(done.session, bank, done.updates, [])];
    const next = generateModule(bank, "Math", done.updates, study, {
      seed: "next",
      now: now + 1000,
    });
    expect(
      next.questionIds.filter((id) => s.questionIds.includes(id)),
    ).toHaveLength(0);
  });
  it("keeps editable draft responses separate from graded answers", () => {
    const s = answered(
      generateModule(bank, "Math", {}, base(), { seed: "deferred", now }),
    );
    expect(s.answers).toEqual({});
    s.drafts[s.questionIds[0]] = wrong(
      bank.find((q) => q.id === s.questionIds[0])!,
    );
    expect(s.answers).toEqual({});
    const graded = gradeModule(s, bank, {}, now);
    expect(graded.session.finished).toBe(true);
    expect(
      Object.values(graded.session.answers).filter((a) => a.correct),
    ).toHaveLength(21);
  });
  it("treats blanks and invalid numeric entries as unanswered at completion", () => {
    const s = answered(
      generateModule(bank, "Math", {}, base(), { seed: "blank", now }),
    );
    delete s.drafts[s.questionIds[0]];
    const numeric = s.questionIds.find(
      (id) =>
        bank.find((q) => q.id === id)!.questionType === "numeric" &&
        id !== s.questionIds[0],
    )!;
    s.drafts[numeric] = "1/0";
    expect(
      Object.keys(gradeModule(s, bank, {}, now).session.answers),
    ).toHaveLength(20);
  });
  it("stores module results, answers and breakdowns and awards completion only once", () => {
    const study = base(),
      s = answered(
        generateModule(bank, "Math", {}, study, { seed: "finish", now }),
      );
    const finished = studyCompletion(s, bank, {}, study, now + 35 * 60 * 1000);
    expect(finished.study.modules).toHaveLength(1);
    const record = finished.study.modules[0];
    expect(record.score).toBe(22);
    expect(record.accuracy).toBe(1);
    expect(record.byDifficulty.reduce((n, r) => n + r.total, 0)).toBe(22);
    expect(record.meaningful).toBe(true);
    expect(finished.study.achievements["module-perfect"]).toBeTruthy();
    expect(
      rewardCompletion(
        finished.study,
        finished.session,
        bank,
        finished.progress,
        now,
      ).xp,
    ).toBe(finished.study.xp);
  });
  it("does not reward empty module completion farming", () => {
    const study = base(),
      s = generateModule(bank, "Math", {}, study, { seed: "empty", now }),
      result = studyCompletion(s, bank, {}, study, now);
    expect(result.study.xp).toBe(0);
    expect(result.study.modules[0].meaningful).toBe(false);
    expect(result.study.achievements["modules-1"]).toBeUndefined();
  });
  it("routes Module 2 deterministically using all questions including unanswered", () => {
    expect(moduleRoute(15, 22)).toBe("easier");
    expect(moduleRoute(16, 22)).toBe("harder");
    expect(moduleRoute(0, 0)).toBe("easier");
  });
  it("runs two distinct modules, preserves the transition, and combines section results", () => {
    const study = base(),
      first = answered(
        generateModule(bank, "Math", {}, study, {
          seed: "m1",
          sectionId: "section",
          now,
        }),
      );
    const a = studyCompletion(first, bank, {}, study, now + RULES.day);
    expect(a.session.module?.awaitingNext).toBe(true);
    const second = answered(
      generateModule(bank, "Math", a.progress, a.study, {
        seed: "m2",
        sectionId: "section",
        number: 2,
        previousModuleId: first.id,
        exclude: first.questionIds,
        route: moduleRoute(22, 22),
        now: now + RULES.day,
      }),
    );
    const b = studyCompletion(
      second,
      bank,
      a.progress,
      a.study,
      now + 2 * RULES.day,
    );
    expect(b.study.modules).toHaveLength(2);
    expect(b.session.questionIds).toHaveLength(44);
    expect(new Set(b.session.questionIds).size).toBe(44);
    expect(b.session.module?.sectionSummary).toBe(true);
    expect(b.session).toEqual(
      sectionSession(b.study.modules[0], b.study.modules[1]),
    );
    expect(Object.values(b.session.answers).every((a) => a.correct)).toBe(true);
  });
  it("normal practice still grades explicitly and assigns a single event ID", () => {
    const study = base(),
      s = createAdaptiveSession(
        { questions: bank, progress: {}, study, now },
        "Math",
        5,
        "submit",
      ),
      q = bank.find((q) => q.id === s.questionIds[0])!;
    s.drafts[q.id] = correct(q);
    const r = studySubmission(s, q, bank, {}, study, now);
    expect(r.session.answers[q.id].correct).toBe(true);
    expect(r.study.revision).toBe(1);
    expect(r.eventId).toBe(`submit:answer:${q.id}`);
    expect(() =>
      studySubmission(r.session, q, bank, r.progress, r.study, now),
    ).toThrow();
  });
});
