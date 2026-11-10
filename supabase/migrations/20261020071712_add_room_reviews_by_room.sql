
create table if not exists public.room_reviews (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(btrim(comment)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists room_reviews_room_id_created_at_idx
  on public.room_reviews (room_id, created_at desc);

alter table public.room_reviews enable row level security;

revoke all on public.room_reviews from anon, authenticated;
grant select on public.room_reviews to anon, authenticated;
grant insert (room_id, rating, comment) on public.room_reviews to anon, authenticated;

create policy "read_room_reviews" on public.room_reviews
  for select to anon, authenticated using (true);
create policy "insert_room_reviews" on public.room_reviews
  for insert to anon, authenticated with check (true);
