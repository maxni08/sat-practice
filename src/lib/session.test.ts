import { describe, expect, it } from "vitest";
import {
  createSession,
  filterQuestions,
  recordAttempt,
  remainingTimerSeconds,
  shuffleQuestions,
  submitSessionAnswer,
} from "./session";
import { emptyProgress } from "../types";
import type { Question, SessionOptions } from "../types";

const options: SessionOptions = {
  test: "Math",
  domains: [],
  skills: [],
  difficulties: [],
  history: "all",
  count: 20,
  randomize: false,
  timerMode: "none",
  timerSeconds: 0,
};

const question: Question = {
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
  question,
  {
    ...question,
    id: "b",
    domain: "Advanced Math",
    skill: "Quadratics",
    difficulty: "Hard",
  },
  { ...question, id: "c", difficulty: "Medium" },
  {
    ...question,
    id: "d",
    test: "Reading and Writing",
    domain: "Information and Ideas",
    skill: "Inferences",
  },
];

describe("metadata and history filtering", () => {
  it("combines OR within metadata selections and AND between fields", () => {
    const filtered = filterQuestions(questions, {
      ...options,
      domains: ["Algebra", "Advanced Math"],
      skills: ["Linear equations", "Quadratics"],
      difficulties: ["Easy", "Hard"],
    });
    expect(filtered.map((q) => q.id)).toEqual(["a", "b"]);
    expect(
      filterQuestions(questions, {
        ...options,
        domains: ["Algebra"],
        skills: ["Quadratics"],
      }),
    ).toEqual([]);
  });

  it("uses ever incorrect / ever correct instead of only the latest attempt", () => {
    const prior = recordAttempt(question, "3", 10);
    const progress = {
      a: recordAttempt(question, "2", 15, prior),
      b: { ...emptyProgress(), bookmark: true },
    };
    expect(
      filterQuestions(
        questions,
        { ...options, history: "incorrect" },
        progress,
      ).map((q) => q.id),
    ).toEqual(["a"]);
    expect(
      filterQuestions(
        questions,
        { ...options, history: "correct" },
        progress,
      ).map((q) => q.id),
    ).toEqual(["a"]);
    expect(
      filterQuestions(
        questions,
        { ...options, history: "unanswered" },
        progress,
      ).map((q) => q.id),
    ).toEqual(["b", "c"]);
    expect(
      filterQuestions(
        questions,
        { ...options, history: "bookmarked" },
        progress,
      ).map((q) => q.id),
    ).toEqual(["b"]);
  });

  it("supports Reading and Writing independently", () => {
    expect(
      filterQuestions(questions, {
        ...options,
        test: "Reading and Writing",
      }).map((q) => q.id),
    ).toEqual(["d"]);
  });
});

describe("sessions", () => {
  it("caps the requested count and preserves source order", () => {
    expect(createSession(questions, options).questionIds).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      createSession(questions, { ...options, count: 2 }).questionIds,
    ).toEqual(["a", "b"]);
    expect(() => createSession(questions, { ...options, count: 0 })).toThrow(
      /No questions/,
    );
  });

  it("shuffles without changing the source array or duplicating questions", () => {
    const original = [1, 2, 3, 4];
    const shuffled = shuffleQuestions(original, () => 0);
    expect(shuffled).not.toEqual(original);
    expect([...shuffled].sort()).toEqual(original);
    expect(original).toEqual([1, 2, 3, 4]);
  });

  it("records an attempt independently from immutable question data and annotations", () => {
    const previous = {
      ...emptyProgress(),
      notes: "Remember the sign",
      bookmark: true,
    };
    const snapshot = JSON.stringify(question);
    const progress = recordAttempt(
      question,
      " 2 ",
      32,
      previous,
      "2026-09-08T00:00:00Z",
    );
    expect(progress).toMatchObject({
      attempts: 1,
      correctAttempts: 1,
      incorrectAttempts: 0,
      totalTimeSpent: 32,
      lastAnswer: "2",
      lastResult: true,
      notes: "Remember the sign",
      bookmark: true,
    });
    expect(previous.attempts).toBe(0);
    expect(JSON.stringify(question)).toBe(snapshot);
  });

  it("rejects double submission and unselected or malformed answers", () => {
    const session = createSession(questions, options);
    session.elapsed.a = 13;
    expect(() => submitSessionAnswer(session, question, "")).toThrow(
      /valid answer/,
    );
    const submitted = submitSessionAnswer(session, question, "2");
    expect(submitted.session.answers.a).toMatchObject({
      answer: "2",
      correct: true,
      timeSpent: 13,
    });
    expect(() =>
      submitSessionAnswer(submitted.session, question, "3", submitted.progress),
    ).toThrow(/already/);
    expect(session.answers).toEqual({});
  });

  it("rejects attempts for completed sessions or unrelated questions", () => {
    const session = createSession(questions, options);
    expect(() =>
      submitSessionAnswer({ ...session, finished: true }, question, "2"),
    ).toThrow(/ended/);
    expect(() =>
      submitSessionAnswer(session, { ...question, id: "missing" }, "2"),
    ).toThrow(/not part/);
  });

  it("handles untimed and question timers without counting another question", () => {
    const untimed = createSession(questions, options);
    expect(remainingTimerSeconds(untimed, "a")).toBeNull();
    const timed = createSession(questions, {
      ...options,
      timerMode: "question",
      timerSeconds: 60,
    });
    timed.elapsed.a = 60.5;
    timed.elapsed.b = 12.5;
    expect(remainingTimerSeconds(timed, "a")).toBe(0);
    expect(remainingTimerSeconds(timed, "b")).toBe(48);
  });

  it("uses a persistent wall-clock deadline for a session timer, regardless of visibility", () => {
    const timed = createSession(
      questions,
      { ...options, timerMode: "session", timerSeconds: 120 },
      {},
      1000,
    );
    expect(timed.deadline).toBe(121000);
    expect(
      remainingTimerSeconds({ ...timed, timerHidden: true }, "a", 61000),
    ).toBe(60);
    expect(remainingTimerSeconds(timed, "a", 121001)).toBe(0);
    expect(() =>
      createSession(questions, {
        ...options,
        timerMode: "session",
        timerSeconds: -1,
      }),
    ).toThrow(/greater than zero/);
  });
});
