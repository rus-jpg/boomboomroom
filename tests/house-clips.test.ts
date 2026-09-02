import { describe, expect, it } from "vitest";
import {
  clipAllowedForHolder,
  clipIsHolderBooth,
  countHolderReadyClips,
  selectHouseTurnClips,
  type HouseClipCandidate,
} from "../lib/shared/house-clips";
import { isDjBoothSlot } from "../lib/shared/stage-cast";

const A = "holder-a";
const B = "holder-b";

function clip(
  id: string,
  participantId: string | null,
  role: string | null,
  key = `${id}.mp4`,
): HouseClipCandidate {
  return { id, storage_key: key, participant_id: participantId, role };
}

describe("house clip eligibility for labeled DJ", () => {
  it("never allows booth/DJ-tagged media for a different holder", () => {
    const vinylDj = clip("vinyl-dj", B, "dj");
    const kevDj = clip("kev-dj", A, "dj");
    const vinylDance = clip("vinyl-dance", B, "dancer");
    expect(clipAllowedForHolder(vinylDj, A)).toBe(false);
    expect(clipAllowedForHolder(kevDj, A)).toBe(true);
    expect(clipAllowedForHolder(vinylDance, A)).toBe(true);
    expect(clipIsHolderBooth(vinylDj, A)).toBe(false);
    expect(clipIsHolderBooth(kevDj, A)).toBe(true);
  });

  it("excludes untagged clips of another person (may be leftover DJ takes)", () => {
    expect(clipAllowedForHolder(clip("old-b", B, null), A)).toBe(false);
    expect(clipAllowedForHolder(clip("old-a", A, null), A)).toBe(true);
    expect(clipAllowedForHolder(clip("crowd", null, null), A)).toBe(true);
  });
});

describe("selectHouseTurnClips", () => {
  it("selecting clips for holder A never returns booth/DJ-tagged media for participant B", () => {
    const clips = [
      clip("b-dj-1", B, "dj", "https://cdn.example/vinyl-dj-1.mp4"),
      clip("b-dj-2", B, "dj", "https://cdn.example/vinyl-dj-2.mp4"),
      clip("a-dj-1", A, "dj", "https://cdn.example/kev-dj-1.mp4"),
      clip("b-dance", B, "dancer", "https://cdn.example/vinyl-dance.mp4"),
      clip("a-dance", A, "dancer", "https://cdn.example/kev-dance.mp4"),
      clip("crowd", null, "crowd", "https://cdn.example/crowd.mp4"),
      clip("b-untagged", B, null, "https://cdn.example/vinyl-old.mp4"),
    ];
    const { keys, claimIds } = selectHouseTurnClips(clips, A, 6);
    expect(keys.length).toBe(6);
    expect(keys).not.toContain("https://cdn.example/vinyl-dj-1.mp4");
    expect(keys).not.toContain("https://cdn.example/vinyl-dj-2.mp4");
    expect(keys).not.toContain("https://cdn.example/vinyl-old.mp4");
    expect(keys).toContain("https://cdn.example/kev-dj-1.mp4");
    expect(keys).toContain("https://cdn.example/vinyl-dance.mp4");
    expect(claimIds).not.toContain("b-dj-1");
    expect(claimIds).not.toContain("b-dj-2");
    expect(claimIds).not.toContain("b-untagged");

    for (let i = 0; i < keys.length; i++) {
      if (!isDjBoothSlot(i)) continue;
      expect(keys[i]).toBe("https://cdn.example/kev-dj-1.mp4");
    }
  });

  it("fills with dancers instead of another resident's DJ face when holder booth clips are missing", () => {
    const clips = [
      clip("b-dj-1", B, "dj"),
      clip("b-dj-2", B, "dj"),
      clip("b-dance", B, "dancer"),
      clip("crowd", null, "crowd"),
    ];
    const { keys } = selectHouseTurnClips(clips, A, 6);
    expect(keys.every((key) => !key.includes("b-dj"))).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("b-dance.mp4");
  });

  it("counts only holder-safe unused clips toward the ready pool", () => {
    const clips = [clip("b-dj", B, "dj"), clip("a-dj", A, "dj"), clip("dance", B, "dancer")];
    expect(countHolderReadyClips(clips, A)).toEqual({ booth: 1, floor: 1, allowed: 2 });
  });
});
