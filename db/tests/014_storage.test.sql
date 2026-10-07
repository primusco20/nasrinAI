-- Checks for migration 014 (Storage). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$
declare c uuid; n integer;
begin
  insert into public.conversations (tenant_id, owner_type, owner_id, title, updated_at)
    values ('00000000-0000-0000-0000-000000000001', 'user', 'u-st', 'old chat', now() - interval '40 days') returning id into c;
  insert into public.sent_files (tenant_id, user_id, conversation_id, kind, name, mime, size, bytes)
    values ('00000000-0000-0000-0000-000000000001', 'u-st', c, 'photo', 'a.png', 'image/png', 4, '\x89504e47');
  insert into public.sent_files (tenant_id, user_id, kind, name, mime, size, bytes, created_at)
    values ('00000000-0000-0000-0000-000000000001', 'u-st', 'file', 'old.txt', 'text/plain', 3, '\x616263', now() - interval '40 days');
  insert into public.sent_files (tenant_id, user_id, kind, name, mime, size, bytes)
    values ('00000000-0000-0000-0000-000000000001', 'u-st', 'file', 'new.txt', 'text/plain', 3, '\x616263');
  insert into public.sent_files (tenant_id, user_id, kind, name, mime, size, bytes, created_at)
    values ('00000000-0000-0000-0000-000000000001', 'u-other', 'file', 'theirs.txt', 'text/plain', 3, '\x616263', now() - interval '40 days');

  perform public.purge_user_data_before('00000000-0000-0000-0000-000000000001', 'u-st', now() - interval '30 days');
  if exists (select 1 from public.conversations where id = c) then raise exception 'an old chat survived the purge'; end if;
  if exists (select 1 from public.sent_files where conversation_id = c) then raise exception 'a sent file outlived its chat'; end if;
  if exists (select 1 from public.sent_files where name = 'old.txt') then raise exception 'an old sent file survived the purge'; end if;
  select count(*) into n from public.sent_files where name = 'new.txt';
  if n <> 1 then raise exception 'a recent sent file was purged'; end if;
  select count(*) into n from public.sent_files where name = 'theirs.txt';
  if n <> 1 then raise exception 'the purge crossed people'; end if;

  insert into public.sent_files (tenant_id, user_id, kind, name, mime, size, bytes, created_at)
    values ('00000000-0000-0000-0000-000000000001', 'u-st', 'file', 'keep.txt', 'text/plain', 3, '\x616263', now() - interval '40 days');
  perform public.purge_user_data_before('00000000-0000-0000-0000-000000000001', 'u-st', now() - interval '30 days', true);
  if not exists (select 1 from public.sent_files where name = 'keep.txt') then raise exception 'a pictures-only purge removed a file'; end if;

  begin
    insert into public.sent_files (tenant_id, user_id, kind, name, mime, size, bytes)
      values ('00000000-0000-0000-0000-000000000001', 'u-st', 'video', 'x', 'video/mp4', 1, '\x00');
    raise exception 'an unknown kind was accepted';
  exception when check_violation then null; end;

  perform public.delete_user_data('00000000-0000-0000-0000-000000000001', 'u-st');
  if exists (select 1 from public.sent_files where user_id = 'u-st') then raise exception 'sent files survived account deletion'; end if;
  delete from public.sent_files where user_id = 'u-other';
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.sent_files; raise exception 'anon could read sent files';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.purge_user_data_before('00000000-0000-0000-0000-000000000001', 'u-st', now()); raise exception 'anon could purge';
exception when insufficient_privilege then null; end $$;
reset role;
select 'storage checks passed' as result;
