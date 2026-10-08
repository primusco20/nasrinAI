# Deploy NasrinAI on Vercel

This puts the `development` branch online as a test site. Every step works
from a phone browser. Production from `main` comes after you approve merging
`development` into `main`.

## 1. Prepare Supabase (once)

1. Run the database migration: follow [database.md](database.md).
2. Make the guest-session secret. In the same SQL Editor, run:

   ```sql
   select encode(extensions.gen_random_bytes(32), 'hex');
   ```

   Copy the 64-character result. It goes into Vercel as `GUEST_SESSION_SECRET`.
   Do not paste it anywhere else.
3. Open **Project Settings > API keys** and keep the page open for step 3.

## 2. Get an OpenAI key and cap its spending

1. In the OpenAI dashboard, create an API key for NasrinAI only.
2. Set a monthly budget limit on that project, as a second safety net behind
   NasrinAI's own daily limits.

## 3. Create the Vercel project

1. In Vercel: **Add New > Project**, and import `primusco20/nasrinAI`.
   If the repo is not listed, use **Adjust GitHub App Permissions** to add it.
2. **Framework Preset:** Other. Leave the build and output settings as they are.
3. Open **Environment Variables** and add each of these. Mark the secret
   ones as **Sensitive**.

   | Name | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SUPABASE_URL` | Supabase Project URL, like `https://abcd.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | Supabase anon / publishable key |
   | `SUPABASE_SECRET_KEY` | Supabase service_role / secret key (Sensitive) |
   | `GUEST_SESSION_SECRET` | The 64 characters from step 1 (Sensitive) |
   | `CRON_SECRET` | A separate random 32+ character secret for hourly retention cleanup (Sensitive) |
   | `AI_PROVIDER` | `openai` |
   | `OPENAI_API_KEY` | Your OpenAI key (Sensitive) |
   | `OPENAI_MODEL` | `gpt-4o-mini` |

4. Press **Deploy**. This first deploy is of `main`, which holds only the
   README, so the site is empty for now. That is expected.

## 4. Point production at the development branch

1. In the project: **Settings > Environments > Production > Branch Tracking**
   (on older screens: **Settings > Git > Production Branch**).
2. Change the branch from `main` to `development` and save.
3. Go to **Deployments**, open the menu, choose **Create Deployment**, and
   enter `development`. Any new push to `development` also deploys it.

## 5. Check it

1. `https://<project>.vercel.app/healthz` shows `ok`.
2. `https://<project>.vercel.app/` shows the chat page.
3. `https://<project>.vercel.app/package.json` shows **404**. Only the page
   files should be public.
4. Ask a question. A reply means the database, guest sessions and OpenAI all work.
5. In Supabase, **Table Editor > usage_events** shows one row per reply, with
   token counts and no message text.

If a setting is missing or two Supabase keys are swapped, the server refuses
to start. Vercel's **Logs** tab shows which setting is wrong.

## Changing settings later

Settings are under **Settings > Environment Variables**; the full list with
defaults is in [`.env.example`](../.env.example). After saving, redeploy for
the change to take effect.

- **New OpenAI or Supabase key:** paste the new value and redeploy, then delete the old key at the provider.
- **`GUEST_SESSION_SECRET`:** changing it signs every guest out. Do it if you think it leaked.
- **Limits:** the `LIMIT_*`, `GUEST_DAILY_TOKEN_CEILING` and `USER_DAILY_TOKEN_LIMIT` settings.
- **Tiers (NasrinAI, Pro, Max, Ultra):** `TIER_NASRINAI`, `TIER_PRO`, `TIER_MAX`, `TIER_ULTRA` set the model behind each, for example `TIER_ULTRA=gpt-5:high`; empty turns a tier off. `TIERS_GUEST` (default `nasrinai,pro`) and `TIERS_USER` (default all four) set who can pick which.
- **Realtime voice:** `REALTIME_VOICE_ENABLED=true` enables WebRTC voice sessions. The server resolves the caller's Quick/Pro/Max/Ultra tier before minting a short-lived OpenAI Realtime client secret. `REALTIME_QUICK_*`, `REALTIME_PRO_*`, `REALTIME_MAX_*`, and `REALTIME_ULTRA_*` control the model, reasoning ceiling, and maximum session duration; keep the OpenAI API key server-side.
- **Voice engine:** `SPEECH_PROVIDER` is `auto` (default: OpenAI when it is used, otherwise Gemini when `GEMINI_API_KEY` is set), `openai` or `gemini`. Gemini voices use `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-tts`, a preview model: names and limits can change, so check Google's speech-generation page) and optionally `GEMINI_TTS_FAST_MODEL` (default `gemini-3.8-flash-lite-tts`). Gemini audio is sent to the browser as WAV. In the voice conversation you can talk over Nasrin: she stops and listens (wear headphones if she keeps cutting herself off).
- **Voices:** natural voices are on with OpenAI or Gemini. `SPEECH_ENABLED=false` turns them off (the page then uses the phone's voice); `LIMIT_GUEST_SPEECH_HOUR` and `LIMIT_USER_SPEECH_HOUR` cap read-alouds. `SPEECH_RATE` (0.5 to 2, default 1.15) sets how fast replies are read, for natural and phone voices. `OPENAI_TTS_FAST_MODEL` (default `tts-1`; `off` to use the normal voice model) is the quick voice used in the hands-free voice conversation: Nasrin starts talking after the first sentence, while the rest is still being written.
- **Your own model instead of OpenAI:** see [local-model.md](local-model.md).
- **Turn the AI off:** set `AI_PROVIDER=none`. The page then says the chat is not switched on.
- **Before charging businesses:** move the project to Vercel Pro. Hobby is for non-commercial use only.
