-- Checks for migration 009 (knowledge, memory). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$
declare d uuid; n integer; t text;
begin
  insert into public.knowledge_docs (tenant_id, title, who, chars) values ('00000000-0000-0000-0000-000000000001', 'Menu', array['guest'], 40) returning id into d;
  insert into public.knowledge_chunks (doc_id, tenant_id, idx, text) values
    (d, '00000000-0000-0000-0000-000000000001', 0, 'Adobo with rice costs 120 pesos. Open daily 8am to 9pm.'),
    (d, '00000000-0000-0000-0000-000000000001', 1, 'Sinigang na baboy is our Sunday special.');
  select count(*), min(s.text) into n, t from public.search_knowledge('00000000-0000-0000-0000-000000000001', 'adobo | price', 'guest', 5) s;
  if n <> 1 or t not like 'Adobo%' then raise exception 'search did not find the adobo chunk (%)', n; end if;
  select count(*) into n from public.search_knowledge('00000000-0000-0000-0000-000000000001', 'adobo', 'service', 5);
  if n <> 0 then raise exception 'a guest-only document was shown to another audience'; end if;
  select count(*) into n from public.search_knowledge('11111111-1111-4111-8111-111111111111', 'adobo', 'guest', 5);
  if n <> 0 then raise exception 'knowledge crossed businesses'; end if;
  begin
    insert into public.knowledge_docs (tenant_id, title, who, chars) values ('00000000-0000-0000-0000-000000000001', 'x', array['admin'], 1);
    raise exception 'an unknown audience was accepted';
  exception when check_violation then null; end;

  insert into public.user_memories (tenant_id, user_id, text) values ('00000000-0000-0000-0000-000000000001', 'u-mem', 'I am vegetarian');
  perform public.delete_user_data('00000000-0000-0000-0000-000000000001', 'u-mem');
  if exists (select 1 from public.user_memories where user_id = 'u-mem') then raise exception 'memories survived account deletion'; end if;
  begin
    update public.user_memories set text = 'x' where false;
    raise exception 'memories could be edited';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.user_memories; raise exception 'anon could read memories';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.search_knowledge('00000000-0000-0000-0000-000000000001', 'adobo', 'guest', 5); raise exception 'anon could search knowledge';
exception when insufficient_privilege then null; end $$;
reset role;
select 'knowledge and memory checks passed' as result;
