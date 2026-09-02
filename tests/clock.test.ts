import { describe, expect, it } from "vitest";
import { audioDriftMs, clockFromStart, crossfadeProgress, shouldCorrectAudio } from "../lib/shared/clock";

describe("clockFromStart", () => {
  it("starts at clip 0", () => {
    const c = clockFromStart(1000, 1000);
    expect(c.audioOffsetMs).toBe(0);
    expect(c.clipIndex).toBe(0);
    expect(c.crossfading).toBe(false);
  });

  it("maps 10s boundaries to six clips", () => {
    const start = 0;
    expect(clockFromStart(start, 9999).clipIndex).toBe(0);
    expect(clockFromStart(start, 10_000).clipIndex).toBe(1);
    expect(clockFromStart(start, 59_999).clipIndex).toBe(5);
    expect(clockFromStart(start, 80_000).clipIndex).toBe(5);
    expect(clockFromStart(start, 80_000).audioOffsetMs).toBe(60_000);
  });

  it("crossfades the last 250ms of a clip", () => {
    const c = clockFromStart(0, 9_800);
    expect(c.crossfading).toBe(true);
    expect(c.nextClipIndex).toBe(1);
    const last = clockFromStart(0, 59_900);
    expect(last.crossfading).toBe(false);
    expect(last.clipIndex).toBe(5);
  });

  it("ramps crossfade opacity instead of snapping", () => {
    expect(crossfadeProgress(9_750)).toBe(0);
    expect(crossfadeProgress(9_800)).toBeCloseTo(0.2, 5);
    expect(crossfadeProgress(9_875)).toBeCloseTo(0.5, 5);
    expect(crossfadeProgress(10_000)).toBe(1);
  });
});

describe("audio master clock", () => {
  it("corrects drift beyond 180ms", () => {
    expect(shouldCorrectAudio(audioDriftMs(1.0, 1000))).toBe(false);
    expect(shouldCorrectAudio(audioDriftMs(1.4, 1000))).toBe(true);
  });

  it("does not correct 250ms playback jitter at the stage threshold", () => {
    expect(shouldCorrectAudio(250, 900)).toBe(false);
    expect(shouldCorrectAudio(901, 900)).toBe(true);
  });
});
