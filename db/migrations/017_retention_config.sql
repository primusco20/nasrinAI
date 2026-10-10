-- NasrinAI retention architecture correction (migration 017)
-- =============================================================================
-- Pass the deployed IMAGE_RETENTION_DAYS setting to the one authoritative
-- scheduled purge. Migration 015's fixed 30-day SQL value could override the
-- server setting for inactive users.
--
-- The zero-argument wrapper remains for compatibility with existing SQL tests
-- and manual operations; production calls the parameterized function.
-- =============================================================================

begin;

create or replace function public.purge_retention(p_image_retention_days integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u record;
  keep_days integer;
  image_days integer;
  cutoff timestamptz;
begin
  if p_image_retention_days is null or p_image_retention_days < 0 or p_image_retention_days > 3650 then
    raise exception 'purge_retention: image retention must be between 0 and 3650 days';
  end if;
  image_days := p_image_retention_days;

  -- Guest conversations have their own short expiry (normally 24 hours).
  delete from public.conversations
    where owner_type = 'guest'
      and expires_at is not null
      and expires_at < now();

  -- Operational metadata has independent, fixed retention periods.
  delete from public.rate_counters
    where window_start < now() - interval '2 days';
  delete from public.usage_events
    where created_at < now() - interval '24 months';

  -- Signed-in data uses the retention choice in the user's Auth metadata.
  for u in
    select id, raw_user_meta_data
    from auth.users
  loop
    keep_days := case
      when jsonb_typeof(u.raw_user_meta_data->'nasrin_prefs'->'retention') = 'number'
       and (u.raw_user_meta_data->'nasrin_prefs'->>'retention') ~ '^[0-9]{1,4}$'
       and (u.raw_user_meta_data->'nasrin_prefs'->>'retention')::integer between 0 and 3650
      then (u.raw_user_meta_data->'nasrin_prefs'->>'retention')::integer
      else null
    end;

    if keep_days is not null and keep_days > 0 then
      cutoff := now() - make_interval(days => keep_days);
      delete from public.conversations
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and owner_type = 'user' and owner_id = u.id::text and updated_at < cutoff;
      delete from public.library_files
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and user_id = u.id::text and created_at < cutoff;
      delete from public.sent_files
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and user_id = u.id::text and created_at < cutoff;
      delete from public.generated_images
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and owner_type = 'user' and owner_id = u.id::text and created_at < cutoff;
    elsif keep_days is null and image_days > 0 then
      -- Standard preference: chats/files stay until deleted; images follow the
      -- deployed IMAGE_RETENTION_DAYS value. Zero means no automatic image purge.
      cutoff := now() - make_interval(days => image_days);
      delete from public.generated_images
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and owner_type = 'user' and owner_id = u.id::text and created_at < cutoff;
    end if;
  end loop;

  if image_days > 0 then
    delete from public.generated_images
      where owner_type = 'service'
        and created_at < now() - make_interval(days => image_days);
  end if;
end;
$$;

create or replace function public.purge_retention()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.purge_retention(30);
$$;

revoke execute on function public.purge_retention() from public, anon, authenticated, service_role;
revoke execute on function public.purge_retention(integer) from public, anon, authenticated, service_role;
grant execute on function public.purge_retention() to service_role;
grant execute on function public.purge_retention(integer) to service_role;

commit;
