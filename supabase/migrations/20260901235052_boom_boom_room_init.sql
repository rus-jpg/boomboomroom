-- Compatible replay of the already-applied remote schema.
-- Safe on a fresh database; no-ops / IF NOT EXISTS on the provisioned project.

create extension if not exists pgcrypto;

do $$ begin
  create type public.participant_status as enum ('processing', 'ready', 'blocked');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.chat_kind as enum ('chat', 'system');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.queue_status as enum ('waiting', 'preparing', 'submitted', 'playing', 'done', 'skipped');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.turn_kind as enum ('house', 'dj');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.generation_status as enum ('draft', 'generating', 'ready', 'playing', 'complete', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.job_kind as enum ('character', 'music', 'video');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.job_status as enum ('queued', 'running', 'complete', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.media_kind as enum ('face', 'character', 'audio', 'video', 'house_audio', 'house_video');
exception when duplicate_object then null;
end $$;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  house_epoch timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text unique not null,
  display_name text not null,
  character_prompt text not null,
  original_face_url text,
  character_reference_url text,
  status public.participant_status not null default 'processing',
  regenerate_used boolean not null default false,
  ip_hash text,
  muted_until timestamptz,
  banned_until timestamptz,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.room_presence (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  socket_id text not null,
  connected_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  body text not null,
  kind public.chat_kind not null default 'chat',
  created_at timestamptz not null default now()
);

create table if not exists public.dj_queue_entries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status public.queue_status not null default 'waiting',
  created_at timestamptz not null default now()
);

create table if not exists public.turns (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  dj_participant_id uuid references public.participants(id) on delete set null,
  kind public.turn_kind not null,
  music_prompt text,
  starts_at timestamptz,
  ends_at timestamptz,
  audio_url text,
  video_segment_urls jsonb default '[]'::jsonb,
  generation_status public.generation_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid references public.turns(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  kind public.job_kind not null,
  status public.job_status not null default 'queued',
  fal_request_id text,
  payload jsonb default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  kind public.media_kind not null,
  storage_key text not null,
  content_type text not null,
  duration_ms integer,
  participant_id uuid references public.participants(id) on delete set null,
  turn_id uuid references public.turns(id) on delete set null,
  visibility text not null default 'signed',
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  actor_participant_id uuid references public.participants(id) on delete set null,
  target_participant_id uuid references public.participants(id) on delete set null,
  reason text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists participants_status_idx on public.participants (status);
create index if not exists presence_room_idx on public.room_presence (room_id);
create index if not exists presence_socket_idx on public.room_presence (socket_id);
create index if not exists chat_room_created_idx on public.chat_messages (room_id, created_at);
create index if not exists queue_room_status_idx on public.dj_queue_entries (room_id, status, created_at);
create index if not exists turns_room_status_idx on public.turns (room_id, generation_status);
create index if not exists jobs_status_kind_idx on public.generation_jobs (status, kind);
create index if not exists media_key_idx on public.media_assets (storage_key);

insert into public.rooms (slug, name, house_epoch)
values ('main', 'Boom Boom Room', now())
on conflict (slug) do nothing;
