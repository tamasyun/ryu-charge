
-- MVP: allow unsigned visitors to add rooms/outlets, never edit/delete.
-- Anonymous rights are restricted to INSERT and SELECT on existing tables.
grant insert on public.rooms, public.outlets to anon;

create policy "insert_rooms_anonymous"
  on public.rooms
  for insert to anon
  with check (true);

create policy "insert_outlets_anonymous"
  on public.outlets
  for insert to anon
  with check (true);

-- Validate request sizes on the database side, not just in React.
alter table public.rooms
  add constraint rooms_name_length_check
    check (char_length(name) between 1 and 80),
  add constraint rooms_location_length_check
    check (char_length(location_detail) <= 300),
  add constraint rooms_floor_reasonable_check
    check (floor is null or floor between -10 and 40),
  add constraint rooms_id_length_check
    check (char_length(id) between 1 and 80);

alter table public.outlets
  add constraint outlets_location_length_check
    check (char_length(location_detail) between 1 and 300),
  add constraint outlets_ac_ports_limit_check
    check (ac_ports is null or ac_ports between 0 and 50),
  add constraint outlets_id_length_check
    check (char_length(id) between 1 and 80);
