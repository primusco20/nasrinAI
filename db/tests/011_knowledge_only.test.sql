-- Checks for migration 011 (knowledge only). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$
declare v_id uuid;
begin
  if (select knowledge_only from public.tenants where id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'the platform must not be knowledge only';
  end if;
  insert into public.tenants (name) values ('Knowledge only test') returning id into v_id;
  if (select knowledge_only from public.tenants where id = v_id) then raise exception 'default must be off'; end if;
  update public.tenants set knowledge_only = true, off_topic_reply = 'Ask me about our services.' where id = v_id;
  begin
    update public.tenants set off_topic_reply = '' where id = v_id;
    raise exception 'an empty reply was accepted';
  exception when check_violation then null; end;
  begin
    update public.tenants set off_topic_reply = repeat('x', 501) where id = v_id;
    raise exception 'a too long reply was accepted';
  exception when check_violation then null; end;
  delete from public.tenants where id = v_id;
end $$;
reset role;
select 'knowledge only checks passed' as result;
