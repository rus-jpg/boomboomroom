import {
  COMPOSE_WINDOW_MS,
  HOUSE_AUDIO_PATH,
  HOUSE_VIDEO_PATHS,
  MAX_PARTICIPANTS,
  TURN_DURATION_MS,
} from "@/lib/shared/constants";
import { clockFromStart, turnBounds } from "@/lib/shared/clock";
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
  insertTurn,
  latestPlayingTurn,
  leaveQueue,
  listQueue,
  nextReadyDjTurn,
  occupancy,
  updateParticipant,
  updateQueue,
  updateTurn,
} from "@/lib/server/repo";
import { buildRoomState } from "@/lib/server/room-state";

const chatBuckets = new Map<string, RateBucket>();
const composeDeadlines = new Map<string, number>();

export type EngineListener = (state: RoomState) => void;

export class RoomEngine {
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<EngineListener>();
  private lastEmit = 0;

  on(fn: EngineListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start() {
    await this.ensureHousePlaying();
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<RoomState> {
    const state = await buildRoomState();
    if (state.compose) {
      const deadline = composeDeadlines.get(state.compose.entryId);
      if (deadline) state.compose.deadlineAt = new Date(deadline).toISOString();
    }
    return state;
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
      await this.promoteComposer();
      await this.expireComposeWindows();
      await this.emit();
    } catch (err) {
      console.error("[engine] tick failed", err);
    }
  }

  private async ensureHousePlaying() {
    const room = await getRoomBySlug();
    const playing = await latestPlayingTurn(room.id);
    if (playing && playing.generation_status === "playing") {
      const ends = playing.ends_at ? new Date(playing.ends_at).getTime() : 0;
      if (ends > Date.now()) return;
    }
    await this.startHouse(room.id);
  }

  private async startHouse(roomId: string) {
    const bounds = turnBounds(Date.now());
    await insertTurn({
      roomId,
      kind: "house",
      generationStatus: "playing",
      musicPrompt: "House buffer — midnight basement disco",
      audioUrl: HOUSE_AUDIO_PATH,
      videoSegmentUrls: [...HOUSE_VIDEO_PATHS],
      startsAt: bounds.startsAt,
      endsAt: bounds.endsAt,
    });
    await insertChat({
      roomId,
      participantId: null,
      body: "House takes the booth while the next set cooks.",
      kind: "system",
    });
  }

  private async advancePlayback() {
    const room = await getRoomBySlug();
    const playing = await latestPlayingTurn(room.id);
    if (!playing) {
      await this.startHouse(room.id);
      return;
    }
    const ends = playing.ends_at ? new Date(playing.ends_at).getTime() : 0;
    if (ends > Date.now() + 50) return;

    if (playing.kind === "dj" && playing.dj_participant_id) {
      const q = (await listQueue(room.id)).find((e) => e.participant_id === playing.dj_participant_id && e.status === "playing");
      if (q) await updateQueue(q.id, "done");
    }
    await updateTurn(playing.id, { generation_status: "complete" });

    const ready = await nextReadyDjTurn(room.id);
    if (ready) {
      const bounds = turnBounds(Date.now());
      await updateTurn(ready.id, {
        generation_status: "playing",
        starts_at: bounds.startsAt,
        ends_at: bounds.endsAt,
      });
      const q = (await listQueue(room.id)).find((e) => e.participant_id === ready.dj_participant_id && e.status === "submitted");
      if (q) await updateQueue(q.id, "playing");
      const dj = ready.dj_participant_id ? await getParticipant(ready.dj_participant_id) : null;
      await insertChat({
        roomId: room.id,
        participantId: null,
        body: dj ? `${dj.display_name} takes the booth.` : "A new set drops.",
        kind: "system",
      });
      return;
    }
    await this.startHouse(room.id);
  }

  private async promoteComposer() {
    const room = await getRoomBySlug();
    const queue = await listQueue(room.id);
    if (queue.some((q) => q.status === "preparing" || q.status === "submitted" || q.status === "playing")) return;
    const next = queue.find((q) => q.status === "waiting");
    if (!next) return;
    await updateQueue(next.id, "preparing");
    composeDeadlines.set(next.id, Date.now() + COMPOSE_WINDOW_MS);
    const person = await getParticipant(next.participant_id);
    await insertChat({
      roomId: room.id,
      participantId: null,
      body: `${person?.display_name ?? "Someone"} has 60 seconds to drop a prompt.`,
      kind: "system",
    });
  }

  private async expireComposeWindows() {
    const room = await getRoomBySlug();
    const queue = await listQueue(room.id);
    for (const entry of queue.filter((q) => q.status === "preparing")) {
      const deadline = composeDeadlines.get(entry.id) ?? new Date(entry.created_at).getTime() + COMPOSE_WINDOW_MS;
      if (Date.now() < deadline) continue;
      await updateQueue(entry.id, "skipped");
      composeDeadlines.delete(entry.id);
      await insertChat({
        roomId: room.id,
        participantId: null,
        body: "Booth timed out. Next up.",
        kind: "system",
      });
    }
  }

  async joinQueue(participantId: string) {
    const room = await getRoomBySlug();
    const person = await getParticipant(participantId);
    if (!person) throw new Error("not cast");
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

  async submitPrompt(participantId: string, prompt: string, lyrics?: string) {
    const room = await getRoomBySlug();
    const person = await getParticipant(participantId);
    if (!person || person.status !== "ready") throw new Error("not ready");
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
    composeDeadlines.delete(entry.id);

    const musicJob = await insertJob({
      kind: "music",
      turnId: turn.id,
      participantId,
      payload: { prompt: clean, lyrics: lyrics ?? null },
    });

    const readyPeople = (await import("@/lib/server/repo")).listReadyParticipants;
    const roster = await readyPeople();
    const rotation = roster.length ? roster : [person];

    for (let i = 0; i < 6; i++) {
      const featured = rotation[i % rotation.length];
      const videoJob = await insertJob({
        kind: "video",
        turnId: turn.id,
        participantId: featured.id,
        payload: {
          clipIndex: i,
          prompt: `Image 1 is ${featured.display_name}, ${featured.character_prompt}. Nightclub music video, 16:9, cinematic, moving with the track: ${clean}. Clip ${i + 1} of 6.`,
          referenceImageUrl: featured.character_reference_url,
        },
      });
      if (hasRedis()) await enqueueVideo(videoJob.id, turn.id, i);
    }
    if (hasRedis()) await enqueueMusic(musicJob.id, turn.id);

    if (isMockMode() && !hasRedis()) {
      await this.mockReady(turn.id, clean);
    }

    await insertChat({
      roomId: room.id,
      participantId: null,
      body: `${person.display_name} locked a prompt. Generating the set…`,
      kind: "system",
    });
    return turn;
  }

  private async mockReady(turnId: string, prompt: string) {
    await updateTurn(turnId, {
      generation_status: "ready",
      audio_url: HOUSE_AUDIO_PATH,
      video_segment_urls: [...HOUSE_VIDEO_PATHS],
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
  if (composeDeadlines.has(entryId)) return composeDeadlines.get(entryId);
  const entry = await getQueueEntry(entryId);
  if (!entry) return undefined;
  return new Date(entry.created_at).getTime() + COMPOSE_WINDOW_MS;
}
