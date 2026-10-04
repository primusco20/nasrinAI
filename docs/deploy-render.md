# Deploy NasrinAI on Render

This puts the `development` branch online as a test site. Every step works
from a phone browser. Production (from `main`) comes after you approve
merging `development` into `main`.

## 1. Prepare the database (once)

Follow [database.md](database.md): run `db/migrations/001_core.sql` in the
SQL Editor of your NasrinAI Supabase project.

Then, in Supabase, open **Project Settings > API keys** and keep the page
open. You will copy three values from it:

| Render setting | Supabase value |
| --- | --- |
| `SUPABASE_URL` | Project URL, like `https://abcd.supabase.co` |
| `SUPABASE_ANON_KEY` | The anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role / secret key. Server only: never paste it into a page, a chat or a message |

## 2. Get an OpenAI key and cap its spending

1. In the OpenAI dashboard, create an API key for NasrinAI only.
2. Set a monthly budget limit on the project. NasrinAI has its own daily
   limits, but a cap at OpenAI is a second safety net.

## 3. Create the service

1. In Render: **New > Blueprint**, and connect the GitHub repo `primusco20/nasrinAI`.
2. Choose the **development** branch. Render reads `render.yaml` and proposes
   a web service called `nasrinai-staging` in Singapore.
3. Render asks for the values marked secret. Paste `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY`.
   `GUEST_SESSION_SECRET` is generated for you.
4. Pick a plan, then **Apply**.

If a setting is missing or two Supabase keys are swapped, the server refuses
to start and the Render log says which setting is wrong.

## 4. Check it

1. Open `https://<your-service>.onrender.com/healthz`. It should say `ok`.
2. Open `https://<your-service>.onrender.com/`. The chat page should load.
3. Ask a question. A reply means the database, the guest session and OpenAI all work.
4. In Supabase, **Table Editor > usage_events** shows one row per reply, with token counts and no message text.

## Changing settings later

All settings are in Render under **Environment**. The full list, with
defaults, is in [`.env.example`](../.env.example). Saving restarts the service.

- **New OpenAI or Supabase key:** paste the new value and save. The old key can then be deleted at the provider.
- **`GUEST_SESSION_SECRET`:** changing it signs every guest out. Do it if you think it leaked.
- **Limits:** the `LIMIT_*`, `GUEST_DAILY_TOKEN_CEILING` and `USER_DAILY_TOKEN_LIMIT` settings.
- **Turn the AI off:** set `AI_PROVIDER=none`. The page then says the chat is not switched on.
