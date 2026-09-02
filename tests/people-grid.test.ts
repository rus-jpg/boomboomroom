import { describe, expect, it } from "vitest";
import { orderPeopleGrid } from "../lib/shared/people-grid";
import type { PublicParticipant, QueueEntryView } from "../lib/shared/types";

function person(partial: Partial<PublicParticipant> & Pick<PublicParticipant, "id" | "displayName">): PublicParticipant {
  return {
    characterPrompt: "",
    characterUrl: null,
    status: "ready",
    muted: false,
    isDj: false,
    isResident: false,
    ...partial,
  };
}

function queueRow(
  partial: Partial<QueueEntryView> & Pick<QueueEntryView, "id" | "participantId" | "displayName">,
): QueueEntryView {
  return {
    characterUrl: null,
    status: "waiting",
    createdAt: "2026-09-02T16:00:00.000Z",
    position: 1,
    isResident: false,
    endsAt: null,
    ...partial,
  };
}

describe("orderPeopleGrid", () => {
  const fox = person({ id: "p-3", displayName: "Neon Fox" });
  const velvet = person({ id: "velvet", displayName: "Velvet" });
  const mira = person({ id: "r1", displayName: "Neon Mira", isResident: true, isDj: true });

  it("puts booth queue first: decks, then up next, then everyone else", () => {
    const tiles = orderPeopleGrid(
      [fox, mira, velvet],
      [
        queueRow({
          id: "q1",
          participantId: mira.id,
          displayName: mira.displayName,
          status: "playing",
          position: 1,
          isResident: true,
          endsAt: "2026-09-02T16:01:00.000Z",
        }),
        queueRow({ id: "q2", participantId: velvet.id, displayName: velvet.displayName, position: 2 }),
      ],
    );
    expect(tiles.map((t) => t.displayName)).toEqual(["Neon Mira", "Velvet", "Neon Fox"]);
    expect(tiles[0]?.booth).toEqual({ role: "decks", endsAt: "2026-09-02T16:01:00.000Z" });
    expect(tiles[1]?.booth).toEqual({ role: "up-next", endsAt: null });
    expect(tiles[2]?.booth).toBeNull();
  });

  it("keeps synthesized upcoming residents that are not in the people list", () => {
    const tiles = orderPeopleGrid(
      [fox],
      [
        queueRow({
          id: "hold",
          participantId: "r-hold",
          displayName: "House Cat",
          status: "playing",
          isResident: true,
          endsAt: "2026-09-02T16:01:00.000Z",
        }),
        queueRow({
          id: "next",
          participantId: "r-next",
          displayName: "Basement Kev",
          position: 2,
          isResident: true,
        }),
      ],
    );
    expect(tiles.map((t) => t.displayName)).toEqual(["House Cat", "Basement Kev", "Neon Fox"]);
    expect(tiles[0]?.isResident).toBe(true);
    expect(tiles[1]?.booth?.role).toBe("up-next");
  });

  it("falls back to the current DJ as decks when the queue is empty", () => {
    const tiles = orderPeopleGrid(
      [fox, { ...mira, isDj: true }],
      [],
      "2026-09-02T16:01:00.000Z",
    );
    expect(tiles[0]?.displayName).toBe("Neon Mira");
    expect(tiles[0]?.booth).toEqual({ role: "decks", endsAt: "2026-09-02T16:01:00.000Z" });
    expect(tiles.map((t) => t.id)).toEqual(["r1", "p-3"]);
  });
});
