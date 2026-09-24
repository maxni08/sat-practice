import type { ProgressMap, Question, Session, TestSection, Difficulty } from "../types";

export const ERROR_TAGS = ["Concept", "Careless", "Misread", "Timing", "Vocabulary", "Guess"] as const;
export type ErrorTag = (typeof ERROR_TAGS)[number];
export interface TaggedError { tags: ErrorTag[]; updatedAt: string }
export interface ProductivityState {
  version: 1;
  queue: string[];
  errors: Record<string, TaggedError>;
}
export const emptyProductivity = (): ProductivityState => ({ version: 1, queue: [], errors: {} });
const STORAGE_KEY = "sat-practice-productivity-v1";
export function loadProductivity(): ProductivityState {
  try { const raw=localStorage.getItem(STORAGE_KEY); return raw?sanitizeProductivity(JSON.parse(raw)):emptyProductivity(); }
  catch { return emptyProductivity(); }
}
export function saveProductivity(state: ProductivityState) { localStorage.setItem(STORAGE_KEY,JSON.stringify(sanitizeProductivity(state))); }

export function sanitizeProductivity(raw: unknown, validIds?: Set<string>): ProductivityState {
  const value = raw && typeof raw === "object" ? raw as Partial<ProductivityState> : {};
  const queue = [...new Set(Array.isArray(value.queue) ? value.queue.filter((id): id is string => typeof id === "string" && (!validIds || validIds.has(id))) : [])];
  const errors: Record<string, TaggedError> = {};
  if (value.errors && typeof value.errors === "object") for (const [id, entry] of Object.entries(value.errors)) {
    if (validIds && !validIds.has(id)) continue;
    const tags = Array.isArray(entry?.tags) ? [...new Set(entry.tags.filter((tag): tag is ErrorTag => ERROR_TAGS.includes(tag as ErrorTag)))] : [];
    if (tags.length) errors[id] = { tags, updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString() };
  }
  return { version: 1, queue, errors };
}

const searchable = (q: Question) => `${q.questionId} ${q.stem} ${q.passage} ${q.choices.map(c => c.text).join(" ")}`.toLowerCase();
export function findQuestions(questions: Question[], query: string, limit = 50): Question[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return questions
    .map(q => ({ q, exact: q.questionId.toLowerCase() === term ? 0 : q.questionId.toLowerCase().includes(term) ? 1 : 2 }))
    .filter(row => row.exact < 2 || searchable(row.q).includes(term))
    .sort((a, b) => a.exact - b.exact || a.q.questionId.localeCompare(b.q.questionId))
    .slice(0, limit).map(row => row.q);
}

export function parseQuestionIds(input: string, questions: Question[]) {
  const index = new Map(questions.flatMap(q => [[q.id.toLowerCase(), q], [q.questionId.toLowerCase(), q]]));
  const tokens = input.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
  const ids: string[] = [], invalid: string[] = [], duplicate: string[] = [], seen = new Set<string>();
  for (const token of tokens) {
    const q = index.get(token.toLowerCase());
    if (!q) { invalid.push(token); continue; }
    if (seen.has(q.id)) { duplicate.push(token); continue; }
    seen.add(q.id); ids.push(q.id);
  }
  return { ids, invalid, duplicate };
}

export function similarQuestions(source: Question, questions: Question[], progress: ProgressMap, count = 5): Question[] {
  return questions.filter(q => q.id !== source.id && q.test === source.test).map(q => {
    const p = progress[q.id];
    const recent = p?.lastAttemptDate ? Date.parse(p.lastAttemptDate) : 0;
    const score = Number(q.skill === source.skill) * 10 + Number(q.domain === source.domain) * 5 + Number(q.difficulty === source.difficulty) * 3 + Number(!p?.attempts) * 4 - (recent ? Math.max(0, 3 - (Date.now() - recent) / 86_400_000) : 0);
    return { q, score };
  }).sort((a, b) => b.score - a.score || a.q.questionId.localeCompare(b.q.questionId)).slice(0, count).map(row => row.q);
}

export interface BrowserFilters { query: string; test: "All" | TestSection; domain: string; skill: string; difficulty: "All" | Difficulty; history: "all" | "unseen" | "seen" | "correct" | "incorrect" | "bookmarked" }
export function browseQuestions(questions: Question[], progress: ProgressMap, f: BrowserFilters): Question[] {
  const term = f.query.trim().toLowerCase();
  return questions.filter(q => {
    const p = progress[q.id];
    if (term && !searchable(q).includes(term)) return false;
    if (f.test !== "All" && q.test !== f.test) return false;
    if (f.domain && q.domain !== f.domain) return false;
    if (f.skill && q.skill !== f.skill) return false;
    if (f.difficulty !== "All" && q.difficulty !== f.difficulty) return false;
    if (f.history === "unseen" && p?.attempts) return false;
    if (f.history === "seen" && !p?.attempts) return false;
    if (f.history === "correct" && !p?.correctAttempts) return false;
    if (f.history === "incorrect" && !p?.incorrectAttempts) return false;
    if (f.history === "bookmarked" && !p?.bookmark) return false;
    return true;
  });
}

export function pacingAnalysis(session: Session, questions: Question[]) {
  const rows = session.questionIds.map((id, index) => {
    const q = questions.find(item => item.id === id)!;
    const answer = session.answers[id];
    return { id, index, question: q, seconds: Math.max(0, session.elapsed[id] ?? answer?.timeSpent ?? 0), correct: answer?.correct === true, answered: !!answer };
  }).filter(row => row.question);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.seconds, 0) / rows.length : 0;
  const slowest = [...rows].sort((a, b) => b.seconds - a.seconds).slice(0, 5);
  const wrong = rows.filter(row => row.answered && !row.correct);
  const third = Math.max(1, Math.ceil(rows.length / 3));
  const avg = (items: typeof rows) => items.length ? items.reduce((sum, row) => sum + row.seconds, 0) / items.length : 0;
  const group = (key: "domain" | "skill") => [...rows.reduce((map, row) => {
    const name = row.question[key], item = map.get(name) ?? { name, total: 0, seconds: 0 };
    item.total++; item.seconds += row.seconds; map.set(name, item); return map;
  }, new Map<string, {name:string;total:number;seconds:number}>()).values()].filter(row => row.total >= 2).map(row => ({ ...row, average: row.seconds / row.total })).sort((a,b)=>b.average-a.average);
  return {
    average, slowest,
    slowWrong: wrong.filter(row => row.seconds > average).sort((a,b)=>b.seconds-a.seconds).slice(0,5),
    fastWrong: wrong.filter(row => row.seconds < average * .6).sort((a,b)=>a.seconds-b.seconds).slice(0,5),
    firstThird: avg(rows.slice(0, third)), finalThird: avg(rows.slice(-third)),
    remaining: session.timerMode === "session" ? Math.max(0, session.timerSeconds - rows.reduce((sum,row)=>sum+row.seconds,0)) : null,
    byDomain: group("domain"), bySkill: group("skill"),
  };
}
