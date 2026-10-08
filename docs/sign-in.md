# Sign-in setup

The chat page signs people in with Supabase Auth: an **email code** (on as soon
as Supabase is set up) and **Google** (after the steps below). Signed-in users
can pick the tiers in `TIERS_USER` (by default Max and Ultra too), and their
chats are kept with their account.

How it works: the page only talks to NasrinAI's server, never to Supabase. The
server keeps the sign-in in an HttpOnly cookie that page scripts cannot read;
the page holds a one-hour access token in memory. Details in
[security.md](security.md).

## 1. Supabase: where people come back to

**Authentication > URL Configuration**

- **Site URL:** `https://nasrinai.com`
- **Redirect URLs:** add `https://nasrinai.com/v1/auth/google/callback`

## 2. Supabase: the email code

**Authentication > Emails > Templates.** In **Magic Link** and in
**Confirm signup**, set the subject to `Your NasrinAI sign-in code` and paste
the whole of [email-templates/sign-in-code.html](email-templates/sign-in-code.html)
as the message body (it shows the NasrinAI logo and the code). A plain
alternative:

```
<h2>Your NasrinAI code</h2>
<p>Enter this code to sign in: <strong>{{ .Token }}</strong></p>
<p>It works for a few minutes. If you did not ask for it, ignore this email.</p>
```

Without `{{ .Token }}` people get a link instead of a code, and the page
cannot use it.

**Sending real emails.** Supabase's built-in email sender is for testing: it
sends only a few emails an hour, and only to addresses in your Supabase team.
Before inviting other people, add your own sender under
**Authentication > Emails > SMTP Settings** (for example Resend, Brevo or your
domain's email service).

## 3. Google (optional)

1. In **Google Cloud Console > APIs & Services > Credentials**, create an
   **OAuth client ID** of type **Web application**. Under
   **Authorized redirect URIs** add
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (Supabase shows this exact address on its Google provider page).
2. In **Supabase > Authentication > Sign In / Providers > Google**, turn it on
   and paste the Client ID and Client Secret.
3. In **Vercel > Settings > Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `AUTH_GOOGLE` | `true` |
   | `SITE_URL` | `https://nasrinai.com` |

4. Redeploy.

## 4. Check it

1. Open the site, tap the sliders icon: **Settings** shows **Sign in**.
2. Sign in with your email: a 6-digit code arrives; enter it.
3. The model picker now offers Max and Ultra without "· Sign in" (if your
   OpenAI key can use those models).
4. Close and reopen the page: you are still signed in.

## More than one account on a device

Settings → **Add account** keeps the signed-in account aside and opens sign-in
for another one; up to 3 accounts per device (`MAX_ACCOUNTS` in
`src/auth/routes.js`). The others' email and refresh token stay in the
`nasrin_acc` cookie (HttpOnly, SameSite=Strict, `/v1/auth` only); the page
only ever sees their emails. Each account keeps its own plan, chats and data.
Switching renews the chosen account's session and keeps the current one
aside. Logging out removes the account: with one other account it takes over,
with several the person chooses, with none the sign-in sheet opens (expired
accounts are dropped, never chosen). Other tabs follow a switch or sign-out.
No setup is needed.

**Log out** ends only this device's session (`/logout?scope=local`).
Settings → Security and devices → **Sign out of other devices**
(`POST /v1/auth/sign-out-others`, `scope=others`) ends every other session of
the account. Supabase does not let NasrinAI list sessions, so there is no
device list.

**Privacy choices** (`GET/PUT /v1/settings`, `src/settings.js`): saved in the
person's Supabase Auth user metadata (`nasrin_prefs`) with their own token,
read on every request with the token check, enforced on the server. Today:
`memory` (off = no memory notes offered or used).

## Settings

| Name | Default | What it does |
| --- | --- | --- |
| `AUTH_EMAIL` | `true` | Email codes on the page |
| `AUTH_GOOGLE` | `false` | "Continue with Google" (needs `SITE_URL`) |
| `SITE_URL` | none | The site's address, for Google's return trip |
| `LIMIT_SIGNIN_CODES_IP_HOUR` | 10 | Codes requested per IP per hour |
| `LIMIT_SIGNIN_CODES_EMAIL_HOUR` | 4 | Codes sent to one address per hour |
| `LIMIT_SIGNIN_TRIES_HOUR` | 10 | Code attempts per address per hour |
