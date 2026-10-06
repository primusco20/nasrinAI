-- NasrinAI Projects (migration 013)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-012. Safe to run again.
--
-- A signed-in person's projects: name, description, their own instructions
-- (project context), status and tasks. Chats and Library items can belong to
-- one project (link tables). Deleting a project removes its tasks and the
-- links; the chats and Library items stay, back in the person's general chats
-- and Library. Library search is scoped: a project's chat sees only that
-- project's items, other chats only items outside any project.
-- Only the server (service role) can read these tables.
-- =============================================================================

begin;

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null default '' check (char_length(description) <= 500),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  status       text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (tenant_id, user_id, updated_at desc);

create table if not exists public.project_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  text        text not null check (char_length(text) between 1 and 300),
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists project_tasks_project_idx on public.project_tasks (project_id, created_at);

-- A chat belongs to at most one project.
create table if not exists public.project_chats (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  created_at      timestamptz not null default now()
);
create index if not exists project_chats_project_idx on public.project_chats (project_id);

-- A Library item belongs to at most one project.
create table if not exists public.project_files (
  file_id     uuid primary key references public.library_files(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     text not null check (user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  created_at  timestamptz not null default now()
);
create index if not exists project_files_project_idx on public.project_files (project_id);

-- Library search for one place: p_project null = items outside any project.
create or replace function public.search_library_scoped(p_tenant uuid, p_user text, p_project uuid, p_terms text, p_limit integer)
returns table (file_id uuid, title text, idx integer, text text, rank real)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.file_id, f.title, c.idx, c.text, ts_rank_cd(c.tsv, q, 32) as rank
  from public.library_chunks c
  join public.library_files f on f.id = c.file_id
  left join public.project_files pf on pf.file_id = f.id
  cross join to_tsquery('simple', p_terms) q
  where c.tenant_id = p_tenant and c.user_id = p_user
    and f.tenant_id = p_tenant and f.user_id = p_user
    and ((p_project is null and pf.file_id is null)
         or (p_project is not null and pf.project_id = p_project and pf.tenant_id = p_tenant and pf.user_id = p_user))
    and c.tsv @@ q
  order by rank desc
  limit least(greatest(p_limit, 1), 10);
$$;

-- Account deletion now also removes the person's projects.
create or replace function public.delete_user_data(p_tenant uuid, p_user text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversations where tenant_id = p_tenant and owner_type = 'user' and owner_id = p_user;
  delete from public.user_memories where tenant_id = p_tenant and user_id = p_user;
  delete from public.library_files where tenant_id = p_tenant and user_id = p_user;
  delete from public.projects where tenant_id = p_tenant and user_id = p_user;
  update public.usage_events set actor_id = 'deleted-user' where tenant_id = p_tenant and actor_type = 'user' and actor_id = p_user;
end;
$$;

alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_chats enable row level security;
alter table public.project_files enable row level security;
revoke all on table public.projects, public.project_tasks, public.project_chats, public.project_files from anon, authenticated, service_role;
grant select, insert, update, delete on table public.projects, public.project_tasks to service_role;
grant select, insert, delete on table public.project_chats, public.project_files to service_role;
revoke execute on function public.search_library_scoped(uuid, text, uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_library_scoped(uuid, text, uuid, text, integer) to service_role;
revoke execute on function public.delete_user_data(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.delete_user_data(uuid, text) to service_role;

commit;
