# Boom Boom Room

Multiplayer AI generative music party. One room, 5–20 anonymous casts, open chat, a FIFO 60-second DJ booth, and server-authoritative playback.

Turntable.fm energy: you get the decks, MiniMax Music 3 writes a 60s track, and six parallel MiniMax H3 Max clips (10s, 768P, 16:9) cut rotating participant appearances into the video. House buffers hold the floor while a set generates.

This is the first milestone only — no voting, points, multi-rooms, profiles, playlists, or tipping.

## Architecture

| Piece | Where | Role |
| --- | --- | --- |
| Next.js App Router + TypeScript | Vercel | Cast, room UI, webhooks, signed media |
| Socket.IO turn engine | Railway `realtime` | Presence, chat, FIFO booth, audio master clock |
| BullMQ + FFmpeg workers | Railway `worker` | Character / music / video jobs |
| Redis | Railway | Adapters + job queues |
| Supabase Postgres + Storage | `cokbfdbzvunlrssmivng` | Authoritative rows, `faces` + `media` buckets |

`FAL_KEY` is **server-only**. Never put it in `NEXT_PUBLIC_*`. When it is missing, generation runs in **mock mode** and serves the house stubs.

## Product loop

1. Cast: name, character description, face photo, consent.
2. Character still via `CHARACTER_MODEL_ENDPOINT` (default `fal-ai/flux-pro/kontext`).
3. Join the FIFO booth. When you are up, you have 60s to lock a prompt.
4. Worker submits `minimax/music-3` (webhook) and six `minimax/h3-max/reference-to-video` jobs.
5. Playback is server-authoritative: audio is the master clock; two HTML `<video>` elements crossfade ~250ms at clip boundaries.
6. House audio/video loops whenever no DJ set is ready.

## Local

```bash
cp .env.example .env
# fill SUPABASE_SERVICE_ROLE_KEY (service role — RLS has no public policies)
# REDIS_URL=redis://127.0.0.1:6379
# leave FAL_KEY empty for mock generation

docker compose up redis -d
npm install
npm run house:assets
npm run dev:all
```

- Web: http://localhost:3000
- Realtime: http://localhost:4000/health
- Worker: http://localhost:4100/health

Without Redis, mock character generation still completes inline on `/api/cast` (local only). On Vercel, `/api/cast` never waits on Redis — it inserts a `queued` row and the Railway worker claims it.

## Railway

Empty services already exist on project `683b04a0-1ace-402b-a822-fde3ca4523ed`:

| Service | Start | Config |
| --- | --- | --- |
| `realtime` | `npm run start:realtime` or `scripts/start-realtime.sh` | `railway.realtime.json` |
| `worker` | `npm run start:worker` or `scripts/start-worker.sh` | `railway.worker.json` |

Set on both services (and share Redis):

```
REDIS_URL=${{Redis.REDIS_URL}}
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=https://cokbfdbzvunlrssmivng.supabase.co
SESSION_SECRET=
APP_URL=https://<vercel-host>
WEBHOOK_BASE_URL=https://<vercel-host>
FAL_KEY=                 # optional; mock if empty
CHARACTER_MODEL_ENDPOINT=fal-ai/flux-pro/kontext
MODERATOR_SECRET=
```

Point `railwayConfigFile` at `railway.realtime.json` / `railway.worker.json`. Worker image includes FFmpeg.

## Vercel

Create the project from this repo (team **Pika** / `team_pSsw74HAimXgS0MVLh6zTIEO`). Required env:

```
NEXT_PUBLIC_SUPABASE_URL=https://cokbfdbzvunlrssmivng.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_REALTIME_URL=https://<railway-realtime>
SUPABASE_SERVICE_ROLE_KEY=
SESSION_SECRET=
APP_URL=
WEBHOOK_BASE_URL=
FAL_KEY=
CHARACTER_MODEL_ENDPOINT=fal-ai/flux-pro/kontext
MODERATOR_SECRET=
```

Do **not** point Vercel at Railway private Redis (`*.railway.internal`). Cast inserts `generation_jobs` as `queued`; the worker claims those rows over the private network.

Fal webhooks hit `POST /api/webhooks/fal`. Moderators call `POST /api/moderate` with `x-moderator-secret`.

## Supabase

Schema + RLS are already applied (`rooms`, `participants`, `room_presence`, `chat_messages`, `dj_queue_entries`, `turns`, `generation_jobs`, `media_assets`, `moderation_events`). Room slug `main` is seeded.

`supabase/migrations` replay that schema with `IF NOT EXISTS` / enum guards so a fresh local stack works and the remote project is a no-op.

There are **no public RLS policies**. The app uses the service role on the server. The anon key is only for client bootstrapping if you add Supabase Realtime later.

## House stubs

`public/house/house-audio.mp3` — 60s generated four-on-the-floor bed  
`public/house/house-01.mp4` … `house-06.mp4` — 10s 1280×720 color washes  

Replace the files in place when you have real house masters.

## Out of scope (later milestones)

Voting, points, multiple rooms, persistent profiles, playlists, tipping.
