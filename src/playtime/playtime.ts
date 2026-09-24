import type { ProgressMap, Session } from "../types";
import type { StudyState } from "../study/types";
import { STAGES } from "../progression/campaign";

export const IDLE_LIMIT_MS = 5 * 60 * 1000;
export const PLAYTIME_MODES = [
  "Practice",
  "Adaptive Practice",
  "Campaign",
  "Boss",
  "Challenge Ladder",
  "Practice Module",
  "Full Section",
  "Full SAT Mock",
  "Review",
  "Local 1v1",
  "Historical study",
] as const;
export type PlaytimeMode = (typeof PLAYTIME_MODES)[number];
export interface PlaytimeState {
  version: 1;
  trackingSince: string;
  totalSeconds: number;
  historicalSeconds: number;
  byDay: Record<string, number>;
  byMode: Partial<Record<PlaytimeMode, number>>;
}

const validSeconds = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;
export function localDay(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function historicalMode(mode: string): PlaytimeMode {
  if (mode === "adaptive") return "Adaptive Practice";
  if (mode === "module") return "Practice Module";
  return "Practice";
}

export function initializePlaytime(
  progress: ProgressMap,
  study: StudyState,
  now: number,
): PlaytimeState {
  const progressSeconds = Object.values(progress).reduce(
    (sum, value) => sum + validSeconds(value.totalTimeSpent),
    0,
  );
  const evidence = Object.values(study.evidence)
    .flat()
    .filter(
      (item) =>
        validSeconds(item.seconds) > 0 && Number.isFinite(Date.parse(item.at)),
    );
  const evidenceSeconds = evidence.reduce(
    (sum, item) => sum + validSeconds(item.seconds),
    0,
  );
  const totalSeconds = Math.max(progressSeconds, evidenceSeconds);
  const byDay: Record<string, number> = {};
  const byMode: PlaytimeState["byMode"] = {};
  for (const item of evidence) {
    const seconds = validSeconds(item.seconds);
    const day = localDay(Date.parse(item.at));
    const mode = historicalMode(item.mode);
    byDay[day] = (byDay[day] ?? 0) + seconds;
    byMode[mode] = (byMode[mode] ?? 0) + seconds;
  }
  const residual = Math.max(0, totalSeconds - evidenceSeconds);
  if (residual) byMode["Historical study"] = residual;
  return {
    version: 1,
    trackingSince: new Date(now).toISOString(),
    totalSeconds,
    historicalSeconds: totalSeconds,
    byDay,
    byMode,
  };
}

export function playtimeMode(
  view: string,
  session: Session | null,
): PlaytimeMode | null {
  if (view === "duel") return "Local 1v1";
  if (view === "results") return "Review";
  if (view !== "practice" || !session) return null;
  if (session.finished) return "Review";
  if (session.mock) return "Full SAT Mock";
  if (session.campaign) {
    return STAGES.find((stage) => stage.id === session.campaign?.stage)?.boss
      ? "Boss"
      : "Campaign";
  }
  if (session.challenge) return "Challenge Ladder";
  if (session.module?.sectionId) return "Full Section";
  if (session.mode === "module") return "Practice Module";
  if (session.mode === "adaptive") return "Adaptive Practice";
  return "Practice";
}

export function activeSeconds(
  from: number,
  to: number,
  lastActivity: number,
  timedUntil: number | null,
) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  const end = timedUntil
    ? Math.min(to, timedUntil)
    : Math.min(to, lastActivity + IDLE_LIMIT_MS);
  return Math.max(0, (end - from) / 1000);
}

export function addPlaytime(
  state: PlaytimeState,
  mode: PlaytimeMode,
  seconds: number,
  at: number,
): PlaytimeState {
  const value = validSeconds(seconds);
  if (!value) return state;
  const day = localDay(at);
  return {
    ...state,
    totalSeconds: state.totalSeconds + value,
    byDay: { ...state.byDay, [day]: (state.byDay[day] ?? 0) + value },
    byMode: {
      ...state.byMode,
      [mode]: (state.byMode[mode] ?? 0) + value,
    },
  };
}

export function playtimeStats(
  state: PlaytimeState,
  currentSessionSeconds: number,
  now: number,
) {
  const today = localDay(now);
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  const weekStart = localDay(current.getTime());
  const knownDays = Object.values(state.byDay).filter((seconds) => seconds > 0);
  return {
    total: state.totalSeconds,
    today: state.byDay[today] ?? 0,
    week: Object.entries(state.byDay)
      .filter(([day]) => day >= weekStart && day <= today)
      .reduce((sum, [, seconds]) => sum + seconds, 0),
    current: currentSessionSeconds,
    averageDay: knownDays.length
      ? knownDays.reduce((sum, seconds) => sum + seconds, 0) /
        knownDays.length
      : 0,
    longestDay: Math.max(0, ...knownDays),
  };
}

export function formatPlaytime(seconds: number) {
  const minutes = Math.floor(validSeconds(seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
