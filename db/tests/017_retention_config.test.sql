-- Checks for migration 017: configured image retention reaches the SQL purge.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeeeee-0000-4000-8000-000000000017', 'retention017@example.com', '{}')
on conflict (id) do nothing;

insert into public.conversations (tenant_id, owner_type, owner_id, title, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', 'user', 'eeeeeeee-0000-4000-8000-000000000017', '017 user image owner', now(), now()),
  ('00000000-0000-0000-0000-000000000001', 'service', 'retention-test', '017 service image owner', now(), now());

insert into public.generated_images
  (tenant_id, conversation_id, owner_type, owner_id, mime, bytes, provider, model, created_at)
select c.tenant_id, c.id, v.owner_type, v.owner_id, 'image/png', decode(repeat('00', 100), 'hex'),
       'test', 'test-model', v.created_at
from public.conversations c
join (values
  ('user'::text, 'eeeeeeee-0000-4000-8000-000000000017'::text, '017 user old'::text, now() - interval '10 days'),
  ('user'::text, 'eeeeeeee-0000-4000-8000-000000000017'::text, '017 user recent'::text, now() - interval '5 days'),
  ('service'::text, 'retention-test'::text, '017 service old'::text, now() - interval '10 days'),
  ('service'::text, 'retention-test'::text, '017 service recent'::text, now() - interval '5 days')
) as v(owner_type, owner_id, label, created_at)
  on c.owner_type = v.owner_type and c.owner_id = v.owner_id;

-- Run with the configured seven-day value as production does.
set role service_role;
select public.purge_retention(7);
reset role;

do $$
begin
  if exists (
    select 1 from public.generated_images
    where owner_id in ('eeeeeeee-0000-4000-8000-000000000017', 'retention-test')
      and created_at < now() - interval '7 days'
  ) then raise exception 'an image older than configured seven-day retention survived'; end if;
  if not exists (
    select 1 from public.generated_images
    where owner_id = 'eeeeeeee-0000-4000-8000-000000000017'
      and created_at > now() - interval '7 days'
  ) then raise exception 'a recent user image was deleted'; end if;
  if not exists (
    select 1 from public.generated_images
    where owner_id = 'retention-test'
      and created_at > now() - interval '7 days'
  ) then raise exception 'a recent service image was deleted'; end if;
end $$;

delete from public.conversations where title like '017 %';
delete from public.conversations where owner_id = 'retention-test';
delete from auth.users where email = 'retention017@example.com';
select 'configured retention checks passed' as result;
