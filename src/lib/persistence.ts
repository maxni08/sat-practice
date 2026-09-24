import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppState, QuestionProgress, Session } from "../types";
import type { StudyState } from "../study/types";
import type { PlaytimeState } from "../playtime/playtime";
import { sanitizeDuelHistory, type DuelHistory } from "../duel/duel";

const PREVIEW_KEY = "sat-practice-browser-preview-v1";
const PLAYTIME_PREVIEW_KEY = "sat-practice-playtime-preview-v1";
const DUEL_PREVIEW_KEY = "sat-practice-duel-history-preview-v1";
let pendingWrite: Promise<unknown> = Promise.resolve();

export function isDesktopApp(): boolean {
  return isTauri();
}

function readPreview(): AppState {
  const raw = localStorage.getItem(PREVIEW_KEY);
  if (!raw) return { progress: {}, session: null };
  try {
    const state: unknown = JSON.parse(raw);
    if (
      !state ||
      typeof state !== "object" ||
      !("progress" in state) ||
      !("session" in state) ||
      typeof state.progress !== "object" ||
      state.progress === null ||
      Array.isArray(state.progress)
    ) {
      throw new Error("Invalid preview data");
    }
    return state as AppState;
  } catch {
    throw new Error(
      "Browser preview progress could not be read. Your desktop SQLite database is separate and unaffected.",
    );
  }
}

function writePreview(state: AppState): void {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(state));
  } catch {
    throw new Error(
      "Browser preview progress could not be saved. Check available browser storage.",
    );
  }
}

/** All writes share a queue so notes, session snapshots and attempts cannot overtake each other. */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(work, work);
  pendingWrite = result.catch(() => undefined);
  return result;
}

export async function loadState(): Promise<AppState> {
  await pendingWrite;
  return isDesktopApp() ? invoke<AppState>("load_state") : readPreview();
}

export function saveProgress(
  questionId: string,
  progress: QuestionProgress,
): Promise<void> {
  const snapshot = structuredClone(progress);
  return enqueue(async () => {
    if (isDesktopApp())
      await invoke("save_progress", { questionId, progress: snapshot });
    else {
      const state = readPreview();
      state.progress[questionId] = snapshot;
      writePreview(state);
    }
  });
}

export function saveSession(session: Session | null): Promise<void> {
  const snapshot = structuredClone(session);
  return enqueue(async () => {
    if (isDesktopApp()) await invoke("save_session", { session: snapshot });
    else writePreview({ ...readPreview(), session: snapshot });
  });
}

export function saveAttempt(
  questionId: string,
  progress: QuestionProgress,
  session: Session,
): Promise<void> {
  const progressSnapshot = structuredClone(progress);
  const sessionSnapshot = structuredClone(session);
  return enqueue(async () => {
    if (isDesktopApp())
      await invoke("save_attempt", {
        questionId,
        progress: progressSnapshot,
        session: sessionSnapshot,
      });
    else {
      const state = readPreview();
      state.progress[questionId] = progressSnapshot;
      state.session = sessionSnapshot;
      writePreview(state);
    }
  });
}

export function resetQuestion(questionId: string): Promise<void> {
  return enqueue(async () => {
    if (isDesktopApp()) await invoke("reset_question", { questionId });
    else {
      const state = readPreview();
      delete state.progress[questionId];
      writePreview(state);
    }
  });
}

export async function getDataLocation(): Promise<string> {
  return isDesktopApp()
    ? invoke<string>("data_location")
    : "Browser preview storage only. The Windows application saves progress in its local SQLite database.";
}

export async function openCalculator(): Promise<void> {
  if (isDesktopApp()) await invoke("open_calculator");
  else {
    // Native builds use an isolated, resizable WebView2 window inside the application.
    // This separate browser-preview window is never used by the packaged application.
    window.open(
      "https://www.desmos.com/calculator",
      "sat-practice-calculator",
      "popup,width=700,height=700",
    );
  }
}

export async function flushPersistence(): Promise<void> {
  await pendingWrite;
}

export async function loadStudy(): Promise<StudyState | null> {
  await pendingWrite;
  return isDesktopApp()
    ? invoke<StudyState | null>("load_study")
    : ((readPreview() as AppState & { study?: StudyState }).study ?? null);
}

export async function loadPlaytime(): Promise<PlaytimeState | null> {
  await pendingWrite;
  if (isDesktopApp()) return invoke<PlaytimeState | null>("load_playtime");
  const raw = localStorage.getItem(PLAYTIME_PREVIEW_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlaytimeState;
  } catch {
    throw new Error("Browser preview playtime could not be read.");
  }
}

export function savePlaytime(playtime: PlaytimeState): Promise<void> {
  const snapshot = structuredClone(playtime);
  return enqueue(async () => {
    if (isDesktopApp()) await invoke("save_playtime", { playtime: snapshot });
    else localStorage.setItem(PLAYTIME_PREVIEW_KEY, JSON.stringify(snapshot));
  });
}

export async function loadDuelHistory(): Promise<DuelHistory | null> {
  await pendingWrite;
  if (isDesktopApp()) {
    const history = await invoke<DuelHistory | null>("load_duel_history");
    return history ? sanitizeDuelHistory(history) : null;
  }
  const raw = localStorage.getItem(DUEL_PREVIEW_KEY);
  return raw ? sanitizeDuelHistory(JSON.parse(raw)) : null;
}

export function saveDuelHistory(history: DuelHistory): Promise<void> {
  const snapshot = sanitizeDuelHistory(structuredClone(history));
  return enqueue(async () => {
    if (isDesktopApp()) await invoke("save_duel_history", { history: snapshot });
    else localStorage.setItem(DUEL_PREVIEW_KEY, JSON.stringify(snapshot));
  });
}

export function commitStudy(
  eventId: string,
  study: StudyState,
  updates: AppState["progress"],
  session: Session | null,
  removed: string[] = [],
): Promise<void> {
  const snapshot = structuredClone({ study, updates, session, removed });
  return enqueue(async () => {
    if (isDesktopApp())
      await invoke("commit_study", {
        eventId,
        expectedRevision: study.revision - 1,
        ...snapshot,
      });
    else {
      const state = readPreview() as AppState & { study?: StudyState };
      if ((state.study?.revision ?? 0) !== study.revision - 1)
        throw new Error(
          "Study data changed in another operation. Reload before retrying.",
        );
      for (const id of removed) delete state.progress[id];
      state.progress = { ...state.progress, ...snapshot.updates };
      state.session = snapshot.session;
      state.study = snapshot.study;
      writePreview(state);
    }
  });
}
