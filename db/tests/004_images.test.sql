-- Checks for migration 004 (images). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role anon;
do $$ begin
  perform 1 from public.generated_images; raise exception 'anon could read images';
exception when insufficient_privilege then null; end $$;
reset role;
set role service_role;
do $$
declare c uuid; i uuid;
begin
  insert into public.conversations (tenant_id, owner_type, owner_id) values ('00000000-0000-0000-0000-000000000001', 'guest', 'g-img') returning id into c;
  insert into public.generated_images (tenant_id, conversation_id, owner_type, owner_id, mime, bytes, provider, model)
  values ('00000000-0000-0000-0000-000000000001', c, 'guest', 'g-img', 'image/png', decode(repeat('00', 200), 'hex'), 'gemini', 'm') returning id into i;
  delete from public.conversations where id = c;
  if exists (select 1 from public.generated_images where id = i) then raise exception 'image outlived its conversation'; end if;
end $$;
reset role;
select 'images checks passed' as result;
