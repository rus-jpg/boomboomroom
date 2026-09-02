import type { PublicParticipant, QueueEntryView } from "./types";

export type BoothMark = {
  role: "decks" | "up-next";
  endsAt: string | null;
};

export type PeopleTile = PublicParticipant & {
  booth: BoothMark | null;
};

function fromQueue(row: QueueEntryView): PublicParticipant {
  return {
    id: row.participantId,
    displayName: row.displayName,
    characterPrompt: "",
    characterUrl: row.characterUrl,
    status: "ready",
    muted: false,
    isDj: row.status === "playing",
    isResident: Boolean(row.isResident),
  };
}

/** Booth queue leads the people grid: first tile is on decks, following queue rows are up next. */
export function orderPeopleGrid(
  participants: PublicParticipant[],
  queue: QueueEntryView[],
  playingEndsAt?: string | null,
): PeopleTile[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const used = new Set<string>();
  const tiles: PeopleTile[] = [];

  for (const row of queue) {
    if (used.has(row.participantId)) continue;
    const person = byId.get(row.participantId) ?? fromQueue(row);
    used.add(person.id);
    tiles.push({
      ...person,
      booth: {
        role: tiles.length === 0 ? "decks" : "up-next",
        endsAt: row.endsAt ?? (tiles.length === 0 ? playingEndsAt ?? null : null),
      },
    });
  }

  if (!tiles.length) {
    const dj = participants.find((p) => p.isDj);
    if (dj) {
      used.add(dj.id);
      tiles.push({
        ...dj,
        booth: { role: "decks", endsAt: playingEndsAt ?? null },
      });
    }
  }

  for (const person of participants) {
    if (used.has(person.id)) continue;
    tiles.push({ ...person, booth: null });
  }

  return tiles;
}
