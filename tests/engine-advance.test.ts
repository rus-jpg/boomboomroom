import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createParticipant,
  createResident,
  enqueueDj,
  getQueueEntry,
  getRoomBySlug,
  getTurn,
  insertTurn,
  latestPlayingTurn,
  updateParticipant,
  updateQueue,
  updateTurn,
} from "../lib/server/repo";
import { RoomEngine } from "../realtime/engine";

const previousStore = process.env.DEV_STORE_PATH;

beforeEach(() => {
  process.env.DEV_STORE_PATH = join(mkdtempSync(join(tmpdir(), "bbr-engine-")), "store.json");
});

afterEach(() => {
  if (previousStore === undefined) delete process.env.DEV_STORE_PATH;
  else process.env.DEV_STORE_PATH = previousStore;
});

describe("advancePlayback house interrupt", () => {
  it("completes playing house and starts a ready DJ without waiting for ends_at", async () => {
    const room = await getRoomBySlug();
    const now = Date.now();
    const house = await insertTurn({
      roomId: room.id,
      kind: "house",
      generationStatus: "playing",
      musicPrompt: "House buffer",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 60_000).toISOString(),
    });
    const person = await createParticipant({
      sessionHash: "dj-1",
      displayName: "Velvet",
      characterPrompt: "silver sequin dancer in the booth",
      ipHash: null,
    });
    const entry = await enqueueDj(room.id, person.id);
    await updateQueue(entry.id, "submitted");
    const djTurn = await insertTurn({
      roomId: room.id,
      kind: "dj",
      djParticipantId: person.id,
      generationStatus: "ready",
      musicPrompt: "acid disco",
    });

    const engine = new RoomEngine();
    await engine.advancePlayback();

    const finishedHouse = await getTurn(house.id);
    const playingDj = await getTurn(djTurn.id);
    const live = await latestPlayingTurn(room.id);
    const queue = await getQueueEntry(entry.id);

    expect(finishedHouse?.generation_status).toBe("complete");
    expect(new Date(finishedHouse?.ends_at ?? 0).getTime()).toBeLessThanOrEqual(Date.now() + 50);
    expect(playingDj?.generation_status).toBe("playing");
    expect(playingDj?.starts_at).toBeTruthy();
    expect(playingDj?.ends_at).toBeTruthy();
    expect(live?.id).toBe(djTurn.id);
    expect(queue?.status).toBe("playing");
  });

  it("does not cut a live human DJ for another ready set", async () => {
    const room = await getRoomBySlug();
    const now = Date.now();
    const currentDj = await createParticipant({
      sessionHash: "dj-live",
      displayName: "Chrome",
      characterPrompt: "chrome visor in the booth",
      ipHash: null,
    });
    const nextDj = await createParticipant({
      sessionHash: "dj-next",
      displayName: "Acid Mira",
      characterPrompt: "acid green dancer",
      ipHash: null,
    });
    const liveEntry = await enqueueDj(room.id, currentDj.id);
    await updateQueue(liveEntry.id, "playing");
    const nextEntry = await enqueueDj(room.id, nextDj.id);
    await updateQueue(nextEntry.id, "submitted");

    const playing = await insertTurn({
      roomId: room.id,
      kind: "dj",
      djParticipantId: currentDj.id,
      generationStatus: "playing",
      musicPrompt: "live set",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 60_000).toISOString(),
    });
    const waiting = await insertTurn({
      roomId: room.id,
      kind: "dj",
      djParticipantId: nextDj.id,
      generationStatus: "ready",
      musicPrompt: "next set",
    });

    const engine = new RoomEngine();
    await engine.advancePlayback();

    expect((await getTurn(playing.id))?.generation_status).toBe("playing");
    expect((await getTurn(waiting.id))?.generation_status).toBe("ready");
    expect((await latestPlayingTurn(room.id))?.id).toBe(playing.id);
    expect((await getQueueEntry(liveEntry.id))?.status).toBe("playing");
    expect((await getQueueEntry(nextEntry.id))?.status).toBe("submitted");
  });
});

describe("resident booth rotation", () => {
  it("rotates residents on successive house turns and yields to a ready human", async () => {
    const room = await getRoomBySlug();
    const mira = await createResident({
      sessionHash: "resident:neon-mira",
      displayName: "Neon Mira",
      characterPrompt: "sharp chrome bangs, magenta underlights",
    });
    const kev = await createResident({
      sessionHash: "resident:basement-kev",
      displayName: "Basement Kev",
      characterPrompt: "shaved head, gold tooth, vintage rave jacket",
    });
    await updateParticipant(mira.id, { status: "ready" });
    await updateParticipant(kev.id, { status: "ready" });

    const engine = new RoomEngine();
    await engine.advancePlayback();
    const first = await latestPlayingTurn(room.id);
    expect(first?.kind).toBe("house");
    expect(first?.dj_participant_id).toBe(mira.id);

    await updateTurn(first!.id, {
      generation_status: "complete",
      ends_at: new Date(Date.now() - 100).toISOString(),
    });
    await engine.advancePlayback();
    const second = await latestPlayingTurn(room.id);
    expect(second?.id).not.toBe(first?.id);
    expect(second?.dj_participant_id).toBe(kev.id);

    const human = await createParticipant({
      sessionHash: "human-dj",
      displayName: "Velvet",
      characterPrompt: "silver sequin dancer in the booth",
      ipHash: null,
    });
    const entry = await enqueueDj(room.id, human.id);
    await updateQueue(entry.id, "submitted");
    await insertTurn({
      roomId: room.id,
      kind: "dj",
      djParticipantId: human.id,
      generationStatus: "ready",
      musicPrompt: "acid disco",
    });
    await engine.advancePlayback();
    const live = await latestPlayingTurn(room.id);
    expect(live?.kind).toBe("dj");
    expect(live?.dj_participant_id).toBe(human.id);

    await updateTurn(live!.id, {
      generation_status: "complete",
      ends_at: new Date(Date.now() - 100).toISOString(),
    });
    await updateQueue(entry.id, "done");
    await engine.advancePlayback();
    const resumed = await latestPlayingTurn(room.id);
    expect(resumed?.kind).toBe("house");
    expect(resumed?.dj_participant_id).toBe(mira.id);
  });
});
