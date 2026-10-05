-- Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

-- @@ VERBATIM migration_v4_chat_language_theme.sql:1-26 | Adds chat_multilang_enabled column (whole file)
-- migration_v4_chat_language_theme.sql
-- Run once in Supabase > SQL Editor. Safe to run again (idempotent).
-- Adds: smart-chat multi-language switch + customer-app gradient theme.
-- Both switches default to OFF, so nothing changes until the owner turns them on.

alter table public.store_settings add column if not exists chat_multilang_enabled boolean not null default false;
alter table public.store_settings add column if not exists theme_enabled          boolean not null default false;
alter table public.store_settings add column if not exists theme_color_1          text    not null default '#f59e0b';
alter table public.store_settings add column if not exists theme_color_2          text    not null default '#ef4444';
alter table public.store_settings add column if not exists theme_color_3          text    not null default '#8b5cf6';
alter table public.store_settings add column if not exists theme_top_opacity      int     not null default 85;
alter table public.store_settings add column if not exists theme_bottom_opacity   int     not null default 0;

-- Guard rails: only real #rrggbb colors and 0-100 percentages can be stored,
-- so a bad value can never reach the customer app's stylesheet.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'store_settings_theme_valid') then
    alter table public.store_settings add constraint store_settings_theme_valid check (
      theme_color_1 ~* '^#[0-9a-f]{6}$' and theme_color_2 ~* '^#[0-9a-f]{6}$' and theme_color_3 ~* '^#[0-9a-f]{6}$'
      and theme_top_opacity between 0 and 100 and theme_bottom_opacity between 0 and 100);
  end if;
end $$;

-- No new policy needed: the existing store_settings public-read and crew-update
-- policies already cover these columns, and Realtime already publishes the table.
-- @@ END VERBATIM
