import { describe, expect, it } from "vitest";
import { emptyProgress, type Question } from "../types";
import { focusSections, freshSkill, validScore } from "./StudyPlan";
import { emptyProductivity, sanitizeProductivity } from "./productivity";

describe("Bluebook study plan", () => {
  it("prioritizes the larger gap and changes focus with the latest result", () => {
    expect(focusSections({ rw: 640, math: 730 })).toEqual(["Reading and Writing", "Reading and Writing", "Math"]);
    expect(focusSections({ rw: 790, math: 730 })).toEqual(["Math", "Math", "Reading and Writing"]);
    expect([200, 640, 800, 655, 810, NaN].map(validScore)).toEqual([true,true,true,false,false,false]);
  });
  it("selects only other, unattempted questions from the same skill", () => {
    const q = { id: "original", test: "Math", domain: "Algebra", skill: "Linear equations" } as Question;
    const bank = [q, {...q,id:"new"}, {...q,id:"seen"}, {...q,id:"other",skill:"Systems"}];
    expect(freshSkill(q, bank, { seen: {...emptyProgress(), attempts: 1} }).map(item=>item.id)).toEqual(["new"]);
  });
  it("preserves new flags and separate verification evidence on reload", () => {
    const state = emptyProductivity();
    state.errors.example = { tags: ["Uncertain correct","Too slow"], updatedAt: "one", retriedAt: "two", verifiedAt: "three" };
    expect(sanitizeProductivity(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});
