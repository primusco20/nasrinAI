-- Checks for migration 015 (retention scheduler). Run via db/tests/run.sh.
\set ON_ERROR_STOP on

-- People with different keep-time choices, and one chat each (plus guests).
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000015', 'keep7@example.com',    '{"nasrin_prefs":{"retention":7}}'),
  ('bbbbbbbb-0000-4000-8000-000000000015', 'standard@example.com', '{}'),
  ('cccccccc-0000-4000-8000-000000000015', 'forever@example.com',  '{"nasrin_prefs":{"retention":0}}'),
  ('dddddddd-0000-4000-8000-000000000015', 'badpref@example.com',  '{"nasrin_prefs":{"retention":"7"}}')
on conflict (id) do nothing;

insert into public.conversations (tenant_id, owner_type, owner_id, title, created_at, updated_at, expires_at) values
  ('00000000-0000-0000-0000-000000000001', 'guest', 'g-015-old', '015 guest expired', now() - interval '3 days',   now() - interval '3 days',   now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'guest', 'g-015-new', '015 guest live',    now(),                       now(),                       now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000000001', 'user', 'aaaaaaaa-0000-4000-8000-000000000015', '015 keep7 old',    now() - interval '10 days',  now() - interval '10 days',  null),
  ('00000000-0000-0000-0000-000000000001', 'user', 'aaaaaaaa-0000-4000-8000-000000000015', '015 keep7 recent', now() - interval '1 day',    now() - interval '1 day',    null),
  ('00000000-0000-0000-0000-000000000001', 'user', 'bbbbbbbb-0000-4000-8000-000000000015', '015 standard old', now() - interval '400 days', now() - interval '400 days', null),
  ('00000000-0000-0000-0000-000000000001', 'user', 'cccccccc-0000-4000-8000-000000000015', '015 forever old',  now() - interval '400 days', now() - interval '400 days', null),
  ('00000000-0000-0000-0000-000000000001', 'user', 'dddddddd-0000-4000-8000-000000000015', '015 badpref old',  now() - interval '400 days', now() - interval '400 days', null);

-- The browser roles cannot run it.
set role anon;
do $$ begin
  perform public.purge_retention(); raise exception 'anon could run the purge';
exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin
  perform public.purge_retention(); raise exception 'authenticated could run the purge';
exception when insufficient_privilege then null; end $$;
reset role;

-- The server role can, and it removes only what each preference allows.
set role service_role;
select public.purge_retention();
reset role;

do $$
declare gone text[] := array['015 guest expired', '015 keep7 old'];
        kept text[] := array['015 guest live', '015 keep7 recent', '015 standard old', '015 forever old', '015 badpref old'];
        t text;
begin
  foreach t in array gone loop
    if exists (select 1 from public.conversations where title = t) then raise exception 'purge kept "%"', t; end if;
  end loop;
  foreach t in array kept loop
    if not exists (select 1 from public.conversations where title = t) then raise exception 'purge deleted "%"', t; end if;
  end loop;
end $$;

delete from public.conversations where title like '015 %';
delete from auth.users where email in ('keep7@example.com', 'standard@example.com', 'forever@example.com', 'badpref@example.com');
select 'retention checks passed' as result;
