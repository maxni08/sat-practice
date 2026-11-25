import type { Question } from "../types";

const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
/** Identical text with permuted choices is still the same question. Include
 * visuals when content depends on them: bare math transcription is incomplete. */
export function mockQuestionIdentity(q: Question): string {
  const visual = q.assets.length > 0 || q.choices.some(c => c.assets?.length) || q.requiresOriginalFormat;
  return JSON.stringify([
    q.test, q.questionType, normalize(q.passage), normalize(q.stem),
    q.choices.map(c => JSON.stringify([normalize(c.text), visual ? [...(c.assets ?? [])].sort() : []])).sort(),
    visual ? [...q.assets, ...(q.passageAssets ?? [])].sort() : [],
  ]);
}
export function uniqueMockBank(questions: Question[], excluded: Set<string>): Question[] {
  const identities = new Set(questions.filter(q=>excluded.has(q.id)).map(mockQuestionIdentity));
  const result: Question[] = [];
  for(const q of questions){
    if(excluded.has(q.id)) continue;
    const key=mockQuestionIdentity(q);
    if(identities.has(key))continue;
    identities.add(key);result.push(q);
  }
  return result;
}
export function assertUniqueMockQuestions(questions: Question[], ids: string[]) {
  if(new Set(ids).size!==ids.length) throw Error("Repeated question IDs detected in mock. The next module was not opened.");
  const bank=new Map(questions.map(q=>[q.id,q]));
  const seen=new Set<string>();
  for(const id of ids){
    const q=bank.get(id);
    if(!q)throw Error("Mock question is missing from the library: "+id);
    const key=mockQuestionIdentity(q);
    if(seen.has(key))throw Error("Duplicate question content detected in mock. The next module was not opened.");
    seen.add(key);
  }
}
