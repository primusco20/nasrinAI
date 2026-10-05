-- NasrinAI connector OAuth (migration 010, Phase 6)
-- =============================================================================
-- Run once in the Supabase SQL editor, after 001-009. Safe to run again.
--
-- Connectors can sign in to a business's API with OAuth 2.0 (client
-- credentials): the token address, client id and scope are stored here; the
-- client secret only encrypted in secret_enc, like other keys.
-- =============================================================================

begin;

alter table public.connectors drop constraint if exists connectors_auth_type_check;
alter table public.connectors add constraint connectors_auth_type_check
  check (auth_type in ('none', 'bearer', 'header', 'oauth2'));
alter table public.connectors add column if not exists oauth jsonb
  check (oauth is null or (jsonb_typeof(oauth) = 'object' and octet_length(oauth::text) <= 1000));
alter table public.connectors drop constraint if exists connectors_oauth_settings;
alter table public.connectors add constraint connectors_oauth_settings
  check ((auth_type = 'oauth2') = (oauth is not null));

commit;
