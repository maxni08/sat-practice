import { describe, expect, it } from "vitest";
import type { Question } from "../types";
import { createEndlessSession, continueEndlessSession } from "./endless";
import { initializeStudy } from "./rewards";
import { studySubmission } from "./transitions";

const q = (id:string, test:Question["test"], difficulty:Question["difficulty"]="Medium"):Question => ({
  id, questionId:id, test, domain:test === "Math" ? "Algebra" : "Information and Ideas", skill:"Skill", difficulty,
  questionType:"multiple-choice", passage:"", stem:"Question", choices:[{label:"A",text:"Yes"},{label:"B",text:"No"}], acceptedAnswers:["A"], correctAnswer:"A", rationale:"Because.", assets:[], rationaleAssets:[], sourcePages:[1],
});
const bank = [q("m1","Math","Easy"),q("r1","Reading and Writing","Hard"),q("m2","Math","Hard"),q("r2","Reading and Writing","Easy")];

describe("Endless Practice", () => {
  it("starts untimed and keeps a mixed unseen sequence without an endpoint", () => {
    let session = createEndlessSession(bank, {}, 1, () => 0);
    expect(session.mode).toBe("endless"); expect(session.timerMode).toBe("none");
    for(let i=0;i<3;i++) session=continueEndlessSession(session,bank,{},i+2,()=>0);
    const tests=session.questionIds.map(id=>bank.find(q=>q.id===id)!.test);
    expect(new Set(session.questionIds).size).toBe(4); expect(new Set(tests)).toEqual(new Set(["Math","Reading and Writing"]));
  });
  it("avoids recently used questions, then rolls over safely after a full cycle", () => {
    let session=createEndlessSession(bank.slice(0,2),{},1,()=>0);
    session=continueEndlessSession(session,bank.slice(0,2),{},2,()=>0);
    const rolled=continueEndlessSession(session,bank.slice(0,2),{},3,()=>0);
    expect(rolled.questionIds).toHaveLength(1); expect(rolled.endless?.cycles).toBe(2);
  });
  it("records normal progress, XP evidence and live endless stats", () => {
    const session=createEndlessSession(bank,{},1,()=>0);
    const question=bank.find(q=>q.id===session.questionIds[0])!;
    session.drafts[question.id]="A"; session.elapsed[question.id]=42;
    const study=initializeStudy(bank,{},1);
    const result=studySubmission(session,question,bank,{},study,1000);
    expect(result.progress[question.id].attempts).toBe(1); expect(result.study.evidence[question.id]).toHaveLength(1);
    expect(result.study.xp).toBeGreaterThan(study.xp);
    expect(result.session.endless).toMatchObject({answered:1,correct:1,streak:1,activeSeconds:42});
  });
});
