# Connectors (Phase 6)

A connector lets Nasrin use a business's **own HTTPS API**, for that business
only. The business declares exactly what may be called; the model can only
ask, and code checks every call (see [tools.md](tools.md)).

## Set up (owner)

1. Supabase SQL Editor: run [`db/migrations/006_connectors.sql`](../db/migrations/006_connectors.sql).
2. Vercel: add `CONNECTOR_SECRET_KEY` (sensitive) = the output of `openssl rand -hex 32`.
   It encrypts the businesses' API keys. Losing or changing it means each
   connector's key must be sent again.
3. Give a business's secret key the right to manage connectors:
   ```sql
   update public.api_keys set scopes = array['chat', 'connectors'] where id = '<12-character key id>';
   ```

## Add a connector (business, server to server)

```
PUT /v1/connectors/shop
Authorization: Bearer nss_<id>_<secret>
{
  "base_url": "https://api.shop.example.com/v1",
  "auth": { "type": "header", "header": "X-Api-Key", "secret": "<their API key>" },
  "actions": [{
    "name": "order_status",
    "description": "Status of an order by its number",
    "method": "GET",
    "path": "/orders/{order_id}",
    "parameters": { "properties": { "order_id": { "type": "string", "pattern": "^[0-9]{4,10}$" } }, "required": ["order_id"] },
    "who": ["service", "guest"]
  }]
}
```

`GET /v1/connectors` lists them (never the key), `DELETE /v1/connectors/:name`
removes one. Leaving `auth.secret` out keeps the stored key.

## Rules

- https on port 443, a public host fixed by `base_url`; names that resolve to
  internal addresses are refused at connect time; redirects are not followed;
  8 s, 256 KB per call.
- Only declared actions, paths and inputs (strict types, patterns without
  slow shapes, path values URL-encoded). The tool is named `connector_action`.
- `GET` actions read. Other methods are `write` (or `money` if marked) and
  never run without the person's **Confirm** (card in the chat, or `POST /v1/actions/confirm`).
- `who`: `service` (the business's server, default) and/or `guest` (visitors
  on its site). Opening an action to guests is the business's choice: only
  open what any visitor may see.
- Other businesses and nasrinai.site users never see a business's connectors.
- The API key is stored encrypted (AES-256-GCM, bound to the business and
  connector), decrypted only for the call, never logged or returned.
- Results go back to the model marked as the business's data (not
  instructions), at most 6,000 characters.
