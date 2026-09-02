"use client";

import { useEffect, useRef, useState } from "react";
import { CLIP_COUNT, HOUSE_AUDIO_PATH, UNLOCK_AUDIO_EVENT } from "@/lib/shared/constants";
import { clockFromStart, crossfadeProgress, shouldCorrectAudio } from "@/lib/shared/clock";
import { PLAYBACK_DRIFT_MS, isStubHouseVideo } from "@/lib/shared/media";
import type { ClockSnapshot, TurnView } from "@/lib/shared/types";

function sameSrc(el: HTMLVideoElement, url: string): boolean {
  if (!url) return false;
  if (el.getAttribute("src") === url) return true;
  try {
    return el.currentSrc === url || el.src === new URL(url, window.location.origin).href;
  } catch {
    return el.src === url;
  }
}

export function Stage({
  turn,
  clock,
  allowEnterOverlay = true,
  dormant = false,
}: {
  turn: TurnView | null;
  clock: ClockSnapshot;
  allowEnterOverlay?: boolean;
  /** Pause live seeking so Entrance / creating can sit on a static loop instead. */
  dormant?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const v0Ref = useRef<HTMLVideoElement>(null);
  const v1Ref = useRef<HTMLVideoElement>(null);
  const lastAudioUrl = useRef<string | null>(null);
  const frontIs0Ref = useRef(true);
  const primedTurnRef = useRef<string | null>(null);
  const primedIndexRef = useRef<number | null>(null);
  const nextReadyRef = useRef(false);
  const fadeStartedRef = useRef(false);
  const clockRef = useRef(clock);
  const urlsRef = useRef({ currentUrl: "", nextUrl: "" });
  const [fade, setFade] = useState(0);
  const [frontIs0, setFrontIs0] = useState(true);
  const [playIndex, setPlayIndex] = useState(clock.clipIndex);
  const failedUrlsRef = useRef(new Set<string>());
  const [, setFailedTick] = useState(0);
  const [audioGate, setAudioGate] = useState<"unknown" | "blocked" | "live">("unknown");
  const [audioPaused, setAudioPaused] = useState(false);
  const tryStartAudioRef = useRef<() => Promise<boolean>>(async () => false);
  const audioGateRef = useRef(audioGate);
  audioGateRef.current = audioGate;
  const dormantRef = useRef(dormant);
  dormantRef.current = dormant;

  clockRef.current = clock;
  frontIs0Ref.current = frontIs0;

  const clips = turn?.videoSegments ?? [];
  const audioUrl = turn?.audioUrl || HOUSE_AUDIO_PATH;
  const clipIndex = playIndex;
  const nextClipIndex = clipIndex < CLIP_COUNT - 1 ? clipIndex + 1 : clipIndex;
  const currentUrl = clips[clipIndex]?.url ?? "";
  const nextUrl = clips[nextClipIndex]?.url ?? "";
  urlsRef.current = { currentUrl, nextUrl };
  const stubCurrent = isStubHouseVideo(currentUrl);
  const warming = stubCurrent || failedUrlsRef.current.has(currentUrl);

  function markFailed(url: string) {
    if (!url || failedUrlsRef.current.has(url)) return;
    failedUrlsRef.current.add(url);
    setFailedTick((n) => n + 1);
  }

  tryStartAudioRef.current = async () => {
    if (dormantRef.current) return false;
    const audio = audioRef.current;
    if (!audio) return false;
    try {
      const startsAt = turn?.startsAt ? new Date(turn.startsAt).getTime() : Date.now();
      const local = clockFromStart(startsAt, Date.now());
      const target = local.audioOffsetMs / 1000;
      if (audio.readyState >= 1 && Number.isFinite(target) && Math.abs(audio.currentTime - target) > 0.35) {
        audio.currentTime = Math.max(0, target);
      }
      audio.muted = false;
      await audio.play();
      setAudioGate("live");
      setAudioPaused(false);
      void v0Ref.current?.play().catch(() => undefined);
      void v1Ref.current?.play().catch(() => undefined);
      return true;
    } catch {
      setAudioGate("blocked");
      return false;
    }
  };

  useEffect(() => {
    const onUnlock = () => {
      void tryStartAudioRef.current();
    };
    window.addEventListener(UNLOCK_AUDIO_EVENT, onUnlock);
    document.addEventListener("pointerdown", onUnlock);
    return () => {
      window.removeEventListener(UNLOCK_AUDIO_EVENT, onUnlock);
      document.removeEventListener("pointerdown", onUnlock);
    };
  }, []);

  useEffect(() => {
    primedTurnRef.current = null;
    primedIndexRef.current = null;
    nextReadyRef.current = false;
    fadeStartedRef.current = false;
    setPlayIndex(clockRef.current.clipIndex);
    setFade(0);
  }, [turn?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (lastAudioUrl.current !== audioUrl) {
      lastAudioUrl.current = audioUrl;
      audio.src = audioUrl;
    }
    if (!dormant) void tryStartAudioRef.current();
    else audio.pause();
  }, [audioUrl, dormant]);

  useEffect(() => {
    if (dormant) {
      v0Ref.current?.pause();
      v1Ref.current?.pause();
      audioRef.current?.pause();
    }
  }, [dormant]);

  useEffect(() => {
    if (dormant || stubCurrent) return;
    const v0 = v0Ref.current;
    const v1 = v1Ref.current;
    if (!v0 || !v1 || !currentUrl) return;

    const turnId = turn?.id ?? "";
    const isNewTurn = primedTurnRef.current !== turnId;
    const isNewClip = primedIndexRef.current !== clipIndex;

    const preloadBack = (back: HTMLVideoElement) => {
      if (!nextUrl || nextUrl === currentUrl || isStubHouseVideo(nextUrl)) return;
      if (sameSrc(back, nextUrl)) {
        if (back.readyState >= 3) nextReadyRef.current = true;
        return;
      }
      nextReadyRef.current = false;
      back.pause();
      back.src = nextUrl;
      back.addEventListener(
        "canplay",
        () => {
          nextReadyRef.current = true;
        },
        { once: true },
      );
    };

    if (!isNewTurn && !isNewClip) {
      preloadBack(frontIs0Ref.current ? v1 : v0);
      return;
    }

    const on0 = sameSrc(v0, currentUrl);
    const on1 = sameSrc(v1, currentUrl);
    let front = frontIs0Ref.current ? v0 : v1;
    let back = frontIs0Ref.current ? v1 : v0;
    if (on1 && !on0) {
      front = v1;
      back = v0;
      setFrontIs0(false);
    } else if (on0) {
      front = v0;
      back = v1;
      setFrontIs0(true);
    } else if (!sameSrc(front, currentUrl)) {
      front.src = currentUrl;
    }

    const joinOffset = isNewTurn ? Math.max(0, clockRef.current.clipOffsetMs / 1000) : 0;
    const reusedPreload = (on0 || on1) && !isNewTurn;
    const startFront = () => {
      if (!reusedPreload) {
        if (Math.abs(front.currentTime - joinOffset) > 0.08) front.currentTime = joinOffset;
      }
      void front.play().catch(() => undefined);
    };
    if (front.readyState >= 1) startFront();
    else front.addEventListener("loadedmetadata", startFront, { once: true });

    preloadBack(back);
    primedTurnRef.current = turnId;
    primedIndexRef.current = clipIndex;
  }, [currentUrl, nextUrl, clipIndex, stubCurrent, turn?.id, dormant]);

  useEffect(() => {
    const startsAt = turn?.startsAt ? new Date(turn.startsAt).getTime() : Date.now();
    let raf = 0;
    const loop = () => {
      if (dormantRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const { currentUrl: liveUrl, nextUrl: liveNext } = urlsRef.current;
      const local = clockFromStart(startsAt, Date.now());
      const canFade =
        local.crossfading &&
        nextReadyRef.current &&
        Boolean(liveNext) &&
        liveNext !== liveUrl &&
        !isStubHouseVideo(liveNext);
      const progress = canFade ? crossfadeProgress(local.clipOffsetMs) : 0;
      setFade((prev) => (Math.abs(prev - progress) < 0.02 ? prev : progress));
      setPlayIndex((i) => (i === local.clipIndex ? i : local.clipIndex));

      const v0 = v0Ref.current;
      const v1 = v1Ref.current;
      const front = frontIs0Ref.current ? v0 : v1;
      const back = frontIs0Ref.current ? v1 : v0;

      if (front && !isStubHouseVideo(liveUrl) && front.readyState >= 2) {
        const expected = local.clipOffsetMs / 1000;
        if (Number.isFinite(front.currentTime) && Math.abs(front.currentTime - expected) * 1000 > PLAYBACK_DRIFT_MS) {
          front.currentTime = Math.max(0, expected);
        }
        if (front.paused) void front.play().catch(() => undefined);
      }

      if (canFade && back) {
        if (!fadeStartedRef.current) {
          fadeStartedRef.current = true;
          if (back.currentTime > 0.15) back.currentTime = 0;
          void back.play().catch(() => undefined);
        } else if (back.paused) {
          void back.play().catch(() => undefined);
        }
      } else if (!local.crossfading) {
        fadeStartedRef.current = false;
      }

      const audio = audioRef.current;
      if (audio && audio.readyState >= 2) {
        const target = local.audioOffsetMs / 1000;
        const drift = Math.round((audio.currentTime - target) * 1000);
        if (Number.isFinite(audio.currentTime) && shouldCorrectAudio(drift, PLAYBACK_DRIFT_MS)) {
          audio.currentTime = Math.max(0, target);
        }
        if (audio.paused && audioGateRef.current !== "blocked") {
          void audio.play().catch(() => undefined);
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [turn?.id, turn?.startsAt]);

  const op0 = warming ? 0 : frontIs0 ? 1 - fade : fade;
  const op1 = warming ? 0 : frontIs0 ? fade : 1 - fade;

  return (
    <div className="stage-wrap">
      <video
        ref={v0Ref}
        muted
        playsInline
        preload="auto"
        loop={false}
        className={op0 <= 0.02 ? "is-off" : undefined}
        onError={() => markFailed(v0Ref.current?.getAttribute("src") || currentUrl)}
        style={{ opacity: op0 }}
      />
      <video
        ref={v1Ref}
        muted
        playsInline
        preload="auto"
        loop={false}
        className={op1 <= 0.02 ? "is-off" : undefined}
        onError={() => markFailed(v1Ref.current?.getAttribute("src") || nextUrl)}
        style={{ opacity: op1 }}
      />
      <div className="stage-fallback" aria-hidden />
      {warming && !dormant ? (
        <div className="stage-warming" role="status">
          warming livestream
        </div>
      ) : null}
      <audio
        ref={audioRef}
        preload="auto"
        loop
        playsInline
        onPlay={() => {
          setAudioGate("live");
          setAudioPaused(false);
        }}
        onPause={() => setAudioPaused(true)}
      />
      {dormant ? null : (
        <div className="hud">
          <div className="pill now-playing">
            {turn?.kind === "dj" && turn.dj
              ? `${turn.dj.displayName} · ${turn.musicPrompt ?? "live set"}`
              : turn?.musicPrompt ?? "House buffer · midnight basement disco"}
          </div>
          <div className="hud-right">
            {allowEnterOverlay && audioGate === "live" && audioPaused ? (
              <button
                className="pill audio-chip"
                type="button"
                onClick={() => void tryStartAudioRef.current()}
              >
                Unmute
              </button>
            ) : null}
            <div className="pill">
              {String(1 + clipIndex).padStart(2, "0")} / 06 · {(clock.audioOffsetMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
      {allowEnterOverlay && !dormant && audioGate === "blocked" ? (
        <button
          className="enter-party"
          type="button"
          onClick={() => void tryStartAudioRef.current()}
        >
          <span className="eyebrow">The booth is live</span>
          <strong className="display">Tap to enter</strong>
          <span>Start the music</span>
        </button>
      ) : null}
    </div>
  );
}
