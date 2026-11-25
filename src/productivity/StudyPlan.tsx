import { useState, useRef } from "react";
import type { ProgressMap, Question, Session, TestSection } from "../types";
import type { StudyState } from "../study/types";
import { pacingAnalysis } from "./productivity";

export type BluebookScore = { date: string; test: string; rw: number | null; math: number | null };
const defaultRotation: TestSection[] = ["Reading and Writing", "Reading and Writing", "Math"];
const key = "sat-practice-bluebook-v1";

export function validScore(value: number) {
  return Number.isInteger(value) && value >= 200 && value <= 800 && value % 10 === 0;
}

export function loadBluebook(): BluebookScore[] {
  try {
    const rows = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(rows) ? rows.filter(r => r && typeof r.date === "string" && typeof r.test === "string" && (r.rw == null || validScore(r.rw)) && (r.math == null || validScore(r.math)) && (r.rw != null || r.math != null)) : [];
  } catch { return []; }
}

export function freshSkill(source: Question, bank: Question[], progress: ProgressMap, count = 12) {
  return bank.filter(q => q.id !== source.id && q.test === source.test && q.domain === source.domain && q.skill === source.skill && !progress[q.id]?.attempts).slice(0, count);
}

export function focusSections(score: Pick<BluebookScore, "rw" | "math">): TestSection[] {
  if (score.rw == null) return ["Math"];
  if (score.math == null) return ["Reading and Writing"];
  const rwGap = 760 - score.rw;
  const mathGap = 790 - score.math;
  const first = rwGap >= mathGap ? "Reading and Writing" : "Math";
  const second = first === "Math" ? "Reading and Writing" : "Math";
  return Math.abs(rwGap - mathGap) < 20 ? [first, second] : [first, first, second];
}

