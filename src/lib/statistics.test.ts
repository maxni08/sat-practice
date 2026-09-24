import { describe, expect, it } from "vitest";
import { buildSessionStatistics, buildStatistics } from "./statistics";
import { createSession, recordAttempt } from "./session";
import type { Question } from "../types";

const base: Question = {
  id: "a",
  questionId: "a",
  test: "Math",
  domain: "Algebra",
  skill: "Linear equations",
  difficulty: "Easy",
  questionType: "numeric",
  passage: "",
  stem: "Find x.",
  choices: [],
  acceptedAnswers: ["2"],
  correctAnswer: "2",
  rationale: "x=2",
  assets: [],
  rationaleAssets: [],
  sourcePages: [1],
};
const questions: Question[] = [
  base,
  { ...base, id: "b", difficulty: "Hard", skill: "Quadratics" },
  {
    ...base,
    id: "c",
    test: "Reading and Writing",
    domain: "Craft and Structure",
    skill: "Words in Context",
  },
];

describe("progress statistics", () => {
  it("separates unique questions and total attempts and weights accuracy by attempts", () => {
    const progress = {
      a: recordAttempt(base, "2", 20, recordAttempt(base, "3", 40)),
      b: recordAttempt(questions[1], "2", 30),
    };
    const stats = buildStatistics(questions, progress);
    expect(stats.total).toMatchObject({
      attemptedQuestions: 2,
      attempts: 3,
      correct: 2,
      incorrect: 1,
      averageTime: 30,
    });
    expect(stats.total.accuracy).toBeCloseTo(66.6667, 3);
    expect(stats.weakestSkills[0].label).toBe("Linear equations");
    expect(stats.weakestSkills.map((item) => item.label)).not.toContain(
      "Words in Context",
    );
    expect(stats.incorrectQuestions.map((item) => item.id)).toEqual(["a"]);
    expect(
      stats.byTest.find((item) => item.label === "Reading and Writing")
        ?.attempts,
    ).toBe(0);
    expect(stats.byDifficulty.map((item) => item.label)).toEqual([
      "Easy",
      "Hard",
    ]);
  });

  it("has finite empty statistics", () => {
    expect(buildStatistics([], {}).total).toMatchObject({
      attempts: 0,
      accuracy: 0,
      averageTime: 0,
    });
  });

  it("session results include unanswered questions in the score denominator", () => {
    const session = createSession(questions, {
      test: "Math",
      domains: [],
      skills: [],
      difficulties: [],
      history: "all",
      count: 2,
      randomize: false,
      timerMode: "none",
      timerSeconds: 0,
    });
    session.answers.a = {
      answer: "2",
      correct: true,
      timeSpent: 25,
      submittedAt: "2026-09-08T00:00:00Z",
    };
    const stats = buildSessionStatistics(questions, session);
    expect(stats).toMatchObject({
      totalQuestions: 2,
      submittedQuestions: 1,
      correctQuestions: 1,
      sessionAccuracy: 50,
    });
    expect(stats.unansweredQuestions.map((item) => item.id)).toEqual(["b"]);
    expect(stats.total.averageTime).toBe(25);
  });
});
