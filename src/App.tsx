import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChartNoAxesCombined, Sigma } from "lucide-react";
import {
  emptyProgress,
  type Question,
  type QuestionProgress,
  type Session,
  type ProgressMap,
} from "./types";
import {
  loadState,
  saveSession,
  saveProgress,
  resetQuestion,
  getDataLocation,
  openCalculator,
  loadStudy,
  commitStudy,
  loadPlaytime,
  savePlaytime,
  loadDuelHistory,
  saveDuelHistory,
} from "./lib/persistence";
import { isValidAnswer } from "./lib/answers";
import { createSession } from "./lib/session";
import { Setup, type SetupFilters } from "./components/Setup";
import { Practice } from "./components/Practice";
import { Progress, Results } from "./components/Statistics";
import { Modal } from "./components/Modal";
import { SfxSettings } from "./components/SfxSettings";
import type { StudyState, Recommendation } from "./study/types";
import { initializeStudy } from "./study/rewards";
import { calculateMastery } from "./study/mastery";
import {
  createAdaptiveSession,
  sessionFromRecommendation,
} from "./study/adaptive";
import { generateModule, moduleRoute } from "./study/modules";
import { studySubmission, studyCompletion } from "./study/transitions";
import {
  LevelSummary,
  RecommendationList,
  StudyOverview,
  Achievements,
  AdaptiveSetup,
  ModulesSetup,
  ModuleHistory,
  ModuleTransition,
} from "./study/StudyPanels";
import "./study/study.css";
import { upgradeAchievements } from "./achievements/engine";
import { AchievementToast } from "./achievements/Achievements";
import "./motion.css";
import { generateMock } from './study/mock';
import { generateChallenge } from './study/ladder';
import { createEndlessSession, continueEndlessSession } from "./study/endless";
import { ChallengeLadder, MockTransition, ExtraResults } from './study/ExtraModes';

import { RANKS } from "./progression/rank";
import { dayKey, initializeProgression } from "./progression/engine";
import { generateCampaign } from "./progression/campaign";
import { ProgressionSummary, CampaignPanel, CampaignResults } from "./progression/Panels";
import {
  activeSeconds,
  addPlaytime,
  initializePlaytime,
  playtimeMode,
  type PlaytimeState,
} from "./playtime/playtime";
import {
  loadSfxSettings,
  progressionSfx,
  saveSfxSettings,
  sfx,
} from "./lib/sfx";
import { Duel, DuelSetup } from "./duel/DuelView";
import { emptyDuelHistory, recordDuel, type DuelHistory, type DuelMatch } from "./duel/duel";
import { ProductivityPanel } from "./productivity/ProductivityPanel";
import { loadProductivity, saveProductivity, sanitizeProductivity, similarQuestions, type ErrorTag, type ProductivityState } from "./productivity/productivity";

type View =
  | "campaign"
  | "ladder"
  | "home"
  | "setup"
  | "practice"
  | "progress"
  | "results"
  | "adaptive-setup"
  | "modules"
  | "achievements"
  | "module-history"
  | "transition"
  | "duel-setup"
  | "productivity"
  | "duel";
