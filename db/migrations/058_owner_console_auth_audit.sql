-- Platform-wide aggregate authentication audit signals for the Owner Console.
-- Reads only coarse event categories from Supabase Auth's audit log. No IPs,
-- email addresses, actor IDs, user agents, or raw payloads leave this function.

begin;

create or replace function public.owner_console_auth_audit_summary(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $owner_auth_audit$
declare
  v_result jsonb;
begin
  if p_since is null or p_since > now() or p_since < now() - interval '90 days' then
    raise exception 'p_since must be within the last 90 days';
  end if;

  -- Supabase Auth's audit log may not be exposed in every compatible environment.
  -- Return an explicit unavailable state rather than breaking the Owner Console.
  if to_regclass('auth.audit_log_entries') is null then
    return jsonb_build_object(
      'available', false,
      'window_start', p_since,
      'window_end', now(),
      'event_count', 0,
      'sign_in_events', 0,
      'account_recovery_events', 0,
      'password_change_events', 0,
      'sign_out_events', 0,
      'last_event_at', null,
      'by_category', '[]'::jsonb
    );
  end if;

  execute $query$
    with normalized as (
      select created_at,
        case
          when lower(coalesce(payload->>'action', '')) in ('login', 'token_refreshed', 'token_refresh') then 'sign_in'
          when lower(coalesce(payload->>'action', '')) like '%recovery%' then 'account_recovery'
          when lower(coalesce(payload->>'action', '')) like '%password%' then 'password_change'
          when lower(coalesce(payload->>'action', '')) in ('logout', 'user_signedout') then 'sign_out'
          else 'other'
        end as category
      from auth.audit_log_entries
      where created_at >= $1
    )
    select jsonb_build_object(
      'available', true,
      'window_start', $1,
      'window_end', now(),
      'event_count', count(*),
      'sign_in_events', count(*) filter (where category = 'sign_in'),
      'account_recovery_events', count(*) filter (where category = 'account_recovery'),
      'password_change_events', count(*) filter (where category = 'password_change'),
      'sign_out_events', count(*) filter (where category = 'sign_out'),
      'last_event_at', max(created_at),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', grouped.category, 'events', grouped.events) order by grouped.category)
        from (
          select category, count(*) as events
          from normalized
          group by category
        ) grouped
      ), '[]'::jsonb)
    )
    from normalized
  $query$ into v_result using p_since;

  return v_result;
exception
  when undefined_table or undefined_column then
    return jsonb_build_object(
      'available', false,
      'window_start', p_since,
      'window_end', now(),
      'event_count', 0,
      'sign_in_events', 0,
      'account_recovery_events', 0,
      'password_change_events', 0,
      'sign_out_events', 0,
      'last_event_at', null,
      'by_category', '[]'::jsonb
    );
end;
$owner_auth_audit$;

revoke execute on function public.owner_console_auth_audit_summary(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_console_auth_audit_summary(timestamptz) to service_role;

commit;
