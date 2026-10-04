# Nasrin AI (Smart Chat) — extracted from The Crazy Bite Co.

Source: `primusco20/Crazybite`, commit `0f305455e9d3`.

Every code block in this folder is copied **verbatim** by line range from the repo. Each block is wrapped in
`@@ VERBATIM <file>:<from>-<to>` / `@@ END VERBATIM` markers, and `MANIFEST.tsv` lists every range.
The full original files (`originals/` in the zip) are deliberately not committed here; read them in the Crazybite repo.

To prove nothing was changed or dropped, run against a clone of the repo:

```
python3 verify.py . /path/to/Crazybite
# blocks checked: 37, mismatches: 0
```

## How the Smart Chat works today

1. **Customer types or speaks** (`client/03-chat-panel.html`, `client/09-voice-and-mic.js` for speech recognition).
2. `chatSend()` → `chatReply()` (`client/06-chat-methods.js`):
   - If an in-chat order is in progress (`chatFlow.step`), the **order state machine** answers
     (`chatFlowReply`, `chatParseOrder`, `chatNextQuestion`, `chatAskSize/Flavour/Qty`, `chatConfirm`, `chatFlowAdd`).
   - Otherwise the **built-in rule brain** answers first (`chatAnswer` → `chatAnswerCore`, with `chatSentiment`,
     `chatFindItem`, `chatWantsPerson`).
   - Only if that brain has no exact answer (`fallback`), or multi-language is on and the message looks foreign
     (`chatLooksForeign` in `client/08-chat-globals.js`), it calls the **AI**: `chatRemoteReply()` → `POST /api/chat`.
3. **Server `/api/chat`** (`server/06-api-chat.js`): reads live menu, categories, branches, promos, fees, and the
   signed-in customer's active orders from Supabase; builds a knowledge block; sends it with the "Nasrin" system prompt
   to OpenAI (`gpt-4o-mini`, JSON mode, 12 s timeout); then validates the output — reply ≤ 700 chars, max 4 action
   buttons, and every action must be in `CHAT_ACTIONS` or a `pick:<menu id>` of an in-stock item. Any failure returns
   `{ reply: null }` and the browser falls back to the built-in answer.
4. **Reply shown and spoken**: `chatSay()` → `speakText()` → `POST /api/tts` (OpenAI voice, male `onyx` / female `coral`,
   cached) with the phone's built-in voice as fallback. In hands-free mode the mic reopens after Nasrin finishes speaking.
5. **Buttons** under a reply run `chatAction(a)` — this is where the chat acts on the app.
6. Conversation is saved to `localStorage` (`cb_chat`) and cleared after 3 quiet minutes.

## Actions the AI can take (`CHAT_ACTIONS`)

`menu`, `orders`, `cart`, `track`, `contact`, `callsupport`, `address`, `branch`, `order`, plus `pick:<menu id>`.
The AI never places orders or takes payment itself; it only proposes these buttons.

## What the chat depends on in the host app

These are **not** chat code — they belong to the Crazy Bite app, and the chat calls them. In a standalone agent,
each one becomes a tool or data source you provide.

| Kind | Used by the chat |
|---|---|
| Menu & pricing | `menuItems`, `categories`, `isSoldOut()`, `sizesOf()`, `unitPrice()`, `defaultSize()`, `fromPrice()`, `peso()`, `livePromos` |
| Cart & ordering | `addToCart()`, `cartCount`, `cartSubtotal`, `viewCart()`, `selectedItem`, `modalSize`, `modalQty`, `modalFlavour`, `quote`, `checkoutMethods` |
| Orders | `orders`, `trackOrder()`, `orderTiming` |
| Branches & delivery | `branches`, `branchList`, `selectedBranch`, `deliveryFeeAmount`, `deliveryPerKm`, `serviceFeeAmount`, `businessHours`, `openAddressPicker()`, `showLocationPicker` |
| Account & rewards | `user`, `isLoggedIn`, `tier`, `nextTier`, `ordersThisMonth`, `ordersToNext`, `bpoRule`, `bpoWindowLabel`, `walletOn`, `walletBalanceReadable` |
| UI | `currentTab`, `showContact`, `showToast()`, `startDrag/endDrag/sheetStyleFor/resetDrag` (sheet dragging), `authHeader()` |
| Live support call | `startSupportCall()` and the call methods in `client/07-support-call-handoff.js` (PeerJS, separate feature) |
| Server | Supabase tables `store_settings`, `menu_items`, `categories`, `branches`, `orders`; `express`, `express-rate-limit` |

## Environment

`OPENAI_API_KEY` (turns on AI and voice), `OPENAI_CHAT_MODEL` (default `gpt-4o-mini`),
`OPENAI_TTS_MODEL` (default `tts-1`), `OPENAI_TTS_VOICE` / `_MALE` / `_FEMALE`, `OPENAI_TTS_SPEED` (default 1.2).

## Notes

- `owner-console/settings-logic.js` includes a legacy `chatApiUrl` setting that nothing reads; kept for completeness.
- The Alpine.js markup uses Tailwind classes from the app's compiled CSS (`public/css/app.css`), which is not copied
  here — rebuild it or restyle the panel in the new project.
