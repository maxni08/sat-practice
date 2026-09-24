import type { Question } from "../types";

interface Rational {
  numerator: bigint;
  denominator: bigint;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[−–﹣－]/g, "-")
    .replace(/[⁄∕]/g, "/");
}

/** Exact rational parsing. Never evaluates user-provided expressions. */
export function parseNumericAnswer(raw: string): Rational | null {
  const value = normalize(raw);
  if (!value || value.length > 80) return null;
  const fraction = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(value);
  if (fraction) {
    let numerator = BigInt(fraction[1]);
    let denominator = BigInt(fraction[2]);
    if (denominator === 0n) return null;
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    return { numerator, denominator };
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole, decimal = ""] = unsigned.split(".");
  return {
    numerator: BigInt((whole || "0") + decimal) * (negative ? -1n : 1n),
    denominator: 10n ** BigInt(decimal.length),
  };
}

function equal(a: Rational, b: Rational): boolean {
  return a.numerator * b.denominator === b.numerator * a.denominator;
}

/** Accept full-field SAT decimal rounding/truncation, never a broad epsilon. */
function isSatDecimalRepresentation(
  raw: string,
  actual: Rational,
  expected: Rational,
): boolean {
  const value = normalize(raw);
  const unsigned = value.replace(/^-/, "");
  if (unsigned.length !== 5 || !/^-?(?:0?|[1-9]\d*)\.\d+$/.test(value))
    return false;
  // Never let a leading-zero representation erase a nonzero solution.
  // The exact fraction or a decimal without its leading zero remains available.
  if (expected.numerator !== 0n && actual.numerator === 0n) return false;
  const places = value.split(".")[1].length;
  const scale = 10n ** BigInt(places);
  const magnitude =
    expected.numerator < 0n ? -expected.numerator : expected.numerator;
  const scaled = magnitude * scale;
  const truncated = scaled / expected.denominator;
  const remainder = scaled % expected.denominator;
  const rounded =
    truncated + (remainder * 2n >= expected.denominator ? 1n : 0n);
  const sign = expected.numerator < 0n ? -1n : 1n;
  return (
    equal(actual, { numerator: sign * truncated, denominator: scale }) ||
    equal(actual, { numerator: sign * rounded, denominator: scale })
  );
}

export function numericAnswersEquivalent(
  answer: string,
  accepted: string,
): boolean {
  const actual = parseNumericAnswer(answer);
  const expected = parseNumericAnswer(accepted);
  return (
    actual !== null &&
    expected !== null &&
    (equal(actual, expected) ||
      isSatDecimalRepresentation(answer, actual, expected))
  );
}

export function answerMatches(question: Question, answer: string): boolean {
  if (question.questionType === "multiple-choice") {
    const label = answer.trim().toUpperCase();
    return (
      question.choices.some((choice) => choice.label === label) &&
      label === question.correctAnswer.trim().toUpperCase()
    );
  }
  const accepted = question.acceptedAnswers.length
    ? question.acceptedAnswers
    : [question.correctAnswer];
  return accepted.some((value) => numericAnswersEquivalent(answer, value));
}

export function isValidAnswer(question: Question, answer: string): boolean {
  return question.questionType === "numeric"
    ? parseNumericAnswer(answer) !== null
    : question.choices.some(
        (choice) => choice.label === answer.trim().toUpperCase(),
      );
}
