import {
  HOUSE_AUDIO_PATH,
  MAX_PARTICIPANTS,
  TURN_DURATION_MS,
} from "@/lib/shared/constants";
import { ensureHouseJobsQueued, takeHouseAudioKey, takeHouseClipKeys } from "@/lib/server/house";
import { clockFromStart, turnBounds } from "@/lib/shared/clock";
import { composeDeadlineMs, isComposeWindowExpired } from "@/lib/shared/compose";
import { shouldAdvancePlayback } from "@/lib/shared/playback";
import { isBanned, isBlockedText, isMuted, normalizeChat, takeToken, type RateBucket } from "@/lib/shared/moderation";
import type { RoomState } from "@/lib/shared/types";
import { CHAT_MAX_LEN, CHAT_RATE_PER_MIN } from "@/lib/shared/constants";
import { isMockMode } from "@/lib/server/env";
import { enqueueMusic, enqueueVideo, hasRedis } from "@/lib/server/queues";
import {
  enqueueDj,
  getParticipant,
  getQueueEntry,
  getRoomBySlug,
  insertChat,
  insertJob,
  insertModeration,
  insertSystemChat,
  insertTurn,
  latestHouseTurn,
  latestPlayingTurn,
  leaveQueue,
  leaveRoomSession,
  listPresentReadyParticipants,
  listQueue,
  listResidents,
  nextReadyDjTurn,
  occupancy,
  updateParticipant,
  updateQueue,
  updateTurn,
} from "@/lib/server/repo";
import { buildRoomState } from "@/lib/server/room-state";
import { assignDjTurnClips, djClipPrompt, shouldAnnounceHouseTakeover } from "@/lib/shared/stage-cast";
import { pickNextResident, residentSetLabel } from "@/lib/shared/resident-booth";

const chatBuckets = new Map<string, RateBucket>();

export type EngineListener = (state: RoomState) => void;

export class RoomEngine {
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<EngineListener>();
  private lastEmit = 0;
  private playbackLock: Promise<void> = Promise.resolve();

