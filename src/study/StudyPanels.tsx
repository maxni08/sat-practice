import { ProgressionSummary } from "../progression/Panels";
import { PlatinumMark } from "../achievements/Achievements";
import { useState } from "react";
import type { ProgressMap, Question, Session, TestSection } from "../types";
import { ACHIEVEMENTS, levelProgress } from "./rewards";
import { MODULE_BLUEPRINT } from "./config";
import { recommendations } from "./adaptive";
import { sectionSession } from "./modules";
import type { Recommendation, StudyState } from "./types";
import type { PlaytimeState } from "../playtime/playtime";
import { PlaytimeSummary } from "../playtime/PlaytimeSummary";

export function LevelSummary({ study }: { study: StudyState }) {
  const level = levelProgress(study.xp);
  return (
    <div
      className="level-summary"
      aria-label={`Level ${level.level}, ${study.xp} XP`}
    >
      <strong key={level.level}>Level {level.level}</strong>
      <span className="xp-value" key={study.xp}>
        {study.xp.toLocaleString()} XP
      </span>
      <PlatinumMark study={study} />
      <progress
        aria-label="Progress to next level"
        value={level.current}
        max={level.required}
      />
      <small>
        {level.remaining.toLocaleString()} XP to level {level.level + 1}
      </small>
    </div>
  );
}
export function RecommendationList({
  questions,
  progress,
  study,
  onStart,
}: {
  questions: Question[];
  progress: ProgressMap;
  study: StudyState;
  onStart: (r: Recommendation) => void;
}) {
  return (
    <section className="recommendations">
      <h2>Recommended next</h2>
      {recommendations({ questions, progress, study, now: Date.now() }).map(
        (r) => (
          <button key={r.id} onClick={() => onStart(r)}>
            <span>
              <strong>{r.title}</strong>
              <small>{r.detail}</small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        ),
      )}
    </section>
  );
}
export function StudyOverview({
  questions,
  progress,
  study,
  onStart,
  onAchievements,
  onHistory,
  playtime,
  currentPlaytime,
}: {
  questions: Question[];
  progress: ProgressMap;
  study: StudyState;
  onStart: (r: Recommendation) => void;
  onAchievements: () => void;
  onHistory: () => void;
  playtime: PlaytimeState | null;
  currentPlaytime: number;
}) {
  const practiced = Object.values(study.skills).filter((s) => s.samples > 0),
    byScore = [...practiced].sort((a, b) => a.score - b.score);
  const groups = [
    ["Weakest skills", byScore.slice(0, 3)],
    ["Strongest skills", [...byScore].reverse().slice(0, 3)],
    [
      "Recently improving",
      practiced
        .filter((s) => s.trend > 0)
        .sort((a, b) => b.trend - a.trend)
        .slice(0, 3),
    ],
    [
      "Recent declines",
      practiced
        .filter((s) => s.trend < 0)
        .sort((a, b) => a.trend - b.trend)
        .slice(0, 3),
    ],
  ] as const;
  return (
    <section className="study-overview">
      <LevelSummary study={study} /><ProgressionSummary study={study} questions={questions} progress={progress} playtime={playtime} />
      {playtime && <PlaytimeSummary playtime={playtime} currentSession={currentPlaytime} />}
      <p className="muted">
        Overall mastery:{" "}
        <strong>
          {practiced.length
            ? Math.round(
                practiced.reduce((n, s) => n + s.score, 0) / practiced.length,
              )
            : "—"}
        </strong>{" "}
        / 100 across practiced skills. Mastery also considers difficulty, recent
        evidence and time away.
      </p>
      <div className="mastery-lists">
        {groups.map(([title, skills]) => (
          <section key={title}>
            <h2>{title}</h2>
            {skills.length ? (
              <ul>
                {skills.map((s) => (
                  <li key={s.key}>
                    <span>
                      {s.skill}
                      <small>
                        {s.test} · {s.state} · {s.samples} distinct questions
                      </small>
                    </span>
                    <strong className="mastery-value" key={s.state}>
                      {s.score}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                More varied practice will build this evidence.
              </p>
            )}
          </section>
        ))}
      </div>
      <RecommendationList {...{ questions, progress, study, onStart }} />
      <div className="button-row">
        <button onClick={onAchievements}>
          Achievements · {Object.keys(study.achievements).length}/
          {ACHIEVEMENTS.length}
        </button>
        <button onClick={onHistory}>
          Module history · {study.modules.length}
        </button>
      </div>
      {!!study.modules.length && (
        <p className="muted">
          Recent modules:{" "}
          {study.modules
            .slice(-3)
            .reverse()
            .map(
              (m) => `${m.subject}: ${m.score}/${m.session.questionIds.length}`,
            )
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
export { Achievements } from "../achievements/Achievements";
export function AdaptiveSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (test: TestSection, count: number) => void;
}) {
  const [test, setTest] = useState<TestSection>("Math"),
    [count, setCount] = useState(12);
  return (
    <main className="page study-setup">
      <button className="text-button back" onClick={onBack}>
        ← Home
      </button>
      <h1>Adaptive Practice</h1>
      <p>
        Work on what needs attention, with some stronger material for retention.
      </p>
      <label className="field-label">
        Subject
        <select
          value={test}
          onChange={(e) => setTest(e.target.value as TestSection)}
        >
          <option>Math</option>
          <option>Reading and Writing</option>
        </select>
      </label>
      <label className="field-label">
        Questions
        <input
          aria-label="Adaptive question count"
          type="number"
          min={5}
          max={50}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        Difficulty moves gradually after repeated success or difficulty.
        Recently used questions are avoided when alternatives are available.
      </p>
      <button
        className="primary"
        disabled={!Number.isInteger(count) || count < 5 || count > 50}
        onClick={() => onStart(test, count)}
      >
        Begin adaptive practice
      </button>
    </main>
  );
}
export function ModulesSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (test: TestSection, section: boolean) => void;
}) {
  return (
    <main className="page">
      <button className="text-button back" onClick={onBack}>
        ← Home
      </button>
      <h1>Practice Modules</h1>
      <p>
        Work under SAT-style timing. Change answers freely; correctness and
        explanations appear only after finishing.
      </p>
      <div className="module-options">
        {(["Reading and Writing", "Math"] as const).map((test) => {
          const b = MODULE_BLUEPRINT[test];
          return (
            <section key={test}>
              <h2>{test === "Math" ? "Math" : "Reading & Writing"}</h2>
              <p>
                {b.count} questions · {b.seconds / 60} minutes per module
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={() => onStart(test, false)}
                >
                  Start {test === "Math" ? "Math" : "Reading & Writing"} module
                </button>
                <button onClick={() => onStart(test, true)}>
                  Full {test === "Math" ? "Math" : "Reading & Writing"} section
                </button>
              </div>
              <small>
                Full section: two modules · {b.count * 2} questions ·{" "}
                {b.seconds / 30} minutes
              </small>
            </section>
          );
        })}
      </div>
      <p className="muted">
        All questions count toward the raw practice result. Domain weights
        follow the SAT blueprint; difficulty mixtures and second-module routing
        are practice approximations, not College Board’s proprietary test or
        scoring.
      </p>
    </main>
  );
}
export function ModuleHistory({
  study,
  onBack,
  onOpen,
}: {
  study: StudyState;
  onBack: () => void;
  onOpen: (s: Session) => void;
}) {
  return (
    <main className="page">
      <button className="text-button back" onClick={onBack}>
        ← Home
      </button>
      <h1>Module History</h1>
      <p className="muted">
        Completed modules retain their questions, final responses, timing, and
        results.
      </p>
      {!study.modules.length && (
        <p>Complete a Practice Module to begin your history.</p>
      )}
      <div className="module-history">
        {[...study.modules].reverse().map((m) => {
          const first = study.modules.find(
            (x) => x.id === m.session.module?.previousModuleId,
          );
          return (
            <section key={m.id}>
              <div>
                <h2>
                  {m.subject}{" "}
                  {m.session.module?.sectionId
                    ? `· Module ${m.session.module.number}`
                    : ""}
                </h2>
                <p>
                  {new Date(m.date).toLocaleString()} · {m.score}/
                  {m.session.questionIds.length} correct ·{" "}
                  {Math.round(m.accuracy * 100)}%
                </p>
                <small>
                  {m.session.questionIds.length - m.answered} unanswered ·{" "}
                  {Math.round(
                    m.seconds / Math.max(1, m.session.questionIds.length),
                  )}
                  s average per question
                </small>
              </div>
              <div className="button-row">
                <button
                  onClick={() =>
                    onOpen({
                      ...m.session,
                      index: 0,
                      module: { ...m.session.module!, awaitingNext: false },
                    })
                  }
                >
                  Review module
                </button>
                {first && (
                  <button onClick={() => onOpen(sectionSession(first, m))}>
                    Review full section
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
export function ModuleTransition({
  session,
  onContinue,
  onHome,
}: {
  session: Session;
  onContinue: () => void;
  onHome: () => void;
}) {
  return (
    <main className="page study-setup">
      <p className="eyebrow">SECTION PRACTICE</p>
      <h1>Module 1 complete.</h1>
      <p>
        Take a moment, then continue to Module 2. Its{" "}
        {MODULE_BLUEPRINT[session.test].seconds / 60}-minute timer starts when
        you continue.
      </p>
      <p className="muted">
        Module 2’s difficulty mixture uses your Module 1 performance. This is a
        documented practice approximation.
      </p>
      <div className="button-row">
        <button className="primary" onClick={onContinue}>
          Start Module 2
        </button>
        <button onClick={onHome}>Save and return home</button>
      </div>
    </main>
  );
}
