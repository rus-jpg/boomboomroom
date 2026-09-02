import { extractAudioUrl, extractDurationS, extractImageUrl, extractVideoUrl } from "@/lib/server/fal";
import { ensureHouseJobsQueued, hydratePlayingHouseTurn } from "@/lib/server/house";
import { isStubHouseAudio, isStubHouseVideo } from "@/lib/shared/media";
import { publishRoomEvent } from "@/lib/server/queues";
import {
  findHouseAudioForJob,
  findHouseVideoForJob,
  getJob,
  getTurn,
  insertMedia,
  listJobsForTurn,
  updateJob,
  updateMediaStorageKey,
  updateParticipant,
  updateTurn,
} from "@/lib/server/repo";
import { downloadUrlToBuffer, uploadBytes } from "@/lib/server/storage";

type Job = NonNullable<Awaited<ReturnType<typeof getJob>>>;

function jobPayload(job: { payload: unknown }): { house?: boolean } {
  return (job.payload ?? {}) as { house?: boolean };
}

function isHouseVideo(job: Job): boolean {
  return job.kind === "video" && jobPayload(job).house === true;
}

function isHouseMusic(job: Job): boolean {
  return job.kind === "music" && jobPayload(job).house === true;
}

/** Insert fal URL immediately so the stage can play. Optional later copy into Supabase storage. */
export async function storeHouseVideo(job: Job, payload: unknown): Promise<boolean> {
  const remote = extractVideoUrl(payload) || extractVideoUrl(job.result);
  if (!remote || isStubHouseVideo(remote) || !remote.startsWith("http")) return false;
  if (await findHouseVideoForJob(job.id, remote)) return false;
  const row = await insertMedia({
    kind: "house_video",
    storageKey: remote,
    contentType: "video/mp4",
    durationMs: 10_000,
    participantId: job.participant_id,
  });
  void promoteHouseVideo(row.id, job.id, remote).catch((err) =>
    console.warn(`[house] storage copy ${job.id}`, err),
  );
  return true;
}

async function promoteHouseVideo(mediaId: string, jobId: string, remote: string) {
  const { buf, contentType } = await downloadUrlToBuffer(remote);
  const storageKey = await uploadBytes("media", `house/video/${jobId}.mp4`, buf, contentType);
  await updateMediaStorageKey(mediaId, storageKey);
}

export async function storeHouseAudio(job: Job, payload: unknown): Promise<boolean> {
  const remote = extractAudioUrl(payload) || extractAudioUrl(job.result);
  if (!remote || isStubHouseAudio(remote) || !remote.startsWith("http")) return false;
  if (await findHouseAudioForJob(job.id, remote)) return false;
  const row = await insertMedia({
    kind: "house_audio",
    storageKey: remote,
    contentType: "audio/wav",
    durationMs: Math.round((extractDurationS(payload) ?? extractDurationS(job.result) ?? 60) * 1000),
  });
  void promoteHouseAudio(row.id, job.id, remote).catch((err) =>
    console.warn(`[house] audio copy ${job.id}`, err),
  );
  return true;
}

async function promoteHouseAudio(mediaId: string, jobId: string, remote: string) {
  const { buf, contentType } = await downloadUrlToBuffer(remote);
  const storageKey = await uploadBytes("media", `house/audio/${jobId}.wav`, buf, contentType);
  await updateMediaStorageKey(mediaId, storageKey);
}

/** Idempotent: works even if an old webhook already marked the job complete. */
export async function ensureHouseMediaStored(job: Job, payload?: unknown): Promise<boolean> {
  const body = payload ?? job.result;
  if (isHouseVideo(job)) return storeHouseVideo(job, body);
  if (isHouseMusic(job)) return storeHouseAudio(job, body);
  return false;
}

