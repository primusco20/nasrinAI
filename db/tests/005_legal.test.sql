-- Checks for migration 005 (legal). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$
declare c uuid;
begin
  insert into public.legal_acceptances (tenant_id, user_id, document, version, action, method)
  values ('00000000-0000-0000-0000-000000000001', 'u-del', 'terms', 'v1', 'accepted', 'signin');
  begin
    update public.legal_acceptances set version = 'v0' where user_id = 'u-del';
    raise exception 'acceptance records could be edited';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.legal_acceptances where user_id = 'u-del';
    raise exception 'acceptance records could be deleted';
  exception when insufficient_privilege then null; end;

  insert into public.conversations (tenant_id, owner_type, owner_id) values ('00000000-0000-0000-0000-000000000001', 'user', 'u-del') returning id into c;
  insert into public.messages (conversation_id, tenant_id, role, content) values (c, '00000000-0000-0000-0000-000000000001', 'user', 'private words');
  insert into public.usage_events (tenant_id, actor_type, actor_id, provider, model, outcome) values ('00000000-0000-0000-0000-000000000001', 'user', 'u-del', 'openai', 'm', 'ok');
  perform public.delete_user_data('00000000-0000-0000-0000-000000000001', 'u-del');
  if exists (select 1 from public.messages where content = 'private words') then raise exception 'messages survived deletion'; end if;
  if exists (select 1 from public.usage_events where actor_id = 'u-del') then raise exception 'usage still names the user'; end if;
  if not exists (select 1 from public.legal_acceptances where user_id = 'u-del') then raise exception 'acceptance proof was lost'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.legal_acceptances; raise exception 'anon could read acceptances';
exception when insufficient_privilege then null; end $$;
reset role;
select 'legal checks passed' as result;
