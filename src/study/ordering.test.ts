import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Question } from "../types";
import { initializeStudy } from "./rewards";
import { generateModule } from "./modules";
import { orderModuleQuestions, validateModuleStructure, READING_ORDER } from "./ordering";
const bank=JSON.parse(readFileSync("public/bank/questions.json","utf8")) as Question[];
const now=Date.parse("2026-11-20T12:00:00Z");
const state=initializeStudy(bank,{},now);
const rank={Easy:0,Medium:1,Hard:2};
describe("SAT module ordering",()=>{
 for(const route of ["balanced","easier","harder"] as const) for(const test of ["Math","Reading and Writing"] as const)
 it(test+" "+route+" preserves counts, domains, difficulty progression and selection",()=>{
  const s=generateModule(bank,test,{},state,{seed:test+route,now,route});
  const qs=s.questionIds.map(id=>bank.find(q=>q.id===id)!);
  expect(qs.length).toBe(test==="Math"?22:27);
  expect(s.timerSeconds).toBe(test==="Math"?2100:1920);
  expect(()=>validateModuleStructure(qs,test)).not.toThrow();
  expect(new Set(qs.map(q=>q.domain)).size).toBe(4);
  if(test==="Reading and Writing"){
    expect(qs[0].domain).toBe("Craft and Structure");
    const sequence=qs.map(q=>READING_ORDER.indexOf(q.domain));
    expect(sequence).toEqual([...sequence].sort((a,b)=>a-b));
    for(let i=1;i<qs.length;i++){
      const a=qs[i-1],b=qs[i];
      if(a.domain===b.domain&&(a.skill.toLowerCase()===b.skill.toLowerCase()||a.domain==="Standard English Conventions"))expect(rank[a.difficulty]).toBeLessThanOrEqual(rank[b.difficulty]);
    }
  }else expect(qs.map(q=>rank[q.difficulty])).toEqual(qs.map(q=>rank[q.difficulty]).sort((a,b)=>a-b));
  expect(orderModuleQuestions(qs,test).map(q=>q.id)).toEqual(s.questionIds);
 });
 it("rejects incomplete banks instead of silently omitting domains",()=>{
  expect(()=>generateModule(bank.filter(q=>q.domain!=="Craft and Structure"),"Reading and Writing",{},state,{seed:"bad",now})).toThrow();
 });
});
