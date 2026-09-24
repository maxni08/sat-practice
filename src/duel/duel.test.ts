import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Question } from "../types";
import { advanceDuel, chooseDuelAnswer, emptyDuelHistory, expireDuelRound, generateDuel, lockDuelAnswer, recordDuel, sanitizeDuelHistory, summarizeDuel } from "./duel";

const bank = JSON.parse(readFileSync("public/bank/questions.json", "utf8")) as Question[];
const setup = { subject: "Mixed" as const, mode: "Regular" as const, count: 10 as const, timerSeconds: 30 as const, p1Name: "Player 1", p2Name: "Player 2" };
const now = Date.parse("2026-09-17T12:00:00Z");

describe("Local 1v1", () => {
  it("generates one synchronized, deterministic multiple-choice set", () => {
    const first = generateDuel(bank, setup, "duel", now);
    expect(generateDuel(bank, setup, "duel", now).questionIds).toEqual(first.questionIds);
    expect(first.questionIds).toHaveLength(10);
    expect(first.questionIds.every((id) => bank.find((q) => q.id === id)!.questionType === "multiple-choice")).toBe(true);
    expect(new Set(first.questionIds.map((id) => bank.find((q) => q.id === id)!.test)).size).toBe(2);
  });
  it("uses balanced and harder existing difficulty rules", () => {
    for (const mode of ["Regular", "Hard"] as const) {
      const match = generateDuel(bank, { ...setup, mode, count: 20 }, mode, now);
      const hard = match.questionIds.filter((id) => bank.find((q) => q.id === id)!.difficulty === "Hard").length;
      expect(hard).toBe(mode === "Hard" ? 9 : 6);
    }
  });
  it("keeps answers independent and hidden until both players lock", () => {
    let match = generateDuel(bank, setup, "independent", now);
    const question = bank.find((q) => q.id === match.questionIds[0])!;
    match = chooseDuelAnswer(match, "p1", question.correctAnswer);
    expect(match.rounds[question.id].p2.answer).toBe("");
    match = lockDuelAnswer(match, "p1", question, now + 1000);
    expect(match.rounds[question.id].revealed).toBe(false);
    match = chooseDuelAnswer(match, "p2", question.choices.find((c) => c.label !== question.correctAnswer)!.label);
    match = lockDuelAnswer(match, "p2", question, now + 2000);
    expect(match.rounds[question.id].revealed).toBe(true);
    expect(match.rounds[question.id].p1.correct).toBe(true);
    expect(match.rounds[question.id].p2.correct).toBe(false);
  });
  it("starts at zero and normalizes player names", () => {
    const match = generateDuel(bank, { ...setup, p1Name: "  Nicol\u00e1s ", p2Name: "   " }, "names", now);
    expect(summarizeDuel(match, now)).toMatchObject({ p1: 0, p2: 0, p1Name: "Nicol\u00e1s", p2Name: "Player 2" });
  });
  it("expires unanswered players and advances only after reveal", () => {
    let match = generateDuel(bank, setup, "timer", now);
    const question = bank.find((q) => q.id === match.questionIds[0])!;
    expect(advanceDuel(match, now + 1000).index).toBe(0);
    match = expireDuelRound(match, question, now + 30000);
    expect(match.rounds[question.id].p1.answer).toBe("");
    expect(match.rounds[question.id].p1.correct).toBe(false);
    expect(advanceDuel(match, now + 30001).index).toBe(1);
  });
  it("scores without speed bonuses and uses correct-answer time only for ties", () => {
    let match = generateDuel(bank, { ...setup, count: 5 }, "score", now);
    for (const id of match.questionIds) {
      const question = bank.find((q) => q.id === id)!;
      match = chooseDuelAnswer(match, "p1", question.correctAnswer);
      match = lockDuelAnswer(match, "p1", question, match.roundStartedAt + 2000);
      match = chooseDuelAnswer(match, "p2", question.correctAnswer);
      match = lockDuelAnswer(match, "p2", question, match.roundStartedAt + 3000);
      match = advanceDuel(match, match.roundStartedAt + 4000);
    }
    const summary = summarizeDuel(match, now + 100000);
    expect(summary.p1).toBe(5);
    expect(summary.p2).toBe(5);
    expect(summary.winner).toBe("Player 1");
  });
  it("persists isolated, idempotent history without study state", () => {
    let match = generateDuel(bank, { ...setup, count: 5 }, "history", now);
    for (const id of match.questionIds) {
      match = expireDuelRound(match, bank.find((q) => q.id === id)!, match.roundStartedAt + 30000);
      match = advanceDuel(match, match.roundStartedAt + 30001);
    }
    const history = recordDuel(emptyDuelHistory(), match, now + 200000);
    expect(history.matches).toHaveLength(1);
    expect(recordDuel(history, match, now + 300000)).toEqual(history);
  });
  it("sanitizes invalid legacy duel scores and names", () => {
    const history = sanitizeDuelHistory({ version: 1, matches: [{ id: "old", date: "x", subject: "Math", mode: "Regular", count: 5, p1: Number.NaN, p2: null, p1CorrectMs: Number.NaN, p2CorrectMs: undefined, winner: "Player 1" }] });
    expect(history.matches[0]).toMatchObject({ p1: 0, p2: 0, p1CorrectMs: 0, p2CorrectMs: 0, p1Name: "Player 1", p2Name: "Player 2", winner: "Draw" });
  });
});
