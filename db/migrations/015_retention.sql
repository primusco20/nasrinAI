-- NasrinAI retention scheduler (migration 015)
-- =============================================================================
-- Run after 014. Safe to run again.
--
-- The user's retention preference is stored in Supabase Auth metadata
-- (nasrin_prefs.retention). This function is the single server-side source of
-- truth for automatic deletion. It is intentionally idempotent.
-- =============================================================================

begin;

create or replace function public.purge_retention()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u record;
  keep_days integer;
  cutoff timestamptz;
begin
  -- Guest sessions are always 24 hours.
  delete from public.conversations
    where owner_type = 'guest'
      and expires_at is not null
      and expires_at < now();

  -- Old rate-limit counters are operational metadata, not user content.
  delete from public.rate_counters
    where window_start < now() - interval '2 days';

  -- Each signed-in user's preference controls chats/files/sent files and
  -- generated pictures. A null preference keeps chats/files but uses the
  -- configured 30-day picture default. Zero means keep until the user deletes.
  for u in
    select id, raw_user_meta_data
    from auth.users
  loop
    keep_days := case
      when jsonb_typeof(
        u.raw_user_meta_data->'nasrin_prefs'->'retention'
      ) = 'number'
      and (u.raw_user_meta_data->'nasrin_prefs'->>'retention') ~ '^[0-9]{1,4}$'
      and (u.raw_user_meta_data->'nasrin_prefs'->>'retention')::integer between 0 and 3650
      then (u.raw_user_meta_data->'nasrin_prefs'->>'retention')::integer
      else null
    end;

    if keep_days is not null and keep_days > 0 then
      cutoff := now() - make_interval(days => keep_days);

      delete from public.conversations
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and owner_type = 'user'
          and owner_id = u.id::text
          and updated_at < cutoff;

      delete from public.library_files
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and user_id = u.id::text
          and created_at < cutoff;

      delete from public.sent_files
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and user_id = u.id::text
          and created_at < cutoff;

      delete from public.generated_images
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and owner_type = 'user'
          and owner_id = u.id::text
          and created_at < cutoff;

    elsif keep_days is null then
      -- Standard preference: chats/files remain until user deletes them;
      -- generated pictures use IMAGE_RETENTION_DAYS = 30.
      cutoff := now() - interval '30 days';

      delete from public.generated_images
        where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and owner_type = 'user'
          and owner_id = u.id::text
          and created_at < cutoff;
    end if;
  end loop;

  -- Service-owned generated images follow the same 30-day operational default.
  delete from public.generated_images
    where owner_type = 'service'
      and created_at < now() - interval '30 days';
end;
$$;

revoke execute on function public.purge_retention() from public, anon, authenticated, service_role;
grant execute on function public.purge_retention() to service_role;

commit;
