import { describe, expect, it } from "vitest";
import { houseClipPrompt, houseMusicPrompt } from "../lib/shared/house-prompt";
import { isPlayableAudioUrl, isPlayableVideoUrl, isStubHouseAudio, isStubHouseVideo } from "../lib/shared/media";
import { RESIDENT_SEEDS, residentSessionHash } from "../lib/shared/residents";

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

  it("asks for dancing bodies and DJ performance", () => {
    const prompt = houseClipPrompt(2, { display_name: "Neon Mira", character_prompt: "magenta DJ" }, "dancer");
    expect(prompt).toMatch(/dancing|dancefloor|club floor/i);
    expect(prompt).toMatch(/Neon Mira/);
    expect(prompt).toMatch(/NOT DJing/);
    expect(prompt).toMatch(/NOT in the DJ booth/);
  });
});

describe("house music beds", () => {
  it("writes instrumental Music 3 prompts", () => {
    expect(houseMusicPrompt(0)).toMatch(/BPM/i);
    expect(houseMusicPrompt(0)).toMatch(/instrumental/i);
    expect(houseMusicPrompt(0)).not.toBe(houseMusicPrompt(2));
  });
});

describe("house audio stubs", () => {
  it("treats the public mp3 as last-resort only", () => {
    expect(isStubHouseAudio("/house/house-audio.mp3")).toBe(true);
    expect(isPlayableAudioUrl("house/audio/abc.wav")).toBe(true);
  });
});

describe("resident crew", () => {
  it("seeds five named house DJs", () => {
    expect(RESIDENT_SEEDS.length).toBeGreaterThanOrEqual(5);
    expect(RESIDENT_SEEDS.map((r) => r.displayName)).toEqual(
      expect.arrayContaining(["Neon Mira", "Basement Kev", "Vinyl Ghost"]),
    );
    expect(residentSessionHash("neon-mira")).toBe("resident:neon-mira");
  });
});
