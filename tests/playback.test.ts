import { describe, expect, it } from "vitest";
import { shouldAdvancePlayback } from "../lib/shared/playback";

const now = Date.parse("2026-09-02T12:00:00.000Z");
const later = new Date(now + 45_000).toISOString();
const past = new Date(now - 100).toISOString();

describe("shouldAdvancePlayback", () => {
  it("advances when the playing turn has ended", () => {
    expect(
      shouldAdvancePlayback({ playingKind: "house", endsAt: past, hasReadyDj: false, now }),
    ).toBe(true);
    expect(
      shouldAdvancePlayback({ playingKind: "dj", endsAt: past, hasReadyDj: true, now }),
    ).toBe(true);
  });

  it("cuts house immediately when a human DJ set is ready", () => {
    expect(
      shouldAdvancePlayback({ playingKind: "house", endsAt: later, hasReadyDj: true, now }),
    ).toBe(true);
  });

  it("lets house finish when no DJ is ready", () => {
    expect(
      shouldAdvancePlayback({ playingKind: "house", endsAt: later, hasReadyDj: false, now }),
    ).toBe(false);
  });

  it("does not preempt a live human DJ for another ready set", () => {
    expect(
      shouldAdvancePlayback({ playingKind: "dj", endsAt: later, hasReadyDj: true, now }),
    ).toBe(false);
  });
});
