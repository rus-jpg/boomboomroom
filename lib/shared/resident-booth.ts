import type { QueueEntryView, QueueStatus, TurnKind } from "./types";

export function pickNextResident<T extends { id: string }>(residents: T[], lastId: string | null): T | null {
  if (!residents.length) return null;
  if (!lastId) return residents[0];
  const idx = residents.findIndex((person) => person.id === lastId);
  if (idx < 0) return residents[0];
  return residents[(idx + 1) % residents.length];
}

export function upcomingResidents<T extends { id: string }>(residents: T[], currentId: string, count = 3): T[] {
  if (!residents.length) return [];
  const idx = residents.findIndex((person) => person.id === currentId);
  const start = idx < 0 ? 0 : idx + 1;
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, residents.length - (idx >= 0 ? 1 : 0)); i++) {
    const person = residents[(start + i) % residents.length];
    if (person.id === currentId) continue;
    out.push(person);
  }
  return out;
}

export function residentSetLabel(name?: string | null): string {
  return name ? `Resident set · ${name}` : "House buffer — midnight basement disco";
}

export type ResidentQueueFace = {
  id: string;
  displayName: string;
  characterUrl: string | null;
};

export type HumanQueueRow = QueueEntryView;

/** Synthesize booth list: one resident holder while house plays; humans override after. */
export function mergeBoothQueue(input: {
  humans: HumanQueueRow[];
  residents: ResidentQueueFace[];
  playingKind: TurnKind | null;
  playingDjId: string | null;
  playingEndsAt: string | null;
}): QueueEntryView[] {
  const humans = input.humans.filter((row) => !row.isResident);
  const houseHold =
    input.playingKind === "house" && input.playingDjId
      ? input.residents.find((person) => person.id === input.playingDjId) ?? null
      : null;

  const rows: QueueEntryView[] = [];
  let position = 1;

  if (houseHold) {
    rows.push({
      id: `resident-booth-${houseHold.id}`,
      participantId: houseHold.id,
      displayName: houseHold.displayName,
      characterUrl: houseHold.characterUrl,
      status: "playing",
      createdAt: "",
      position: position++,
      isResident: true,
      endsAt: input.playingEndsAt,
    });
  }

  if (humans.length) {
    for (const row of humans) {
      rows.push({
        ...row,
        position: position++,
        isResident: false,
        endsAt: row.status === "playing" ? input.playingEndsAt : row.endsAt ?? null,
      });
    }
    return rows;
  }

  if (houseHold) {
    for (const person of upcomingResidents(input.residents, houseHold.id, 4)) {
      rows.push({
        id: `resident-next-${person.id}`,
        participantId: person.id,
        displayName: person.displayName,
        characterUrl: person.characterUrl,
        status: "waiting" as QueueStatus,
        createdAt: "",
        position: position++,
        isResident: true,
        endsAt: null,
      });
    }
  }

  return rows;
}
