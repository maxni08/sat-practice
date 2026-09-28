import { describe, expect, it, vi } from "vitest";
import { registerEscape } from "./escape";

describe("Escape layers", () => {
  it("closes one highest layer at a time without triggering lower layers", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const calls: string[] = [];
    const low = registerEscape(() => calls.push("panel"), 10);
    const high = registerEscape(() => calls.push("zoom"), 50);
    const event = () => Object.assign(new Event("keydown", {cancelable:true}), {key:"Escape"});
    target.dispatchEvent(event());
    expect(calls).toEqual(["zoom"]);
    high();
    target.dispatchEvent(event());
    expect(calls).toEqual(["zoom","panel"]);
    low();
    target.dispatchEvent(event());
    expect(calls).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
