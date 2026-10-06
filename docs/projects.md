# Projects (migration 013)

A signed-in person's own workspaces: name, description, instructions for
Nasrin, status (active, paused, done), tasks, and the chats and Library items
that belong to the project. Open them from the chats button → **Projects**.

## Owner setup

Run [`db/migrations/013_projects.sql`](../db/migrations/013_projects.sql) in
the Supabase SQL editor (after 012). Until then Projects say they are not
available; chat and the Library keep working.

Optional settings (`.env.example`): `PROJECTS_ENABLED` (default `true`),
`PROJECTS_MAX` (50 per person), `PROJECT_TASKS_MAX` (100 per project),
`LIMIT_USER_PROJECTS_HOUR` (300 changes per hour).

## Boundaries

- Every table carries tenant and user; every query filters by both; RLS on,
  service role only. Another person's project, chat or file reads as "not
  found".
- A project's chats get, in the system prompt, the project's name,
  description, the person's instructions (fenced: they cannot change the
  rules above) and up to 20 open tasks. Other chats never see them.
- Library search is scoped (`search_library_scoped`): a project's chat sees
  only that project's items; other chats only items outside any project.
- Nothing from a project becomes memory.
- Deleting a project deletes its tasks and links; its chats and Library items
  stay, outside any project. Account deletion removes projects
  (`delete_user_data`); the data export includes them.

## API (signed in)

- `GET /v1/projects`, `POST /v1/projects` `{ name, description?, instructions? }`
- `GET|PUT|DELETE /v1/projects/:id` (`PUT`: any of name, description,
  instructions, status)
- `POST /v1/projects/:id/tasks` `{ text }`, `PUT|DELETE /v1/projects/:id/tasks/:taskId`
- `POST /v1/project-links` `{ kind: chat|file, id, project_id | null }`
- `POST /v1/chat` with `project_id` starts a new chat in a project;
  `POST /v1/library` with `project_id` adds straight into one.
