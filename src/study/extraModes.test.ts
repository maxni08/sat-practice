import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Question, Session } from '../types';
import { initializeStudy } from './rewards';
import { generateMock } from './mock';
import { CHALLENGES, generateChallenge, challengeResult, completeChallenge } from './ladder';
import { estimateSAT, estimateSection } from './scoreEstimate';
import { studyCompletion } from './transitions';
import { gradeModule } from './modules';
const bank = JSON.parse(readFileSync('public/bank/questions.json','utf8')) as Question[];
const now = Date.parse('2026-09-14T12:00:00Z');
const base = () => initializeStudy(bank, {}, now);
function fill(s: Session) { return { ...s, drafts: Object.fromEntries(s.questionIds.map(id => [id, bank.find(q => q.id === id)!.acceptedAnswers[0]])), elapsed: Object.fromEntries(s.questionIds.map(id => [id, 40])) }; }
describe('orientation score estimate', () => {
  it('is bounded, monotonic and deterministic at every raw score', () => {
    for (const test of ['Math','Reading and Writing'] as const) {
      const total = test === 'Math' ? 44 : 54; let last = 0;
      for (let n = 0; n <= total; n++) {
        const a = estimateSection(test,n,total);
        expect(a).toEqual(estimateSection(test,n,total));
        expect(a.low).toBeGreaterThanOrEqual(200); expect(a.high).toBeLessThanOrEqual(800);
        expect(a.midpoint).toBeGreaterThanOrEqual(last); expect(a.low).toBeLessThanOrEqual(a.midpoint); expect(a.high).toBeGreaterThanOrEqual(a.midpoint); last = a.midpoint;
      }
    }
  });
  it('sums section ranges and midpoints without fake precision', () => {
    const s = estimateSAT(50,40); expect(s.total.midpoint).toBe(s.reading.midpoint+s.math.midpoint);
    expect(s.total.low).toBe(s.reading.low+s.math.low); expect(s.total.high).toBe(s.reading.high+s.math.high);
    expect(estimateSAT(54,44).total.high).toBe(1600); expect(estimateSAT(0,0).total.low).toBe(400);
  });
  it('rejects invalid or incomplete raw inputs', () => { expect(() => estimateSAT(55,0)).toThrow(); expect(() => estimateSection('Math',0,0)).toThrow(); expect(() => estimateSAT(NaN,1)).toThrow(); });
});
describe('Full SAT Mock', () => {
  it('runs four existing modules with adaptive second modules, no repeated questions, secrecy and restartable transitions', () => {
    let study = base(), progress = {}, s = generateMock(bank, {}, study, 'mock-start', now);
    const all = new Set<string>();
    for (let stage = 0; stage < 4; stage++) {
      expect(s.mock?.stage).toBe(stage); expect(s.test).toBe(stage < 2 ? 'Reading and Writing' : 'Math');
      expect(s.questionIds.length).toBe(stage < 2 ? 27 : 22); expect(s.timerSeconds).toBe(stage < 2 ? 1920 : 2100);
      expect(s.answers).toEqual({}); for (const id of s.questionIds) { expect(all.has(id)).toBe(false); all.add(id); }
      if (stage % 2) expect(s.module?.route).toBe('harder');
      const result = studyCompletion(fill(s), bank, progress, study, s.startedAt + 600000);
      study = result.study; progress = result.progress; s = JSON.parse(JSON.stringify(result.session));
      if (stage < 3) { expect(s.module?.awaitingNext).toBe(true); s = generateMock(bank, progress, study, `mock-${stage+1}`, now+(stage+1)*700000, s); }
    }
    expect(s.mock?.complete).toBe(true); expect(s.questionIds).toHaveLength(98); expect(Object.values(s.answers).filter(a=>a.correct)).toHaveLength(98); expect(study.modules).toHaveLength(4); expect(s.module?.awaitingNext).toBe(false);
  }, 20000);
  it('routes weak first-module performance easier and refuses premature advancement', () => {
    const study = base(), s = generateMock(bank,{},study,'weak',now);
    expect(() => generateMock(bank,{},study,'too-soon',now,s)).toThrow();
    const done = studyCompletion(s,bank,{},study,now+1000);
    expect(generateMock(bank,{},done.study,'next',now+2000,done.session).module?.route).toBe('easier');
  });
});
describe('Challenge Ladder', () => {
  it('has fourteen sequential achievable configurations on the real bank', () => {
    const study = base(); study.ladder = { highestUnlocked:14, levels:{}, history:[] };
    for (const rule of CHALLENGES) {
      const s = generateChallenge(bank,{},study,rule.level,`level-${rule.level}`,now);
      expect(s.questionIds).toHaveLength(rule.count);
      for (const d of ['Easy','Medium','Hard'] as const) expect(s.questionIds.filter(id => bank.find(q=>q.id===id)!.difficulty===d)).toHaveLength(rule.mix[d]);
      const graded = gradeModule(fill(s),bank,{},now+60000).session;
      expect(challengeResult(graded,bank,now+60000).passed).toBe(true);
    }
  });
  it('preserves secrecy then unlocks sequentially and persists best results without changing existing XP itself', () => {
    const study = base(), s = generateChallenge(bank,{},study,1,'pass',now);
    expect(() => generateChallenge(bank,{},study,2,'locked',now)).toThrow(); expect(fill(s).answers).toEqual({});
    const done = studyCompletion(fill(s),bank,{},study,now+60000);
    expect(done.session.challenge?.passed).toBe(true); expect(done.study.ladder?.highestUnlocked).toBe(2); expect(done.study.modules).toHaveLength(0);
    const restored = JSON.parse(JSON.stringify(done.study)); expect(restored).toEqual(done.study);
    expect(completeChallenge(restored,done.session,bank,now+70000)).toBe(restored);
    expect(restored.ladder.levels[1].completedAt).toBe(new Date(now+60000).toISOString());
  });
  it('fails accuracy, hard-answer, unanswered and time objectives independently', () => {
    const study = base(); study.ladder = { highestUnlocked:14, levels:{}, history:[] };
    const s = generateChallenge(bank,{},study,5,'objectives',now), good = gradeModule(fill(s),bank,{},now+60000).session;
    expect(challengeResult({...good, answers:{}},bank,now+60000).passed).toBe(false);
    const answers = {...good.answers}; delete answers[s.questionIds[0]];
    expect(challengeResult({...good, answers},bank,now+60000).passed).toBe(false);
    const hardWrong = {...good.answers}; for(const id of s.questionIds) if(bank.find(q=>q.id===id)!.difficulty==='Hard') hardWrong[id]={...hardWrong[id],correct:false};
    expect(challengeResult({...good, answers:hardWrong},bank,now+60000).passed).toBe(false);
    expect(challengeResult(good,bank,now+(s.timerSeconds+2)*1000).passed).toBe(false);
  });
  it('failed retries generate distinct sets excluding the last three completed sets', () => {
    let study = base(); const seen = new Set<string>();
    for(let i=0;i<3;i++) {
      const s = generateChallenge(bank,{},study,1,'retry'+i,now+i*10000);
      for(const id of s.questionIds) { expect(seen.has(id)).toBe(false); seen.add(id); }
      study = completeChallenge(study,gradeModule(s,bank,{},now+i*10000+1000).session,bank,now+i*10000+1000);
    }
    expect(study.ladder?.highestUnlocked).toBe(1); expect(study.ladder?.levels[1].attempts).toBe(3);
  });
  it('is seed deterministic and prioritizes questions not practiced in the past day', () => {
    const study = base(), first=generateChallenge(bank,{},study,1,'seed',now);
    expect(generateChallenge(bank,{},study,1,'seed',now).questionIds).toEqual(first.questionIds);
    const progress = Object.fromEntries(first.questionIds.map(id=>[id,{attempts:1,correctAttempts:1,incorrectAttempts:0,lastAnswer:'A',lastResult:true,totalTimeSpent:30,lastAttemptDate:new Date(now).toISOString(),bookmark:false,notes:'',highlights:[]}]));
    expect(generateChallenge(bank,progress,study,1,'seed',now).questionIds.some(id=>first.questionIds.includes(id))).toBe(false);
  });
});
