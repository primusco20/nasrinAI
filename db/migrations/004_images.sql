-- NasrinAI generated images (migration 004)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-003. Safe to run again.
--
-- Images Nasrin makes are kept here, private: only the NasrinAI server (service
-- role) can read them, and it shows each one only to its owner. Each image
-- belongs to a conversation and is deleted with it (guest chats expire after
-- 24 hours). No prompt text is stored here; the conversation holds it.
-- =============================================================================

begin;

create table if not exists public.generated_images (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_type      text not null check (owner_type in ('user', 'guest', 'service')),
  owner_id        text not null check (char_length(owner_id) between 1 and 80),
  mime            text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  bytes           bytea not null check (octet_length(bytes) between 100 and 8000000),
  provider        text not null check (char_length(provider) between 1 and 40),
  model           text not null check (char_length(model) between 1 and 80),
  created_at      timestamptz not null default now()
);
create index if not exists generated_images_owner_idx on public.generated_images (tenant_id, owner_type, owner_id, created_at desc);
create index if not exists generated_images_conversation_idx on public.generated_images (conversation_id);

alter table public.generated_images enable row level security;
revoke all on table public.generated_images from anon, authenticated;
grant select, insert, delete on table public.generated_images to service_role;

commit;
