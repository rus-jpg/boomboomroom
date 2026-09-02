import { describe, expect, it } from "vitest";
import { isPlayableVideoUrl, isStubHouseVideo } from "../lib/shared/media";
import { houseClipPrompt } from "../lib/shared/house-prompt";

describe("house livestream urls", () => {
  it("treats empty and public stubs as not playable", () => {
    expect(isStubHouseVideo("")).toBe(true);
    expect(isStubHouseVideo("/house/house-01.mp4")).toBe(true);
    expect(isPlayableVideoUrl("/house/house-03.mp4")).toBe(false);
  });

  it("treats signed H3 Max storage keys as playable", () => {
    expect(isStubHouseVideo("house/video/abc.mp4")).toBe(false);
    expect(isPlayableVideoUrl("https://example.supabase.co/storage/v1/object/sign/media/house/video/abc.mp4")).toBe(true);
  });
});

describe("house clip prompt", () => {
  it("asks for midnight basement disco livestream", () => {
    const prompt = houseClipPrompt(0);
    expect(prompt).toMatch(/midnight basement disco/i);
    expect(prompt).toMatch(/16:9/);
    expect(prompt).toMatch(/768P/);
  });

  it("rotates camera and mood so the auto-prompter stays fresh", () => {
    const a = houseClipPrompt(0);
    const b = houseClipPrompt(7);
    expect(a).not.toBe(b);
    expect(b).toMatch(/neon sweat|fog and lasers|crowd silhouettes|DJ booth|wet concrete|strobe|basement/i);
  });
});
