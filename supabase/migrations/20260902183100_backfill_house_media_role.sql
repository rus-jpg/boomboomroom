-- Backfill house clip roles from the generation job that produced them.
-- Matches promoted storage paths (`.../house/video/<jobId>.mp4`) and the original fal URL.
update public.media_assets m
set role = j.payload->>'role'
from public.generation_jobs j
where m.kind = 'house_video'
  and m.role is null
  and j.kind = 'video'
  and coalesce(j.payload->>'house', '') = 'true'
  and j.payload->>'role' in ('dj', 'dancer', 'crowd', 'booth', 'floor')
  and (
    m.storage_key like '%/' || j.id::text || '.mp4'
    or m.storage_key = coalesce(
      j.result->'video'->>'url',
      j.result->'data'->'video'->>'url',
      j.result->'payload'->'video'->>'url'
    )
  );
