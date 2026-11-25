import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Question } from "../types";
import { initializeStudy } from "./rewards";
import { generateMock } from "./mock";
import { studyCompletion } from "./transitions";
import { uniqueMockBank,assertUniqueMockQuestions,mockQuestionIdentity } from "./mockIdentity";
const bank=JSON.parse(readFileSync("public/bank/questions.json","utf8")) as Question[];
const now=Date.parse("2026-11-20T12:00:00Z");
const fill=(s:ReturnType<typeof generateMock>)=>({...s,drafts:Object.fromEntries(s.questionIds.map(id=>[id,bank.find(q=>q.id===id)!.acceptedAnswers[0]]))});
describe("mock duplicate protection",()=>{
 it("excludes prior mock questions across two full mocks and persisted transitions",()=>{
  let study=initializeStudy(bank,{},now),progress={};
  const all=new Set<string>(),contents=new Set<string>();
  for(let exam=0;exam<2;exam++){
   let s=generateMock(bank,progress,study,"exam"+exam,now);
   for(let stage=0;stage<4;stage++){
    for(const id of s.questionIds){
     expect(all.has(id)).toBe(false);all.add(id);
     const key=mockQuestionIdentity(bank.find(q=>q.id===id)!);
     expect(contents.has(key)).toBe(false);contents.add(key);
    }
    expect(s.mock!.usedQuestionIds).toHaveLength(stage<2?(stage+1)*27:54+(stage-1)*22);
    const done=studyCompletion(fill(s),bank,progress,study,now+600000);
    study=done.study;progress=done.progress;s=JSON.parse(JSON.stringify(done.session));
    if(stage<3)s=generateMock(bank,progress,study,"exam"+exam+"stage"+stage,now+700000,s);
   }
   expect(s.questionIds).toHaveLength(98);
  }
  expect(all.size).toBe(196);
 },20000);
 it("keeps a self-contained exclusion ledger when a historical module is unavailable",()=>{
  const study=initializeStudy(bank,{},now), first=generateMock(bank,{},study,"first",now);
  const done=studyCompletion(fill(first),bank,{},study,now+600000);
  const next=generateMock(bank,done.progress,{...done.study,modules:[]},"next",now+700000,JSON.parse(JSON.stringify(done.session)));
  expect(next.questionIds.some(id=>first.questionIds.includes(id))).toBe(false);
 });
 it("deduplicates identical text under another ID, including reordered choices",()=>{
  const q=bank.find(q=>q.test==="Reading and Writing"&&!q.assets.length&&!q.requiresOriginalFormat)!;
  const copy={...q,id:"alias",questionId:"alias",choices:[...q.choices].reverse()};
  expect(uniqueMockBank([q,copy],new Set())).toHaveLength(1);
  expect(uniqueMockBank([q,copy],new Set([q.id]))).toHaveLength(0);
  expect(()=>assertUniqueMockQuestions([q,copy],[q.id,copy.id])).toThrow("Duplicate");
  expect(()=>assertUniqueMockQuestions([q],[q.id,q.id])).toThrow("Repeated");
 });
 it("fails explicitly if the fresh bank is exhausted instead of recycling mock questions",()=>{
  const study=initializeStudy(bank,{},now),s=generateMock(bank,{},study,"all",now);
  const done=studyCompletion(fill(s),bank,{},study,now+600000);
  const onlyUsed=bank.filter(q=>s.questionIds.includes(q.id));
  expect(()=>generateMock(onlyUsed,done.progress,done.study,"exhausted",now+700000,done.session)).toThrow("Not enough unused");
 });
});
