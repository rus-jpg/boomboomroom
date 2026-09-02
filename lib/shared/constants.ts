export const PRODUCT_NAME = "Boom Boom Room";
export const ROOM_SLUG = process.env.ROOM_SLUG ?? process.env.NEXT_PUBLIC_ROOM_SLUG ?? "main";

export const TURN_DURATION_MS = 60_000;
export const CLIP_DURATION_MS = 10_000;
export const CLIP_COUNT = 6;
export const CROSSFADE_MS = 250;
export const COMPOSE_WINDOW_MS = 60_000;
export const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS ?? 20);
export const MIN_PARTY_SIZE = 5;

export const SESSION_COOKIE = "bbr_session";
export const SESSION_TTL_DAYS = 30;
export const UNLOCK_AUDIO_EVENT = "bbr:unlock-audio";

export const MUSIC_MODEL = "minimax/music-3";
export const VIDEO_MODEL = "minimax/h3-max/reference-to-video";
export const DEFAULT_CHARACTER_MODEL = "fal-ai/flux-pro/kontext";
export const RESIDENT_PORTRAIT_MODEL = "fal-ai/flux-pro";

export const VIDEO_RESOLUTION = "768P" as const;
export const VIDEO_ASPECT = "16:9" as const;
export const VIDEO_DURATION_S = 10;
export const MUSIC_DURATION_S = 60;

export const HOUSE_AUDIO_PATH = "/house/house-audio.mp3";
export const HOUSE_VIDEO_PATHS = [
  "/house/house-01.mp4",
  "/house/house-02.mp4",
  "/house/house-03.mp4",
  "/house/house-04.mp4",
  "/house/house-05.mp4",
  "/house/house-06.mp4",
] as const;
/** Looping wash behind Entrance / creating — reuse a house clip, never the live seeking stage. */
export const ENTRANCE_LOOP_PATH = HOUSE_VIDEO_PATHS[0];

export const CHAT_MAX_LEN = 240;
export const CHAT_RATE_PER_MIN = 20;
export const NAME_MIN = 2;
export const NAME_MAX = 24;
export const CHARACTER_MIN = 12;
export const CHARACTER_MAX = 400;
export const FACE_MAX_BYTES = 4 * 1024 * 1024;

export const CLOCK_TICK_MS = 1000;
export const HEARTBEAT_MS = 15_000;
/** Human disconnect grace: stay in Who's Here / casting until this long without a heartbeat. Residents are never swept. */
export const PRESENCE_STALE_MS = 180_000;

export const QUEUES = {
  character: "bbr-character",
  music: "bbr-music",
  video: "bbr-video",
  finalize: "bbr-finalize",
} as const;

export const REDIS_CHANNELS = {
  roomEvents: "bbr:room:events",
} as const;