export async function ingestFalWebhook(jobId: string, payload: unknown, status: string) {
  const job = await getJob(jobId);
  if (!job) return;

  if (job.status === "complete") {
    const added = await ensureHouseMediaStored(job, payload);
    if (added) {
      console.log(`[house] backfilled media for complete job ${job.id}`);
      try {
        await hydratePlayingHouseTurn();
        await ensureHouseJobsQueued();
      } catch (err) {
        console.warn("[house] hydrate after backfill", err);
      }
    }
    return;
  }
  if (job.status === "failed") return;

  if (status !== "OK") {
    await updateJob(job.id, {
      status: "failed",
      error: "fal failed",
      result: payload as never,
      completed_at: new Date().toISOString(),
    });
    if (job.turn_id) await finalizeTurn(job.turn_id);
    return;
  }
  await updateJob(job.id, { status: "complete", result: payload as never, completed_at: new Date().toISOString() });

  if (job.kind === "character" && job.participant_id) {
    const imageUrl = extractImageUrl(payload);
    if (imageUrl) {
      try {
        const { buf, contentType } = await downloadUrlToBuffer(imageUrl);
        const storageKey = await uploadBytes("media", `characters/${job.participant_id}.jpg`, buf, contentType);
        await insertMedia({ kind: "character", storageKey, contentType, participantId: job.participant_id });
        await updateParticipant(job.participant_id, { character_reference_url: storageKey, status: "ready" });
      } catch {
        await updateParticipant(job.participant_id, { character_reference_url: imageUrl, status: "ready" });
      }
    }
    await publishRoomEvent({ type: "character-ready", participantId: job.participant_id });
    return;
  }

  if (isHouseVideo(job) || isHouseMusic(job)) {
    const added = await ensureHouseMediaStored({ ...job, status: "complete", result: payload as Job["result"] }, payload);
    console.log(`[house] ${isHouseVideo(job) ? "house_clip" : "house_bed"} complete ${job.id} stored=${added}`);
    try {
      await hydratePlayingHouseTurn();
      await ensureHouseJobsQueued();
    } catch (err) {
      console.warn("[house] refill after complete", err);
    }
    return;
  }

  if (job.turn_id) {
    await finalizeTurn(job.turn_id);
  }
}

export async function finalizeTurn(turnId: string) {
  const turn = await getTurn(turnId);
  if (!turn) return;
  if (turn.generation_status === "ready" || turn.generation_status === "playing" || turn.generation_status === "complete") {
    return;
  }
  const jobs = await listJobsForTurn(turnId);
  const music = jobs.find((j) => j.kind === "music");
  const videos = jobs
    .filter((j) => j.kind === "video")
    .sort((a, b) => {
      const ai = Number((a.payload as { clipIndex?: number } | null)?.clipIndex ?? 0);
      const bi = Number((b.payload as { clipIndex?: number } | null)?.clipIndex ?? 0);
      return ai - bi;
    });
  if (!music || videos.length < 6) return;
  if (music.status !== "complete" || videos.some((v) => v.status !== "complete")) {
    if (music.status === "failed" || videos.some((v) => v.status === "failed")) {
      await updateTurn(turnId, { generation_status: "failed" });
    }
    return;
  }

  const audioRemote = extractAudioUrl(music.result);
  let audioUrl = audioRemote || "/house/house-audio.mp3";
  if (audioRemote?.startsWith("http")) {
    try {
      const { buf, contentType } = await downloadUrlToBuffer(audioRemote);
      audioUrl = await uploadBytes("media", `turns/${turnId}/audio.wav`, buf, contentType);
      await insertMedia({
        kind: "audio",
        storageKey: audioUrl,
        contentType,
        durationMs: Math.round((extractDurationS(music.result) ?? 60) * 1000),
        turnId,
      });
    } catch {
      audioUrl = audioRemote;
    }
  }

  const videoUrls: string[] = [];
  for (const [i, v] of videos.entries()) {
    const remote = extractVideoUrl(v.result);
    if (!remote || isStubHouseVideo(remote)) continue;
    videoUrls.push(remote);
  }

  await updateTurn(turnId, {
    generation_status: "ready",
    audio_url: audioUrl,
    video_segment_urls: videoUrls,
  });
  await publishRoomEvent({ type: "turn-ready", turnId });
}
