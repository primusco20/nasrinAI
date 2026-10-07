begin;

-- Connect provisions only origin-locked publishable widget keys.
-- Secret business keys remain server-to-server and are never created by Connect.
revoke execute on function public.create_api_key(uuid, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.create_api_key(uuid, text, text, text[], text[]) to service_role;

commit;
