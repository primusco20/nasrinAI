-- Checks for migration 012 (Library). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$
declare f uuid; g uuid; n integer; t text;
begin
  insert into public.library_files (tenant_id, user_id, title, kind, format, chars)
    values ('00000000-0000-0000-0000-000000000001', 'u-lib', 'Budget notes', 'note', 'text', 60) returning id into f;
  insert into public.library_chunks (file_id, tenant_id, user_id, idx, text) values
    (f, '00000000-0000-0000-0000-000000000001', 'u-lib', 0, 'Rent is 12000 pesos a month.'),
    (f, '00000000-0000-0000-0000-000000000001', 'u-lib', 1, 'Groceries come to about 6000.');
  insert into public.library_files (tenant_id, user_id, title, kind, format, chars)
    values ('00000000-0000-0000-0000-000000000001', 'u-other', 'Their rent', 'file', 'text', 20) returning id into g;
  insert into public.library_chunks (file_id, tenant_id, user_id, idx, text) values
    (g, '00000000-0000-0000-0000-000000000001', 'u-other', 0, 'My rent is secret.');

  select count(*), min(s.text) into n, t from public.search_library('00000000-0000-0000-0000-000000000001', 'u-lib', 'rent | pesos', 5) s;
  if n <> 1 or t not like 'Rent is%' then raise exception 'search did not find only the owner''s chunk (%)', n; end if;
  select count(*) into n from public.search_library('00000000-0000-0000-0000-000000000001', 'u-nobody', 'rent', 5);
  if n <> 0 then raise exception 'the Library crossed people'; end if;
  select count(*) into n from public.search_library('11111111-1111-4111-8111-111111111111', 'u-lib', 'rent', 5);
  if n <> 0 then raise exception 'the Library crossed businesses'; end if;

  begin
    insert into public.library_files (tenant_id, user_id, title, kind, format, chars) values ('00000000-0000-0000-0000-000000000001', 'u-lib', 'x', 'exe', 'text', 1);
    raise exception 'an unknown kind was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.library_files (tenant_id, user_id, title, kind, format, chars) values ('00000000-0000-0000-0000-000000000001', '../u', 'x', 'file', 'text', 1);
    raise exception 'a bad user id was accepted';
  exception when check_violation then null; end;
  begin
    update public.library_files set title = 'x' where false;
    raise exception 'files could be edited';
  exception when insufficient_privilege then null; end;

  delete from public.library_files where id = g;
  if exists (select 1 from public.library_chunks where file_id = g) then raise exception 'chunks survived their file'; end if;

  perform public.delete_user_data('00000000-0000-0000-0000-000000000001', 'u-lib');
  if exists (select 1 from public.library_files where user_id = 'u-lib') or exists (select 1 from public.library_chunks where user_id = 'u-lib') then
    raise exception 'the Library survived account deletion';
  end if;
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.library_files; raise exception 'anon could read the Library';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.search_library('00000000-0000-0000-0000-000000000001', 'u-lib', 'rent', 5); raise exception 'anon could search the Library';
exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from public.library_chunks; raise exception 'a signed-in role could read chunks directly';
exception when insufficient_privilege then null; end $$;
reset role;
select 'library checks passed' as result;
