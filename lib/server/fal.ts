import { fal } from "@fal-ai/client";
import { MUSIC_MODEL, VIDEO_ASPECT, VIDEO_DURATION_S, VIDEO_MODEL, VIDEO_RESOLUTION } from "@/lib/shared/constants";
import { characterModel, isMockMode, webhookBaseUrl } from "./env";

function configureFal() {
  if (process.env.FAL_KEY) {
    fal.config({ credentials: process.env.FAL_KEY });
  }
}

export type FalSubmitResult = { requestId: string; mock: boolean };

export async function submitCharacter(input: {
  imageUrl: string;
  prompt: string;
  jobId: string;
}): Promise<FalSubmitResult> {
  if (isMockMode()) return { requestId: `mock-character-${input.jobId}`, mock: true };
  configureFal();
  const { request_id } = await fal.queue.submit(characterModel(), {
    input: {
      prompt: `Transform this face into a cinematic club-ready character portrait. ${input.prompt}. Keep the same person recognizable. Moody nightclub lighting, film still, 35mm.`,
      image_url: input.imageUrl,
      aspect_ratio: "1:1",
      output_format: "jpeg",
      safety_tolerance: "2",
    },
    webhookUrl: `${webhookBaseUrl()}/api/webhooks/fal?jobId=${input.jobId}`,
  });
  return { requestId: request_id, mock: false };
}

export async function submitMusic(input: {
  prompt: string;
  lyrics?: string;
  jobId: string;
}): Promise<FalSubmitResult> {
  if (isMockMode()) return { requestId: `mock-music-${input.jobId}`, mock: true };
  configureFal();
  const { request_id } = await fal.queue.submit(MUSIC_MODEL, {
    input: {
      prompt: input.prompt,
      lyrics: input.lyrics || "[instrumental]\n[verse]\n[chorus]\n[instrumental]",
      duration: 60,
    },
    webhookUrl: `${webhookBaseUrl()}/api/webhooks/fal?jobId=${input.jobId}`,
  });
  return { requestId: request_id, mock: false };
}

export async function submitVideo(input: {
  prompt: string;
  referenceImageUrl: string | null;
  jobId: string;
}): Promise<FalSubmitResult> {
  if (isMockMode()) return { requestId: `mock-video-${input.jobId}`, mock: true };
  configureFal();
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    prompt_expansion_mode: "balanced",
    duration: VIDEO_DURATION_S,
    resolution: VIDEO_RESOLUTION,
    aspect_ratio: VIDEO_ASPECT,
    enable_safety_checker: true,
  };
  if (input.referenceImageUrl) {
    payload.reference_image_urls = [input.referenceImageUrl];
  }
  const { request_id } = await fal.queue.submit(VIDEO_MODEL, {
    input: payload,
    webhookUrl: `${webhookBaseUrl()}/api/webhooks/fal?jobId=${input.jobId}`,
  });
  return { requestId: request_id, mock: false };
}

export function extractAudioUrl(payload: unknown): string | null {
  const p = payload as { audio?: { url?: string }; payload?: { audio?: { url?: string } } };
  return p?.audio?.url || p?.payload?.audio?.url || null;
}

export function extractImageUrl(payload: unknown): string | null {
  const p = payload as {
    images?: { url?: string }[];
    image?: { url?: string };
    payload?: { images?: { url?: string }[] };
  };
  return p?.images?.[0]?.url || p?.image?.url || p?.payload?.images?.[0]?.url || null;
}

export function extractVideoUrl(payload: unknown): string | null {
  const p = payload as {
    video?: { url?: string };
    payload?: { video?: { url?: string } };
  };
  return p?.video?.url || p?.payload?.video?.url || null;
}

export function extractDurationS(payload: unknown): number | null {
  const p = payload as { duration?: number; payload?: { duration?: number } };
  const d = p?.duration ?? p?.payload?.duration;
  return typeof d === "number" ? d : null;
}
