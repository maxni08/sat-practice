import { STAGES } from "../progression/campaign";
import { useEffect, useState } from "react";
import {
  Bookmark,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  Highlighter,
  Home,
  BookOpen,
  X,
  Check,
  StickyNote,
} from "lucide-react";
import type { Question, QuestionProgress, Session } from "../types";
import { HighlightText } from "./HighlightText";
import { Modal } from "./Modal";
import { ReferenceSheet } from "./ReferenceSheet";
import { SourceImage } from "./SourceImage";
import { isValidAnswer } from "../lib/answers";
type Props = {
  question: Question;
  session: Session;
  progress: Record<string, QuestionProgress>;
  onChange: (fn: (s: Session) => Session) => void;
  onProgress: (
    id: string,
    fn: (p: QuestionProgress) => QuestionProgress,
  ) => void;
  onSubmit: () => void;
  onFinish: () => void;
  onHome: () => void;
  onCalculator: () => void;
  onReset: (id: string) => void;
  errorTags?: string[];
  onErrorTags?: (tags: string[]) => void;
  onQueue?: () => void;
  onSimilar?: () => void;
  onEndlessNext?: () => void;
  saving: boolean;
};
export function Practice({
  question: q,
  session: s,
  progress,
  onChange,
  onProgress,
  onSubmit,
  onFinish,
  onHome,
  onCalculator,
  onReset,
  errorTags = [],
  onErrorTags,
  onQueue,
  onSimilar,
  onEndlessNext,
  saving,
}: Props) {
  const [panel, setPanel] = useState<
    "notes" | "navigator" | "reference" | "finish" | "reset" | null
  >(null);
  const [highlight, setHighlight] = useState(false);
  const [original, setOriginal] = useState(false);
  const [originalRationale, setOriginalRationale] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [lineReader, setLineReader] = useState(false);
  const [lineTop, setLineTop] = useState(35);
  const p = progress[q.id];
  const activeModule = s.mode === "module" && !s.finished;
  const unansweredReview =
    s.mode === "module" && s.finished && !s.answers[q.id];
  const submitted = activeModule
    ? undefined
    : (s.answers[q.id] ??
      (unansweredReview
        ? { answer: "Unanswered", correct: false }
        : undefined));
  const draft = s.drafts[q.id] ?? "";
  const eliminated = s.eliminated[q.id] ?? [];
  const setDraft = (answer: string) =>
    onChange((old) => ({ ...old, drafts: { ...old.drafts, [q.id]: answer }, draftTimes: { ...old.draftTimes, [q.id]: Date.now() } }));
  const jump = (i: number) => {
    if (i >= 0 && i < s.questionIds.length) {
      onChange((old) => ({ ...old, index: i }));
      setPanel(null);
    }
  };
  const next = () =>
    s.mode === "endless"
      ? submitted && onEndlessNext?.()
      : s.index < s.questionIds.length - 1
      ? jump(s.index + 1)
      : s.finished
        ? onFinish()
        : setPanel("finish");
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (saving || e.ctrlKey || e.altKey || e.metaKey || panel || e.repeat)
        return;
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (
        ["a", "b", "c", "d"].includes(e.key.toLowerCase()) &&
        q.questionType === "multiple-choice" &&
        !submitted &&
        !s.finished
      ) {
        e.preventDefault();
        setDraft(e.key.toUpperCase());
      } else if (e.key === "Enter" && target.tagName !== "BUTTON") {
        e.preventDefault();
        if (submitted || s.finished || activeModule) next();
        else onSubmit();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        jump(s.index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        jump(s.index - 1);
      } else if (
        e.key.toLowerCase() === "c" &&
        q.test === "Math" &&
        (submitted || q.questionType === "numeric")
      )
        onCalculator();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    document
      .querySelectorAll(".passage-pane,.answer-pane")
      .forEach((el) => (el.scrollTop = 0));
    setOriginal(
      !!(q as Question & { requiresOriginalFormat?: boolean })
        .requiresOriginalFormat,
    );
    setOriginalRationale(false);
  }, [q.id]);
  const remain =
    s.timerMode === "session"
      ? Math.max(0, Math.ceil(((s.deadline ?? now) - now) / 1000))
      : Math.max(0, Math.ceil(s.timerSeconds - (s.elapsed[q.id] ?? 0)));
  const clock = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")}`;
  const isRW = q.test === "Reading and Writing";
  const addHighlight = (h: QuestionProgress["highlights"][number]) =>
    onProgress(q.id, (old) => ({ ...old, highlights: [...old.highlights, h] }));
  const renderText = (text: string, field: "passage" | "stem") => (
    <HighlightText
      key={`${q.id}-${field}`}
      text={text}
      field={field}
      highlights={p?.highlights ?? []}
      onHighlight={addHighlight}
      enabled={highlight}
      underlines={field === "passage" ? q.passageUnderlines : []}
    />
  );
  return (
    <div className="practice" inert={saving}>
      <header className="practice-toolbar">
        <div className="section-title">
          <strong>{isRW ? "Reading & Writing" : "Math"}</strong>
          <span>
            {s.finished
              ? s.module?.sectionSummary
                ? "Section review"
                : "Session review"
              : activeModule
                ? s.campaign ? STAGES.find(stage=>stage.id===s.campaign!.stage)?.name : s.challenge ? `Challenge ${s.challenge.level}` : s.mock ? `Full SAT Mock · Module ${s.mock.stage + 1} of 4` : `Practice Module ${s.module?.number ?? 1}`
                : s.mode === "endless"
                  ? "Endless Practice"
                  : s.mode === "adaptive"
                  ? "Adaptive Practice"
                  : "Independent practice"}
          </span>
        </div>
        <div
          className={`timer ${remain === 0 && s.timerMode !== "none" ? "expired" : ""}`}
          aria-live="off"
        >
          {s.timerMode === "none" ? (
            <span className="muted">Untimed</span>
          ) : (
            <>
              <strong>{s.timerHidden ? "Timer running" : clock}</strong>
              <button
                onClick={() =>
                  onChange((old) => ({ ...old, timerHidden: !old.timerHidden }))
                }
              >
                {s.timerHidden ? "Show Timer" : "Hide Timer"}
              </button>
              {!s.timerHidden && remain === 0 && (
                <small>
                  {activeModule
                    ? "Time is up · finishing module"
                    : "Time is up · continue when ready"}
                </small>
              )}
            </>
          )}
        </div>
        <nav className="tools">
          {q.test === "Math" && (
            <>
              <button onClick={onCalculator}>
                <Calculator size={19} />
                <span>Calculator</span>
              </button>
              <button onClick={() => setPanel("reference")}>
                <BookOpen size={19} />
                <span>Reference</span>
              </button>
            </>
          )}
          <button onClick={() => setPanel(panel === "notes" ? null : "notes")}>
            <Highlighter size={19} />
            <span>Highlights & Notes</span>
          </button>
          {isRW && q.passage && <button aria-pressed={lineReader} onClick={()=>setLineReader(!lineReader)}><span>Line Reader</span></button>}
          <button aria-label="Save and return home" onClick={onHome}>
            <Home size={19} />
            <span>Home</span>
          </button>
        </nav>
      </header>
      <div className="practice-strip">
        <span>{q.domain}</span>
        <span>
          {q.skill} · {q.difficulty}
        </span>
      </div>
      {s.mode === "endless" && <div className="endless-stats" aria-label="Endless Practice stats">
        <span>{s.endless?.answered ?? 0} answered</span>
        <span>{s.endless?.correct ?? 0} correct · {(s.endless?.answered ?? 0) ? Math.round(((s.endless?.correct ?? 0) / (s.endless?.answered ?? 1)) * 100) : 0}%</span>
        <span>Current streak: {s.endless?.streak ?? 0}</span>
        <span>Hard correct: {s.endless?.hardCorrect ?? 0}</span>
        <span>Study time: {Math.floor(((s.endless?.activeSeconds ?? 0) + (s.answers[q.id] ? 0 : (s.elapsed[q.id] ?? 0))) / 60)}m</span>
      </div>}
      <div className={`practice-workspace ${isRW && q.passage ? "split" : ""}`}>
        {isRW && q.passage && (
          <section className={`passage-pane ${lineReader ? "line-reader-on" : ""}`} aria-label="Passage" onClick={event=>{if(!lineReader)return;const rect=event.currentTarget.getBoundingClientRect();setLineTop(Math.max(5,Math.min(90,((event.clientY-rect.top)/rect.height)*100)))}}>
            {lineReader && (
              <div className="line-reader-band" aria-label="Line reader band" tabIndex={0} style={{top:`${lineTop}%`}} onKeyDown={event=>{if(event.key==="ArrowUp"){event.preventDefault();setLineTop(v=>Math.max(5,v-3))}if(event.key==="ArrowDown"){event.preventDefault();setLineTop(v=>Math.min(90,v+3))}}}/>
            )}
            {original ? (
              q.sourceAssets?.map((a) => (
                <SourceImage
                  dpi={q.assetDpi ?? 180}
                  className="source-asset"
                  key={a}
                  src={a}
                  alt="Original passage and question, with source formatting"
                />
              ))
            ) : (
              <>
                {q.passageAssets?.map((a) => (
                  <SourceImage
                    dpi={q.assetDpi ?? 180}
                    className="source-asset"
                    key={a}
                    src={a}
                    alt="Passage chart or source material"
                  />
                ))}
                {renderText(q.passage, "passage")}
              </>
            )}
            {q.sourceAssets?.length ? (
              <button
                className="text-button source-toggle"
                onClick={() => setOriginal(!original)}
              >
                {original ? "Show selectable text" : "Show original formatting"}
              </button>
            ) : null}
          </section>
        )}
        <main className="answer-pane">
          <div className="question-heading">
            <span className="question-number" key={q.id}>{s.index + 1}</span>
            <button
              className={p?.bookmark ? "bookmark marked" : "bookmark"}
              aria-pressed={!!p?.bookmark}
              onClick={() =>
                onProgress(q.id, (old) => ({ ...old, bookmark: !old.bookmark }))
              }
            >
              <Bookmark
                size={19}
                fill={p?.bookmark ? "currentColor" : "none"}
              />
              Mark for Review
            </button>
            {s.ghost && <small>Personal ghost: {s.ghost.correct}/{s.ghost.total} · {Math.round(s.ghost.seconds/60)} min</small>}
             <span className="question-id">ID {q.questionId}</span>
          </div>
          {highlight && (
            <div className="highlight-hint">
              <Highlighter size={16} /> Select passage or question text to
              highlight it.{" "}
              <button onClick={() => setHighlight(false)}>Done</button>
            </div>
          )}
          <div className="stem">
            {isRW &&
              !q.passage &&
              !original &&
              q.passageAssets?.map((a) => (
                <SourceImage
                  key={a}
                  src={a}
                  dpi={q.assetDpi ?? 180}
                  className="source-asset"
                  alt="Question chart or table"
                />
              ))}
            {isRW && !q.passage && original && q.sourceAssets?.length
              ? q.sourceAssets.map((a) => (
                  <SourceImage
                    key={a}
                    src={a}
                    dpi={q.assetDpi ?? 180}
                    className="source-asset"
                    alt="Original question with source formatting"
                  />
                ))
              : q.assets.length
                ? q.assets.map((a) => (
                    <SourceImage
                      dpi={q.assetDpi ?? 180}
                      key={a}
                      className="source-asset"
                      src={a}
                      alt={`Original question ${q.questionId}; equations and figures preserved`}
                    />
                  ))
                : renderText(q.stem, "stem")}
            {isRW && !q.passage && q.sourceAssets?.length ? (
              <button
                className="text-button source-toggle"
                onClick={() => setOriginal(!original)}
              >
                {original ? "Show selectable text" : "Show original formatting"}
              </button>
            ) : null}
          </div>
          {q.questionType === "multiple-choice" ? (
            <div className="choices">
              {q.choices.map((c) => {
                const selected = draft === c.label;
                const crossed = eliminated.includes(c.label);
                const correct = submitted && q.correctAnswer === c.label;
                const wrong = submitted && selected && !submitted.correct;
                return (
                  <div
                    key={c.label}
                    className={`choice-wrap ${crossed ? "eliminated" : ""}`}
                  >
                    <button
                      disabled={!!submitted || s.finished}
                      className={`choice ${selected ? "chosen" : ""} ${correct ? "correct" : ""} ${wrong ? "incorrect" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setDraft(c.label)}
                    >
                      <span className="choice-letter">{c.label}</span>
                      <span className="choice-content">
                        {c.assets?.length
                          ? c.assets.map((a) => (
                              <SourceImage
                                dpi={q.assetDpi ?? 180}
                                key={a}
                                src={a}
                                alt={`Choice ${c.label}`}
                              />
                            ))
                          : c.text}
                      </span>
                      {correct && <Check size={20} />}
                      {wrong && <X size={20} />}
                    </button>
                    <button
                      className="eliminate"
                      aria-label={`${crossed ? "Restore" : "Cross out"} ${c.label}`}
                      aria-pressed={crossed}
                      disabled={!!submitted || s.finished}
                      onClick={() =>
                        onChange((old) => ({
                          ...old,
                          eliminated: {
                            ...old.eliminated,
                            [q.id]: crossed
                              ? eliminated.filter((x) => x !== c.label)
                              : [...eliminated, c.label],
                          },
                        }))
                      }
                    >
                      <span>{c.label}</span>
                      <i />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="numeric-entry">
              <label htmlFor="numeric-answer">Your answer</label>
              <input
                id="numeric-answer"
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter a number or fraction"
                value={draft}
                disabled={!!submitted || s.finished}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !submitted) {
                    e.preventDefault();
                    if (activeModule) next();
                    else onSubmit();
                  }
                }}
              />
              <p className="muted">
                Use a decimal or fraction, such as 0.75 or 3/4. Negative values
                are supported.
              </p>
              {activeModule && draft.trim() && !isValidAnswer(q, draft) && (
                <p role="alert">
                  Enter a valid number or fraction. An invalid response will
                  count as unanswered.
                </p>
              )}
            </div>
          )}
          {!submitted && !s.finished && !activeModule && (
            <div className="submit-row">
              <button
                className="primary"
                disabled={!draft.trim() || saving}
                onClick={onSubmit}
              >
                {saving ? "Saving…" : "Submit Answer"}
              </button>
              <span className="muted">
                The explanation appears after you submit.
              </span>
            </div>
          )}
          {activeModule && (
            <p className="module-response-status">
              {draft.trim()
                ? "Response saved. You can change it until the module ends."
                : "Select or enter your answer. Responses save automatically."}{" "}
              Correctness and explanations appear after the module ends.
            </p>
          )}
          {submitted && (
            <section
              className={`feedback ${submitted.correct ? "right" : "wrong"}`}
              aria-label="Answer explanation"
            >
              <h2>
                {submitted.correct ? <Check size={21} /> : <X size={21} />}{" "}
                {unansweredReview
                  ? "Unanswered"
                  : submitted.correct
                    ? "Correct"
                    : "Incorrect"}
              </h2>
              <p>
                Your answer: <strong>{submitted.answer}</strong>{" "}
                <span className="feedback-divider">|</span> Correct answer:{" "}
                <strong>{q.correctAnswer}</strong>
              </p>
              <h3>College Board explanation</h3>
              {q.rationaleAssets.length && (!isRW || originalRationale) ? (
                q.rationaleAssets.map((a) => (
                  <SourceImage
                    dpi={q.assetDpi ?? 180}
                    key={a}
                    className="source-asset"
                    src={a}
                    alt="Original College Board explanation"
                  />
                ))
              ) : (
                <div className="question-text">{q.rationale}</div>
              )}
              {isRW && q.rationaleAssets.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => setOriginalRationale(!originalRationale)}
                >
                  {originalRationale
                    ? "Show readable explanation"
                    : "Show original explanation"}
                </button>
              )}
              {!submitted.correct && onErrorTags && <div className="tag-row" aria-label="Error tags">{["Concept","Careless","Misread","Timing","Vocabulary","Guess"].map(tag=><button key={tag} aria-pressed={errorTags.includes(tag)} className={errorTags.includes(tag)?"selected":""} onClick={()=>onErrorTags(errorTags.includes(tag)?errorTags.filter(value=>value!==tag):[...errorTags,tag])}>{tag}</button>)}</div>}
              <div className="button-row">{onQueue&&<button onClick={onQueue}>Add to Study Queue</button>}{onSimilar&&<button onClick={onSimilar}>Practice similar questions</button>}</div>
              <button className="text-button" onClick={() => setPanel("reset")}>
                Reset progress for this question
              </button>
            </section>
          )}
          {s.finished && !submitted && (
            <p className="notice">This question was left unanswered.</p>
          )}
        </main>
      </div>
      <footer className="practice-footer">
        <span className="saved-label">
          {saving ? "Saving…" : "Progress saved locally"}
        </span>
        <button
          className="navigator-button"
          onClick={() => setPanel("navigator")}
        >
          <Grid2X2 size={17} />
          Question {s.index + 1}{s.mode === "endless" ? " · ∞" : ` of ${s.questionIds.length}`}
          <span>⌃</span>
        </button>
        <div className="footer-actions">
          <button
            aria-label="Previous question"
            onClick={() => jump(s.index - 1)}
            disabled={s.index === 0}
          >
            <ChevronLeft size={18} />
            <span>Previous</span>
          </button>
          <button className="primary" onClick={next} disabled={s.mode === "endless" && !submitted}>
            {s.mode === "endless"
              ? "Next"
              : s.index === s.questionIds.length - 1
              ? s.finished
                ? "Results"
                : "Finish"
              : "Next"}
            <ChevronRight size={18} />
          </button>
          {s.mode === "endless" && <button onClick={() => setPanel("finish")}>End session</button>}
        </div>
      </footer>
      {panel === "navigator" && (
        <Modal title="Question navigator" onClose={() => setPanel(null)}>
          <p className="muted">Filled = answered · flag = marked for review</p>
          <div className="navigator-grid">
            {s.questionIds.map((id, i) => (
              <button
                key={id}
                aria-label={`Question ${i + 1}${(activeModule ? s.drafts[id]?.trim() : s.answers[id]) ? ", answered" : ", unanswered"}${progress[id]?.bookmark ? ", marked for review" : ""}`}
                className={`${(activeModule ? s.drafts[id]?.trim() : s.answers[id]) ? "answered" : ""} ${s.index === i ? "current" : ""}`}
                onClick={() => jump(i)}
              >
                {i + 1}
                {progress[id]?.bookmark && (
                  <Bookmark size={12} fill="currentColor" />
                )}
              </button>
            ))}
          </div>
          <button className="primary" onClick={() => setPanel("finish")}>
            Finish session
          </button>
        </Modal>
      )}
      {panel === "notes" && (
        <Modal title="Highlights & Notes" onClose={() => setPanel(null)}>
          <div className="notes-tools">
            <button
              className={highlight ? "selected" : ""}
              onClick={() => {
                setHighlight(!highlight);
                setPanel(null);
              }}
            >
              <Highlighter size={18} />
              {highlight ? "Turn off highlighting" : "Highlight selected text"}
            </button>
            <button
              onClick={() =>
                onProgress(q.id, (old) => ({ ...old, highlights: [] }))
              }
            >
              Clear highlights
            </button>
          </div>
          <p className="muted">
            Turn highlighting on, then select passage or question text.
            Highlights are yellow and saved with this question.
          </p>
          <label className="field-label">
            <span>
              <StickyNote size={16} /> Question note
            </span>
            <textarea
              aria-label="Question note"
              rows={8}
              value={p?.notes ?? ""}
              onChange={(e) =>
                onProgress(q.id, (old) => ({ ...old, notes: e.target.value }))
              }
              placeholder="What did you notice? What should you remember?"
            />
          </label>
          <p className="muted">Saved automatically on this device.</p>
        </Modal>
      )}
      {panel === "reference" && (
        <ReferenceSheet onClose={() => setPanel(null)} />
      )}
      {panel === "finish" && (
        <Modal title={s.mode === "endless" ? "End Endless Practice?" : "Finish this session?"} onClose={() => setPanel(null)}>
          <p>
            You have {activeModule ? "entered responses for" : "answered"}{" "}
            {activeModule
              ? Object.values(s.drafts).filter((a) => a.trim()).length
              : Object.keys(s.answers).length}{" "}
            of {s.questionIds.length} questions. Unanswered questions will be
            included in the total.
          </p>
          <div className="button-row">
            <button onClick={() => setPanel(null)}>Keep practicing</button>
            <button
              className="primary"
              onClick={() => {
                setPanel(null);
                onFinish();
              }}
            >
              View results
            </button>
          </div>
        </Modal>
      )}
      {panel === "reset" && (
        <Modal title="Reset question history?" onClose={() => setPanel(null)}>
          <p>
            This removes all past attempts, the note, highlights, and review
            flag for {q.questionId}. The current session result remains
            available.
          </p>
          <div className="button-row">
            <button onClick={() => setPanel(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() => {
                onReset(q.id);
                setPanel(null);
              }}
            >
              Reset question
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
