import { describe, expect, it } from "vitest";
import { mergeLibrary, listSources } from "./library";
import { filterQuestions } from "../lib/session";
import { findQuestions, parseQuestionIds } from "../productivity/productivity";
import { createSession } from "../lib/session";
import { initializeStudy } from "../study/rewards";
import { studySubmission, studyCompletion } from "../study/transitions";
import { createEndlessSession, continueEndlessSession } from "../study/endless";
import type { Question } from "../types";

const q = (id: string, sourceId?: string): Question => ({ id, questionId: sourceId ? `${sourceId}:42` : "42", sourceId, sourceName: sourceId ? "Teacher Set" : undefined, test: "Math", domain: "Algebra", skill: "Linear equations", difficulty: "Medium", questionType: "multiple-choice", passage: "", stem: "Find x.", choices: ["A","B","C","D"].map(label => ({label,text:label})), correctAnswer: "C", acceptedAnswers: [], rationale: "Divide by two.", assets: [], rationaleAssets: [], sourcePages: [] });

describe("unified question library", () => {
  const builtin = q("builtin-42");
  const external = q("teacher-set:42@abc123", "teacher-set");
  const snapshot = { sources: [{id:"teacher-set",name:"Teacher Set",sourceType:"pack" as const,version:"1",enabled:true,present:true,count:1,status:"Ready",report:{}}], questions:[external] };
  it("preserves built-in identity and distinguishes duplicate original numbers", () => {
    const all = mergeLibrary([builtin], snapshot);
    expect(all.map(item => item.id)).toEqual([builtin.id, external.id]);
    expect(parseQuestionIds("42 teacher-set:42", all).ids).toEqual([builtin.id, external.id]);
    expect(findQuestions(all, external.id)[0].id).toBe(external.id);
  });
  it("filters by selected source without changing the built-in bank", () => {
    const all = mergeLibrary([builtin], snapshot);
    expect(filterQuestions(all,{test:"Math",sourceIds:["teacher-set"],domains:[],skills:[],difficulties:[],history:"all"},{}).map(item=>item.id)).toEqual([external.id]);
    expect(listSources([builtin],snapshot).map(item=>item.id)).toEqual(["builtin","teacher-set"]);
    expect(builtin.id).toBe("builtin-42");
  });
  it("records an external answer without granting uncalibrated XP or rank evidence", () => {
    const session = createSession([external], {test:"Math",domains:[],skills:[],difficulties:[],history:"all",count:1,randomize:false,timerMode:"none",timerSeconds:0});
    session.drafts[external.id] = "C";
    const study = initializeStudy([builtin], {}, 1000);
    const result = studySubmission(session,external,[builtin],{},study,2000);
    expect(result.progress[external.id].attempts).toBe(1);
    expect(result.study.evidence[external.id]).toHaveLength(1);
    expect(result.study.xp).toBe(study.xp);
    expect(result.session.answers[external.id].xpAwarded).toBe(0);
    const complete = studyCompletion(result.session,[builtin],result.progress,result.study,3000);
    expect(complete.study.xp).toBe(study.xp);
    expect(complete.session.finished).toBe(true);
  });
  it("offers both enabled source classes to Endless Practice", () => {
    const all = mergeLibrary([builtin], snapshot);
    const first = createEndlessSession(all, {}, 10, () => 0);
    const second = continueEndlessSession(first, all, {}, 11, () => 0);
    expect(new Set([...first.questionIds,...second.questionIds])).toEqual(new Set([builtin.id,external.id]));
  });
});
