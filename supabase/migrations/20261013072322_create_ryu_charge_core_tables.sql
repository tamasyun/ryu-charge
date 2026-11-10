
-- Building -> Room -> Outlet. IDs remain compatible with src/data/spots.json.
create table public.buildings (
  id text primary key,
  name text not null check (length(btrim(name)) > 0),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180)
);

create table public.rooms (
  id text primary key,
  building_id text not null references public.buildings(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  floor integer,
  location_detail text not null default ''
);

create index rooms_building_id_idx on public.rooms (building_id);

create table public.outlets (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  location_detail text not null check (length(btrim(location_detail)) > 0),
  ac_ports integer check (ac_ports >= 0)
);

create index outlets_room_id_idx on public.outlets (room_id);

-- Enable RLS for the Data API.
alter table public.buildings enable row level security;
alter table public.rooms enable row level security;
alter table public.outlets enable row level security;

-- Give Data API roles only the required privileges.
revoke all on table public.buildings, public.rooms, public.outlets from anon, authenticated;
grant select on table public.buildings, public.rooms, public.outlets to anon, authenticated;
grant insert on table public.rooms, public.outlets to authenticated;

create policy "read_buildings" on public.buildings
  for select to anon, authenticated using (true);
create policy "read_rooms" on public.rooms
  for select to anon, authenticated using (true);
create policy "read_outlets" on public.outlets
  for select to anon, authenticated using (true);

create policy "insert_rooms_authenticated" on public.rooms
  for insert to authenticated
  with check (auth.uid() is not null);
create policy "insert_outlets_authenticated" on public.outlets
  for insert to authenticated
  with check (auth.uid() is not null);
