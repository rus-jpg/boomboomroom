import { Worker } from "bullmq";
import { createServer } from "node:http";
import Redis from "ioredis";
import { QUEUES } from "@/lib/shared/constants";
import { isMockMode, redisUrl } from "@/lib/server/env";
import { submitCharacter, submitMusic, submitVideo } from "@/lib/server/fal";
import { enqueueFinalize, publishRoomEvent } from "@/lib/server/queues";
import { getJob, getParticipant, insertMedia, updateJob, updateParticipant } from "@/lib/server/repo";
import { signedUrl, uploadBytes } from "@/lib/server/storage";
import { finalizeTurn, ingestFalWebhook } from "./ingest";
import { mockCharacterJpeg } from "./mock";

function connection() {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is required for the worker");
  return { url };
}

async function handleCharacter(jobId: string) {
  const job = await getJob(jobId);
  if (!job || !job.participant_id) return;
  const person = await getParticipant(job.participant_id);
  if (!person) return;
  await updateJob(job.id, { status: "running" });

  const faceKey = person.original_face_url;
  const faceUrl = faceKey ? (await signedUrl(faceKey, 3600)) || faceKey : "";
  const submitted = await submitCharacter({
    imageUrl: faceUrl.startsWith("http") ? faceUrl : "https://fal.media/files/placeholder.jpg",
    prompt: person.character_prompt,
    jobId: job.id,
  });
  await updateJob(job.id, { fal_request_id: submitted.requestId });

  if (submitted.mock) {
    const svg = mockCharacterJpeg(person.display_name, person.character_prompt);
    const key = `characters/${person.id}.svg`;
    const storageKey = await uploadBytes("media", key, svg, "image/svg+xml");
    await insertMedia({
      kind: "character",
      storageKey,
      contentType: "image/svg+xml",
      participantId: person.id,
    });
    await updateParticipant(person.id, {
      character_reference_url: storageKey,
      status: "ready",
    });
    await updateJob(job.id, { status: "complete", completed_at: new Date().toISOString(), result: { mock: true, storageKey } });
    await publishRoomEvent({ type: "character-ready", participantId: person.id });
  }
}

async function handleMusic(jobId: string) {
  const job = await getJob(jobId);
  if (!job || !job.turn_id) return;
  const payload = (job.payload ?? {}) as { prompt?: string; lyrics?: string };
  await updateJob(job.id, { status: "running" });
  const submitted = await submitMusic({
    prompt: payload.prompt || "Genre: midnight disco. BPM: 118.",
    lyrics: payload.lyrics,
    jobId: job.id,
  });
  await updateJob(job.id, { fal_request_id: submitted.requestId });
  if (submitted.mock) {
    await updateJob(job.id, {
      status: "complete",
      completed_at: new Date().toISOString(),
      result: { mock: true, audio: { url: "/house/house-audio.mp3" }, duration: 60 },
    });
    await enqueueFinalize(job.turn_id);
  }
}

async function handleVideo(jobId: string) {
  const job = await getJob(jobId);
  if (!job || !job.turn_id) return;
  const payload = (job.payload ?? {}) as {
    clipIndex?: number;
    prompt?: string;
    referenceImageUrl?: string | null;
  };
  await updateJob(job.id, { status: "running" });
  let ref = payload.referenceImageUrl ?? null;
  if (ref && !ref.startsWith("http") && !ref.startsWith("/")) {
    ref = (await signedUrl(ref, 3600)) || ref;
  }
  const submitted = await submitVideo({
    prompt: payload.prompt || "Cinematic nightclub music video, 16:9.",
    referenceImageUrl: ref?.startsWith("http") ? ref : null,
    jobId: job.id,
  });
  await updateJob(job.id, { fal_request_id: submitted.requestId });
  if (submitted.mock) {
    const clip = ((payload.clipIndex ?? 0) % 6) + 1;
    await updateJob(job.id, {
      status: "complete",
      completed_at: new Date().toISOString(),
      result: { mock: true, video: { url: `/house/house-0${clip}.mp4` }, clipIndex: payload.clipIndex ?? 0 },
    });
    await enqueueFinalize(job.turn_id);
  }
}

async function handleFinalize(turnId: string) {
  await finalizeTurn(turnId);
}

async function main() {
  const health = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "worker", mock: isMockMode() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  health.listen(Number(process.env.HEALTH_PORT || process.env.PORT || 4100), "0.0.0.0");

  if (!redisUrl()) {
    console.log("[worker] REDIS_URL missing — idle health server only (mock inline path used by realtime)");
    return;
  }

  const conn = connection();
  const workers = [
    new Worker(QUEUES.character, async (job) => handleCharacter(String(job.data.jobId)), { connection: conn, concurrency: 4 }),
    new Worker(QUEUES.music, async (job) => handleMusic(String(job.data.jobId)), { connection: conn, concurrency: 2 }),
    new Worker(QUEUES.video, async (job) => handleVideo(String(job.data.jobId)), { connection: conn, concurrency: 6 }),
    new Worker(QUEUES.finalize, async (job) => handleFinalize(String(job.data.turnId)), { connection: conn, concurrency: 2 }),
  ];

  if (redisUrl()) {
    const sub = new Redis(redisUrl()!);
    sub.subscribe("bbr:fal:webhook");
    sub.on("message", (_ch, raw) => {
      try {
        const msg = JSON.parse(raw) as { jobId: string; payload: unknown; status: string };
        void ingestFalWebhook(msg.jobId, msg.payload, msg.status);
      } catch (err) {
        console.error("[worker] webhook ingest", err);
      }
    });
  }

  for (const w of workers) {
    w.on("failed", (job, err) => console.error(`[worker] ${w.name} failed`, job?.id, err));
  }

  console.log(`[worker] Boom Boom Room workers online (mock=${isMockMode()})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
