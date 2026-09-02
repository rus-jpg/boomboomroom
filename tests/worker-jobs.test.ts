import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createParticipant,
  enqueueDj,
  getQueueEntry,
  getRoomBySlug,
  getTurn,
  insertJob,
  insertTurn,
  listQueuedJobs,
  listRunningFalJobs,
  updateJob,
  updateQueue,
} from "../lib/server/repo";
import { finalizeTurn } from "../worker/ingest";

const previousStore = process.env.DEV_STORE_PATH;

beforeEach(() => {
  process.env.DEV_STORE_PATH = join(mkdtempSync(join(tmpdir(), "bbr-tick-")), "store.json");
});

afterEach(() => {
  if (previousStore === undefined) delete process.env.DEV_STORE_PATH;
  else process.env.DEV_STORE_PATH = previousStore;
});

describe("worker claim order", () => {
  it("lists DJ turn jobs ahead of house livestream jobs", async () => {
    const room = await getRoomBySlug();
    const person = await createParticipant({
      sessionHash: "s1",
      displayName: "Disco",
      characterPrompt: "silver sequin dancer in the booth",
      ipHash: null,
    });
    await insertJob({ kind: "video", payload: { house: true, clipIndex: 0 } });
    const turn = await insertTurn({
      roomId: room.id,
      kind: "dj",
      djParticipantId: person.id,
      generationStatus: "generating",
    });
    await insertJob({ kind: "music", turnId: turn.id, participantId: person.id, payload: { prompt: "midnight disco" } });
    await insertJob({ kind: "character", participantId: person.id, payload: { resident: true } });

    const queued = await listQueuedJobs();
    expect(queued.map((j) => j.kind)).toEqual(["music", "character", "video"]);
  });

  it("lists running DJ fal jobs before house zombies", async () => {
    const room = await getRoomBySlug();
    const turn = await insertTurn({ roomId: room.id, kind: "dj", generationStatus: "generating" });
    const house = await insertJob({ kind: "video", payload: { house: true } });
    const music = await insertJob({ kind: "music", turnId: turn.id, payload: { prompt: "bass" } });
    await updateJob(house.id, { status: "running", fal_request_id: "fal-house" });
    await updateJob(music.id, { status: "running", fal_request_id: "fal-music" });

    const running = await listRunningFalJobs();
    expect(running.map((j) => j.id)).toEqual([music.id, house.id]);
  });
});

describe("finalizeTurn after stale music", () => {
  it("fails the generating turn and frees the booth when music fails", async () => {
    const room = await getRoomBySlug();
    const person = await createParticipant({
      sessionHash: "s2",
      displayName: "Kev",
      characterPrompt: "basement resident with a silver chain",
      ipHash: null,
    });
    const entry = await enqueueDj(room.id, person.id);
    await updateQueue(entry.id, "submitted");
    const turn = await insertTurn({
      roomId: room.id,
      kind: "dj",
      djParticipantId: person.id,
      generationStatus: "generating",
    });
    const music = await insertJob({
      kind: "music",
      turnId: turn.id,
      participantId: person.id,
      payload: { prompt: "warehouse techno", resubmitted: true },
    });
    await updateJob(music.id, { status: "failed", error: "timed out after 9m in running" });
    for (let i = 0; i < 6; i++) {
      const clip = await insertJob({ kind: "video", turnId: turn.id, payload: { clipIndex: i } });
      await updateJob(clip.id, { status: "complete", result: { video: { url: `https://cdn.example/clip-${i}.mp4` } } });
    }

    await finalizeTurn(turn.id);

    expect((await getTurn(turn.id))?.generation_status).toBe("failed");
    expect((await getQueueEntry(entry.id))?.status).toBe("skipped");
  });
});

describe("compose preparing_at", () => {
  it("stamps preparing_at when the booth is promoted", async () => {
    const room = await getRoomBySlug();
    const person = await createParticipant({
      sessionHash: "s3",
      displayName: "Mira",
      characterPrompt: "magenta lasers and a silver chain",
      ipHash: null,
    });
    const waiting = await enqueueDj(room.id, person.id);
    expect(waiting.preparing_at).toBeNull();
    const preparing = await updateQueue(waiting.id, "preparing");
    expect(preparing.status).toBe("preparing");
    expect(preparing.preparing_at).toBeTruthy();
    expect(Date.parse(preparing.preparing_at!)).toBeGreaterThanOrEqual(Date.parse(waiting.created_at));
  });
});
