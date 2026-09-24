import { useEffect, useMemo, useState } from "react";
import type { Question } from "../types";
import { SourceImage } from "../components/SourceImage";
import {
  advanceDuel,
  chooseDuelAnswer,
  expireDuelRound,
  generateDuel,
  lockDuelAnswer,
  summarizeDuel,
  type DuelHistory,
  type DuelMatch,
  type DuelMode,
  type DuelPlayer,
  type DuelSetup as DuelOptions,
  type DuelSubject,
} from "./duel";
import "./duel.css";

export function DuelSetup({ questions, history, onStart, onBack }: {
  questions: Question[];
  history: DuelHistory;
  onStart: (match: DuelMatch) => void;
  onBack: () => void;
}) {
  const [subject, setSubject] = useState<DuelSubject>("Mixed");
  const [mode, setMode] = useState<DuelMode>("Regular");
  const [count, setCount] = useState<DuelOptions["count"]>(10);
  const [timerSeconds, setTimer] = useState<DuelOptions["timerSeconds"]>(60);
  const [p1Name, setP1Name] = useState("Player 1");
  const [p2Name, setP2Name] = useState("Player 2");
  return <main className="page duel-setup">
    <button onClick={onBack}>← Home</button>
    <p className="eyebrow">SAME QUESTIONS · ISOLATED RESULTS</p>
    <h1>Local 1v1</h1>
    <p>Two players on one PC. Duel answers never change XP, Rank, mastery, Campaign, achievements, quests, review schedules, or normal history.</p>
    <div className="duel-options">
      <label>Subject<select aria-label="1v1 subject" value={subject} onChange={(event) => setSubject(event.target.value as DuelSubject)}>
        <option>Math</option><option>Reading and Writing</option><option>Mixed</option>
      </select></label>
      <label>Difficulty<select aria-label="1v1 difficulty" value={mode} onChange={(event) => setMode(event.target.value as DuelMode)}>
        <option>Regular</option><option>Hard</option>
      </select></label>
      <label>Questions<select aria-label="1v1 questions" value={count} onChange={(event) => setCount(Number(event.target.value) as DuelOptions["count"])}>
        {[5, 10, 15, 20].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>Per-question timer<select aria-label="1v1 timer" value={timerSeconds} onChange={(event) => setTimer(Number(event.target.value) as DuelOptions["timerSeconds"])}>
        <option value={0}>Off</option>{[30, 45, 60, 90].map((value) => <option key={value} value={value}>{value} sec</option>)}
      </select></label>
      <label>Player 1 name<input aria-label="Player 1 name" maxLength={20} value={p1Name} onChange={(event) => setP1Name(event.target.value)} /></label>
      <label>Player 2 name<input aria-label="Player 2 name" maxLength={20} value={p2Name} onChange={(event) => setP2Name(event.target.value)} /></label>
    </div>
    <button className="primary" onClick={() => onStart(generateDuel(questions, { subject, mode, count, timerSeconds, p1Name, p2Name }, crypto.randomUUID(), Date.now()))}>Start Local 1v1</button>
    <section><h2>Match history</h2>{history.matches.length ? <ul className="duel-history">{history.matches.slice(-8).reverse().map((match) => <li key={match.id}><strong>{match.p1Name} {match.p1}–{match.p2} {match.p2Name}</strong> · {match.winner === "Draw" ? "Draw" : `${match.winner} won`} · {match.subject} · {match.mode} · {new Date(match.date).toLocaleDateString()}</li>)}</ul> : <p>No completed matches yet.</p>}</section>
  </main>;
}

function QuestionView({ question }: { question: Question }) {
  return <section className="duel-question" aria-label="Shared question">
    {question.passage && <div className="duel-passage">{question.passage}</div>}
    <div className="stem">
      {question.passageAssets?.map((asset) => <SourceImage key={asset} src={asset} dpi={question.assetDpi ?? 180} alt="Question context" />)}
      {question.assets.length ? question.assets.map((asset) => <SourceImage key={asset} src={asset} dpi={question.assetDpi ?? 180} alt={`Question ${question.questionId}`} />) : question.stem}
    </div>
  </section>;
}

export function Duel({ questions, match, onChange, onFinish, onBack, onFeedback }: {
  questions: Question[];
  match: DuelMatch;
  onChange: (match: DuelMatch) => void;
  onFinish: (match: DuelMatch) => void;
  onBack: () => void;
  onFeedback: (correct: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const question = questions.find((item) => item.id === match.questionIds[match.index])!;
  const round = match.rounds[question.id];
  const summary = useMemo(() => summarizeDuel(match, now), [match, now]);
  const apply = (next: DuelMatch) => {
    if (!round.revealed && next.rounds[question.id].revealed)
      onFeedback(next.rounds[question.id].p1.correct === true && next.rounds[question.id].p2.correct === true);
    onChange(next);
  };
  useEffect(() => {
    if (!match.deadline || round.revealed || match.finished) return;
    const timer = window.setInterval(() => {
      const time = Date.now(); setNow(time);
      if (time >= match.deadline!) apply(expireDuelRound(match, question, time));
    }, 200);
    return () => clearInterval(timer);
  });
  useEffect(() => {
    if (match.finished) return;
    const keys: Record<string, [DuelPlayer, number]> = { a: ["p1", 0], s: ["p1", 1], d: ["p1", 2], f: ["p1", 3], j: ["p2", 0], k: ["p2", 1], l: ["p2", 2], ";": ["p2", 3] };
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      const binding = keys[event.key.toLowerCase()];
      if (!binding) return;
      event.preventDefault();
      const choice = question.choices[binding[1]];
      if (choice) onChange(chooseDuelAnswer(match, binding[0], choice.label));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [match, question, onChange]);
  useEffect(() => { if (match.finished) onFinish(match); }, [match.finished]);

  if (match.finished) return <DuelResults questions={questions} match={match} onBack={onBack} />;
  const remaining = match.deadline ? Math.max(0, Math.ceil((match.deadline - now) / 1000)) : null;
  const score = Object.values(match.rounds).reduce((value, item) => ({ p1: value.p1 + Number(item.p1.correct === true), p2: value.p2 + Number(item.p2.correct === true) }), { p1: 0, p2: 0 });
  const player = (id: DuelPlayer, title: string, keys: string[]) => {
    const answer = round[id];
    return <section className="duel-player" aria-label={title}>
      <h2>{title}</h2>
      <p className="duel-keys">{keys.join(" / ")}</p>
      <div className="choices">{question.choices.map((choice, index) => {
        const shown = round.revealed && answer.answer === choice.label;
        const correct = round.revealed && choice.label === question.correctAnswer;
        return <button key={choice.label} disabled={answer.locked || round.revealed} className={`choice ${correct ? "correct" : ""} ${shown && !answer.correct ? "incorrect" : ""}`} onClick={() => onChange(chooseDuelAnswer(match, id, choice.label))}>
          <span className="choice-letter">{choice.label}</span><span className="choice-content">{choice.assets?.length ? choice.assets.map((asset) => <SourceImage key={asset} src={asset} dpi={question.assetDpi ?? 180} alt={`Choice ${choice.label}`} />) : choice.text}</span>
        </button>;
      })}</div>
      <p className="duel-private-status">{round.revealed ? `${answer.answer || "Unanswered"} · ${answer.correct ? "Correct" : "Incorrect"}` : answer.locked ? "Locked in" : answer.answer ? "Answer selected" : "Choose an answer"}</p>
      {!round.revealed && <button className="primary" disabled={!answer.answer || answer.locked} onClick={() => apply(lockDuelAnswer(match, id, question, Date.now()))}>Lock in</button>}
    </section>;
  };
  return <main className="duel-page">
    <header className="duel-scoreboard"><button onClick={onBack}>Exit duel</button><strong>{match.setup.p1Name.toUpperCase()}&nbsp;&nbsp; {score.p1} — {score.p2} &nbsp;&nbsp;{match.setup.p2Name.toUpperCase()}</strong><span>Question {match.index + 1} / {match.questionIds.length}{remaining !== null ? ` · ${remaining}s` : ""}</span></header>
    <QuestionView question={question} />
    <div className="duel-split">{player("p1", match.setup.p1Name, ["A", "S", "D", "F"])}{player("p2", match.setup.p2Name, ["J", "K", "L", ";"])}</div>
    {round.revealed && <footer className="duel-reveal"><strong>Correct answer: {question.correctAnswer}</strong><button className="primary" onClick={() => apply(advanceDuel(match, Date.now()))}>{match.index === match.questionIds.length - 1 ? "Finish match" : "Next question"}</button></footer>}
  </main>;
}

function DuelResults({ questions, match, onBack }: { questions: Question[]; match: DuelMatch; onBack: () => void }) {
  const result = summarizeDuel(match, Date.now());
  const average = (player: DuelPlayer) => {
    const answers = Object.values(match.rounds).filter((round) => round[player].correct);
    return answers.length ? answers.reduce((sum, round) => sum + (round[player].responseMs ?? 0), 0) / answers.length / 1000 : 0;
  };
  return <main className="page duel-results"><p className="eyebrow">FINAL SCORE</p><h1>{result.winner === "Draw" ? "Draw" : `${result.winner} wins`}</h1><h2>{result.p1} — {result.p2}</h2><p>{result.p1Name}: {Math.round(result.p1 / result.count * 100)}% · {average("p1").toFixed(1)}s average correct response</p><p>{result.p2Name}: {Math.round(result.p2 / result.count * 100)}% · {average("p2").toFixed(1)}s average correct response</p>
    <div className="duel-comparison">{match.questionIds.map((id, index) => { const question = questions.find((item) => item.id === id)!; const round = match.rounds[id]; return <div key={id}><strong>Q{index + 1}</strong><span>{result.p1Name} {round.p1.answer || "—"} {round.p1.correct ? "✓" : "×"}</span><span>{result.p2Name} {round.p2.answer || "—"} {round.p2.correct ? "✓" : "×"}</span><span>Correct {question.correctAnswer}</span></div>; })}</div>
    <button className="primary" onClick={onBack}>Back to home</button>
  </main>;
}
