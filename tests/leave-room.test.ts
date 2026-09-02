import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  listQueue,
  occupancy,
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
