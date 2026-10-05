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

- **Site URL:** `https://nasrinai.site`
- **Redirect URLs:** add `https://nasrinai.site/v1/auth/google/callback`

## 2. Supabase: the email code

**Authentication > Emails > Templates.** In **Magic Link** and in
**Confirm signup**, put the code in the message, for example:

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
   | `PUBLIC_URL` | `https://nasrinai.site` |

4. Redeploy.

## 4. Check it

1. Open the site, tap the sliders icon: **Settings** shows **Sign in**.
2. Sign in with your email: a 6-digit code arrives; enter it.
3. The model picker now offers Max and Ultra without "· Sign in" (if your
   OpenAI key can use those models).
4. Close and reopen the page: you are still signed in.

## Settings

| Name | Default | What it does |
| --- | --- | --- |
| `AUTH_EMAIL` | `true` | Email codes on the page |
| `AUTH_GOOGLE` | `false` | "Continue with Google" (needs `PUBLIC_URL`) |
| `PUBLIC_URL` | none | The site's address, for Google's return trip |
| `LIMIT_SIGNIN_CODES_IP_HOUR` | 10 | Codes requested per IP per hour |
| `LIMIT_SIGNIN_CODES_EMAIL_HOUR` | 4 | Codes sent to one address per hour |
| `LIMIT_SIGNIN_TRIES_HOUR` | 10 | Code attempts per address per hour |
