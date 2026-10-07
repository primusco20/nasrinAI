begin;

-- Connect provisions only origin-locked publishable widget keys.
-- Secret business keys remain server-to-server and are never created by Connect.
revoke execute on function public.create_api_key(uuid, text, text, text[], text[]) from public, anon, authenticated, service_role;
-- The function is intentionally callable only by the privileged database owner/server path.\n-- The service role does not need direct EXECUTE; PostgREST executes through the\n-- authenticated database role configured for the backend.\n

commit;
