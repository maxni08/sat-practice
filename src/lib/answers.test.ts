import { describe, expect, it } from "vitest";
import {
  answerMatches,
  isValidAnswer,
  numericAnswersEquivalent,
  parseNumericAnswer,
} from "./answers";
import type { Question } from "../types";

const numeric = (acceptedAnswers: string[]): Question => ({
  id: "math-1",
  questionId: "math-1",
  test: "Math",
  domain: "Algebra",
  skill: "Linear equations",
  difficulty: "Medium",
  questionType: "numeric",
  passage: "",
  stem: "Find x.",
  choices: [],
  acceptedAnswers,
  correctAnswer: acceptedAnswers[0],
  rationale: "Solve for x.",
  assets: [],
  rationaleAssets: [],
  sourcePages: [1],
});

describe("numeric response validation", () => {
  it('does not round a small nonzero solution away to zero', () => {
    expect(numericAnswersEquivalent('0.000', '1/10000')).toBe(false);
    expect(numericAnswersEquivalent('.0001', '1/10000')).toBe(true);
  });
  it.each([
    [".5", "1/2"],
    ["2/4", "0.50"],
    ["−2.5", "-5/2"],
    ["-3/-6", ".5"],
    ["0", "-0.0"],
    [" 7 / 2 ", "3.5"],
    ["+3", "3"],
    [".125", "1/8"],
    ["10000000000000000001", "10000000000000000001"],
  ])("recognizes exact equivalence %s = %s", (answer, accepted) => {
    expect(numericAnswersEquivalent(answer, accepted)).toBe(true);
  });

  it.each([
    "",
    " ",
    "1/0",
    "0/0",
    "2+2",
    "3 1/2",
    "3 4",
    "4%",
    "$4",
    "1,000",
    "Infinity",
    "NaN",
    "1e3",
    ".",
    "--2",
    "alert(1)",
  ])("rejects invalid input %s", (answer) => {
    expect(parseNumericAnswer(answer)).toBeNull();
  });

  it.each([
    [".6666", "2/3"],
    [".6667", "2/3"],
    ["0.666", "2/3"],
    ["0.667", "2/3"],
    ["1.333", "4/3"],
    ["-1.333", "-4/3"],
    ["-.6667", "-2/3"],
    ["12.34", "12.345678"],
    ["12.35", "12.345678"],
  ])(
    "accepts SAT full-field rounding/truncation %s for %s",
    (answer, accepted) => {
      expect(numericAnswersEquivalent(answer, accepted)).toBe(true);
    },
  );

  it.each([
    [".66", "2/3"],
    ["0.67", "2/3"],
    [".6668", "2/3"],
    [".334", "1/3"],
    ["-1.334", "-4/3"],
    ["2.001", "2"],
    ["99999", "100000"],
    ["00.33", "1/3"],
    ["10000000000000000000", "10000000000000000001"],
  ])(
    "rejects insufficient precision or unequal values %s for %s",
    (answer, accepted) => {
      expect(numericAnswersEquivalent(answer, accepted)).toBe(false);
    },
  );

  it("accepts either stored alternative, but does not create an interval", () => {
    const question = numeric(["-2", "2"]);
    expect(answerMatches(question, "-4/2")).toBe(true);
    expect(answerMatches(question, "2.00")).toBe(true);
    expect(answerMatches(question, "0")).toBe(false);
  });

  it("handles explicit truncated answer keys without fuzzy matching", () => {
    const question = numeric([".666", ".667", "2/3"]);
    expect(answerMatches(question, "0.667")).toBe(true);
    expect(answerMatches(question, "0.668")).toBe(false);
  });

  it("does not reveal the answer through input validity", () => {
    const question = numeric(["2"]);
    expect(isValidAnswer(question, "18")).toBe(true);
    expect(answerMatches(question, "18")).toBe(false);
  });

  it("grades multiple choice by a real label, including lowercase input", () => {
    const question: Question = {
      ...numeric([]),
      questionType: "multiple-choice",
      choices: ["A", "B", "C", "D"].map((label) => ({ label, text: label })),
      correctAnswer: "B",
    };
    expect(answerMatches(question, "b")).toBe(true);
    expect(answerMatches(question, "A")).toBe(false);
    expect(isValidAnswer(question, "E")).toBe(false);
  });
});
