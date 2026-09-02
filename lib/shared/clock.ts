import { CLIP_COUNT, CLIP_DURATION_MS, CROSSFADE_MS, TURN_DURATION_MS } from "./constants";
import type { ClockSnapshot } from "./types";

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function clockFromStart(startsAtMs: number, nowMs: number, durationMs = TURN_DURATION_MS): ClockSnapshot {
  const elapsed = nowMs - startsAtMs;
  const audioOffsetMs = clamp(elapsed, 0, durationMs);
  const rawIndex = Math.floor(audioOffsetMs / CLIP_DURATION_MS);
  const clipIndex = clamp(rawIndex, 0, CLIP_COUNT - 1);
  const clipOffsetMs = audioOffsetMs - clipIndex * CLIP_DURATION_MS;
  const canCrossfade = clipIndex < CLIP_COUNT - 1;
  const crossfading = canCrossfade && clipOffsetMs >= CLIP_DURATION_MS - CROSSFADE_MS;
  return {
    serverNow: nowMs,
    audioOffsetMs,
    clipIndex,
    clipOffsetMs,
    crossfading,
    nextClipIndex: canCrossfade ? clipIndex + 1 : clipIndex,
  };
}

export function turnBounds(startMs: number, durationMs = TURN_DURATION_MS): { startsAt: string; endsAt: string } {
  return {
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(startMs + durationMs).toISOString(),
  };
}

export function remainingMs(endsAt: string | null, nowMs = Date.now()): number {
  if (!endsAt) return 0;
  return Math.max(0, new Date(endsAt).getTime() - nowMs);
}

export function audioDriftMs(elementCurrentTimeS: number, audioOffsetMs: number): number {
  return Math.round(elementCurrentTimeS * 1000 - audioOffsetMs);
}

export function shouldCorrectAudio(driftMs: number, thresholdMs = 180): boolean {
  return Math.abs(driftMs) > thresholdMs;
}