  on(fn: EngineListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start() {
    await this.expireComposeWindows();
    await this.advancePlayback();
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<RoomState> {
    return buildRoomState();
  }

  async emit() {
    const state = await this.snapshot();
    this.lastEmit = Date.now();
    for (const fn of this.listeners) fn(state);
    return state;
  }

  private async tick() {
    try {
      await this.advancePlayback();
      await this.expireComposeWindows();
      await this.promoteComposer();
      await this.emit();
    } catch (err) {
      console.error("[engine] tick failed", err);
    }
  }

  private async startHouse(roomId: string, previousKind: "house" | "dj" | null = null) {
    try {
      await ensureHouseJobsQueued();
    } catch (err) {
      console.warn("[engine] house buffer enqueue", err);
    }
    const holder = await this.nextResidentHolder(roomId);
    const bounds = turnBounds(Date.now());
    const turn = await insertTurn({
      roomId,
      kind: "house",
      djParticipantId: holder?.id ?? null,
      generationStatus: "playing",
      musicPrompt: residentSetLabel(holder?.display_name),
      audioUrl: HOUSE_AUDIO_PATH,
      videoSegmentUrls: [],
      startsAt: bounds.startsAt,
      endsAt: bounds.endsAt,
    });
    try {
      const [keys, audio] = await Promise.all([takeHouseClipKeys(6, turn.id), takeHouseAudioKey(turn.id)]);
      await updateTurn(turn.id, {
        video_segment_urls: keys,
        ...(audio ? { audio_url: audio } : {}),
      });
    } catch (err) {
      console.warn("[engine] house clip claim", err);
    }
    try {
      await ensureHouseJobsQueued();
    } catch (err) {
      console.warn("[engine] house buffer refill", err);
    }
    if (shouldAnnounceHouseTakeover(previousKind)) {
      await insertSystemChat({
        roomId,
        body: holder ? `${holder.display_name} takes the booth.` : "House takes the booth.",
      });
    }
  }

  private async nextResidentHolder(roomId: string) {
    const residents = (await listResidents()).filter((p) => p.status === "ready" || p.character_reference_url);
    const ordered = residents.length ? residents : await listResidents();
    const last = await latestHouseTurn(roomId);
    return pickNextResident(ordered, last?.dj_participant_id ?? null);
  }

  /** Legacy house turns without a resident pick up the rotation without skipping ahead every tick. */
  private async attachResidentBooth(turn: { id: string; kind: string; dj_participant_id: string | null }) {
    if (turn.kind !== "house" || turn.dj_participant_id) return;
    const residents = await listResidents();
    const holder = pickNextResident(residents, null);
    if (!holder) return;
    await updateTurn(turn.id, {
      dj_participant_id: holder.id,
      music_prompt: residentSetLabel(holder.display_name),
    });
  }

  /** Postgres-authoritative: complete the current turn when it expires, or cut house for a ready DJ. */
  async advancePlayback() {
    const run = this.playbackLock.then(
      () => this.advancePlaybackUnlocked(),
      () => this.advancePlaybackUnlocked(),
    );
    this.playbackLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async advancePlaybackUnlocked() {
    const room = await getRoomBySlug();
    const playing = await latestPlayingTurn(room.id);
    if (!playing) {
      await this.startHouse(room.id);
      return;
    }
    if (playing.kind === "house" && !playing.dj_participant_id) {
      await this.attachResidentBooth(playing);
    }
    const ready = await nextReadyDjTurn(room.id);
    const now = Date.now();
    if (
      !shouldAdvancePlayback({
        playingKind: playing.kind,
        endsAt: playing.ends_at,
        hasReadyDj: Boolean(ready),
        now,
      })
    ) {
      return;
    }

    const ends = playing.ends_at ? new Date(playing.ends_at).getTime() : 0;
    const interruptingHouse = playing.kind === "house" && Boolean(ready) && ends > now + 50;
    const previousKind = playing.kind;

    if (playing.kind === "dj" && playing.dj_participant_id) {
      const q = (await listQueue(room.id)).find((e) => e.participant_id === playing.dj_participant_id && e.status === "playing");
      if (q) await updateQueue(q.id, "done");
    }
    await updateTurn(playing.id, {
      generation_status: "complete",
      ...(interruptingHouse ? { ends_at: new Date(now).toISOString() } : {}),
    });

    if (ready) {
      const bounds = turnBounds(now);
      await updateTurn(ready.id, {
        generation_status: "playing",
        starts_at: bounds.startsAt,
        ends_at: bounds.endsAt,
      });
      const q = (await listQueue(room.id)).find((e) => e.participant_id === ready.dj_participant_id && e.status === "submitted");
      if (q) await updateQueue(q.id, "playing");
      const dj = ready.dj_participant_id ? await getParticipant(ready.dj_participant_id) : null;
      await insertSystemChat({
        roomId: room.id,
        body: dj ? `${dj.display_name} takes the booth.` : "A new set drops.",
      });
      return;
    }
    await this.startHouse(room.id, previousKind);
  }

  private async promoteComposer() {
    const room = await getRoomBySlug();
    const queue = await listQueue(room.id);
    if (queue.some((q) => q.status === "preparing" || q.status === "submitted" || q.status === "playing")) return;
    const next = queue.find((q) => q.status === "waiting");
    if (!next) return;
    await updateQueue(next.id, "preparing");
    const person = await getParticipant(next.participant_id);
    await insertSystemChat({
      roomId: room.id,
      body: `${person?.display_name ?? "Someone"} has 60 seconds to drop a prompt.`,
    });
  }

  private async expireComposeWindows() {
    const room = await getRoomBySlug();
    const queue = await listQueue(room.id);
    for (const entry of queue.filter((q) => q.status === "preparing")) {
      if (!isComposeWindowExpired(entry)) continue;
      await updateQueue(entry.id, "skipped");
      await insertSystemChat({
        roomId: room.id,
        body: "Booth timed out. Next up.",
      });
    }
  }

  async joinQueue(participantId: string) {
    const room = await getRoomBySlug();
    const person = await getParticipant(participantId);
    if (!person) throw new Error("not cast");
    if (person.is_resident) throw new Error("residents hold the house booth");
    if (person.status !== "ready") throw new Error("character still processing");
    if (isBanned(person.banned_until)) throw new Error("banned");
    const cap = await occupancy(room.id);
    if (cap > MAX_PARTICIPANTS) throw new Error("room full");
    const entry = await enqueueDj(room.id, participantId);
    return entry;
  }

  async leaveQueue(participantId: string) {
    const room = await getRoomBySlug();
    await leaveQueue(room.id, participantId);
  }

  async leaveRoom(participantId: string) {
    await leaveRoomSession(participantId);
  }

  async submitPrompt(participantId: string, prompt: string, lyrics?: string) {
    const room = await getRoomBySlug();
    const person = await getParticipant(participantId);
    if (!person || person.status !== "ready") throw new Error("not ready");
    if (person.is_resident) throw new Error("residents hold the house booth");
    if (isBanned(person.banned_until) || isMuted(person.muted_until)) throw new Error("restricted");
    const clean = normalizeChat(prompt, 400);
    if (clean.length < 8) throw new Error("prompt too short");
    if (isBlockedText(clean)) throw new Error("prompt blocked");
    const queue = await listQueue(room.id);
    const entry = queue.find((q) => q.participant_id === participantId && q.status === "preparing");
    if (!entry) throw new Error("not your booth");

    const turn = await insertTurn({
      roomId: room.id,
      kind: "dj",
      djParticipantId: participantId,
      musicPrompt: clean,
      generationStatus: "generating",
    });
    await updateQueue(entry.id, "submitted");

    const musicJob = await insertJob({
      kind: "music",
      turnId: turn.id,
      participantId,
      payload: { prompt: clean, lyrics: lyrics ?? null },
    });

    const present = await listPresentReadyParticipants(room.id);
    const others = present.filter((p) => p.id !== person.id && p.character_reference_url);
    const casts = assignDjTurnClips(person, others);

    for (let i = 0; i < casts.length; i++) {
      const { role, person: featured } = casts[i];
      const face = featured ?? (role === "booth" ? person : null);
      const videoJob = await insertJob({
        kind: "video",
        turnId: turn.id,
        participantId: face?.id ?? null,
        payload: {
          clipIndex: i,
          role,
          prompt: djClipPrompt({ role, person: face, track: clean, clipIndex: i }),
          referenceImageUrl: face?.character_reference_url ?? null,
        },
      });
      if (hasRedis()) await enqueueVideo(videoJob.id, turn.id, i);
    }
    if (hasRedis()) await enqueueMusic(musicJob.id, turn.id);

    if (isMockMode() && !hasRedis()) {
      await this.mockReady(turn.id, clean);
    }

    await insertSystemChat({
      roomId: room.id,
      body: `${person.display_name} locked a prompt. Generating the set…`,
    });
    return turn;
  }

  private async mockReady(turnId: string, prompt: string) {
    await updateTurn(turnId, {
      generation_status: "ready",
      audio_url: HOUSE_AUDIO_PATH,
      video_segment_urls: [],
      music_prompt: prompt,
    });
  }

  async chat(participantId: string, body: string) {
    const room = await getRoomBySlug();
    const person = await getParticipant(participantId);
    if (!person) throw new Error("not cast");
    if (isBanned(person.banned_until)) throw new Error("banned");
    if (isMuted(person.muted_until)) throw new Error("muted");
    const clean = normalizeChat(body, CHAT_MAX_LEN);
    if (!clean) throw new Error("empty");
    if (isBlockedText(clean)) {
      await insertModeration({ kind: "blocked_chat", targetId: participantId, reason: "blocked_text" });
      throw new Error("blocked");
    }
    const bucket = chatBuckets.get(participantId) ?? { stamps: [] };
    if (!takeToken(bucket, CHAT_RATE_PER_MIN, 60_000)) throw new Error("slow down");
    chatBuckets.set(participantId, bucket);
    return insertChat({ roomId: room.id, participantId, body: clean, kind: "chat" });
  }

  async moderate(action: "mute" | "ban" | "skip", targetId: string, reason?: string) {
    const until = new Date(Date.now() + (action === "ban" ? 24 : 1) * 60 * 60 * 1000).toISOString();
    if (action === "mute") await updateParticipant(targetId, { muted_until: until });
    if (action === "ban") {
      await updateParticipant(targetId, { banned_until: until, status: "blocked" });
      const room = await getRoomBySlug();
      await leaveQueue(room.id, targetId);
    }
    if (action === "skip") {
      const room = await getRoomBySlug();
      const playing = await latestPlayingTurn(room.id);
      if (playing) await updateTurn(playing.id, { ends_at: new Date().toISOString(), generation_status: "complete" });
      const q = (await listQueue(room.id)).find((e) => e.status === "playing" || e.status === "preparing");
      if (q) await updateQueue(q.id, "skipped");
    }
    await insertModeration({ kind: action, targetId, reason: reason ?? null });
  }

  clockFor(state: RoomState) {
    const start = state.currentTurn?.startsAt ? new Date(state.currentTurn.startsAt).getTime() : Date.now();
    return clockFromStart(start, Date.now(), TURN_DURATION_MS);
  }
}

export async function getComposeDeadline(entryId: string): Promise<number | undefined> {
  const entry = await getQueueEntry(entryId);
  if (!entry) return undefined;
  return composeDeadlineMs(entry);
}
