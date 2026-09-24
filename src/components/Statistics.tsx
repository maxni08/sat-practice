import type { Question, QuestionProgress, Session } from "../types";
import type { ReactNode } from "react";
import { pacingAnalysis } from "../productivity/productivity";
type Row = { name: string; correct: number; total: number; seconds: number };
const pct = (c: number, t: number) =>
  t ? `${Math.round((c / t) * 100)}%` : "—";
export function Breakdown({ rows, title }: { rows: Row[]; title: string }) {
  return (
    <section className="breakdown">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">{title.replace("Accuracy by ", "")}</th>
            <th scope="col">Correct</th>
            <th scope="col">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .sort((a, b) => a.correct / a.total - b.correct / b.total)
            .map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td>
                  {r.correct} / {r.total}
                </td>
                <td>
                  <span className="accuracy-bar">
                    <i style={{ width: `${(r.correct / r.total) * 100}%` }} />
                  </span>
                  {pct(r.correct, r.total)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="muted">Answer a few questions to see your progress.</p>
      )}
    </section>
  );
}
function aggregate(
  questions: Question[],
  getter: (q: Question) => { correct: number; total: number; seconds: number },
  key: "domain" | "skill" | "difficulty" | "test",
) {
  const rows = new Map<string, Row>();
  for (const q of questions) {
    const n = getter(q);
    if (!n.total) continue;
    const r = rows.get(q[key]) ?? {
      name: q[key],
      correct: 0,
      total: 0,
      seconds: 0,
    };
    r.correct += n.correct;
    r.total += n.total;
    r.seconds += n.seconds;
    rows.set(r.name, r);
  }
  return [...rows.values()];
}
export function Progress({
  questions,
  progress,
  onBack,
  onPractice,
  onReview,
  studyPanel,
}: {
  questions: Question[];
  progress: Record<string, QuestionProgress>;
  onBack: () => void;
  onPractice: (test: Question["test"]) => void;
  onReview: (q: Question) => void;
  studyPanel?: ReactNode;
}) {
  const get = (q: Question) => ({
    correct: progress[q.id]?.correctAttempts ?? 0,
    total: progress[q.id]?.attempts ?? 0,
    seconds: progress[q.id]?.totalTimeSpent ?? 0,
  });
  const all = questions.map(get);
  const correct = all.reduce((s, r) => s + r.correct, 0),
    total = all.reduce((s, r) => s + r.total, 0),
    seconds = all.reduce((s, r) => s + r.seconds, 0);
  const skills = aggregate(questions, get, "skill");
  const weak = [...skills]
    .sort(
      (a, b) => a.correct / a.total - b.correct / b.total || b.total - a.total,
    )
    .slice(0, 5);
  const missed = questions.filter((q) => progress[q.id]?.incorrectAttempts > 0);
  return (
    <main className="page progress-page">
      <button className="text-button back" onClick={onBack}>
        ← Home
      </button>
      <p className="eyebrow">YOUR STUDY RECORD</p>
      <h1>Progress</h1>
      <div className="metric-grid">
        <Metric
          value={String(
            questions.filter((q) => progress[q.id]?.attempts > 0).length,
          )}
          label="Questions attempted"
        />
        <Metric value={pct(correct, total)} label="Overall accuracy" />
        <Metric
          value={total ? `${Math.round(seconds / total)}s` : "—"}
          label="Average time / attempt"
        />
        {(["Math", "Reading and Writing"] as const).map((section) => {
          const r = aggregate(questions, get, "test").find(
            (row) => row.name === section,
          ) ?? { name: section, correct: 0, total: 0 };
          return (
            <Metric
              key={r.name}
              value={pct(r.correct, r.total)}
              label={`${r.name} accuracy`}
            />
          );
        })}
      </div>
      <p className="muted">
        Accuracy includes all {total} submitted attempts. Time measures active
        question practice.
      </p>
      {studyPanel}
      {!studyPanel && (
        <section className="weak">
          <h2>Skills to work on</h2>
          {weak.length ? (
            <ul>
              {weak.map((r) => (
                <li key={r.name}>
                  <span>{r.name}</span>
                  <strong>{pct(r.correct, r.total)}</strong>
                  <small>{r.total} attempts</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>Your weakest skills will appear after you practice.</p>
          )}
        </section>
      )}
      <Breakdown
        rows={aggregate(questions, get, "domain")}
        title="Accuracy by domain"
      />
      <Breakdown rows={skills} title="Accuracy by skill" />
      <Breakdown
        rows={aggregate(questions, get, "difficulty")}
        title="Accuracy by difficulty"
      />
      <section>
        <h2>
          Incorrect-question bank{" "}
          <span className="muted">({missed.length})</span>
        </h2>
        <div className="button-row">
          <button onClick={() => onPractice("Reading and Writing")}>
            Practice Reading & Writing misses
          </button>
          <button onClick={() => onPractice("Math")}>
            Practice Math misses
          </button>
        </div>
        <div className="question-list">
          {missed.map((q) => (
            <button key={q.id} onClick={() => onReview(q)}>
              <strong>{q.questionId}</strong>
              <span>
                {q.test} · {q.skill}
              </span>
              <span>Review →</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
export function Results({
  session,
  questions,
  onReview,
  onHome,
  progress,
}: {
  session: Session;
  questions: Question[];
  onReview: (index: number) => void;
  onHome: () => void;
  progress?: Record<string, QuestionProgress>;
}) {
  const bank = session.questionIds
    .map((id) => questions.find((q) => q.id === id)!)
    .filter(Boolean);
  const answers = Object.values(session.answers);
  const endless = session.endless;
  const correct = endless?.correct ?? answers.filter((a) => a.correct).length;
  const total = endless?.answered ?? bank.length;
  const module = session.mode === "module";
  const marked = new Set(
    session.module?.marked ??
      bank.filter((q) => progress?.[q.id]?.bookmark).map((q) => q.id),
  );
  const seconds = endless?.activeSeconds ?? (module
    ? Object.values(session.elapsed).reduce((a, b) => a + b, 0)
    : answers.reduce((s, a) => s + a.timeSpent, 0));
  const get = (q: Question) => ({
    correct: session.answers[q.id]?.correct ? 1 : 0,
    total: 1,
    seconds: session.answers[q.id]?.timeSpent ?? 0,
  });
  const missed = bank.filter(
    (q) => session.answers[q.id] && !session.answers[q.id].correct,
  );
  return (
    <main className="page">
      <p className="eyebrow">{endless ? "ENDLESS SESSION COMPLETE" : "PRACTICE COMPLETE"}</p>
      <h1>
        {session.mock?.complete ? 'Full SAT Mock results' : session.challenge ? 'Challenge results' : module
          ? session.module?.sectionSummary
            ? "Section results"
            : "Module results"
          : endless ? "Keep the momentum. Come back whenever you want." : "Every question is a step forward."}
      </h1>
      <div className="metric-grid">
        <Metric value={`${correct} / ${total}`} label="Correct answers" />
        <Metric value={pct(correct, total)} label="Accuracy" />
        <Metric
          value={
            (module ? bank.length : total)
              ? `${Math.round(seconds / (module ? bank.length : total))}s`
              : "—"
          }
          label={module ? "Average time / question" : "Average time / answer"}
        />
      </div>
      <p className="muted">
        {total} answered{endless ? "" : ` · ${bank.length - answers.length} unanswered`}.
        This is a practice result, not an official SAT scaled score.
      </p>
      <div className="button-row">
        <button className="primary" onClick={onHome}>
          Back to home
        </button>
        <button onClick={() => onReview(0)}>Review all questions</button>
      </div>
      <Breakdown
        rows={aggregate(bank, get, "domain")}
        title="Accuracy by domain"
      />
      <Breakdown
        rows={aggregate(bank, get, "skill")}
        title="Accuracy by skill"
      />
      {module && (
        <Breakdown
          rows={aggregate(bank, get, "difficulty")}
          title="Accuracy by difficulty"
        />
      )}
      {module && <Pacing session={session} questions={questions} />}
      <h2>Questions missed ({missed.length})</h2>
      <div className="question-list">
        {missed.map((q) => (
          <button
            key={q.id}
            onClick={() => onReview(session.questionIds.indexOf(q.id))}
          >
            <strong>Question {session.questionIds.indexOf(q.id) + 1}</strong>
            <span>{q.skill}</span>
            <span>Review →</span>
          </button>
        ))}
      </div>
      {module && (
        <section className="module-details">
          <h2>All module questions</h2>
          <p className="muted">
            {bank.filter((q) => !session.answers[q.id]).length} unanswered ·{" "}
            {bank.filter((q) => marked.has(q.id)).length} marked for review
          </p>
          <table>
            <thead>
              <tr>
                <th>Question</th>
                <th>Difficulty</th>
                <th>Result</th>
                <th>Time</th>
                <th>Review flag</th>
              </tr>
            </thead>
            <tbody>
              {bank.map((q, i) => (
                <tr key={q.id}>
                  <td>
                    <button onClick={() => onReview(i)}>
                      Question {i + 1} · {q.questionId}
                    </button>
                  </td>
                  <td>{q.difficulty}</td>
                  <td>
                    {session.answers[q.id]
                      ? session.answers[q.id].correct
                        ? "Correct"
                        : "Incorrect"
                      : "Unanswered"}
                  </td>
                  <td>{Math.round(session.elapsed[q.id] ?? 0)}s</td>
                  <td className="marked">
                    {marked.has(q.id) ? "Marked" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
function Pacing({session,questions}:{session:Session;questions:Question[]}) {
  const p=pacingAnalysis(session,questions), format=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.round(seconds%60)).padStart(2,"0")}`;
  const rows=(title:string,items:typeof p.slowest)=><section className="pacing-list"><h3>{title}</h3>{items.length?items.map(row=><p key={row.id}>Q{row.index+1} — {format(row.seconds)} — {row.correct?"Correct":"Incorrect"} — {row.question.domain}</p>):<p className="muted">None</p>}</section>;
  return <section className="module-details"><h2>Pacing analysis</h2><p>Average {format(p.average)} per question · First third {format(p.firstThird)} · Final third {format(p.finalThird)}{p.remaining!==null?` · ${format(p.remaining)} remaining`:""}</p><div className="pacing-grid">{rows("Slowest questions",p.slowest)}{rows("Slow + wrong",p.slowWrong)}{rows("Fast + wrong",p.fastWrong)}</div>{p.byDomain.length>0&&<p className="muted">By domain: {p.byDomain.map(row=>`${row.name} ${format(row.average)}`).join(" · ")}</p>}{p.bySkill.length>0&&<p className="muted">By skill: {p.bySkill.slice(0,6).map(row=>`${row.name} ${format(row.average)}`).join(" · ")}</p>}</section>;
}
