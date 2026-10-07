-- NasrinAI hardening follow-up (migration 016)
-- Safe to run repeatedly.

begin;

create index if not exists knowledge_chunks_doc_id_idx
  on public.knowledge_chunks (doc_id);

create index if not exists messages_conversation_tenant_idx
  on public.messages (conversation_id, tenant_id);

create index if not exists project_tasks_tenant_idx
  on public.project_tasks (tenant_id);

create index if not exists project_chats_tenant_idx
  on public.project_chats (tenant_id);

create index if not exists project_files_tenant_idx
  on public.project_files (tenant_id);

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set public = false,
           updated_at = now()
     where id = 'media';
  end if;
end $$;

commit;
