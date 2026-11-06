
create table public.building_reviews (
  id uuid primary key default gen_random_uuid(),
  building_id text not null references public.buildings(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(btrim(comment)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index building_reviews_building_id_created_at_idx
  on public.building_reviews (building_id, created_at desc);
alter table public.building_reviews enable row level security;
revoke all on table public.building_reviews from anon, authenticated;
grant select, insert on table public.building_reviews to anon, authenticated;
create policy "read_building_reviews"
  on public.building_reviews
  for select to anon, authenticated using (true);
create policy "insert_building_reviews"
  on public.building_reviews
  for insert to anon, authenticated with check (true);
