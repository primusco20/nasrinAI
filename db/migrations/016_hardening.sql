-- NasrinAI hardening follow-up (migration 016)
-- =============================================================================
-- Run after 015. Safe to run again.
-- Fixes live-schema drift/performance findings and aligns the empty media
-- bucket with the server-mediated private-storage architecture.
-- =============================================================================

begin;

-- Cover the foreign keys flagged by Supabase's performance advisor.
create index if not exists knowledge_chunks_doc_id_idx
  on public.knowledge_chunks (doc_id);

create index if not exists messages_conversation_tenant_idx
  on public.messages (conversation_id, tenant_id);

-- The application does not expose direct browser access to storage.
-- The existing media bucket is empty, so making it private is non-destructive.
update storage.buckets
set public = false,
    updated_at = now()
where id = 'media';

commit;
