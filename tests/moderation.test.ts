import { describe, expect, it } from "vitest";
import { isBanned, isBlockedText, isMuted, normalizeChat, takeToken } from "../lib/shared/moderation";

describe("moderation", () => {
  it("strips and clamps chat", () => {
    expect(normalizeChat("  hello   room  ", 8)).toBe("hello ro");
  });

  it("blocks slurs and raw urls", () => {
    expect(isBlockedText("visit https://spam.example")).toBe(true);
    expect(isBlockedText("nice set")).toBe(false);
  });

  it("honors mute and ban windows", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isMuted(future)).toBe(true);
    expect(isBanned(null)).toBe(false);
  });

  it("rate limits", () => {
    const bucket = { stamps: [] as number[] };
    let allowed = 0;
    for (let i = 0; i < 25; i++) if (takeToken(bucket, 20, 60_000, 1_000 + i)) allowed++;
    expect(allowed).toBe(20);
  });
});
