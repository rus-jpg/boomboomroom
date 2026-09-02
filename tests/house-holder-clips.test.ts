import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeHouseClipKeys, hydratePlayingHouseTurn } from "../lib/server/house";
import {
  createResident,
  getRoomBySlug,
  getTurn,
  insertMedia,
  insertTurn,
  listUnusedHouseClips,
  updateParticipant,
} from "../lib/server/repo";
import { isDjBoothSlot } from "../lib/shared/stage-cast";

const previousStore = process.env.DEV_STORE_PATH;

beforeEach(() => {
  process.env.DEV_STORE_PATH = join(mkdtempSync(join(tmpdir(), "bbr-house-")), "store.json");
});

afterEach(() => {
  if (previousStore === undefined) delete process.env.DEV_STORE_PATH;
  else process.env.DEV_STORE_PATH = previousStore;
});

describe("takeHouseClipKeys holder isolation", () => {
  it("never claims booth/DJ-tagged clips of another resident for holder A", async () => {
    const kev = await createResident({
      sessionHash: "resident:basement-kev",
      displayName: "Basement Kev",
      characterPrompt: "tuxedo, gold tooth, vintage rave jacket",
    });
    const vinyl = await createResident({
      sessionHash: "resident:vinyl-ghost",
      displayName: "Vinyl Ghost",
      characterPrompt: "pale visor, translucent vinyl jacket",
    });
    await updateParticipant(kev.id, { status: "ready" });
    await updateParticipant(vinyl.id, { status: "ready" });

    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/vinyl-dj-1.mp4",
      contentType: "video/mp4",
      participantId: vinyl.id,
      role: "dj",
    });
    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/vinyl-dj-2.mp4",
      contentType: "video/mp4",
      participantId: vinyl.id,
      role: "dj",
    });
    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/kev-dj-1.mp4",
      contentType: "video/mp4",
      participantId: kev.id,
      role: "dj",
    });
    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/vinyl-dance.mp4",
      contentType: "video/mp4",
      participantId: vinyl.id,
      role: "dancer",
    });
    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/kev-dance.mp4",
      contentType: "video/mp4",
      participantId: kev.id,
      role: "dancer",
    });

    const room = await getRoomBySlug();
    const turn = await insertTurn({
      roomId: room.id,
      kind: "house",
      djParticipantId: kev.id,
      generationStatus: "playing",
    });

    const keys = await takeHouseClipKeys(6, turn.id, kev.id);
    expect(keys).not.toContain("https://cdn.example/vinyl-dj-1.mp4");
    expect(keys).not.toContain("https://cdn.example/vinyl-dj-2.mp4");
    expect(keys).toContain("https://cdn.example/kev-dj-1.mp4");
    expect(keys).toContain("https://cdn.example/vinyl-dance.mp4");
    for (let i = 0; i < keys.length; i++) {
      if (isDjBoothSlot(i)) expect(keys[i]).toBe("https://cdn.example/kev-dj-1.mp4");
    }

    const leftover = await listUnusedHouseClips(12);
    expect(leftover.map((row) => row.storage_key)).toEqual(
      expect.arrayContaining(["https://cdn.example/vinyl-dj-1.mp4", "https://cdn.example/vinyl-dj-2.mp4"]),
    );
  });

  it("strips another resident's DJ clips off a playing house turn for holder A", async () => {
    const kev = await createResident({
      sessionHash: "resident:basement-kev",
      displayName: "Basement Kev",
      characterPrompt: "tuxedo, gold tooth, vintage rave jacket",
    });
    const vinyl = await createResident({
      sessionHash: "resident:vinyl-ghost",
      displayName: "Vinyl Ghost",
      characterPrompt: "pale visor, translucent vinyl jacket",
    });
    await updateParticipant(kev.id, { status: "ready" });
    await updateParticipant(vinyl.id, { status: "ready" });

    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/vinyl-dj-live.mp4",
      contentType: "video/mp4",
      participantId: vinyl.id,
      role: "dj",
    });
    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/kev-dj-live.mp4",
      contentType: "video/mp4",
      participantId: kev.id,
      role: "dj",
    });
    await insertMedia({
      kind: "house_video",
      storageKey: "https://cdn.example/floor-live.mp4",
      contentType: "video/mp4",
      participantId: vinyl.id,
      role: "dancer",
    });

    const room = await getRoomBySlug();
    const turn = await insertTurn({
      roomId: room.id,
      kind: "house",
      djParticipantId: kev.id,
      generationStatus: "playing",
      videoSegmentUrls: [
        "https://cdn.example/vinyl-dj-live.mp4",
        "https://cdn.example/floor-live.mp4",
      ],
    });

    expect(await hydratePlayingHouseTurn()).toBe(true);
    const live = await getTurn(turn.id);
    const urls = live?.video_segment_urls as string[];
    expect(urls).not.toContain("https://cdn.example/vinyl-dj-live.mp4");
    expect(urls).toContain("https://cdn.example/kev-dj-live.mp4");
    expect(urls).toContain("https://cdn.example/floor-live.mp4");
    const leftover = await listUnusedHouseClips(12);
    expect(leftover.map((row) => row.storage_key)).toContain("https://cdn.example/vinyl-dj-live.mp4");
  });
});
