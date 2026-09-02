-- Resident house crew: NPC DJs that fill an empty room.
alter table public.participants
  add column if not exists is_resident boolean not null default false;

create index if not exists participants_resident_idx
  on public.participants (is_resident)
  where is_resident;
