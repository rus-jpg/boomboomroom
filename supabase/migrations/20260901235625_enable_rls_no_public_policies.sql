-- Service-role only. Matches the already-applied remote policy posture.

alter table public.rooms enable row level security;
alter table public.participants enable row level security;
alter table public.room_presence enable row level security;
alter table public.chat_messages enable row level security;
alter table public.dj_queue_entries enable row level security;
alter table public.turns enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.media_assets enable row level security;
alter table public.moderation_events enable row level security;
