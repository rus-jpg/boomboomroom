-- Tag generated clips with booth vs floor role so house turns can
-- select only the labeled DJ's booth takes.
alter table public.media_assets
  add column if not exists role text;

create index if not exists media_house_unused_role_idx
  on public.media_assets (kind, turn_id, role, participant_id)
  where kind = 'house_video';
