import { Queue } from "bullmq";
import { QUEUES } from "@/lib/shared/constants";
import { redisUrl } from "./env";

function connection() {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is required to enqueue jobs");
  return { url };
}

let queues: {
  character: Queue;
  music: Queue;
  video: Queue;
  finalize: Queue;
} | null = null;

export function jobQueues() {
  if (!queues) {
    const conn = connection();
    queues = {
      character: new Queue(QUEUES.character, { connection: conn }),
      music: new Queue(QUEUES.music, { connection: conn }),
      video: new Queue(QUEUES.video, { connection: conn }),
      finalize: new Queue(QUEUES.finalize, { connection: conn }),
    };
  }
  return queues;
}

export function hasRedis(): boolean {
  return Boolean(redisUrl());
}

export async function enqueueCharacter(jobId: string, participantId: string) {
  await jobQueues().character.add("character", { jobId, participantId }, { jobId, removeOnComplete: 100 });
}

export async function enqueueMusic(jobId: string, turnId: string) {
  await jobQueues().music.add("music", { jobId, turnId }, { jobId, removeOnComplete: 100 });
}

export async function enqueueVideo(jobId: string, turnId: string, clipIndex: number) {
  await jobQueues().video.add("video", { jobId, turnId, clipIndex }, { jobId, removeOnComplete: 200 });
}

export async function enqueueFinalize(turnId: string) {
  await jobQueues().finalize.add("finalize", { turnId }, { jobId: `finalize-${turnId}`, removeOnComplete: 100 });
}

export async function publishRoomEvent(payload: unknown) {
  const url = redisUrl();
  if (!url) return;
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(url);
  await redis.publish("bbr:room:events", JSON.stringify(payload));
  await redis.quit();
}
