import type { StudyState } from "../study/types";
import { STAGES } from "../progression/campaign";

export type SfxName =
  | "correct"
  | "incorrect"
  | "star-earned"
  | "quest-complete"
  | "achievement-unlock"
  | "rank-up"
  | "boss-clear"
  | "personal-best";
export type SoundMode = "all" | "important";
export interface SfxSettings {
  enabled: boolean;
  volume: number;
  mode: SoundMode;
}

export const SFX_STORAGE_KEY = "sat-practice:sfx:v1";
export const DEFAULT_SFX_SETTINGS: SfxSettings = {
  enabled: true,
  volume: 40,
  mode: "all",
};

const sources: Record<SfxName, string> = {
  correct: new URL("../assets/sfx/correct.wav", import.meta.url).href,
  incorrect: new URL("../assets/sfx/incorrect.wav", import.meta.url).href,
  "star-earned": new URL("../assets/sfx/star-earned.wav", import.meta.url).href,
  "quest-complete": new URL("../assets/sfx/quest-complete.wav", import.meta.url).href,
  "achievement-unlock": new URL(
    "../assets/sfx/achievement-unlock.wav",
    import.meta.url,
  ).href,
  "rank-up": new URL("../assets/sfx/rank-up.wav", import.meta.url).href,
  "boss-clear": new URL("../assets/sfx/boss-clear.wav", import.meta.url).href,
  "personal-best": new URL("../assets/sfx/personal-best.wav", import.meta.url).href,
};
const feedback = new Set<SfxName>(["correct", "incorrect"]);
const priority: Record<SfxName, number> = {
  "boss-clear": 80,
  "rank-up": 70,
  "achievement-unlock": 60,
  "quest-complete": 50,
  "personal-best": 40,
  "star-earned": 30,
  correct: 10,
  incorrect: 10,
};
const gain: Record<SfxName, number> = {
  correct: 0.42,
  incorrect: 0.42,
  "star-earned": 0.68,
  "quest-complete": 0.72,
  "achievement-unlock": 0.72,
  "rank-up": 0.78,
  "boss-clear": 0.78,
  "personal-best": 0.68,
};

interface Clip {
  volume: number;
  currentTime: number;
  preload: string;
  onended: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  play(): Promise<void> | void;
  pause(): void;
}
type ClipFactory = (source: string) => Clip;

function normalized(value: unknown): SfxSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SFX_SETTINGS };
  const input = value as Partial<SfxSettings>;
  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : DEFAULT_SFX_SETTINGS.enabled,
    volume:
      typeof input.volume === "number" && Number.isFinite(input.volume)
        ? Math.max(0, Math.min(100, Math.round(input.volume)))
        : DEFAULT_SFX_SETTINGS.volume,
    mode: input.mode === "important" ? "important" : "all",
  };
}

export function loadSfxSettings(storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    const raw = storage.getItem(SFX_STORAGE_KEY);
    return raw ? normalized(JSON.parse(raw)) : { ...DEFAULT_SFX_SETTINGS };
  } catch {
    return { ...DEFAULT_SFX_SETTINGS };
  }
}

export function saveSfxSettings(
  settings: SfxSettings,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  const value = normalized(settings);
  try {
    storage.setItem(SFX_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Sound preferences must never interfere with studying.
  }
  return value;
}

export class SfxPlayer {
  private settings: SfxSettings;
  private queue: SfxName[] = [];
  private active: { name: SfxName; clip: Clip } | null = null;
  private scheduled = false;

  constructor(
    settings: SfxSettings = DEFAULT_SFX_SETTINGS,
    private readonly createClip: ClipFactory = (source) => new Audio(source),
  ) {
    this.settings = normalized(settings);
  }

  setSettings(settings: SfxSettings) {
    this.settings = normalized(settings);
    if (!this.settings.enabled) this.stopAll();
    else if (this.settings.mode === "important" && this.active && feedback.has(this.active.name))
      this.finish(this.active.clip);
  }

  play(name: SfxName) {
    if (
      !this.settings.enabled ||
      (this.settings.mode === "important" && feedback.has(name))
    )
      return;
    if (feedback.has(name)) {
      if (this.active && !feedback.has(this.active.name)) return;
      if (this.queue.length) return;
      if (this.active) this.finish(this.active.clip);
      this.start(name);
      return;
    }
    if (this.active?.name === name || this.queue.includes(name)) return;
    this.queue.push(name);
    this.queue.sort((a, b) => priority[b] - priority[a]);
    if (this.active && feedback.has(this.active.name)) this.finish(this.active.clip);
    this.schedule();
  }

  private schedule() {
    if (this.scheduled || this.active) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const next = this.queue.shift();
      if (next) this.start(next);
    });
  }

  private start(name: SfxName) {
    let clip: Clip;
    try {
      clip = this.createClip(sources[name]);
    } catch {
      this.schedule();
      return;
    }
    clip.preload = "auto";
    clip.volume = (this.settings.volume / 100) * gain[name];
    const done = () => this.finish(clip);
    clip.onended = done;
    clip.onerror = done;
    this.active = { name, clip };
    try {
      void Promise.resolve(clip.play()).catch(done);
    } catch {
      done();
    }
  }

  private finish(clip: Clip) {
    if (this.active?.clip !== clip) return;
    clip.onended = null;
    clip.onerror = null;
    clip.pause();
    clip.currentTime = 0;
    this.active = null;
    this.schedule();
  }

  private stopAll() {
    this.queue = [];
    if (this.active) this.finish(this.active.clip);
  }
}

export const sfx = new SfxPlayer(
  typeof localStorage === "undefined"
    ? DEFAULT_SFX_SETTINGS
    : loadSfxSettings(),
);

export function progressionSfx(before: StudyState | null, next: StudyState) {
  if (!before) return [];
  const events: SfxName[] = [];
  const prior = before.progression;
  const after = next.progression;
  if (after && prior) {
    for (const run of after.runs.slice(prior.runs.length)) {
      const oldStars = prior.stages[run.stage]?.stars ?? 0;
      const newStars = after.stages[run.stage]?.stars ?? 0;
      if (newStars > oldStars) {
        if (STAGES.find((stage) => stage.id === run.stage)?.boss)
          events.push("boss-clear");
        events.push("star-earned");
      }
    }
    if (
      Object.entries(after.quests).some(
        ([id, quest]) => quest.paidAt && !prior.quests[id]?.paidAt,
      )
    )
      events.push("quest-complete");
    if (after.rank.highest > prior.rank.highest) events.push("rank-up");
    if (
      Object.entries(after.records).some(
        ([id, record]) => record.at !== prior.records[id]?.at,
      )
    )
      events.push("personal-best");
  }
  if (
    Object.keys(next.achievements).some((id) => !before.achievements[id])
  )
    events.push("achievement-unlock");
  return [...new Set(events)];
}
