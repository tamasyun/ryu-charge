
alter table public.room_reviews
  add column if not exists delete_key_hash text;

alter table public.room_reviews
  add constraint room_reviews_delete_key_hash_valid
  check (delete_key_hash is null or delete_key_hash ~ '^[0-9a-f]{64}$');

revoke select on public.room_reviews from anon, authenticated;
grant select (id, room_id, rating, comment, created_at)
  on public.room_reviews to anon, authenticated;
grant insert (delete_key_hash)
  on public.room_reviews to anon, authenticated;

create or replace function public.delete_own_room_review(
  p_review_id uuid,
  p_delete_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delete_key is null or p_delete_key !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  delete from public.room_reviews
  where id = p_review_id
    and delete_key_hash = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(p_delete_key, 'UTF8')),
      'hex'
    );

  return found;
end;
$$;

revoke all on function public.delete_own_room_review(uuid,text) from public;
grant execute on function public.delete_own_room_review(uuid,text)
  to anon, authenticated;
