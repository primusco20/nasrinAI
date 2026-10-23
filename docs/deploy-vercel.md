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
- **Abuse and quotas:** `LIMIT_*` controls hourly/per-IP abuse protections. Pro, Max and Ultra paid-model allowances use `PRO_WEEKLY_TOKEN_LIMIT`, `MAX_WEEKLY_TOKEN_LIMIT` and `ULTRA_WEEKLY_TOKEN_LIMIT`; Quick and platform guests have no shared platform token ceiling. Business tenants retain their configured tenant ceilings. In Production, set all three paid weekly variables explicitly; the server refuses to start if any is missing, zero, invalid or above 100,000,000, rather than silently applying a code fallback.
- **Verify the live quota config:** set `OWNER_DIAGNOSTICS_TOKEN` to a random secret of at least 32 characters in Vercel and redeploy. While signed in, request `GET /v1/owner/quota-config` with that value in the `X-Owner-Diagnostics-Token` header. It returns only effective numeric limits and the Vercel deployment environment, never secrets. An unset or incorrect token receives 404. Do not put the token in browser code or share it.
- **Important distinction:** `ULTRA_WEEKLY_TOKEN_LIMIT` is the limit that decides when Ultra falls back to Quick. `ULTRA_DAILY_TOKEN_LIMIT` is legacy configuration and does not raise the weekly Ultra allowance.
- **Tiers (NasrinAI, Pro, Max, Ultra):** `TIER_NASRINAI`, `TIER_PRO`, `TIER_MAX`, `TIER_ULTRA` set the model behind each, for example `TIER_ULTRA=gpt-5:high`; empty turns a tier off. `TIERS_GUEST` (default `nasrinai,pro`) and `TIERS_USER` (default all four) set who can pick which.
- **Realtime voice:** `REALTIME_VOICE_ENABLED=true` enables direct Gemini Live audio-to-audio voice sessions for Quick, Pro, Max and Ultra. Set `GEMINI_API_KEY` as a Sensitive server-only environment variable; realtime voice stays disabled if it is missing. The backend issues a constrained, short-lived Gemini ephemeral token and preserves tier authorization, daily voice limits, token reservations and estimated-spend checks. `REALTIME_QUICK_MAX_SECONDS`, `REALTIME_PRO_MAX_SECONDS`, `REALTIME_MAX_MAX_SECONDS` and `REALTIME_ULTRA_MAX_SECONDS` set session duration ceilings. No separate STT/TTS pipeline is used for realtime voice.
- **Voice engine:** `SPEECH_PROVIDER` is `auto` (default: OpenAI when it is used, otherwise Gemini when `GEMINI_API_KEY` is set, otherwise no speech), `openai`, `gemini` or `openrouter`. OpenRouter speech requires `OPENROUTER_API_KEY` and `OPENROUTER_TTS_MODEL` pinned to a verified speech-output model; the model ID is validated against the live OpenRouter catalog before use. Gemini voices use `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-tts`, a preview model: names and limits can change, so check Google's speech-generation page) and optionally `GEMINI_TTS_FAST_MODEL` (default `gemini-3.8-flash-lite-tts`). Gemini audio is sent to the browser as WAV. In the voice conversation you can talk over Nasrin: she stops and listens (wear headphones if she keeps cutting herself off).
- **Voices:** natural voices are on with OpenAI or Gemini. `SPEECH_ENABLED=false` turns them off (the page then uses the phone's voice); `LIMIT_GUEST_SPEECH_HOUR` and `LIMIT_USER_SPEECH_HOUR` cap read-alouds. `SPEECH_RATE` (0.5 to 2, default 1.15) sets how fast replies are read, for natural and phone voices. `OPENAI_TTS_FAST_MODEL` (default `tts-1`; `off` to use the normal voice model) is the quick voice used in the hands-free voice conversation: Nasrin starts talking after the first sentence, while the rest is still being written.
- **Your own model instead of OpenAI:** see [local-model.md](local-model.md).
- **Turn the AI off:** set `AI_PROVIDER=none`. The page then says the chat is not switched on.
- **Before charging businesses:** move the project to Vercel Pro. Hobby is for non-commercial use only.

- **Coding model specialists (OpenRouter):** with `OPENROUTER_API_KEY` set, `CODING_MAX_MODEL=openrouter:openai/gpt-6-sol` and `CODING_ULTRA_MODEL=openrouter:openai/gpt-6.1-sol`; `CODING_ULTRA_DEEP_MODEL` also defaults to GPT-6.1 Sol. Rates are $2/M input and $10/M output for both. When OpenRouter is not configured, the previous Anthropic coding model fallback remains.
- **TTS (OpenRouter):** when `OPENROUTER_API_KEY` is set and `SPEECH_PROVIDER` is unset, speech defaults to OpenRouter with `OPENROUTER_TTS_MODEL=google/gemini-3.8-flash-lite-tts` and `OPENROUTER_TTS_PROVIDER=Google Vertex`. This pins provider routing without fallback; verify Preview before production. Listed rates: $0.50/M input text and $6/M output audio tokens.


## Owner Command Center allowlist

Configure these variables in the NasrinAI Vercel project's **Settings → Environment Variables** for the intended environment:

- `OWNER_ALLOWED_EMAILS`: exact verified Supabase sign-in email(s), comma-separated.
- `OWNER_ALLOWED_IPS`: exact public IPv4 or IPv6 address(es), comma-separated. CIDR ranges are not accepted.
- `OWNER_SESSION_SECRET`: a dedicated random signing value of at least 32 characters. Do not reuse `GUEST_SESSION_SECRET` or any provider key.

All three values must be valid or the owner console remains disabled without affecting the public site. After changing values, redeploy the relevant environment. If a network change alters your public IP, update the allowlist and redeploy. Do not use Vercel Trusted IPs for this application-only allowlist; Trusted IPs can affect deployment access for the entire project.

Migration 042 must be applied and verified before enabling owner access in production. It supplies server-only aggregate usage/automation RPCs and the owner-action audit log. Until then, protected access fails closed because session issuance must be audited. Unauthorized routes return a generic no-store HTTP 404.