export default function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>("home");
  const [test, setTest] = useState<Question["test"]>("Math");
  const [history, setHistory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [location, setLocation] = useState("");
  const [about, setAbout] = useState(false);
  const [sound, setSound] = useState(loadSfxSettings);
  const [playtime, setPlaytime] = useState<PlaytimeState | null>(null);
  const playtimeRef = useRef<PlaytimeState | null>(null);
  const [currentPlaytime, setCurrentPlaytime] = useState(0);
  const [duelHistory, setDuelHistory] = useState<DuelHistory>(emptyDuelHistory);
  const [duel, setDuel] = useState<DuelMatch | null>(null);
  const [productivity, setProductivity] = useState<ProductivityState>(loadProductivity);
  const currentPlaytimeRef = useRef(0);
  const [study, setStudy] = useState<StudyState | null>(null);
  const studyRef = useRef<StudyState | null>(null);
  const [prepared, setPrepared] = useState<Session | null>(null);
  const [progressionNotice, setProgressionNotice] = useState<{title:string;detail:string}|null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const expiryAttempt = useRef<string | null>(null);
  const [replace, setReplace] = useState<{
    questions: Question[];
    filters: SetupFilters;
    reviewQuestion?: Question;
  } | null>(null);
  const stateRef = useRef({ session, progress });
  stateRef.current = { session, progress };
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const submitting = useRef(false);
  const clockRef = useRef(Date.now());
  const practicingRef = useRef(false);
  practicingRef.current = view === "practice";
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const playtimeTickRef = useRef(Date.now());
  const playtimePersistRef = useRef(Date.now());
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const saved = saveSfxSettings(sound);
    sfx.setSettings(saved);
  }, [sound]);
  useEffect(()=>saveProductivity(productivity),[productivity]);

  // Catch all failed writes, including background snapshots. Callers receive success
  // explicitly; ignored background promises can never become unhandled rejections.
  const enqueue = useCallback(
    (operation: () => Promise<unknown>): Promise<boolean> => {
      const task = pending.current.then(operation).then(
        () => true,
        (reason) => {
          setError(`Your latest change could not be saved: ${String(reason)}`);
          return false;
        },
      );
      pending.current = task;
      return task;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/bank/questions.json").then((response) => {
        if (!response.ok)
          throw Error(
            "Question bank is missing. Run the PDF importer, then rebuild the app.",
          );
        return response.json() as Promise<Question[]>;
      }),
      loadState(),
      getDataLocation(),
      loadStudy(),
      loadPlaytime(),
      loadDuelHistory(),
    ])
      .then(async ([bank, state, path, learning, savedPlaytime, savedDuels]) => {
        if (!active) return;
        if (!Array.isArray(bank) || !bank.length)
          throw Error("The question bank is empty.");
        setQuestions(bank);
        setProgress(state.progress);
        let nextStudy =
          learning ?? initializeStudy(bank, state.progress, Date.now());
        if (!learning?.trophies) {
          nextStudy = upgradeAchievements(
            nextStudy,
            bank,
            state.progress,
            Date.now(),
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          );
          if (nextStudy.trophies)
            nextStudy.trophies.timeZone =
              Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
        const refresh =
          !learning ||
          !learning.trophies ||
          !learning.progression ||
          !Object.values(learning.progression.quests).some(q=>q.id.startsWith("day:")&&q.period===dayKey(Date.now(),learning.progression!.timeZone)) ||
          Object.values(learning.skills).some(
            (s) =>
              s.calculatedAt.slice(0, 10) !==
              new Date().toISOString().slice(0, 10),
          );
        if (refresh) {
          nextStudy = {
            ...nextStudy,
            revision: nextStudy.revision + 1,
            skills: calculateMastery(
              bank,
              state.progress,
              nextStudy.evidence,
              Date.now(),
            ),
          };
          nextStudy = initializeProgression(nextStudy, bank, state.progress, Date.now());
          await commitStudy(
            learning
              ? `mastery-refresh-${crypto.randomUUID()}`
              : "bootstrap-study-v2",
            nextStudy,
            {},
            state.session,
          );
        }
        if (!active) return;
        studyRef.current = nextStudy;
        setStudy(nextStudy);
        const nextPlaytime =
          savedPlaytime ??
          initializePlaytime(state.progress, nextStudy, Date.now());
        if (!savedPlaytime) await savePlaytime(nextPlaytime);
        playtimeRef.current = nextPlaytime;
        setPlaytime(nextPlaytime);
        setDuelHistory(savedDuels ?? emptyDuelHistory());
        const ids = new Set(bank.map((question) => question.id));
        setProductivity(old=>sanitizeProductivity(old,ids));
        if (
          state.session &&
          state.session.questionIds.length &&
          state.session.questionIds.every((id) => ids.has(id))
        ) {
          setSession({
            ...state.session,
            index: Math.min(
              Math.max(0, state.session.index),
              state.session.questionIds.length - 1,
            ),
          });
        }
        setLocation(path);
        setLoading(false);
      })
      .catch((reason) => {
        if (active) {
          setError(String(reason));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const active = () => {
      lastActivityRef.current = Date.now();
    };
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart"])
      window.addEventListener(event, active, { passive: true });
    return () => {
      for (const event of ["pointerdown", "keydown", "wheel", "touchstart"])
        window.removeEventListener(event, active);
    };
  }, []);

  useEffect(() => {
    if (!playtime) return;
    playtimeTickRef.current = Date.now();
    playtimePersistRef.current = Date.now();
    const tick = (persist = false) => {
      const now = Date.now();
      const from = playtimeTickRef.current;
      playtimeTickRef.current = now;
      const current = stateRef.current.session;
      const mode = playtimeMode(viewRef.current, current);
      if (mode && playtimeRef.current) {
        let timedUntil: number | null = null;
        if (viewRef.current === "practice" && current && !current.finished) {
          if (current.timerMode === "session") timedUntil = current.deadline;
          else if (current.timerMode === "question") {
            const id = current.questionIds[current.index];
            timedUntil =
              from +
              Math.max(
                0,
                current.timerSeconds - (current.elapsed[id] ?? 0),
              ) *
                1000;
          }
        }
        const seconds = activeSeconds(
          from,
          now,
          lastActivityRef.current,
          timedUntil,
        );
        if (seconds) {
          const next = addPlaytime(playtimeRef.current, mode, seconds, now);
          playtimeRef.current = next;
          currentPlaytimeRef.current += seconds;
          setPlaytime(next);
          setCurrentPlaytime(currentPlaytimeRef.current);
        }
      }
      if (
        playtimeRef.current &&
        (persist || now - playtimePersistRef.current >= 15_000)
      ) {
        playtimePersistRef.current = now;
        const snapshot = playtimeRef.current;
        void enqueue(() => savePlaytime(snapshot));
      }
    };
    const timer = window.setInterval(() => tick(), 1000);
    const flush = () => {
      if (document.visibilityState === "hidden") tick(true);
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", flush);
      tick(true);
    };
  }, [!!playtime, enqueue]);

  // Flush fractional seconds before navigation/submission, so time cannot leak
  // into the next question. Hiding the clock or opening Desmos never pauses it.
  const chargeElapsed = useCallback((current: Session): Session => {
    const now = Date.now();
    const end =
      current.mode === "module" && current.deadline
        ? Math.min(now, current.deadline)
        : now;
    const seconds = Math.max(0, (end - clockRef.current) / 1000);
    clockRef.current = now;
    const id = current.questionIds[current.index];
    if (
      !practicingRef.current ||
      current.finished ||
      current.answers[id] ||
      submitting.current ||
      seconds === 0
    )
      return current;
    return {
      ...current,
      elapsed: {
        ...current.elapsed,
        [id]: (current.elapsed[id] ?? 0) + seconds,
      },
    };
  }, []);

  const updateSession = useCallback(
    (fn: (current: Session) => Session) => {
      if (submitting.current) return;
      const old = stateRef.current.session;
      if (!old) return;
      if (
        old.mode === "module" &&
        !old.finished &&
        old.deadline &&
        Date.now() >= old.deadline
      )
        return;
      const next = fn(chargeElapsed(old));
      if (next.adaptive)
        next.adaptive = {
          ...next.adaptive,
          seen: [
            ...new Set([...next.adaptive.seen, next.questionIds[next.index]]),
          ],
        };
      stateRef.current.session = next;
      setSession(next);
      void enqueue(() => saveSession(next));
    },
    [enqueue, chargeElapsed],
  );

  const updateProgress = useCallback(
    (id: string, fn: (current: QuestionProgress) => QuestionProgress) => {
      if (submitting.current) return;
      const old = stateRef.current.progress;
      const next = fn(old[id] ?? emptyProgress());
      const map = { ...old, [id]: next };
      stateRef.current.progress = map;
      setProgress(map);
      void enqueue(() => saveProgress(id, next));
    },
    [enqueue],
  );

  useEffect(() => {
    clockRef.current = Date.now();
    if (view !== "practice" || !session || session.finished) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      const current = stateRef.current.session;
      if (!current) return;
      const next = chargeElapsed(current);
      if (next === current) return;
      stateRef.current.session = next;
      setSession(next);
      if (++ticks % 5 === 0) void enqueue(() => saveSession(next));
    }, 1000);
    return () => clearInterval(timer);
  }, [view, session?.id, session?.finished, enqueue, chargeElapsed]);

  async function submit() {
    const snapshot = stateRef.current.session;
    if (
      !snapshot ||
      submitting.current ||
      snapshot.finished ||
      snapshot.mode === "module" ||
      !studyRef.current
    )
      return;
    const current = chargeElapsed(snapshot);
    stateRef.current.session = current;
    setSession(current);
    const question = questions.find(
      (item) => item.id === current.questionIds[current.index],
    );
    if (!question || current.answers[question.id]) return;
    const answer = (current.drafts[question.id] ?? "").trim();
    if (!isValidAnswer(question, answer)) {
      setError(
        question.questionType === "numeric"
          ? "Enter a valid number or a fraction with a nonzero denominator."
          : "Select an answer first.",
      );
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const result = studySubmission(
        current,
        question,
        questions,
        stateRef.current.progress,
        studyRef.current,
        Date.now(),
      );
      if (
        !(await enqueue(() =>
          commitStudy(
            result.eventId,
            result.study,
            result.updates,
            result.session,
          ),
        ))
      )
        return;
      stateRef.current = {
        session: result.session,
        progress: result.progress,
      };
      acceptStudy(result.study);
      sfx.play(
        result.session.answers[question.id].correct ? "correct" : "incorrect",
      );
      setSession(result.session);
      setProgress(stateRef.current.progress);
    } catch (reason) {
      setError(String(reason));
    } finally {
      clockRef.current = Date.now();
      submitting.current = false;
      setSaving(false);
    }
  }

  function begin(
    bank: Question[],
    filters: SetupFilters,
    confirmed = false,
    reviewQuestion?: Question,
  ) {
    if (submitting.current) return;
    if (
      stateRef.current.session &&
      (!stateRef.current.session.finished ||
        stateRef.current.session.module?.awaitingNext) &&
      !confirmed
    ) {
      setReplace({ questions: bank, filters, reviewQuestion });
      return;
    }
    try {
      const next = createSession(bank, {
        test: bank[0]?.test ?? test,
        domains: [],
        skills: [],
        difficulties: [],
        history: "all",
        count: filters.count,
        randomize: filters.random,
        timerMode: filters.timerMode,
        timerSeconds: filters.timerSeconds,
      });
      if (reviewQuestion) {
        const prior = stateRef.current.progress[reviewQuestion.id];
        next.finished = true;
        if (prior?.attempts && prior.lastResult !== null) {
          next.drafts[reviewQuestion.id] = prior.lastAnswer;
          next.answers[reviewQuestion.id] = {
            answer: prior.lastAnswer,
            correct: prior.lastResult,
            timeSpent: prior.totalTimeSpent / prior.attempts,
            submittedAt: prior.lastAttemptDate ?? new Date().toISOString(),
          };
        }
      }
      stateRef.current.session = next;
      clockRef.current = Date.now();
      setSession(next);
      void enqueue(() => saveSession(next));
      setView("practice");
      setReplace(null);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function setup(section: Question["test"], filter = "all") {
    if (submitting.current) return;
    setTest(section);
    setHistory(filter);
    setView("setup");
  }
  function startQuestionIds(ids: string[]) {
    const bank=ids.map(id=>questions.find(q=>q.id===id)).filter(Boolean) as Question[];
    if(!bank.length){setError("No valid questions were selected.");return;}
    const next=createSession([bank[0]],{test:bank[0].test,domains:[],skills:[],difficulties:[],history:"all",count:1,randomize:false,timerMode:"none",timerSeconds:0},stateRef.current.progress);
    next.questionIds=bank.map(q=>q.id);
    launchPrepared(next);
  }
  function startEndless() {
    try { launchPrepared(createEndlessSession(questions, stateRef.current.progress, Date.now())); }
    catch (reason) { setError(String(reason)); }
  }
  function advanceEndless() {
    const current = stateRef.current.session;
    if (!current || current.mode !== "endless") return;
    try {
      const next = continueEndlessSession(current, questions, stateRef.current.progress, Date.now());
      stateRef.current.session = next;
      clockRef.current = Date.now();
      setSession(next);
      void enqueue(() => saveSession(next));
    } catch (reason) { setError(String(reason)); }
  }
  function setErrorTags(id:string,tags:string[]){
    setProductivity(old=>{const errors={...old.errors};if(tags.length)errors[id]={tags:tags as ErrorTag[],updatedAt:new Date().toISOString()};else delete errors[id];return{...old,errors}});
  }
  function finishDuel(match: DuelMatch) {
    const next = recordDuel(duelHistory, match, Date.now());
    if (next === duelHistory) return;
    setDuelHistory(next);
    void enqueue(() => saveDuelHistory(next));
  }
  function home() {
    if (submitting.current) return;
    const current = stateRef.current.session;
    if (current) {
      const next = chargeElapsed(current);
      stateRef.current.session = next;
      setSession(next);
      void enqueue(() => saveSession(next));
    }
    practicingRef.current = false;
    setView("home");
  }
  async function finish() {
    if (submitting.current) return;
    const snapshot = stateRef.current.session;
    if (!snapshot || !studyRef.current) return;
    if (snapshot.finished) {
      setView(snapshot.module?.awaitingNext ? "transition" : "results");
      return;
    }
    const current = chargeElapsed(snapshot);
    submitting.current = true;
    setSaving(true);
    try {
      const result = studyCompletion(
        current,
        questions,
        stateRef.current.progress,
        studyRef.current,
        Date.now(),
      );
      if (
        !(await enqueue(() =>
          commitStudy(
            result.eventId,
            result.study,
            result.updates,
            result.session,
          ),
        ))
      )
        return;
      stateRef.current = { session: result.session, progress: result.progress };
      setSession(result.session);
      setProgress(result.progress);
      acceptStudy(result.study);
      practicingRef.current = false;
      setView(result.session.module?.awaitingNext ? "transition" : "results");
    } catch (reason) {
      setError(String(reason));
    } finally {
      submitting.current = false;
      setSaving(false);
      clockRef.current = Date.now();
    }
  }

  function acceptStudy(next: StudyState) {
    for (const event of progressionSfx(studyRef.current, next)) sfx.play(event);
    if(next.progression?.notice && next.progression.notice.id !== studyRef.current?.progression?.notice?.id) setProgressionNotice(next.progression.notice);
    if(next.progression && next.progression.rank.highest > (studyRef.current?.progression?.rank.highest??0)) setProgressionNotice({title:"RANK UP",detail:`${RANKS[studyRef.current?.progression?.rank.highest??0]} → ${RANKS[next.progression.rank.highest]}`});
    const unlocked = Object.keys(next.achievements).filter(
      (id) => !studyRef.current?.achievements[id],
    );
    if (unlocked.length) setNotice((previous) => [...previous, ...unlocked]);
    studyRef.current = next;
    setStudy(next);
  }
  useEffect(() => {
    if (!notice.length) return;
    const id = window.setTimeout(
      () => setNotice((previous) => previous.slice(1)),
      6000,
    );
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(()=>{if(!progressionNotice)return;const timer=setTimeout(()=>setProgressionNotice(null),6500);return ()=>clearTimeout(timer);},[progressionNotice]);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = stateRef.current.session;
      if (
        !loading &&
        current?.mode === "module" &&
        !current.finished &&
        current.deadline &&
        Date.now() >= current.deadline &&
        !submitting.current &&
        expiryAttempt.current !== current.id
      ) {
        expiryAttempt.current = current.id;
        void finishRef.current();
      }
    }, 500);
    return () => clearInterval(id);
  }, [loading]);
  function launchPrepared(next: Session, confirmed = false) {
    if (submitting.current) return;
    if (
      stateRef.current.session &&
      (!stateRef.current.session.finished ||
        stateRef.current.session.module?.awaitingNext) &&
      !confirmed
    ) {
      setPrepared(next);
      return;
    }
    if (!next.finished) {
      const now = Date.now();
      next = {
        ...next,
        startedAt: now,
        deadline:
          next.timerMode === "session" ? now + next.timerSeconds * 1000 : null,
      };
    }
    stateRef.current.session = next;
    setSession(next);
    clockRef.current = Date.now();
    expiryAttempt.current = null;
    void enqueue(() => saveSession(next));
    setPrepared(null);
    setView("practice");
  }
  function startAdaptive(section: Question["test"], count: number) {
    if (!studyRef.current) return;
    try {
      launchPrepared(
        createAdaptiveSession(
          {
            questions,
            progress: stateRef.current.progress,
            study: studyRef.current,
            now: Date.now(),
          },
          section,
          count,
          crypto.randomUUID(),
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function startRecommendation(recommendation: Recommendation) {
    if (!studyRef.current) return;
    try {
      launchPrepared(
        sessionFromRecommendation(
          {
            questions,
            progress: stateRef.current.progress,
            study: studyRef.current,
            now: Date.now(),
          },
          recommendation,
          crypto.randomUUID(),
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function startModule(section: Question["test"], fullSection: boolean) {
    if (!studyRef.current) return;
    try {
      launchPrepared(
        generateModule(
          questions,
          section,
          stateRef.current.progress,
          studyRef.current,
          {
            seed: crypto.randomUUID(),
            now: Date.now(),
            sectionId: fullSection ? crypto.randomUUID() : undefined,
          },
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function continueSection() {
    const current = stateRef.current.session,
      learning = studyRef.current;
    if (!current?.module?.awaitingNext || !learning) return;
    if (current.mock) {
      try { launchPrepared(generateMock(questions, stateRef.current.progress, learning, crypto.randomUUID(), Date.now(), current), true); }
      catch (e) { setError(String(e)); }
      return;
    }
    const first = learning.modules.find((m) => m.id === current.id);
    if (!first) return;
    try {
      launchPrepared(
        generateModule(
          questions,
          current.test,
          stateRef.current.progress,
          learning,
          {
            seed: crypto.randomUUID(),
            now: Date.now(),
            sectionId: current.module.sectionId,
            number: 2,
            previousModuleId: current.id,
            route: moduleRoute(first.score, current.questionIds.length),
            exclude: current.questionIds,
          },
        ),
        true,
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function review(index: number) {
    if (submitting.current) return;
    updateSession((current) => ({ ...current, index }));
    clockRef.current = Date.now();
    setView("practice");
  }
  function reviewQuestion(question: Question) {
    setTest(question.test);
    begin(
      [question],
      {
        domains: [],
        skills: [],
        difficulties: [],
        history: "all",
        count: 1,
        random: false,
        timerMode: "none",
        timerSeconds: 0,
      },
      false,
      question,
    );
  }
  async function reset(id: string) {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const next = { ...stateRef.current.progress };
      delete next[id];
      if (studyRef.current) {
        const learning = {
          ...studyRef.current,
          revision: studyRef.current.revision + 1,
          evidence: { ...studyRef.current.evidence },
          reviews: { ...studyRef.current.reviews },
        };
        delete learning.evidence[id];
        delete learning.reviews[id];
        learning.skills = calculateMastery(
          questions,
          next,
          learning.evidence,
          Date.now(),
        );
        if (
          !(await enqueue(() =>
            commitStudy(
              `reset-${crypto.randomUUID()}`,
              learning,
              {},
              stateRef.current.session,
              [id],
            ),
          ))
        )
          return;
        acceptStudy(learning);
      } else if (!(await enqueue(() => resetQuestion(id)))) return;
      stateRef.current.progress = next;
      setProgress(next);
    } finally {
      clockRef.current = Date.now();
      submitting.current = false;
      setSaving(false);
    }
  }
  const q = session
    ? questions.find((q) => q.id === session.questionIds[session.index])
    : undefined;
  return (
    <>
      {loading ? (
        <div className="loading">
          <BookOpen size={32} />
          <h1>Opening your question bank…</h1>
        </div>
      ) : (
        <>
          {view === "home" && (
            <>
              <header className="home-header">
                <span className="wordmark">
                  <BookOpen size={22} />
                  SAT Practice
                </span>
                <button onClick={() => setAbout(true)}>About & storage</button>
              </header>
              <main className="page home">
                <p className="eyebrow">A QUIET PLACE TO GET BETTER</p>
                <h1>Make every question count.</h1>
                <p className="lead">
                  Focused practice. Real questions. Your own pace.
                </p>
                {study && <><LevelSummary study={study} /><ProgressionSummary study={study} questions={questions} progress={progress} playtime={playtime} onOpen={()=>setView("campaign")}/></>}
                {session &&
                  (!session.finished || session.module?.awaitingNext) && (
                    <section className="resume">
                      <div>
                        <strong>Continue your practice</strong>
                        <p>
                          {session.mode === "endless" ? "Endless Practice" : session.test} ·{" "}
                          {session.mode === "module" && !session.finished
                            ? Object.values(session.drafts).filter((a) =>
                                a.trim(),
                              ).length
                            : Object.keys(session.answers).length}{" "}
                          of {session.questionIds.length} answered
                        </p>
                      </div>
                      <button
                        className="primary"
                        onClick={() =>
                          setView(
                            session.module?.awaitingNext
                              ? "transition"
                              : "practice",
                          )
                        }
                      >
                        {session.module?.awaitingNext
                          ? "Continue section"
                          : "Resume"}{" "}
                        <ArrowRight size={17} />
                      </button>
                    </section>
                  )}
                <div className="subject-grid">
                  <button
                    className="subject"
                    onClick={() => setup("Reading and Writing")}
                  >
                    <BookOpen size={27} />
                    <h2>Reading & Writing</h2>
                    <p>Read closely. Think clearly.</p>
                    <footer>
                      <span>
                        {questions
                          .filter((q) => q.test === "Reading and Writing")
                          .length.toLocaleString()}{" "}
                        questions
                      </span>
                      <ArrowRight size={22} />
                    </footer>
                  </button>
                  <button className="subject" onClick={() => setup("Math")}>
                    <Sigma size={29} />
                    <h2>Math</h2>
                    <p>Build precision, one problem at a time.</p>
                    <footer>
                      <span>
                        {questions
                          .filter((q) => q.test === "Math")
                          .length.toLocaleString()}{" "}
                        questions
                      </span>
                      <ArrowRight size={22} />
                    </footer>
                  </button>
                </div>
                <div className="study-modes">
                  <button onClick={() => {
                    if (!studyRef.current) return;
                    try { launchPrepared(generateMock(questions, stateRef.current.progress, studyRef.current, crypto.randomUUID(), Date.now())); }
                    catch (e) { setError(String(e)); }
                  }}><span><strong>Full SAT Mock</strong><small>Four timed modules · estimated score range.</small></span></button>
                  <button onClick={() => setView('ladder')}><span><strong>Challenge Ladder</strong><small>Fourteen progressive practice challenges.</small></span></button>
                  <button className="endless-entry" onClick={startEndless}><span><strong>∞ Endless Practice</strong><small>Random SAT questions · no timer · no endpoint.</small></span></button>
                  <button onClick={() => setView("adaptive-setup")}>
                    <span>
                      <strong>Adaptive Practice</strong>
                      <small>Practice what needs attention next.</small>
                    </span>
                  </button>
                  <button onClick={() => setView("modules")}>
                    <span>
                      <strong>Practice Modules</strong>
                      <small>Timed modules and full sections.</small>
                    </span>
                  </button>
                  <button onClick={() => setView("duel-setup")}>
                    <span>
                      <strong>Local 1v1</strong>
                      <small>Two players · one synchronized question set.</small>
                    </span>
                  </button>
                  <button onClick={() => setView("productivity")}><span><strong>Question Finder & Study Tools</strong><small>Find IDs, build sets, browse, queue, and review errors.</small></span></button>
                </div>
                {study && (
                  <RecommendationList
                    questions={questions}
                    progress={progress}
                    study={study}
                    onStart={startRecommendation}
                  />
                )}
                <div className="button-row">
                  <button
                    className="text-button"
                    onClick={() => setView("achievements")}
                  >
                    Achievements
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setView("module-history")}
                  >
                    Module History
                  </button>
                </div>
                <button
                  className="progress-link"
                  onClick={() => setView("progress")}
                >
                  <ChartNoAxesCombined size={22} />
                  <span>
                    <strong>Your progress</strong>
                    <small>
                      Find your weakest skills and revisit missed questions.
                    </small>
                  </span>
                  <ArrowRight size={20} />
                </button>
                {session?.finished && (
                  <button
                    className="text-button"
                    onClick={() => setView("results")}
                  >
                    View last session results →
                  </button>
                )}
                <p className="home-footnote">
                  Private. Local. Focused on practice.
                </p>
              </main>
            </>
          )}
          {view === "setup" && (
            <Setup
              key={`${test}-${history}`}
              test={test}
              questions={questions}
              progress={progress}
              initialHistory={history}
              onStart={begin}
              onBack={home}
            />
          )}
          {view === "practice" && session && q && (
            <Practice
              question={q}
              session={session}
              progress={progress}
              onChange={updateSession}
              onProgress={updateProgress}
              onSubmit={submit}
              onFinish={finish}
              onHome={home}
              onCalculator={() => {
                openCalculator().catch((e) => setError(String(e)));
              }}
              onReset={reset}
              errorTags={productivity.errors[q.id]?.tags}
              onErrorTags={tags=>setErrorTags(q.id,tags)}
              onQueue={()=>setProductivity(old=>old.queue.includes(q.id)?old:{...old,queue:[...old.queue,q.id]})}
              onSimilar={()=>startQuestionIds(similarQuestions(q,questions,stateRef.current.progress).map(item=>item.id))}
              onEndlessNext={advanceEndless}
              saving={saving}
            />
          )}
          {view === "productivity" && (
            <ProductivityPanel questions={questions} progress={progress} study={study} state={productivity} onChange={setProductivity} onPractice={startQuestionIds} onBack={home}/>
          )}
          {view === "progress" && (
            <Progress
              questions={questions}
              progress={progress}
              onBack={home}
              onPractice={(t) => setup(t, "incorrect")}
              onReview={reviewQuestion}
              studyPanel={
                study ? (
                  <StudyOverview
                    questions={questions}
                    progress={progress}
                    study={study}
                    playtime={playtime}
                    currentPlaytime={currentPlaytime}
                    onStart={startRecommendation}
                    onAchievements={() => setView("achievements")}
                    onHistory={() => setView("module-history")}
                  />
                ) : undefined
              }
            />
          )}
          {view === "results" && session && (
            <>
            <CampaignResults session={session}/><ExtraResults session={session} questions={questions} />
            <Results
              questions={questions}
              session={session}
              onHome={home}
              onReview={review}
              progress={progress}
            />
            </>
          )}
          {view === "campaign" && study && <CampaignPanel study={study} onBack={home} onStart={id=>{try{launchPrepared(generateCampaign(questions,stateRef.current.progress,studyRef.current!,id,crypto.randomUUID(),Date.now()));}catch(e){setError(String(e));}}}/>}
          {view === 'ladder' && study && <ChallengeLadder study={study} onBack={home} onStart={level => {
            try { launchPrepared(generateChallenge(questions, stateRef.current.progress, studyRef.current!, level, crypto.randomUUID(), Date.now())); }
            catch (e) { setError(String(e)); }
          }} />}
          {view === "adaptive-setup" && (
            <AdaptiveSetup onBack={home} onStart={startAdaptive} />
          )}
          {view === "modules" && (
            <ModulesSetup onBack={home} onStart={startModule} />
          )}
          {view === "achievements" && study && (
            <Achievements
              study={study}
              questions={questions}
              progress={progress}
              onBack={home}
            />
          )}
          {view === "module-history" && study && (
            <ModuleHistory
              study={study}
              onBack={home}
              onOpen={(s) => launchPrepared(s)}
            />
          )}
          {view === "duel-setup" && (
            <DuelSetup questions={questions} history={duelHistory} onBack={home} onStart={(match) => { setDuel(match); setView("duel"); }} />
          )}
          {view === "duel" && duel && (
            <Duel questions={questions} match={duel} onChange={setDuel} onFinish={finishDuel} onBack={() => { setDuel(null); home(); }} onFeedback={(correct) => sfx.play(correct ? "correct" : "incorrect")} />
          )}
          {view === "transition" && session && (
            session.mock ? <MockTransition session={session} onContinue={continueSection} onHome={home} /> :
            <ModuleTransition
              session={session}
              onContinue={continueSection}
              onHome={home}
            />
          )}
        </>
      )}
      {progressionNotice && <aside className="progression-toast" role="status"><button aria-label="Dismiss progression notification" onClick={()=>setProgressionNotice(null)}>×</button><strong>{progressionNotice.title}</strong><p>{progressionNotice.detail}</p></aside>}
      {error && (
        <Modal title="Something needs attention" onClose={() => setError("")}>
          <p role="alert">{error}</p>
          <button className="primary" onClick={() => setError("")}>
            Close
          </button>
        </Modal>
      )}
      {!!notice.length && (
        <AchievementToast
          id={notice[0]}
          additional={notice.length - 1}
          onClose={() => setNotice((previous) => previous.slice(1))}
        />
      )}
      {prepared && (
        <Modal title="Start a new session?" onClose={() => setPrepared(null)}>
          <p>
            Your completed history is saved. This replaces your currently
            resumable session.
          </p>
          <div className="button-row">
            <button onClick={() => setPrepared(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => launchPrepared(prepared, true)}
            >
              Start new session
            </button>
          </div>
        </Modal>
      )}
      {replace && (
        <Modal title="Start a new session?" onClose={() => setReplace(null)}>
          <p>
            Your completed answers and study history are already saved. Starting
            a new set replaces your currently resumable session.
          </p>
          <div className="button-row">
            <button onClick={() => setReplace(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() =>
                begin(
                  replace.questions,
                  replace.filters,
                  true,
                  replace.reviewQuestion,
                )
              }
            >
              Start new session
            </button>
          </div>
        </Modal>
      )}
      {about && (
        <Modal title="About SAT Practice" onClose={() => setAbout(false)}>
          <p>
            A private study tool using your supplied College Board question-bank
            exports. This app is independent and is not affiliated with or
            endorsed by College Board.
          </p>
          <h3>Local storage</h3>
          <p className="storage-path">{location}</p>
          <p>
            Your question bank is bundled with the app. Attempts, notes,
            highlights, review flags, and the current session are saved
            separately.
          </p>
          <h3>Keyboard shortcuts</h3>
          <p>
            A–D select an answer. Enter submits or advances. Left / Right move
            between questions. Escape closes dialogs. Shortcuts pause while you
            type.
          </p>
          <h3>Calculator</h3>
          <p>
            Official Desmos opens in its own resizable window inside this
            application. Internet is required for the calculator; question
            practice works offline.
          </p>
          <SfxSettings value={sound} onChange={setSound} />
        </Modal>
      )}
    </>
  );
}
