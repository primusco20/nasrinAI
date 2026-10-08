# Nasrin and the internet

## Links people share

When a message contains a link (up to 2), the server opens the page, keeps
only its readable text (no scripts, menus or styles), and adds it to that
turn for the model, marked as data, not instructions. The page text is not
saved with the conversation. If a page cannot be opened, Nasrin is told why
and says so.

Safety rules (server-side request forgery): only `http`/`https` on the normal
ports, no passwords in links, and internal or private addresses are refused,
checked again at the moment of connecting and on every redirect (at most 3).
Pages are cut off at 8 seconds and 1.5 MB, and only text-like pages are read.
`LIMIT_GUEST_WEB_HOUR` / `LIMIT_USER_WEB_HOUR` cap how many reads and
searches one person can trigger per hour. `WEB_LINKS=false` turns it off.

## Web search

Questions that need fresh facts ("today", "latest", "weather", "news",
"price of…", "search the web…") are answered with OpenAI's web search tool
(Responses API, `tools: [{ type: "web_search" }]`), and the answer lists its
**Sources**. It uses `WEB_SEARCH_MODEL` (default `gpt-5.4`); OpenAI's
guide shows the tool with `gpt-6-astra`, so if your key's model does not
support it, the log says `web search failed` and Nasrin answers without the
web. Set `WEB_SEARCH_MODEL=` (empty) to turn search off.

Cost: OpenAI charges per search call (`config/model-prices.json`,
`tools.web_search`) plus tokens. Each search is counted in the budget and only
runs if it fits (see [routing.md](routing.md)).
