import { describe, expect, it, vi } from "vitest";
import type { StudyState } from "../study/types";
import { STAGES } from "../progression/campaign";
import {
  DEFAULT_SFX_SETTINGS,
  loadSfxSettings,
  progressionSfx,
  saveSfxSettings,
  SfxPlayer,
} from "./sfx";

class FakeClip {
  volume = 0;
  currentTime = 0;
  preload = "";
  onended: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}

const tick = () => Promise.resolve();

describe("SFX settings", () => {
  it("uses safe defaults and persists normalized settings", () => {
    expect(loadSfxSettings({ getItem: () => null })).toEqual(
      DEFAULT_SFX_SETTINGS,
    );
    let saved = "";
    expect(
      saveSfxSettings(
        { enabled: true, volume: 140, mode: "important" },
        { setItem: (_key, value) => (saved = value) },
      ),
    ).toEqual({ enabled: true, volume: 100, mode: "important" });
    expect(JSON.parse(saved).volume).toBe(100);
  });

  it("silences routine feedback in Important events only mode", async () => {
    const clips: FakeClip[] = [];
    const player = new SfxPlayer(
      { enabled: true, volume: 40, mode: "important" },
      () => {
        const clip = new FakeClip();
        clips.push(clip);
        return clip;
      },
    );
    player.play("correct");
    player.play("incorrect");
    player.play("star-earned");
    await tick();
    expect(clips).toHaveLength(1);
  });

  it("keeps feedback subtle and stops it when a major event arrives", async () => {
    const clips: FakeClip[] = [];
    const player = new SfxPlayer(DEFAULT_SFX_SETTINGS, () => {
      const clip = new FakeClip();
      clips.push(clip);
      return clip;
    });
    player.play("correct");
    expect(clips[0].volume).toBeCloseTo(0.168);
    player.play("rank-up");
    await tick();
    expect(clips[0].pause).toHaveBeenCalledOnce();
    expect(clips).toHaveLength(2);
    expect(clips[1].volume).toBeCloseTo(0.312);
  });

  it("queues simultaneous major events by importance without overlap", async () => {
    const clips: FakeClip[] = [];
    const player = new SfxPlayer(DEFAULT_SFX_SETTINGS, () => {
      const clip = new FakeClip();
      clips.push(clip);
      return clip;
    });
    player.play("star-earned");
    player.play("boss-clear");
    await tick();
    expect(clips).toHaveLength(1);
    clips[0].onended?.(new Event("ended"));
    await tick();
    expect(clips).toHaveLength(2);
  });
});

describe("progression SFX observer", () => {
  it("detects earned progression events without changing study state", () => {
    const boss = STAGES.find((stage) => stage.boss)!;
    const baseProgression = {
      version: 1 as const,
      since: "2026-01-01T00:00:00.000Z",
      timeZone: "UTC",
      rank: { highest: 0, previous: 0, history: [] },
      stages: {},
      runs: [],
      days: {},
      quests: {
        q: {
          id: "q",
          period: "2026-01-01",
          kind: "questions" as const,
          target: 1,
          xp: 1,
          offset: 0,
          progress: 0,
        },
      },
      records: {},
    };
    const before = {
      achievements: {},
      progression: baseProgression,
    } as unknown as StudyState;
    const run = {
      id: "run",
      stage: boss.id,
      date: "2026-01-02T00:00:00.000Z",
      questionIds: [],
      correct: 1,
      total: 1,
      seconds: 4,
      stars: 1,
    };
    const next = {
      achievements: { first_question: run.date },
      progression: {
        ...baseProgression,
        rank: { highest: 1, previous: 0, history: [] },
        runs: [run],
        stages: {
          [boss.id]: { stars: 1, attempts: 1, best: run },
        },
        quests: {
          q: { ...baseProgression.quests.q, progress: 1, paidAt: run.date },
        },
        records: { stars: { value: 1, at: run.date } },
      },
    } as unknown as StudyState;
    expect(progressionSfx(before, next)).toEqual([
      "boss-clear",
      "star-earned",
      "quest-complete",
      "rank-up",
      "personal-best",
      "achievement-unlock",
    ]);
    expect(before.progression?.runs).toHaveLength(0);
  });
});
