import { describe, expect, it } from "vitest";
import { houseClipPrompt } from "../lib/shared/house-prompt";
import {
  assignDjTurnClips,
  assignHouseClip,
  asCastFace,
  djClipPrompt,
  isDjBoothSlot,
  isHumanPresenceStale,
  latestHeartbeatMs,
  shouldAnnounceHouseTakeover,
  stageCastPool,
  type CastFace,
} from "../lib/shared/stage-cast";

const dj: CastFace = {
  id: "dj-1",
  display_name: "Velvet",
  character_prompt: "silver visor, booth lights",
  character_reference_url: "media/velvet.jpg",
};

const dancerA: CastFace = {
  id: "p-2",
  display_name: "Neon Fox",
  character_prompt: "magenta dancer",
  character_reference_url: "media/fox.jpg",
};

const dancerB: CastFace = {
  id: "p-3",
  display_name: "Chrome",
  character_prompt: "chrome jacket",
  character_reference_url: "media/chrome.jpg",
};

const resident: CastFace = {
  id: "res-1",
  display_name: "Neon Mira",
  character_prompt: "resident house DJ",
  character_reference_url: "media/mira.jpg",
  is_resident: true,
};

describe("DJ turn clip casting", () => {
  it("puts only the submitting DJ in the booth, at least 3 of 6 clips", () => {
    const casts = assignDjTurnClips(dj, [dancerA, dancerB]);
    expect(casts).toHaveLength(6);
    const booth = casts.filter((c) => c.role === "booth");
    expect(booth.length).toBeGreaterThanOrEqual(3);
    expect(booth.every((c) => c.person?.id === dj.id)).toBe(true);
    expect(casts.filter((c) => c.role === "booth").map((c) => c.person?.id)).not.toContain(dancerA.id);
    expect(casts.some((c) => c.role === "floor" && c.person?.id === dancerA.id)).toBe(true);
    expect(casts.every((c) => c.role !== "booth" || c.person?.id === dj.id)).toBe(true);
    for (let i = 0; i < 6; i++) {
      if (isDjBoothSlot(i)) expect(casts[i].person?.id).toBe(dj.id);
      else expect(casts[i].person?.id).not.toBe(dj.id);
    }
  });

  it("never frames a non-DJ behind the decks", () => {
    const casts = assignDjTurnClips(dj, [dancerA, dancerB, resident]);
    for (const clip of casts) {
      if (clip.role === "booth") expect(clip.person?.id).toBe(dj.id);
      if (clip.person?.id !== dj.id) expect(clip.role).not.toBe("booth");
    }
  });

  it("uses crowd floor clips when the DJ is alone", () => {
    const casts = assignDjTurnClips(dj, []);
    expect(casts.filter((c) => c.role === "booth").every((c) => c.person?.id === dj.id)).toBe(true);
    expect(casts.filter((c) => !isDjBoothSlot(casts.indexOf(c))).every((c) => c.role === "crowd")).toBe(true);
  });

  it("writes booth vs floor prompts", () => {
    const booth = djClipPrompt({ role: "booth", person: dj, track: "acid disco", clipIndex: 0 });
    const floor = djClipPrompt({ role: "floor", person: dancerA, track: "acid disco", clipIndex: 1 });
    expect(booth).toMatch(/Velvet/);
    expect(booth).toMatch(/DJ booth\/mixer/i);
    expect(booth).not.toMatch(/NOT in the DJ booth/);
    expect(floor).toMatch(/Neon Fox/);
    expect(floor).toMatch(/NOT DJing/);
    expect(floor).not.toMatch(/performing behind the DJ booth/);
  });
});

