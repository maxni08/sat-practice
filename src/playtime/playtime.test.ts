import { describe, expect, it } from "vitest";
import { emptyProgress, type Session } from "../types";
import type { StudyState } from "../study/types";
import {
  activeSeconds,
  addPlaytime,
  formatPlaytime,
  initializePlaytime,
  playtimeMode,
  playtimeStats,
  type PlaytimeState,
} from "./playtime";

const base: PlaytimeState = {
  version: 1,
  trackingSince: "2026-09-16T00:00:00.000Z",
  totalSeconds: 0,
  historicalSeconds: 0,
  byDay: {},
  byMode: {},
};
const session = (extra: Partial<Session> = {}): Session => ({
  id: "s",
  test: "Math",
  questionIds: ["q"],
  index: 0,
  answers: {},
  drafts: { q: "" },
  eliminated: { q: [] },
  elapsed: { q: 0 },
  timerMode: "none",
  timerSeconds: 0,
  startedAt: 0,
  deadline: null,
  timerHidden: false,
  finished: false,
  mode: "custom",
  ...extra,
});

describe("active playtime", () => {
  it("counts timed thinking until the real deadline without an interaction", () => {
    expect(activeSeconds(0, 10 * 60_000, 0, 8 * 60_000)).toBe(480);
  });

  it("stops untimed activity after five idle minutes", () => {
    expect(activeSeconds(0, 12 * 60_000, 0, null)).toBe(300);
    expect(activeSeconds(8 * 60_000, 9 * 60_000, 0, null)).toBe(0);
  });

  it("classifies every study mode without changing session logic", () => {
    expect(playtimeMode("duel", null)).toBe("Local 1v1");
    expect(playtimeMode("practice", session())).toBe("Practice");
    expect(playtimeMode("practice", session({ mode: "adaptive" }))).toBe(
      "Adaptive Practice",
    );
    expect(playtimeMode("practice", session({ challenge: { level: 1 } }))).toBe(
      "Challenge Ladder",
    );
    expect(
      playtimeMode(
        "practice",
        session({ mode: "module", module: { blueprint: "x", route: "balanced", number: 1 } }),
      ),
    ).toBe("Practice Module");
    expect(playtimeMode("practice", session({ mock: { id: "m", stage: 0, moduleIds: [] } }))).toBe(
      "Full SAT Mock",
    );
    expect(playtimeMode("results", session())).toBe("Review");
    expect(playtimeMode("home", session())).toBeNull();
  });

  it("backfills only persisted proof and keeps unknown mode time explicit", () => {
    const progress = {
      q: { ...emptyProgress(), totalTimeSpent: 100 },
    };
    const study = {
      evidence: {
        q: [
          {
            at: "2026-09-15T12:00:00.000Z",
            correct: true,
            seconds: 60,
            mode: "adaptive",
          },
        ],
      },
    } as unknown as StudyState;
    const result = initializePlaytime(progress, study, Date.parse("2026-09-16T00:00:00Z"));
    expect(result.totalSeconds).toBe(100);
    expect(result.historicalSeconds).toBe(100);
    expect(result.byMode["Adaptive Practice"]).toBe(60);
    expect(result.byMode["Historical study"]).toBe(40);
  });

  it("persists totals, days and mode breakdown deterministically", () => {
    const at = new Date(2026, 8, 16, 12).getTime();
    const result = addPlaytime(base, "Practice", 90, at);
    const stats = playtimeStats(result, 45, at);
    expect(stats).toMatchObject({
      total: 90,
      today: 90,
      week: 90,
      current: 45,
      averageDay: 90,
      longestDay: 90,
    });
    expect(result.byMode.Practice).toBe(90);
    expect(formatPlaytime(100_980)).toBe("28h 3m");
  });
});
