-- Checks for migration 013 (Projects). Run via db/tests/run.sh.
\set ON_ERROR_STOP on
set role service_role;
do $$
declare t constant uuid := '00000000-0000-0000-0000-000000000001';
declare p uuid; q uuid; c uuid; f_in uuid; f_out uuid; f_other uuid; n integer; s text;
begin
  insert into public.projects (tenant_id, user_id, name, instructions) values (t, 'u-pr', 'Cafe launch', 'Use Filipino pesos.') returning id into p;
  insert into public.projects (tenant_id, user_id, name) values (t, 'u-pr', 'Thesis') returning id into q;
  insert into public.project_tasks (project_id, tenant_id, user_id, text) values (p, t, 'u-pr', 'Find a supplier');
  update public.project_tasks set done = true where project_id = p;

  insert into public.conversations (tenant_id, owner_type, owner_id) values (t, 'user', 'u-pr') returning id into c;
  insert into public.project_chats (conversation_id, project_id, tenant_id, user_id) values (c, p, t, 'u-pr');
  begin
    insert into public.project_chats (conversation_id, project_id, tenant_id, user_id) values (c, q, t, 'u-pr');
    raise exception 'a chat joined two projects';
  exception when unique_violation then null; end;

  insert into public.library_files (tenant_id, user_id, title, kind, format, chars) values (t, 'u-pr', 'menu.txt', 'file', 'text', 30) returning id into f_in;
  insert into public.library_chunks (file_id, tenant_id, user_id, idx, text) values (f_in, t, 'u-pr', 0, 'Coffee costs 120 pesos.');
  insert into public.project_files (file_id, project_id, tenant_id, user_id) values (f_in, p, t, 'u-pr');
  insert into public.library_files (tenant_id, user_id, title, kind, format, chars) values (t, 'u-pr', 'notes.txt', 'file', 'text', 30) returning id into f_out;
  insert into public.library_chunks (file_id, tenant_id, user_id, idx, text) values (f_out, t, 'u-pr', 0, 'Coffee beans from Batangas.');
  insert into public.library_files (tenant_id, user_id, title, kind, format, chars) values (t, 'u-other', 'theirs.txt', 'file', 'text', 30) returning id into f_other;
  insert into public.library_chunks (file_id, tenant_id, user_id, idx, text) values (f_other, t, 'u-other', 0, 'Coffee secret.');

  select count(*), min(x.title) into n, s from public.search_library_scoped(t, 'u-pr', p, 'coffee', 10) x;
  if n <> 1 or s <> 'menu.txt' then raise exception 'project search saw the wrong items (% %)', n, s; end if;
  select count(*), min(x.title) into n, s from public.search_library_scoped(t, 'u-pr', null, 'coffee', 10) x;
  if n <> 1 or s <> 'notes.txt' then raise exception 'general search saw project items (% %)', n, s; end if;
  select count(*) into n from public.search_library_scoped(t, 'u-pr', q, 'coffee', 10);
  if n <> 0 then raise exception 'one project saw another project''s items'; end if;
  select count(*) into n from public.search_library_scoped(t, 'u-other', p, 'coffee', 10);
  if n <> 0 then raise exception 'another person saw a project''s items'; end if;

  begin
    insert into public.projects (tenant_id, user_id, name, status) values (t, 'u-pr', 'x', 'deleted');
    raise exception 'an unknown status was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.projects (tenant_id, user_id, name) values (t, 'u-pr', '');
    raise exception 'an empty name was accepted';
  exception when check_violation then null; end;

  -- Deleting a project: tasks and links go; the chat and the file stay.
  delete from public.projects where id = p;
  if exists (select 1 from public.project_tasks where project_id = p) then raise exception 'tasks survived their project'; end if;
  if exists (select 1 from public.project_chats where project_id = p) or exists (select 1 from public.project_files where project_id = p) then raise exception 'links survived their project'; end if;
  if not exists (select 1 from public.conversations where id = c) or not exists (select 1 from public.library_files where id = f_in) then raise exception 'deleting a project deleted a chat or a file'; end if;

  perform public.delete_user_data(t, 'u-pr');
  if exists (select 1 from public.projects where user_id = 'u-pr') then raise exception 'projects survived account deletion'; end if;
  delete from public.library_files where id = f_other;
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.projects; raise exception 'anon could read projects';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.search_library_scoped('00000000-0000-0000-0000-000000000001', 'u-pr', null, 'coffee', 5); raise exception 'anon could search';
exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from public.project_tasks; raise exception 'a signed-in role could read tasks directly';
exception when insufficient_privilege then null; end $$;
reset role;
select 'projects checks passed' as result;
