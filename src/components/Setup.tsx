import { useMemo, useState } from "react";
import type {
  Difficulty,
  HistoryFilter,
  ProgressMap,
  Question,
  Session,
} from "../types";
import { filterQuestions } from "../lib/session";
export type SetupFilters = {
  domains: string[];
  skills: string[];
  difficulties: string[];
  history: string;
  count: number;
  random: boolean;
  timerMode: Session["timerMode"];
  timerSeconds: number;
};
export function Setup({
  test,
  questions,
  progress,
  initialHistory,
  onStart,
  onBack,
}: {
  test: Question["test"];
  questions: Question[];
  progress: ProgressMap;
  initialHistory: string;
  onStart: (questions: Question[], f: SetupFilters) => void;
  onBack: () => void;
}) {
  const [f, setF] = useState<SetupFilters>({
    domains: [],
    skills: [],
    difficulties: [],
    history: initialHistory,
    count: 10,
    random: true,
    timerMode: "none",
    timerSeconds: 90,
  });
  const bank = useMemo(
    () => questions.filter((q) => q.test === test),
    [questions, test],
  );
  const domains = [...new Set(bank.map((q) => q.domain))].sort();
  const skills = [
    ...new Set(
      bank
        .filter((q) => !f.domains.length || f.domains.includes(q.domain))
        .map((q) => q.skill),
    ),
  ].sort();
  const eligible = filterQuestions(
    bank,
    {
      test,
      domains: f.domains,
      skills: f.skills,
      difficulties: f.difficulties as Difficulty[],
      history: f.history as HistoryFilter,
    },
    progress,
  );
  function toggle(key: "domains" | "skills" | "difficulties", value: string) {
    setF((old) => ({
      ...old,
      [key]: old[key].includes(value)
        ? old[key].filter((v) => v !== value)
        : [...old[key], value],
      ...(key === "domains" ? { skills: [] } : {}),
    }));
  }
  return (
    <main className="page setup">
      <button className="text-button back" onClick={onBack}>
        ← Home
      </button>
      <p className="eyebrow">PRACTICE SETUP</p>
      <h1>{test === "Math" ? "Math" : "Reading & Writing"}</h1>
      <p className="lead">
        Choose what to work on. Keep your practice focused.
      </p>
      <div className="setup-grid">
        <div>
          <fieldset>
            <legend>Question history</legend>
            <select
              aria-label="Question history"
              value={f.history}
              onChange={(e) => setF({ ...f, history: e.target.value })}
            >
              <option value="all">All questions</option>
              <option value="unanswered">Unseen only</option>
              <option value="incorrect">Incorrect before</option>
              <option value="correct">Correct before</option>
              <option value="bookmarked">Marked for review</option>
            </select>
          </fieldset>
          <fieldset>
            <legend>
              Domain <small>Any if none selected</small>
            </legend>
            <div className="checkbox-list">
              {domains.map((v) => (
                <label key={v}>
                  <input
                    type="checkbox"
                    checked={f.domains.includes(v)}
                    onChange={() => toggle("domains", v)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              Skill <small>Any if none selected</small>
            </legend>
            <div className="checkbox-list skills">
              {skills.map((v) => (
                <label key={v}>
                  <input
                    type="checkbox"
                    checked={f.skills.includes(v)}
                    onChange={() => toggle("skills", v)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="setup-options">
          <fieldset>
            <legend>Difficulty</legend>
            <div className="chips">
              {["Easy", "Medium", "Hard"].map((v) => (
                <button
                  key={v}
                  aria-pressed={f.difficulties.includes(v)}
                  className={f.difficulties.includes(v) ? "selected" : ""}
                  onClick={() => toggle("difficulties", v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Set length</legend>
            <label className="field-label">
              Number of questions
              <input
                type="number"
                min="1"
                max={Math.max(1, eligible.length)}
                value={f.count}
                onChange={(e) =>
                  setF({ ...f, count: Math.max(1, Number(e.target.value)) })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={f.random}
                onChange={(e) => setF({ ...f, random: e.target.checked })}
              />
              Randomized order
            </label>
          </fieldset>
          <fieldset>
            <legend>Timing</legend>
            <select
              aria-label="Timing"
              value={f.timerMode}
              onChange={(e) =>
                setF({
                  ...f,
                  timerMode: e.target.value as Session["timerMode"],
                })
              }
            >
              <option value="none">No timer</option>
              <option value="question">Timer per question</option>
              <option value="session">Timer for entire session</option>
            </select>
            {f.timerMode !== "none" && (
              <div className="duration">
                <label>
                  Minutes
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={Math.floor(f.timerSeconds / 60)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        timerSeconds:
                          Math.max(0, Number(e.target.value)) * 60 +
                          (f.timerSeconds % 60),
                      })
                    }
                  />
                </label>
                <span>:</span>
                <label>
                  Seconds
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={f.timerSeconds % 60}
                    onChange={(e) =>
                      setF({
                        ...f,
                        timerSeconds:
                          Math.floor(f.timerSeconds / 60) * 60 +
                          Math.min(59, Math.max(0, Number(e.target.value))),
                      })
                    }
                  />
                </label>
              </div>
            )}
            <p className="muted">
              Timers notify you at zero. You can keep working and submit your
              answer.
            </p>
          </fieldset>
          <div className="start-set">
            <strong>
              {eligible.length.toLocaleString()} matching questions
            </strong>
            <span className="muted">
              This set: {Math.min(f.count, eligible.length)} questions
            </span>
            <button
              className="primary"
              disabled={
                !eligible.length || (f.timerMode !== "none" && !f.timerSeconds)
              }
              onClick={() => onStart(eligible, f)}
            >
              Begin practice →
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
