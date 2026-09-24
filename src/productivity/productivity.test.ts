import { describe, expect, it } from "vitest";
import type { Question, Session } from "../types";
import { browseQuestions, findQuestions, pacingAnalysis, parseQuestionIds, sanitizeProductivity, similarQuestions } from "./productivity";

const q=(id:string, overrides:Partial<Question>={}):Question=>({id,questionId:id,test:"Math",domain:"Algebra",skill:"Linear functions",difficulty:"Medium",questionType:"multiple-choice",passage:"",stem:`Stem ${id}`,choices:[{label:"A",text:"Choice"}],acceptedAnswers:["A"],correctAnswer:"A",rationale:"Why",assets:[],rationaleAssets:[],sourcePages:[1],...overrides});
const bank=[q("abc12345"),q("def67890",{difficulty:"Hard"}),q("ghi11111",{domain:"Advanced Math",skill:"Nonlinear functions"}),q("rw222222",{test:"Reading and Writing",domain:"Craft and Structure",skill:"Words in Context",stem:"Distinctive vocabulary prompt"})];

describe("question productivity",()=>{
  it("finds exact, partial and text matches with exact IDs first",()=>{
    expect(findQuestions(bank,"abc12345").map(x=>x.id)).toEqual(["abc12345"]);
    expect(findQuestions(bank,"678").map(x=>x.id)).toEqual(["def67890"]);
    expect(findQuestions(bank,"vocabulary").map(x=>x.id)).toEqual(["rw222222"]);
  });
  it("parses ordered IDs, removes duplicates and reports invalid values",()=>{
    expect(parseQuestionIds("def67890, abc12345\nDEF67890 missing",bank)).toEqual({ids:["def67890","abc12345"],invalid:["missing"],duplicate:["DEF67890"]});
  });
  it("prioritizes unseen same-skill similar questions",()=>{
    const source=q("source");
    expect(similarQuestions(source,[source,...bank],{abc12345:{attempts:0} as never},2)[0].skill).toBe(source.skill);
  });
  it("filters unseen, history and metadata without rendering the whole bank",()=>{
    const result=browseQuestions(bank,{abc12345:{attempts:1,correctAttempts:1} as never},{query:"",test:"Math",domain:"",skill:"",difficulty:"All",history:"unseen"});
    expect(result.map(x=>x.id)).toEqual(["def67890","ghi11111"]);
  });
  it("sanitizes persistent queues, invalid IDs and duplicate tags",()=>{
    expect(sanitizeProductivity({queue:["abc12345","abc12345","bad"],errors:{abc12345:{tags:["Careless","Careless","bad"],updatedAt:"date"}}},new Set(bank.map(x=>x.id)))).toEqual({version:1,queue:["abc12345"],errors:{abc12345:{tags:["Careless"],updatedAt:"date"}}});
  });
  it("calculates compact pacing groups from existing session timing",()=>{
    const session={questionIds:["abc12345","def67890","ghi11111"],answers:{abc12345:{correct:true},def67890:{correct:false},ghi11111:{correct:false}},elapsed:{abc12345:30,def67890:180,ghi11111:10},timerMode:"session",timerSeconds:300} as unknown as Session;
    const result=pacingAnalysis(session,bank);
    expect(result.average).toBeCloseTo(220/3); expect(result.slowWrong.map(x=>x.id)).toEqual(["def67890"]); expect(result.fastWrong.map(x=>x.id)).toEqual(["ghi11111"]); expect(result.remaining).toBe(80);
  });
});
