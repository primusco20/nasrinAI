begin;

-- Connect provisions only origin-locked publishable widget keys.
-- Secret business keys remain server-to-server and are never created by Connect.
revoke execute on function public.create_api_key(uuid, text, text, text[], text[]) from public, anon, authenticated, service_role;
-- The general key function is not callable by any API role (it was already
-- locked in migration 001; repeated here so Connect never depends on it).
-- Connect mints keys only through create_connect_publishable_key (migration 020).

commit;
