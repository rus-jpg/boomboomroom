import { extractAudioUrl, extractDurationS, extractImageUrl, extractVideoUrl } from "@/lib/server/fal";
import { enqueueFinalize, publishRoomEvent } from "@/lib/server/queues";
import { getJob, insertMedia, updateJob, updateParticipant, updateTurn, listJobsForTurn, getTurn } from "@/lib/server/repo";
import { downloadUrlToBuffer, uploadBytes } from "@/lib/server/storage";

export async function ingestFalWebhook(jobId: string, payload: unknown, status: string) {
  const job = await getJob(jobId);
  if (!job) return;
  if (job.status === "complete" || job.status === "failed") return;
  if (status !== "OK") {
    await updateJob(job.id, {
      status: "failed",
      error: "fal failed",
      result: payload as never,
      completed_at: new Date().toISOString(),
    });
    if (job.turn_id) {
      if (process.env.VERCEL) await finalizeTurn(job.turn_id);
      else await enqueueFinalize(job.turn_id);
    }
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

  if (job.turn_id) {
    if (process.env.VERCEL) await finalizeTurn(job.turn_id);
    else await enqueueFinalize(job.turn_id);
  }
}

export async function finalizeTurn(turnId: string) {
  const turn = await getTurn(turnId);
  if (!turn) return;
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
    const remote = extractVideoUrl(v.result) || `/house/house-0${(i % 6) + 1}.mp4`;
    let stored = remote;
    if (remote.startsWith("http")) {
      try {
        const { buf, contentType } = await downloadUrlToBuffer(remote);
        stored = await uploadBytes("media", `turns/${turnId}/clip-${i}.mp4`, buf, contentType);
        await insertMedia({
          kind: "video",
          storageKey: stored,
          contentType,
          durationMs: 10_000,
          turnId,
          participantId: v.participant_id,
        });
      } catch {
        stored = remote;
      }
    }
    videoUrls.push(stored);
  }

  await updateTurn(turnId, {
    generation_status: "ready",
    audio_url: audioUrl,
    video_segment_urls: videoUrls,
  });
  await publishRoomEvent({ type: "turn-ready", turnId });
}
