-- NasrinAI video generation (migration 017)
-- Ultra-only asynchronous video jobs. Final MP4 bytes are owner-scoped and
-- served only through the NasrinAI server.
create table if not exists public.generated_videos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  conversation_id       uuid references public.conversations(id) on delete cascade,
  owner_type            text not null check (owner_type in ('user','guest','service')),
  owner_id              text not null,
  prompt                text not null,
  target_seconds        integer not null check (target_seconds between 1 and 60),
  produced_seconds      integer not null default 0 check (produced_seconds between 0 and 60),
  status                text not null check (status in ('queued','in_progress','completed','failed')),
  provider              text not null,
  provider_operation    text,
  provider_video_uri    text,
  mime                  text,
  bytes                 bytea,
  error_code            text,
  error_message         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists generated_videos_owner_idx
  on public.generated_videos (tenant_id, owner_type, owner_id, created_at desc);

create index if not exists generated_videos_status_idx
  on public.generated_videos (status, updated_at);

alter table public.generated_videos enable row level security;
revoke all on public.generated_videos from anon, authenticated;
grant all on public.generated_videos to service_role;
