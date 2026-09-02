import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRoomState } from "../lib/server/room-state";
import {
  createParticipant,
  createResident,
  enqueueDj,
  getParticipant,
  getQueueEntry,
  getRoomBySlug,
  insertSystemChat,
  leaveRoomSession,
  listChat,
  listPresence,
  listPresentReadyParticipants,
  listQueue,
  occupancy,
  setPresenceHeartbeat,
  sweepStaleHumanPresence,
  updateParticipant,
  updateQueue,
  upsertPresence,
} from "../lib/server/repo";

const previousStore = process.env.DEV_STORE_PATH;

beforeEach(() => {
  process.env.DEV_STORE_PATH = join(mkdtempSync(join(tmpdir(), "bbr-leave-")), "store.json");
});

afterEach(() => {
  if (previousStore === undefined) delete process.env.DEV_STORE_PATH;
  else process.env.DEV_STORE_PATH = previousStore;
});

describe("leaveRoomSession", () => {
  it("drops presence, queue, and the session hash for humans", async () => {
    const room = await getRoomBySlug();
    const person = await createParticipant({
      sessionHash: "sess-human",
      displayName: "Rus",
      characterPrompt: "wet vinyl, gold teeth, Tokyo basement",
      ipHash: null,
    });
    await upsertPresence({ roomId: room.id, participantId: person.id, socketId: "sock-1" });
    const waiting = await enqueueDj(room.id, person.id);
    await updateQueue(waiting.id, "preparing");

    await leaveRoomSession(person.id);

    expect(await occupancy(room.id)).toBe(0);
    expect(await listPresence(room.id)).toHaveLength(0);
    expect(await listQueue(room.id)).toHaveLength(0);
    expect((await getQueueEntry(waiting.id))?.status).toBe("skipped");
    const left = await getParticipant(person.id);
    expect(left?.session_token_hash).toBe(`left:${person.id}`);
  });

  it("refuses to exit residents", async () => {
    const resident = await createResident({
      sessionHash: "resident:test-kev",
      displayName: "Basement Kev",
      characterPrompt: "basement resident with a silver chain",
    });
    await expect(leaveRoomSession(resident.id)).rejects.toThrow(/residents stay/i);
    expect((await getParticipant(resident.id))?.session_token_hash).toBe("resident:test-kev");
    expect((await getParticipant(resident.id))?.is_resident).toBe(true);
  });
});

describe("sweepStaleHumanPresence", () => {
  it("drops a human after ~3 minutes without a heartbeat and leaves the booth queue", async () => {
    const room = await getRoomBySlug();
    const person = await createParticipant({
      sessionHash: "sess-stale",
      displayName: "Joan",
      characterPrompt: "leather jacket, gold tooth, wet concrete",
      ipHash: null,
    });
    await upsertPresence({ roomId: room.id, participantId: person.id, socketId: "sock-stale" });
    const waiting = await enqueueDj(room.id, person.id);
    await setPresenceHeartbeat("sock-stale", new Date(Date.now() - 181_000).toISOString());

    const stillHere = await sweepStaleHumanPresence(room.id, Date.now() - 60_000);
    expect(stillHere).toEqual([]);
    expect(await occupancy(room.id)).toBe(1);

    const gone = await sweepStaleHumanPresence(room.id);
    expect(gone).toEqual([person.id]);
    expect(await occupancy(room.id)).toBe(0);
    expect(await listPresence(room.id)).toHaveLength(0);
    expect((await getQueueEntry(waiting.id))?.status).toBe("skipped");
    expect(await listPresentReadyParticipants(room.id)).toHaveLength(0);
  });

  it("never sweeps residents even when their heartbeat is stale", async () => {
    const room = await getRoomBySlug();
    const resident = await createResident({
      sessionHash: "resident:stale-kev",
      displayName: "Basement Kev",
      characterPrompt: "basement resident with a silver chain",
    });
    await upsertPresence({ roomId: room.id, participantId: resident.id, socketId: "sock-res" });
    await setPresenceHeartbeat("sock-res", new Date(Date.now() - 10 * 60_000).toISOString());

    expect(await sweepStaleHumanPresence(room.id)).toEqual([]);
    expect(await occupancy(room.id)).toBe(1);
    expect((await getParticipant(resident.id))?.session_token_hash).toBe("resident:stale-kev");
  });
});

describe("listPresentReadyParticipants", () => {
  it("does not include ready humans who are not in the room", async () => {
    const room = await getRoomBySlug();
    const present = await createParticipant({
      sessionHash: "here",
      displayName: "Acid Nori",
      characterPrompt: "acid green visor, chrome nails, Tokyo basement",
      ipHash: null,
    });
    const gone = await createParticipant({
      sessionHash: "away",
      displayName: "Left Already",
      characterPrompt: "someone who already left the party floor",
      ipHash: null,
    });
    await updateParticipant(present.id, { status: "ready", character_reference_url: "media/nori.jpg" });
    await updateParticipant(gone.id, { status: "ready", character_reference_url: "media/gone.jpg" });
    await upsertPresence({ roomId: room.id, participantId: present.id, socketId: "sock-nori" });

    const roster = await listPresentReadyParticipants(room.id);
    expect(roster.map((p) => p.id)).toEqual([present.id]);
    expect(roster.map((p) => p.id)).not.toContain(gone.id);
  });
});

describe("Who's Here roster", () => {
  it("always includes residents even when the room is over the old party-size pad", async () => {
    const room = await getRoomBySlug();
    const mira = await createResident({
      sessionHash: "resident:mira",
      displayName: "Neon Mira",
      characterPrompt: "resident house DJ with magenta visor",
    });
    const kev = await createResident({
      sessionHash: "resident:kev",
      displayName: "Basement Kev",
      characterPrompt: "basement resident with a silver chain",
    });
    for (let i = 0; i < 6; i++) {
      const human = await createParticipant({
        sessionHash: `crowd-${i}`,
        displayName: `Guest ${i}`,
        characterPrompt: "leather jacket, gold tooth, wet concrete",
        ipHash: null,
      });
      await upsertPresence({ roomId: room.id, participantId: human.id, socketId: `sock-${i}` });
    }
    const state = await buildRoomState();
    expect(state.occupancy).toBe(6);
    expect(state.participants.some((p) => p.id === mira.id)).toBe(true);
    expect(state.participants.some((p) => p.id === kev.id)).toBe(true);
    expect(state.participants.filter((p) => !p.isResident)).toHaveLength(6);
  });
});

describe("insertSystemChat", () => {
  it("does not post the same system line twice in a row", async () => {
    const room = await getRoomBySlug();
    const first = await insertSystemChat({ roomId: room.id, body: "House takes the booth." });
    const second = await insertSystemChat({ roomId: room.id, body: "House takes the booth." });
    expect(second.id).toBe(first.id);
    const chat = await listChat(room.id);
    expect(chat.filter((m) => m.body === "House takes the booth.")).toHaveLength(1);
  });

  it("still posts a different high-signal line after house", async () => {
    const room = await getRoomBySlug();
    await insertSystemChat({ roomId: room.id, body: "House takes the booth." });
    await insertSystemChat({ roomId: room.id, body: "Velvet takes the booth." });
    const chat = await listChat(room.id);
    expect(chat.map((m) => m.body)).toEqual(["House takes the booth.", "Velvet takes the booth."]);
  });
});
