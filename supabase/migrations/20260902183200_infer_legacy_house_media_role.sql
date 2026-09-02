-- Infer role for older house clips from the job seq (legacy: booth was seq % 6 = 0).
-- Newer jobs already store payload.role; this only fills remaining nulls.
update public.media_assets m
set role = case
  when abs((j.payload->>'seq')::bigint) % 6 = 0 then 'dj'
  when j.participant_id is not null then 'dancer'
  else 'crowd'
end
from public.generation_jobs j
where m.kind = 'house_video'
  and m.role is null
  and j.kind = 'video'
  and coalesce(j.payload->>'house', '') = 'true'
  and j.payload->>'seq' ~ '^[0-9]+$'
  and (
    m.storage_key like '%/' || j.id::text || '.mp4'
    or m.storage_key = coalesce(
      j.result->'video'->>'url',
      j.result->'data'->'video'->>'url',
      j.result->'payload'->'video'->>'url'
    )
  );
