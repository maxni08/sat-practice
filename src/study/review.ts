import { RULES } from "./config";
import type { ReviewSchedule } from "./types";

export function scheduleReview(
  previous: ReviewSchedule | undefined,
  correct: boolean,
  now: number,
): ReviewSchedule | undefined {
  if (correct && !previous) return undefined;
  // A rapid repeat does not advance a spaced-review streak.
  if (correct && previous && now < Date.parse(previous.dueAt)) return previous;
  const streak = correct ? (previous?.streak ?? 0) + 1 : 0;
  const misses = (previous?.misses ?? 0) + Number(!correct);
  const interval = correct
    ? RULES.reviewIntervalsDays[
        Math.min(streak - 1, RULES.reviewIntervalsDays.length - 1)
      ]
    : misses > 1
      ? 0.25
      : 1;
  return {
    dueAt: new Date(now + interval * RULES.day).toISOString(),
    streak,
    misses,
    lastAt: new Date(now).toISOString(),
  };
}
