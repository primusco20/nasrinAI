# Privacy Notice

**Version 2026-10-05 (draft for legal review)** · Effective: [EFFECTIVE DATE] · Last updated: 5 October 2026

This notice explains what NasrinAI does with personal information, written to match how the service actually works today. Placeholders in [BRACKETS] are still to be filled in by the business.

## In short

- **Guests:** your chat is kept for 24 hours, then deleted. No account, no email.
- **Signed in:** we keep your email address and your chats until you delete them or your account.
- **To answer you**, your messages go to AI services (OpenAI, and Google Gemini when switched on). Emails, phone numbers and card numbers are removed first.
- **Files and links** you share are used for that answer and not stored.
- **Payments** go through PayMongo. We never see your card or e-wallet details.
- **You can** download your data, delete all chats, or delete your account in Settings.
- **No advertising**, no selling of personal information, no tracking cookies.

## 1. Who we are

NasrinAI (https://nasrinai.site) is operated by **[LEGAL BUSINESS NAME]**, [REGISTERED ADDRESS] ("we"). We decide why and how your information is used, so we are the **personal information controller** under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).

- Privacy contact: [PRIVACY EMAIL]
- Data Protection Officer: [DPO NAME AND CONTACT]

## 2. What we collect, and why

### When you chat as a guest
- **A random guest ID**, inside a signed token stored in your browser. Used to keep your chat together and to apply fair-use limits. *Basis: providing the service you asked for (contract) and our legitimate interest in preventing abuse.*
- **Your messages and Nasrin's replies.** Used to answer you and to keep the conversation going. Deleted automatically 24 hours after the chat starts. *Basis: contract.*
- **Pictures you ask Nasrin to make.** Kept with the chat and deleted with it.

### When you sign in
- **Your email address and account ID** (held by our sign-in provider, Supabase). Used to sign you in with a one-time code. *Basis: contract.*
- **If you use Google sign-in**, Google shares your name, email address and profile picture with our sign-in provider. NasrinAI itself uses only your account ID and email address.
- **Your chats and pictures**, kept until you delete them or your account. [CHAT RETENTION PERIOD FOR SIGNED-IN USERS — REQUIRES BUSINESS DECISION; today there is no automatic expiry.]
- **Your acceptance of the Terms of Service**: the version and the time. *Basis: legal obligation and our legitimate interest in proving what was agreed.*

### When you share files, links or use voice
- **Files** (photos, PDFs, text files) are used to answer that one message and are **not stored**. Only their names are saved with the message. Photos are re-saved on your device before upload, which removes location and camera details.
- **Links:** our server opens the page and uses its text for that one answer. The page text is not stored. The website sees a request from our server, not from you.
- **Web search:** questions that need current facts may be searched on the web through OpenAI's search tool. The answer lists its sources.
- **Read aloud:** to read a reply in a natural voice, the text of Nasrin's reply is sent to OpenAI to make the audio. Your own messages are not.
- **Voice typing** uses your browser's or phone's speech service (for example Google or Apple), not ours. Their privacy terms apply.

### When you buy a plan
- **PayMongo** processes the payment. We receive the plan, the amount, the payment reference and whether it was paid. We do not receive or store card numbers or e-wallet details. *Basis: contract; keeping payment records is also a legal obligation.*

### To keep the service safe and running
- **IP address**, used only to apply rate limits against abuse. Kept in short-lived counters (removed after about 2 days). *Basis: legitimate interest (security).*
- **Usage records**: which AI model answered, how many tokens, estimated cost, time, and whether it worked. **No message text.** Used to control costs and improve which model answers what. *Basis: legitimate interest.*
- **Server logs** at our hosting provider (Vercel), for errors and security. [LOG RETENTION — REQUIRES VERIFICATION with Vercel plan settings.]
- **Performance measurements** (Vercel Speed Insights): page-speed metrics. [WHETHER IDENTIFIERS ARE INVOLVED — REQUIRES VERIFICATION.]

We do not ask for sensitive personal information (such as health, religion or government IDs). If you type it into a chat, it is processed only to answer you, and the same storage rules apply. [BASIS FOR SENSITIVE INFORMATION VOLUNTEERED IN CHATS — REQUIRES LEGAL REVIEW.]

## 3. AI processing and automated decisions

- Replies are written by AI models, not people. To keep costs down, software picks which model answers each message (simple questions go to a smaller model). It also checks messages for contact details, which are removed before text leaves our servers, and keeps such messages away from any free AI service that may learn from what it receives.
- Fair-use limits and spending limits can stop or delay answers.
- None of this makes decisions about you that have legal or similarly significant effects.
- **We do not use your chats to train AI models.** [CONFIRM THE PROVIDERS' DATA-USE SETTINGS AND CONTRACTS — REQUIRES VERIFICATION, see section 4.]

## 4. Who receives information

- **Vercel** (hosting, logs, performance metrics) — [REGION — REQUIRES VERIFICATION]
- **Supabase** (database and sign-in) — [PROJECT REGION — REQUIRES VERIFICATION]
- **OpenAI** (AI answers, read-aloud audio, web search) — United States. OpenAI states that API data is not used to train its models by default. [CONFIRM ACCOUNT SETTINGS AND DATA PROCESSING ADDENDUM — REQUIRES VERIFICATION]
- **Google Gemini** (AI answers and pictures, only when switched on) — On Gemini's **free tier, Google may use what it receives to improve its products**; NasrinAI sends the free tier only messages without contact details or files. [MOVE TO PAID TIER BEFORE LAUNCH, OR DISCLOSE AS-IS — REQUIRES BUSINESS DECISION]
- **PayMongo** (payments) — Philippines
- **[EMAIL SENDER, e.g. Supabase or Resend]** (sign-in code emails)
- **Google** (only if you choose Google sign-in)
- **[OWN MODEL SERVER]** — if NasrinAI's own model is switched on, messages go to a server we control.

We do not sell personal information and do not share it for advertising. We may disclose information if the law requires it.

## 5. Information sent outside the Philippines

Most of these providers process data outside the Philippines (for example in the United States). We use them because they provide the AI, hosting and database the service runs on. [SAFEGUARDS: DATA PROCESSING AGREEMENTS / CONTRACT CLAUSES WITH EACH PROVIDER — REQUIRES VERIFICATION]

## 6. How long we keep information

- Guest chats and pictures: **24 hours**
- Signed-in chats and pictures: until you delete them or your account [REQUIRES BUSINESS DECISION on an automatic limit]
- Files and link text: **not stored**
- Rate-limit counters (with IP addresses): about **2 days**
- Usage records (no text): [REQUIRES BUSINESS DECISION]; when you delete your account, your ID is removed from them
- Payment records: [PERIOD REQUIRED BY TAX RULES — REQUIRES ACCOUNTANT REVIEW]
- Terms acceptance records: kept as proof of what was agreed, also after account deletion [REQUIRES LEGAL REVIEW of period]
- Backups held by our providers may keep deleted data for a limited time until they expire. [BACKUP RETENTION — REQUIRES VERIFICATION]

## 7. Your rights

Under the Data Privacy Act you have the right to be informed, to object, to access, to correct, to erasure or blocking, to data portability, to claim damages, and to file a complaint.

- **In the app (Settings → Your data):** download your data, delete all your chats, delete your account.
- **By email:** [PRIVACY EMAIL]. We may ask you to confirm the request from the email address on the account. We aim to reply within [RESPONSE PERIOD — REQUIRES LEGAL REVIEW].
- **Complaints:** contact us first if you can. You may also complain to the **National Privacy Commission** (https://privacy.gov.ph).

## 8. Security

Information is sent over encrypted connections. Access to the database is limited to the NasrinAI server. Sign-in uses one-time codes and secure, HTTP-only cookies. Keys to outside services stay on our servers. Abuse and spending limits are in place. No system is perfectly secure; if a breach affecting your information happens, we will notify you and the National Privacy Commission when the law requires it.

## 9. Cookies and browser storage

NasrinAI uses only what it needs to work:

- **nasrin_rt** (cookie): keeps you signed in, up to 30 days. HTTP-only, so page scripts cannot read it.
- **nasrin_pkce** (cookie): used during Google sign-in, 10 minutes.
- **Browser storage**: your guest session, the open chat's ID, the email shown in Settings, and your choices (appearance, voice, read aloud, model).

There are no advertising or cross-site tracking cookies. Clearing your browser's site data removes these.

## 10. Children

[AGE REQUIREMENT — REQUIRES BUSINESS DECISION. If the service is not meant for minors, say so here and in the Terms, and say what happens if we learn a minor is using it.]

## 11. Changes

When this notice changes, we will update the version and date above. For important changes we will tell signed-in users in the app before they take effect.