export function StudyToday({ questions, progress, study, onPractice, onModule }: {
  questions: Question[]; progress: ProgressMap; study: StudyState | null;
  onPractice: (ids: string[]) => void; onModule: (test: TestSection) => void;
}) {
  const [scores, setScores] = useState(loadBluebook);
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const latest = scores[0];
  const totals = scores.filter(s=>s.rw != null && s.math != null).map(s=>s.rw!+s.math!);
  const best = totals.length ? Math.max(...totals) : null;
  const blocks = latest ? focusSections(latest) : defaultRotation;
  const test = blocks[(Math.floor(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) / 86400000)) % blocks.length];
  const due = questions.filter(q => q.test === test && Date.parse(study?.reviews[q.id]?.dueAt ?? "") <= Date.now())
    .sort((a,b) => Date.parse(study!.reviews[a.id].dueAt) - Date.parse(study!.reviews[b.id].dueAt)).slice(0,12);
  const weak = Object.values(study?.skills ?? {}).filter(s => s.test === test && s.samples > 0).sort((a,b) => a.score-b.score);
  const seed = weak.map(s => questions.find(q => q.test === test && q.domain === s.domain && q.skill === s.skill))
    .find(q => q && freshSkill(q, questions, progress).length > 0)
    ?? questions.find(q => q.test === test && progress[q.id]?.lastResult === false && freshSkill(q, questions, progress).length > 0);
  const targeted = seed ? freshSkill(seed, questions, progress) : questions.filter(q => q.test === test && !progress[q.id]?.attempts).slice(0,12);
  return <section className="tool-card">
    <h2>What should I study today?</h2>
    <p>Focus: {test}{seed ? ` · ${seed.skill}` : " · Start with new questions"}. Rotation: {blocks.map(s => s === "Math" ? "Math" : "R&W").join(" → ")}.</p>
    <div className="button-row">
      <button disabled={!due.length} onClick={() => onPractice(due.map(q=>q.id))}>Review due mistakes ({due.length})</button>
      <button disabled={!targeted.length} onClick={() => onPractice(targeted.map(q=>q.id))}>Practice my priority skill</button>
      <button onClick={() => onModule(test)}>Start a timed module</button>
    </div>
    <details>
      <summary>Bluebook score log · Best single test: {best ?? "No complete test recorded"} · Goal: 1550</summary>
      <p>Target: 760 R&W + 790 Math.</p>
      <p>Enter either section or both. Leave an untested section blank; never enter 200 as a placeholder. Only complete tests count toward your best single-test total. Estimates from SAT Practice mocks are separate.</p>
      <form ref={formRef} className="button-row" onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget, data = new FormData(form);
        const row = { date: String(data.get("date")), test: String(data.get("test")).trim(), rw: String(data.get("rw")).trim() ? Number(data.get("rw")) : null, math: String(data.get("math")).trim() ? Number(data.get("math")) : null };
        if (!row.date || !row.test || (row.rw === null && row.math === null) || (row.rw !== null && !validScore(row.rw)) || (row.math !== null && !validScore(row.math))) { setError("Enter a test, date, and at least one section score from 200 to 800 in steps of 10."); return; }
        const next = [row, ...scores.filter(s => s.date !== row.date || s.test !== row.test)].sort((a,b) => b.date.localeCompare(a.date));
        try { localStorage.setItem(key, JSON.stringify(next)); setScores(next); setError(""); form.reset(); } catch { setError("Could not save the Bluebook result."); }
      }}>
        <label>Date <input name="date" type="date" required /></label>
        <label>Test number <input name="test" type="number" min="1" required /></label>
        <label>R&W <input name="rw" type="number" min="200" max="800" step="10" placeholder="Not taken" /></label>
        <label>Math <input name="math" type="number" min="200" max="800" step="10" placeholder="Not taken" /></label>
        <button type="submit">Save Bluebook result</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>{scores.map(s => <li key={s.date+":"+s.test}>{s.date} · Test {s.test} · {s.rw != null && s.math != null ? s.rw+s.math : "Section practice"} ({s.rw ?? "—"} R&W + {s.math ?? "—"} Math)
        <button onClick={()=>{const form=formRef.current!; for(const [name,value] of Object.entries(s)){const input=form.elements.namedItem(name) as HTMLInputElement; if(input) input.value=value == null ? "" : String(value);} form.scrollIntoView({block:"nearest"});}}>Edit</button>
        <button onClick={()=>{const next=scores.filter(row=>row!==s);try{localStorage.setItem(key,JSON.stringify(next));setScores(next);}catch{setError("Could not remove result.");}}}>Remove</button>
      </li>)}</ul>
    </details>
  </section>;
}

export function ModuleNextSteps({ session, questions, progress, onPractice }: {
  session: Session; questions: Question[]; progress: ProgressMap; onPractice: (ids: string[]) => void;
}) {
  if (!session.module || !session.finished || session.module.awaitingNext) return null;
  const misses = new Map<string, { source: Question; count: number }>();
  const bank = new Map(questions.map(q => [q.id,q]));
  for (const id of session.questionIds) {
    const q = bank.get(id);
    if (!q || session.answers[id]?.correct !== false) continue;
    const key = JSON.stringify([q.test, q.domain,q.skill]);
    const entry = misses.get(key);
    misses.set(key,{source:q,count:(entry?.count ?? 0)+1});
  }
  const patterns = [...misses.values()].sort((a,b)=>b.count-a.count).slice(0,3);
  const slow = pacingAnalysis(session, questions).slowWrong;
  return <section className="page tool-card"><h2>What to practice next</h2>
    {!patterns.length && <p>No incorrect answers to drill in this module.</p>}
    {patterns.map(({source,count}) => {
      const fresh = freshSkill(source, questions, progress);
      return <div key={source.id} className="button-row"><p>{count} missed · {source.skill}</p>
        <button disabled={!fresh.length} onClick={() => onPractice(fresh.map(q=>q.id))}>{fresh.length ? `Practice this pattern (${fresh.length} new)` : "No new questions for this skill"}</button></div>;
    })}
    {slow.length > 0 && <><h3>Slow and incorrect</h3><ul>{slow.map(row => <li key={row.id}>Q{row.index + 1} · {Math.floor(row.seconds/60)}:{String(Math.floor(row.seconds%60)).padStart(2,"0")} · {row.question.skill}</li>)}</ul></>}
  </section>;
}
