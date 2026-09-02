-- Persist booth compose start so Railway restarts don't fall back to queue join time.
alter table public.dj_queue_entries
  add column if not exists preparing_at timestamptz;
