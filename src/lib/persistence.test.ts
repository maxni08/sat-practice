import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProgress } from "../types";
import type { Session } from "../types";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/core", () => native);

import {
  flushPersistence,
  getDataLocation,
  loadState,
  loadPlaytime,
  loadDuelHistory,
  resetQuestion,
  saveAttempt,
  saveProgress,
  saveSession,
  savePlaytime,
  saveDuelHistory,
} from "./persistence";

const storage = new Map<string, string>();
const localStorageStub = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value);
  }),
};
vi.stubGlobal("localStorage", localStorageStub);

const session: Session = {
  id: "session-a",
  test: "Math",
  questionIds: ["q1"],
  index: 0,
  answers: {},
  drafts: { q1: "2" },
  eliminated: { q1: ["A"] },
  elapsed: { q1: 42 },
  timerMode: "question",
  timerSeconds: 90,
  startedAt: 1000,
  deadline: null,
  timerHidden: true,
  finished: false,
};

beforeEach(async () => {
  await flushPersistence();
  storage.clear();
  native.isTauri.mockReturnValue(false);
  native.invoke.mockReset();
  localStorageStub.setItem.mockClear();
  localStorageStub.getItem.mockClear();
});

describe("browser preview persistence", () => {
  it("stores progress and interrupted session independently and restores all state", async () => {
    const progress = {
      ...emptyProgress(),
      attempts: 1,
      correctAttempts: 1,
      notes: "Watch the sign.",
      bookmark: true,
      highlights: [
        { field: "stem" as const, start: 1, end: 5, color: "yellow" },
      ],
    };
    await saveProgress("q1", progress);
    await saveSession(session);
    expect(await loadState()).toEqual({ progress: { q1: progress }, session });
    await saveSession(null);
    expect((await loadState()).progress.q1).toEqual(progress);
    expect((await loadState()).session).toBeNull();
  });

  it("snapshots caller data immediately to prevent queued writes from seeing later mutation", async () => {
    const progress = emptyProgress();
    const write = saveProgress("q1", progress);
    progress.notes = "Changed after write was requested";
    await write;
    expect((await loadState()).progress.q1.notes).toBe("");
  });

  it("saves attempts and their session as one storage update", async () => {
    const progress = {
      ...emptyProgress(),
      attempts: 1,
      incorrectAttempts: 1,
      lastResult: false,
    };
    await saveAttempt("q1", progress, session);
    expect(localStorageStub.setItem).toHaveBeenCalledTimes(1);
    expect(await loadState()).toEqual({ progress: { q1: progress }, session });
  });

  it("resets just the selected question", async () => {
    await saveProgress("q1", { ...emptyProgress(), bookmark: true });
    await saveProgress("q2", { ...emptyProgress(), notes: "Keep this" });
    await resetQuestion("q1");
    expect((await loadState()).progress.q1).toBeUndefined();
    expect((await loadState()).progress.q2.notes).toBe("Keep this");
  });

  it("reports corrupted preview data instead of silently destroying it", async () => {
    storage.set("sat-practice-browser-preview-v1", "{bad JSON");
    await expect(loadState()).rejects.toThrow(/could not be read/);
    expect(storage.get("sat-practice-browser-preview-v1")).toBe("{bad JSON");
  });

  it("clearly identifies preview storage", async () => {
    expect(await getDataLocation()).toMatch(/Browser preview/);
  });

  it("persists playtime independently across preview restarts", async () => {
    const playtime = {
      version: 1 as const,
      trackingSince: "2026-09-16T00:00:00.000Z",
      totalSeconds: 90,
      historicalSeconds: 60,
      byDay: { "2026-09-16": 30 },
      byMode: { Practice: 90 },
    };
    await savePlaytime(playtime);
    expect(await loadPlaytime()).toEqual(playtime);
    expect(await loadState()).toEqual({ progress: {}, session: null });
  });

  it("persists isolated Local 1v1 history across preview restarts", async () => {
    const history = { version: 1 as const, matches: [{ id: "m", date: "2026-09-17", subject: "Mixed" as const, mode: "Regular" as const, count: 5, p1: 3, p2: 2, p1CorrectMs: 5000, p2CorrectMs: 6000, p1Name: "Player 1", p2Name: "Player 2", winner: "Player 1" }] };
    await saveDuelHistory(history);
    expect(await loadDuelHistory()).toEqual(history);
    expect(await loadState()).toEqual({ progress: {}, session: null });
  });
});

describe("native persistence", () => {
  beforeEach(() => {
    native.isTauri.mockReturnValue(true);
  });

  it("uses the atomic native save command and correct camelCase arguments", async () => {
    const progress = emptyProgress();
    native.invoke.mockResolvedValue(undefined);
    await saveAttempt("q1", progress, session);
    expect(native.invoke).toHaveBeenCalledWith("save_attempt", {
      questionId: "q1",
      progress,
      session,
    });
    expect(storage.size).toBe(0);
  });

  it("does not switch to browser storage when SQLite fails and permits retry", async () => {
    native.invoke
      .mockRejectedValueOnce(new Error("Database cannot be written"))
      .mockResolvedValueOnce(undefined);
    await expect(saveProgress("q1", emptyProgress())).rejects.toThrow(
      /cannot be written/,
    );
    expect(storage.size).toBe(0);
    await expect(saveProgress("q1", emptyProgress())).resolves.toBeUndefined();
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it("serializes asynchronous writes in their requested order", async () => {
    let release: () => void = () => undefined;
    native.invoke
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const first = saveSession(session);
    const second = saveSession(null);
    await Promise.resolve();
    expect(native.invoke).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(native.invoke.mock.calls.map((call) => call[1])).toEqual([
      { session },
      { session: null },
    ]);
  });

  it("uses isolated native playtime commands", async () => {
    const playtime = {
      version: 1 as const,
      trackingSince: "2026-09-16T00:00:00.000Z",
      totalSeconds: 15,
      historicalSeconds: 0,
      byDay: {},
      byMode: {},
    };
    native.invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce(playtime);
    await savePlaytime(playtime);
    expect(await loadPlaytime()).toEqual(playtime);
    expect(native.invoke).toHaveBeenNthCalledWith(1, "save_playtime", { playtime });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "load_playtime");
  });

  it("uses isolated native Local 1v1 history commands", async () => {
    const history = { version: 1 as const, matches: [] };
    native.invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce(history);
    await saveDuelHistory(history);
    expect(await loadDuelHistory()).toEqual(history);
    expect(native.invoke).toHaveBeenNthCalledWith(1, "save_duel_history", { history });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "load_duel_history");
  });
});
