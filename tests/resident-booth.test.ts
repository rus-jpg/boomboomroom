import { describe, expect, it } from "vitest";
import { mergeBoothQueue, pickNextResident, upcomingResidents } from "../lib/shared/resident-booth";
import type { QueueEntryView } from "../lib/shared/types";

const residents = [
  { id: "r1", displayName: "Neon Mira" },
  { id: "r2", displayName: "Basement Kev" },
  { id: "r3", displayName: "Vinyl Ghost" },
];

describe("resident booth rotation", () => {
  it("cycles fairly and does not stick on the last holder", () => {
    expect(pickNextResident(residents, null)?.id).toBe("r1");
    expect(pickNextResident(residents, "r1")?.id).toBe("r2");
    expect(pickNextResident(residents, "r2")?.id).toBe("r3");
    expect(pickNextResident(residents, "r3")?.id).toBe("r1");
  });

  it("lists upcoming residents after the current holder", () => {
    expect(upcomingResidents(residents, "r1").map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(upcomingResidents(residents, "r3").map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("mergeBoothQueue", () => {
  const faces = residents.map((r) => ({ ...r, characterUrl: null }));

  it("shows the current resident with a countdown and the next residents when humans are gone", () => {
    const rows = mergeBoothQueue({
      humans: [],
      residents: faces,
      playingKind: "house",
      playingDjId: "r2",
      playingEndsAt: "2026-09-02T12:01:00.000Z",
    });
    expect(rows[0]?.displayName).toBe("Basement Kev");
    expect(rows[0]?.isResident).toBe(true);
    expect(rows[0]?.status).toBe("playing");
    expect(rows[0]?.endsAt).toBe("2026-09-02T12:01:00.000Z");
    expect(rows.slice(1).map((r) => r.displayName)).toEqual(["Vinyl Ghost", "Neon Mira"]);
    expect(rows.slice(1).every((r) => r.isResident && !r.endsAt)).toBe(true);
  });

  it("keeps the resident holder then human queue when someone joins", () => {
    const human: QueueEntryView = {
      id: "h1",
      participantId: "velvet",
      displayName: "Velvet",
      characterUrl: null,
      status: "waiting",
      createdAt: "2026-09-02T12:00:00.000Z",
      position: 1,
    };
    const rows = mergeBoothQueue({
      humans: [human],
      residents: faces,
      playingKind: "house",
      playingDjId: "r1",
      playingEndsAt: "2026-09-02T12:01:00.000Z",
    });
    expect(rows.map((r) => r.displayName)).toEqual(["Neon Mira", "Velvet"]);
    expect(rows[1]?.isResident).toBe(false);
  });

  it("hides resident filler while a human DJ is live", () => {
    const human: QueueEntryView = {
      id: "h1",
      participantId: "velvet",
      displayName: "Velvet",
      characterUrl: null,
      status: "playing",
      createdAt: "2026-09-02T12:00:00.000Z",
      position: 1,
    };
    const rows = mergeBoothQueue({
      humans: [human],
      residents: faces,
      playingKind: "dj",
      playingDjId: "velvet",
      playingEndsAt: "2026-09-02T12:01:00.000Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe("Velvet");
    expect(rows[0]?.endsAt).toBe("2026-09-02T12:01:00.000Z");
  });
});
