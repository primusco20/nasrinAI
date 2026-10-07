-- Checks for migration 016 (hardening indexes). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
do $$
declare n integer;
begin
  select count(*) into n from pg_indexes
   where schemaname = 'public'
     and indexname in ('knowledge_chunks_doc_id_idx', 'messages_conversation_tenant_idx',
                       'project_tasks_tenant_idx', 'project_chats_tenant_idx', 'project_files_tenant_idx');
  if n <> 5 then raise exception 'expected 5 hardening indexes, found %', n; end if;
end $$;
select 'hardening checks passed' as result;
