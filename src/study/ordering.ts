import type { Question, TestSection } from "../types";
import { MODULE_BLUEPRINT } from "./config";

// Display labels are never used as UI-language settings. Canonicalize taxonomy
// variants without modifying the immutable bank or stored question identities.
const canonical = (s: string) => s.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim();
export const READING_ORDER = ["Craft and Structure","Information and Ideas","Standard English Conventions","Expression of Ideas"];
const difficulty = { Easy:0, Medium:1, Hard:2 };
export function orderModuleQuestions(selected: Question[], test: TestSection): Question[] {
  const domains = READING_ORDER.map(canonical);
  // Stable sort preserves the selected random order for equal difficulty.
  return [...selected].sort((a,b)=>{
    if(test==="Math") return difficulty[a.difficulty]-difficulty[b.difficulty];
    const domain=domains.indexOf(canonical(a.domain))-domains.indexOf(canonical(b.domain));
    if(domain) return domain;
    if(canonical(a.domain)!==canonical("Standard English Conventions")){
      const skill=canonical(a.skill).localeCompare(canonical(b.skill));
      if(skill) return skill;
    }
    return difficulty[a.difficulty]-difficulty[b.difficulty];
  });
}
export function validateModuleStructure(selected: Question[], test: TestSection) {
  const blueprint=MODULE_BLUEPRINT[test];
  if(selected.length!==blueprint.count || new Set(selected.map(q=>q.id)).size!==selected.length || selected.some(q=>q.test!==test))
    throw Error("Cannot generate a complete, distinct-question module from this bank.");
  for(const domain of Object.keys(blueprint.domains))
    if(!selected.some(q=>canonical(q.domain)===canonical(domain))) throw Error("The module is missing a required domain: "+domain);
  if(test==="Math" && selected.filter(q=>q.questionType==="numeric").length!==blueprint.numericCount)
    throw Error("The module cannot satisfy its numeric-response blueprint.");
  const ordered=orderModuleQuestions(selected,test);
  if(ordered.some((q,i)=>q.id!==selected[i].id)) throw Error("The module question order is invalid.");
}
