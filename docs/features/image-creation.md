# AI image creation

- **Status:** Planned for Phase 4, step 4.2 (see [roadmap](../roadmap.md))
- **Requested:** 2026-10-05

A capability of NasrinAI, inside the same chat page and the same server. It
does not replace the local AI + OpenAI architecture and is not a separate app.

## The experience

```
UPLOAD photo  ->  idea / prompt
  -> ANALYZING      NasrinAI looks at the photo and the request
  -> QUESTIONS      up to 5 adaptive follow-up questions (0 if nothing is missing)
  -> PREPARING      NasrinAI writes the creative brief and shows a short summary
  -> GENERATING     one image, after the person taps Create
  -> COMPLETE       the image, with Download and Regenerate
  (any step) -> ERROR  a plain message and what to do next
```

Quality target: professional, campaign-ready imagery. Product characteristics
in the uploaded photo (shape, colors, label, logo, proportions) are kept unless
the person asks to change them. NasrinAI does not promise "award-winning"
results.

## Adaptive questions

NasrinAI decides what is already known from the photo and the request, and
asks only what would materially change the image. Areas it can ask about:
purpose, target audience, visual style, mood, background, environment,
composition, lighting, product preservation, branding, text, aspect ratio.

- Never more than 5. Fewer, or none, when the request is already detailed.
- Never asks about something already answered.
- Each question can offer 2–4 quick answers plus "Other".
- The model returns questions as structured data; the server checks the
  format, removes repeats and caps the count before the page shows them.

## Creative brief

Written after the answers, as structured fields (not free text), so the server
builds the generation prompt from known fields:

subject, objective, audience, style, composition, environment, lighting,
camera perspective, color direction, mood, branding, typography, aspect ratio,
elements to preserve, elements that may be modified.

The person sees a short plain summary of the brief before anything is
generated. NasrinAI's private reasoning is never shown or stored.

## Providers and cost

| Step | Where it runs |
| --- | --- |
| Analyze, questions, brief | NasrinAI's text models through the router (task routes in Phase 4.1), using a low-cost model; NasrinAI's own model when it can see photos |
| Generate | Image provider: **Gemini by default** (cost-efficient), behind an image-provider interface so it can be swapped (OpenAI images, a local model, others) |

Image-provider interface (same pattern as the text providers):

```
imageProvider.id, imageProvider.model
imageProvider.capabilities()   { editsPhotos, maxReferenceImages, aspectRatios }
imageProvider.generate({ prompt, images, aspectRatio, signal })
    -> { image: bytes, mime, usage }
```

The exact Gemini image model and its price are confirmed when step 2 starts;
they are settings (`IMAGE_PROVIDER`, `IMAGE_MODEL`), not code.

**One request = one image.** No automatic variations. Regenerate is a new,
counted generation and needs a tap.

Limits (all server-side, shared across instances):

- Generations per hour and per day for guests, users and each business, plus
  one total daily ceiling for all guests.
- One generation at a time per person (a second one waits or is refused).
- Uploads: photos only (PNG, JPEG, WebP), checked by their bytes, at most
  3 images and 3 MB per request, resized on the phone first.
- Idea and answers: length limits like chat messages.
- Every analysis, brief and generation is recorded in `usage_events`
  (provider, model, units, outcome; no prompt text, no images).
- Built so plans can be added later (Free / Creator / Studio / Pro): limits
  are read from one place keyed by plan, so a plan becomes a row, not code.

## Security

- Gemini, OpenAI and Supabase keys stay on the server. The page never talks to
  an image provider.
- Uploaded photos and generated images are never committed to GitHub. They go
  to a **private** Supabase Storage bucket, read only by the server.
- The page gets images only through an owner-checked route
  (`/v1/images/:id`), so the page's strict CSP stays `'self'` and nobody can
  open someone else's image by guessing a link.
- Photos are validated by their bytes and size before anything else, and
  re-encoded (which removes location and camera details).
- Text inside an uploaded photo is treated as content, never as instructions.
- The generation prompt is assembled by the server from the brief's fields;
  model output that does not fit the format is rejected.
- Provider safety refusals are shown as a plain message and still counted.
- Retention: guest images are deleted with the guest's chats (24 hours);
  signed-in users' after a set period and on request.

## UI

Same design system as the chat: off-white and ink, the same type, spacing,
buttons, sheet and chips, and Nasrin's moods for each state (thinking while
analyzing, happy when the image is ready, concerned on error). Reached from
the **+** menu ("Create image") and as a welcome-screen starter. Questions
appear as Nasrin's message with answer chips; the brief as a compact card with
a **Create** button; the result as an image in the conversation with
**Download** and **Regenerate**.

## Open decisions (for the owner)

1. A Gemini API key (Google AI Studio) with a spending cap, when step 2 starts.
2. May guests create images before a sign-in screen exists? Suggested: a small
   daily allowance per guest and a low total guest ceiling.
3. How long signed-in users' images are kept (suggested: 30 days).
