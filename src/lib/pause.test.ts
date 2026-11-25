import { describe, expect, it } from "vitest";
import { pauseSession, resumeSession, remainingTimerSeconds } from "./session";
import type { Session } from "../types";
const session = { finished:false, timerMode:"session", timerSeconds:60, deadline:61000, elapsed:{a:12} } as unknown as Session;
describe("pause and review clocks", () => {
  it("freezes a timed session and restores its remaining time once", () => {
    const paused = pauseSession(session,11000);
    expect(remainingTimerSeconds(paused,"a",90000)).toBe(50);
    expect(pauseSession(paused,90000)).toBe(paused);
    const resumed = resumeSession(JSON.parse(JSON.stringify(paused)),90000);
    expect(remainingTimerSeconds(resumed,"a",90000)).toBe(50);
    expect(remainingTimerSeconds(resumed,"a",95000)).toBe(45);
    expect(resumeSession(resumed,100000)).toBe(resumed);
  });
  it("does not expose a countdown or pause completed review", () => {
    const review = {...session,finished:true};
    expect(remainingTimerSeconds(review,"a",20000)).toBeNull();
    expect(pauseSession(review,20000)).toBe(review);
  });
  it("preserves per-question time during a pause and keeps marks session-local", () => {
    const paused = pauseSession({...session,timerMode:"question", highlights:{a:[{field:"stem",start:0,end:3,color:"yellow"}]}},11000);
    expect(remainingTimerSeconds(paused,"a",90000)).toBe(48);
    expect(resumeSession(paused,90000).elapsed).toEqual({a:12});
    expect(session.highlights).toBeUndefined();
  });
});
