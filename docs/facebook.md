# Facebook Messenger (Phase 6)

People message a business's Facebook Page; that business's Nasrin answers
(its own tools, guest limits and budgets). One NasrinAI Meta app serves every
business's Page.

## Owner setup (once)

Meta's screens change; the names below are as Meta documents them, and
cannot be verified from this repository.

1. Supabase SQL Editor: run [`db/migrations/007_channels.sql`](../db/migrations/007_channels.sql).
2. developers.facebook.com: create an app (type Business), add the
   **Messenger** product.
3. Vercel (Production; Sensitive for the first two):

   | Name | Value |
   | --- | --- |
   | `FACEBOOK_APP_SECRET` | App settings > Basic > App secret (32 characters) |
   | `FACEBOOK_VERIFY_TOKEN` | any random text, 16+ characters (you make it up) |
   | `FACEBOOK_GRAPH_VERSION` | optional, the version shown in the app, e.g. `v23.0` |

   `CONNECTOR_SECRET_KEY` must be set too. Redeploy; the log shows `messenger on`.
4. Messenger > Webhooks: callback URL `https://nasrinai.site/v1/webhooks/facebook`,
   verify token = `FACEBOOK_VERIFY_TOKEN`, subscribe the Page to `messages`.
5. To answer people other than the app's testers, Meta's App Review for
   `pages_messaging` is needed.

## Connect a business's Page (business key with the `connectors` scope)

```
PUT /v1/channels/facebook
Authorization: Bearer nss_<id>_<secret>
{ "page_id": "<numeric Page ID>", "page_access_token": "<Page access token>" }
```

`GET /v1/channels/facebook` lists Pages (never the token);
`DELETE /v1/channels/facebook/<page_id>` disconnects. A Page can belong to
one business only. For NasrinAI's own Page, use a key of the NasrinAI
business.

## How it behaves

- Every webhook is checked with Meta's signature (`X-Hub-Signature-256`);
  each message id is answered once (Meta retries).
- Each sender is a guest of the Page's business (`fb_<id>`); their
  conversation continues while it lasts (guest chats: 24 hours).
- Text only; replies are plain text, split at 2,000 characters.
- Messenger cannot show a Confirm card, so write/money actions are refused
  there.
- Page tokens are stored encrypted (AES-256-GCM, bound to business and Page).
