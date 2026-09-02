"use client";

import { useEffect, useRef } from "react";
import { CROSSFADE_MS } from "@/lib/shared/constants";
import { shouldCorrectAudio } from "@/lib/shared/clock";
import type { ClockSnapshot, TurnView } from "@/lib/shared/types";

export function Stage({ turn, clock }: { turn: TurnView | null; clock: ClockSnapshot }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const lastUrl = useRef<string | null>(null);

  const clips = turn?.videoSegments ?? [];
  const audioUrl = turn?.audioUrl ?? "/house/house-audio.mp3";
  const clipA = clips[clock.clipIndex]?.url ?? "/house/house-01.mp4";
  const clipB = clips[clock.nextClipIndex]?.url ?? clipA;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (lastUrl.current !== audioUrl) {
      lastUrl.current = audioUrl;
      audio.src = audioUrl;
    }
    const target = clock.audioOffsetMs / 1000;
    if (Number.isFinite(target)) {
      const drift = Math.round((audio.currentTime - target) * 1000);
      if (shouldCorrectAudio(drift)) audio.currentTime = Math.max(0, target);
    }
    if (audio.paused) void audio.play().catch(() => undefined);
  }, [audioUrl, clock.audioOffsetMs, clock.serverNow]);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;
    if (a.src !== new URL(clipA, window.location.origin).href && a.getAttribute("src") !== clipA) {
      a.src = clipA;
    }
    if (b.getAttribute("src") !== clipB) b.src = clipB;
    const aTime = clock.clipOffsetMs / 1000;
    if (Math.abs(a.currentTime - aTime) > 0.25) a.currentTime = Math.max(0, aTime);
    if (clock.crossfading) {
      if (Math.abs(b.currentTime) > 0.35) b.currentTime = 0;
      void b.play().catch(() => undefined);
    }
    void a.play().catch(() => undefined);
  }, [clipA, clipB, clock.clipIndex, clock.clipOffsetMs, clock.crossfading]);

  const fade = clock.crossfading ? 1 : 0;

  return (
    <div className="stage-wrap">
      <video ref={aRef} muted playsInline loop={false} style={{ opacity: 1 - fade, transition: `opacity ${CROSSFADE_MS}ms linear` }} />
      <video ref={bRef} muted playsInline loop={false} style={{ opacity: fade, transition: `opacity ${CROSSFADE_MS}ms linear` }} />
      <div className="stage-fallback" aria-hidden />
      <audio ref={audioRef} preload="auto" loop />
      <div className="hud">
        <div className="pill now-playing">
          {turn?.kind === "dj" && turn.dj
            ? `${turn.dj.displayName} · ${turn.musicPrompt ?? "live set"}`
            : "House buffer · midnight basement disco"}
        </div>
        <div className="pill">
          {String(1 + clock.clipIndex).padStart(2, "0")} / 06 · {(clock.audioOffsetMs / 1000).toFixed(1)}s
        </div>
      </div>
    </div>
  );
}