describe("house clip casting", () => {
  it("never assigns a non-resident human as the house DJ", () => {
    for (let seq = 0; seq < 18; seq++) {
      const clip = assignHouseClip(seq, [dancerA, dancerB], [resident]);
      if (clip.role === "dj") {
        expect(clip.person?.id).toBe(resident.id);
        expect(clip.person?.id).not.toBe(dancerA.id);
      }
    }
  });

  it("features dancers on floor slots and the resident holder in booth slots", () => {
    const roles = Array.from({ length: 6 }, (_, i) => assignHouseClip(i, [dancerA], [resident]).role);
    expect(roles.filter((r) => r === "dancer").length).toBe(3);
    expect(roles.filter((r) => r === "dj").length).toBe(3);
    const dancer = assignHouseClip(1, [dancerA], [resident]);
    expect(dancer.person?.id).toBe(dancerA.id);
  });

  it("pins house booth clips to the current resident holder", () => {
    const other = { ...resident, id: "res-2", display_name: "Vinyl Ghost" };
    const clip = assignHouseClip(0, [dancerA], [resident, other], { boothHolder: other });
    expect(clip.role).toBe("dj");
    expect(clip.person?.id).toBe("res-2");
  });

  it("features other residents on the floor when they are in the live pool", () => {
    const vinyl = { ...resident, id: "res-2", display_name: "Vinyl Ghost" };
    const pool = stageCastPool([resident, vinyl], [dancerA]);
    const floor = pool.filter((person) => person.id !== resident.id);
    const clip = assignHouseClip(1, floor, [resident, vinyl], { boothHolder: resident });
    expect(clip.role).toBe("dancer");
    expect([dancerA.id, vinyl.id]).toContain(clip.person?.id);
    expect(clip.person?.id).not.toBe(resident.id);
  });

  it("falls back to anonymous booth or crowd when nobody has a face", () => {
    expect(assignHouseClip(0, [], []).role).toBe("dj");
    expect(assignHouseClip(0, [], []).person).toBeNull();
    expect(assignHouseClip(1, [], []).role).toBe("crowd");
  });
});

describe("house clip prompts", () => {
  it("states dancer role instead of ambiguous dancing-or-DJing", () => {
    const prompt = houseClipPrompt(2, { display_name: "Neon Mira", character_prompt: "magenta DJ" }, "dancer");
    expect(prompt).toMatch(/Neon Mira/);
    expect(prompt).toMatch(/NOT DJing/);
    expect(prompt).not.toMatch(/dancing or DJing/);
  });

  it("states resident DJ role for booth clips", () => {
    const prompt = houseClipPrompt(0, { display_name: "Basement Kev", character_prompt: "gold tooth" }, "dj");
    expect(prompt).toMatch(/Basement Kev/);
    expect(prompt).toMatch(/DJ booth\/mixer/i);
    expect(prompt).not.toMatch(/NOT in the DJ booth/);
  });
});

describe("house system chat", () => {
  it("announces house only after a human DJ set", () => {
    expect(shouldAnnounceHouseTakeover("dj")).toBe(true);
    expect(shouldAnnounceHouseTakeover("house")).toBe(false);
    expect(shouldAnnounceHouseTakeover(null)).toBe(false);
  });
});

describe("stage cast pool", () => {
  it("is all residents plus present humans, never absent humans", () => {
    const absent: CastFace = {
      id: "gone",
      display_name: "Left Already",
      character_prompt: "ghosted",
      character_reference_url: "media/gone.jpg",
    };
    const pool = stageCastPool([resident], [dancerA]);
    expect(pool.map((p) => p.id).sort()).toEqual(["p-2", "res-1"]);
    expect(pool.map((p) => p.id)).not.toContain(absent.id);
    expect(asCastFace(resident).is_resident).toBe(true);
  });
});

describe("human presence stale", () => {
  it("is not stale before 3 minutes and is stale at 3 minutes", () => {
    const now = Date.parse("2026-09-02T18:00:00.000Z");
    expect(isHumanPresenceStale(now - 179_000, now)).toBe(false);
    expect(isHumanPresenceStale(now - 180_000, now)).toBe(true);
  });

  it("uses the latest heartbeat when a participant has multiple sockets", () => {
    const latest = latestHeartbeatMs([
      { participant_id: "p-1", last_heartbeat_at: "2026-09-02T17:56:00.000Z" },
      { participant_id: "p-1", last_heartbeat_at: "2026-09-02T17:59:00.000Z" },
    ]);
    expect(latest.get("p-1")).toBe(Date.parse("2026-09-02T17:59:00.000Z"));
  });
});
