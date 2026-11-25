import { useEffect, useState } from 'react';
import type { Question, Session } from '../types';
import type { StudyState } from './types';
import { CHALLENGES } from './ladder';
import { estimateSAT } from './scoreEstimate';

export function ChallengeLadder({ study, onStart, onBack }: { study: StudyState; onStart: (level: number) => void; onBack: () => void }) {
  return <main className="page"><button onClick={onBack}>← Home</button><h1>Challenge Ladder</h1>
    <p>Fourteen practice challenges, separate from your XP level. Answers appear after finishing. Each attempt uses a fresh set; the last three completed sets are excluded.</p>
    <div className="challenge-list">{CHALLENGES.map(rule => {
      const progress = study.ladder?.levels[rule.level], locked = rule.level > (study.ladder?.highestUnlocked ?? 1);
      return <article key={rule.level}><h2>{rule.level}. {rule.test}</h2>
        <p>{rule.count} questions · {Math.round(rule.accuracy * 100)}% accuracy · {Math.floor(rule.seconds / 60)}:{String(rule.seconds % 60).padStart(2,'0')} limit</p>
        <p>{rule.mix.Easy} Easy / {rule.mix.Medium} Medium / {rule.hard} Hard. {rule.hardCorrect > 0 && `At least ${rule.hardCorrect} Hard correct. `}{rule.noUnanswered && 'Answer every question.'}</p>
        {progress && <p>{progress.completedAt ? `Passed ${new Date(progress.completedAt).toLocaleDateString()}` : 'Not yet passed'} · {progress.attempts} attempts · Best accuracy {Math.round(progress.bestAccuracy * 100)}% · Fastest attempt {Math.round(progress.bestTime)}s</p>}
        <button disabled={locked} onClick={() => onStart(rule.level)}>{locked ? 'Locked' : progress?.completedAt ? 'Replay with new questions' : 'Start challenge'}</button>
      </article>;
    })}</div></main>;
}
export function MockTransition({ session, onContinue, onHome }: { session: Session; onContinue: () => void; onHome: () => void }) {
  const breakEnd = Date.parse(session.module?.completedAt ?? '') + 10 * 60 * 1000;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const remaining = Math.max(0, Math.ceil((breakEnd - now) / 1000));
  const stage = session.mock!.stage;
  return <main className="page"><h1>{stage === 1 ? 'Reading & Writing complete' : 'Module 1 complete'}</h1>
    <p>{stage === 1 ? 'Take the standard 10-minute break before Math. You may skip it for practice.' : 'Module 2 uses the existing deterministic practice routing based on Module 1 performance.'}</p>
    {stage === 1 && remaining > 0 && <p>Break remaining: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2,'0')}</p>}
    <p>This practice routing approximates adaptation; it does not reproduce College Board scoring.</p>
    <div className="button-row"><button onClick={onHome}>Save and return home</button><button className="primary" onClick={onContinue}>{stage === 1 ? 'Continue to Math' : 'Start Module 2'}</button></div></main>;
}
export function ExtraResults({ session, questions }: { session: Session; questions: Question[] }) {
  if (session.challenge) return <aside className="extra-results page" role="status"><h2>Challenge {session.challenge.level}: {session.challenge.passed ? 'Passed' : 'Keep practicing'}</h2><p>{session.challenge.passed ? 'The next challenge is unlocked. Your result is saved.' : 'Replay from the Challenge Ladder with a fresh question set.'}</p></aside>;
  if (!session.mock?.complete) return null;
  const correct = (test: Question['test']) => questions.filter(q => q.test === test && session.questionIds.includes(q.id) && session.answers[q.id]?.correct).length;
  const rw = correct('Reading and Writing'), math = correct('Math'), estimate = estimateSAT(rw, math);
  return <aside className="extra-results page"><h1>Estimated SAT Score</h1>
    <p><strong>{estimate.total.low}–{estimate.total.high}</strong> · midpoint {estimate.total.midpoint}</p>
    <p>Reading & Writing: {rw}/54 · estimated {estimate.reading.low}–{estimate.reading.high} (midpoint {estimate.reading.midpoint})</p>
    <p>Math: {math}/44 · estimated {estimate.math.low}–{estimate.math.high} (midpoint {estimate.math.midpoint})</p>
    <p>A rough, uncalibrated orientation estimate, not an official SAT score or a statistical confidence interval. Public paper-practice ranges are percentage-mapped and widened for this unequated question bank. Actual digital SAT scoring uses question characteristics and IRT.</p>
    <details className="scoring-explanation">
      <summary>How the SAT score is calculated — official method and this mock's limits</summary>
      <p>The real SAT reports 200–800 for each section and adds them for a 400–1600 total. Each section uses both modules; Module 1 determines the difficulty of Module 2.</p>
      <p>College Board uses Item Response Theory (IRT): the answer pattern and calibrated characteristics of the questions matter. The same number correct can produce different scores. There is no universal “points lost per wrong answer” table.</p>
      <p>Two pretest questions in each official module do not count toward the score. Their identity and the required item parameters are not provided with this bank. This mock counts all 98 questions for practice and cannot recreate that official calculation.</p>
      <p>Our displayed range is only an uncalibrated practice estimate: section accuracy is mapped to the public paper Practice Test 8 scale, interpolated between seven anchors, widened by 60 points per section and rounded to tens. The total adds the two section estimates. It is not an IRT calculation, a validated prediction or an official confidence interval.</p>
      <p>Public conversion worksheets apply to their specific full paper tests. Applying one to random bank questions does not make an official digital SAT score. For a scored adaptive benchmark, take a new Bluebook test and enter its reported result in the Bluebook score log.</p>
      <p>Sources: <a href="https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated" target="_blank" rel="noreferrer">College Board: How scores are calculated</a> · <a href="https://satsuite.collegeboard.org/media/pdf/scoring-sat-practice-test-8-digital.pdf" target="_blank" rel="noreferrer">Practice Test 8 scoring worksheet</a></p>
    </details>
  </aside>;
}
