# NasrinAI Motion Gallery — Product, Design, Motion Catalogue & Implementation Specification

**Product:** NasrinAI Motion Gallery  
**Canonical URL:** https://gallery.nasrinai.com  
**Repository:** `primusco20/nasrinAI`  
**Status:** Specification drafted; implementation, DNS/domain configuration, deployment, and production verification are not yet complete.  
**Owner priorities:** Quality and security before speed; premium minimalist UI; no missed animation families; record progress explicitly.

---

## 1. Vision and product definition

Build a standalone NasrinAI Gallery extension at `gallery.nasrinai.com`, inspired by the browsing layout and breadth of BrewedOps Motion Library (https://brewedops.cloud/motionlibrary), without copying its branding, source code, assets, or exact visual identity.

The Gallery is a curated, searchable, interactive catalogue of reusable web motion patterns, animation recipes, UI transitions, visual effects, and full interface examples. People should be able to preview each motion, inspect its purpose and implementation requirements, copy a prompt/specification, and obtain or copy a safe implementation snippet where available.

The reference site advertises a large library (652 animations across 47 sections at the time inspected) and a workflow around browsing, prompts, and self-contained HTML. Treat those numbers as reference-site claims, not NasrinAI targets or verified counts. NasrinAI should create its own original catalogue, implementation, taxonomy, and content.

### Goals

1. Make finding and comparing motion examples fast.
2. Give every entry a working preview, clear metadata, and reduced-motion behavior.
3. Support developers, designers, students, and teams with reusable implementation guidance.
4. Keep the interface visually restrained and premium: monochrome foundation with a precise orange accent.
5. Ensure the catalogue remains responsive and usable on iPhone Safari as well as desktop.
6. Keep performance, accessibility, security, licensing, and maintainability as release requirements—not post-launch polish.
7. Make the Gallery a separate extension at the specified subdomain without destabilizing the core NasrinAI application.

### Non-goals

- Do not copy the reference site's code, text, branding, artwork, or proprietary implementation.
- Do not promise that every animation is suitable for production or every snippet is fully self-contained.
- Do not load arbitrary third-party code or run user-submitted code in the Gallery's main application origin.
- Do not add a new AI/provider service, database, or billing model unless an approved implementation plan demonstrates a need.
- Do not alter core chat, authentication, provider routing, plan limits, existing storage, or RLS policies as incidental work.

---

## 2. Visual direction and design system

### 2.1 Art direction

**Keywords:** monochrome, quiet, precise, editorial, minimal, tactile, technical, premium.

Use the reference's high-level information architecture—category navigation, searchable catalogue, preview cards, and detail/implementation actions—as inspiration. Create a distinct NasrinAI design.

- Main surfaces: near-black, charcoal, graphite, and warm off-white depending on theme.
- Primary content: high-contrast neutral text.
- Accent: restrained NasrinAI orange, used for active states, selected filters, focus indicators, small markers, and primary action emphasis.
- Avoid rainbow gradients, excessive glows, noisy glass effects, decorative blobs, and constant ambient animation.
- Motion demos may be colorful when color is integral to the example, but the Gallery chrome and controls remain monochrome with orange accents.
- Use thin neutral dividers, deliberate whitespace, consistent radii, clean type hierarchy, and stable alignment.
- Cards should feel like a curated design-tool catalogue, not a generic admin dashboard.

### 2.2 Suggested tokens

These are starting tokens; reconcile with the repository's existing theme system before implementation. Do not create competing global tokens if equivalent ones already exist.

| Token | Suggested value | Use |
|---|---|---|
| `--gallery-bg` | `#0B0B0C` | Dark page background |
| `--gallery-surface` | `#121214` | Card/surface |
| `--gallery-surface-raised` | `#19191C` | Hover/raised surface |
| `--gallery-border` | `#2A2A2E` | Dividers and borders |
| `--gallery-text` | `#F4F4F2` | Main dark-theme text |
| `--gallery-muted` | `#A2A2A6` | Secondary text |
| `--gallery-orange` | `#F97316` | Accent (verify contrast for each use) |
| `--gallery-orange-strong` | `#EA580C` | Pressed/strong accent |
| `--gallery-light-bg` | `#F7F7F5` | Light page background |
| `--gallery-light-surface` | `#FFFFFF` | Light cards |
| `--gallery-light-text` | `#18181A` | Light-theme text |
| `--gallery-light-border` | `#E2E2E0` | Light-theme dividers |

Use existing NasrinAI typography and spacing if established. Prefer a restrained type scale, readable body copy, and tabular numerals for counts. Orange is an accent, not a full-page fill. Do not rely on color alone to communicate selected, disabled, success, or error states.

### 2.3 Themes

- Support light, dark, and system preference if consistent with the current NasrinAI app.
- Ensure the orange accent passes contrast checks in both themes.
- All SVG icons/logos must adapt to light/dark themes.
- Persist only the user's UI preference through the existing approved preference mechanism; do not introduce tracking.
- Avoid a flash of the wrong theme during startup.

### 2.4 Layout and responsive behavior

**Desktop**
- Compact top bar: NasrinAI Gallery mark/title, search, theme/accessibility controls, and appropriate return-to-NasrinAI navigation.
- Left category rail or compact category navigation, matching the reference's browse-first mental model without overloading the viewport.
- Main area: page title/description, category chips or tabs, result count, sorting/filter controls, and a dense but breathable card grid.
- A card opens a detail panel or dedicated detail route; preserve list context when the user returns.
- Detail view prioritizes the live preview, then motion metadata and implementation actions.

**Tablet**
- Collapse the category rail into a drawer or horizontal scrolling category list.
- Keep search and key actions accessible.
- Use two-column cards when there is enough room.

**Mobile / iPhone Safari**
- Single-column or compact two-column cards only where previews remain legible.
- Category navigation becomes a horizontally scrollable chip row or accessible sheet.
- Filters and sorting open in a bottom sheet with safe-area padding.
- Detail view uses a full-height sheet/page; preview and Copy/Prompt actions remain easy to reach.
- Respect safe-area insets, touch targets (aim for at least 44×44 CSS px), keyboard visibility, and orientation changes.
- Avoid hover-only information; all actions must work by touch and keyboard.
- Test Safari viewport resizing, scroll locking, focus restoration, and back navigation.

### 2.5 Motion in the Gallery shell

The Gallery's own chrome must stay quiet. Motion examples are the product; the shell must not compete with them.

- Short opacity/transform transitions for hover, selection, menus, and panels.
- Small orange focus/selection cues.
- Skeleton shimmer must be subtle and disabled under reduced motion.
- Avoid animating layout dimensions when opacity/transform will work.
- No autoplaying audio, flashing content, or perpetual high-motion backgrounds.
- Provide a global **Pause motion** control for previews, with clear state and accessible label.
- When the user has `prefers-reduced-motion: reduce`, default previews to paused/static states and remove non-essential transitions.

---

## 3. Core information architecture and page layout

### 3.1 Gallery landing page

1. **Header**
   - NasrinAI Gallery identity.
   - Search field with clear button and keyboard shortcut hint if implemented.
   - Theme control.
   - Pause/resume previews.
   - Back-to-NasrinAI link.
2. **Intro**
   - Concise title such as “Motion Gallery”.
   - One-line explanation: browse, preview, and reuse interface motion.
   - Dynamic count of available entries and categories, sourced from actual catalogue data.
3. **Browse controls**
   - Category navigation.
   - Search query.
   - Filters: motion type, complexity, implementation technology, interaction trigger, reduced-motion support, and source/verification status.
   - Sort: featured, recently added, alphabetical, and complexity (only if metadata supports it).
   - Clear-all filters.
4. **Results**
   - Responsive card grid.
   - Every card shows title, category, concise purpose, preview area, technology badges, complexity, and reduced-motion indicator.
   - Preview does not start costly effects until visible/activated.
   - No-match state offers query correction and clear-filter action.
5. **Pagination / Show more**
   - Use pagination or incremental “Show more” based on existing repository conventions and catalogue scale.
   - Keep the current query, category, sort, and scroll position.
   - Do not load the full catalogue or mount all animations at once.
6. **Footer**
   - License/use guidance, accessibility note, feedback/contact link, version/build information only if already safe and useful.

### 3.2 Card behavior

- Entire card is not an ambiguous nested button. Provide a clear preview/open action and separate actions for Copy prompt, Copy code, or Favorite when supported.
- Card preview should have deterministic starting state and a replay control for finite demos.
- Use a static poster/fallback if preview code fails.
- Show “Preview unavailable” with a useful reason when dependencies are unsupported; do not leave a blank card.
- Do not execute untrusted HTML/JS in the main application context.
- Avoid expensive simultaneous animations; use IntersectionObserver or the app's existing visibility pattern to start/pause visible previews.
- Prevent layout shift with fixed/aspect-ratio preview regions.
- Cards need accessible names, focus styling, keyboard operation, and reduced-motion behavior.

### 3.3 Detail page / panel

Each motion entry should provide:

- Name and stable slug/ID.
- Short description and intended use.
- Category and tags.
- Preview with Play/Pause/Replay where relevant.
- Trigger (load, hover, focus, click, scroll, drag, gesture, state change, or media timeline).
- Duration, delay, easing, stagger, and iteration behavior where applicable.
- Complexity and performance considerations.
- Responsive/mobile notes.
- Accessibility and reduced-motion behavior.
- Supported implementation formats/frameworks.
- Dependency list and version notes where applicable.
- Prompt/specification copy action.
- Code copy/download action only when a tested implementation exists.
- License/attribution and provenance.
- Known limitations and fallback.
- Related entries.
- “Report an issue” or feedback path if a safe existing channel is available.

### 3.4 Prompt and code actions

- **Copy prompt:** copies a structured implementation brief with goal, interaction, visual behavior, timing, easing, accessibility, responsive rules, performance requirements, and constraints.
- **Copy code:** only shown when a vetted code artifact exists. Include the required dependencies and setup notes.
- **Download HTML:** optional; only for examples explicitly tested as self-contained and safe. Do not label a snippet self-contained if it requires unavailable assets or external libraries.
- Give accessible confirmation after copy; never expose internal prompts, API keys, environment variables, private repo details, or secrets.
- Escape content when rendering metadata and snippets. Never inject catalogue strings as raw HTML.

---

## 4. Motion catalogue — required categories and entries

The following is the initial taxonomy and completeness checklist. Each named pattern is a catalogue entry or a clearly grouped variant. Add variants when useful, but do not create near-duplicate entries merely to inflate the count. Each entry must have a stable ID, concise description, trigger, preview, implementation notes, and accessibility/performance metadata.

### A. Hero sections and first-impression motion

- Fade-in hero content
- Staggered headline reveal
- Word-by-word headline
- Character-by-character headline
- Split-text line reveal
- Masked text reveal
- Typewriter / rotating phrase
- Scramble / decode text
- Text highlight sweep
- Underline draw
- Animated gradient text (demo only; shell stays monochrome)
- Hero image reveal
- Image clip-path reveal
- Product mockup float
- Layered parallax hero
- Scroll-linked hero transformation
- Sticky hero with content transition
- CTA entrance and emphasis
- Animated metric/stat hero
- Logo mark reveal
- Bento-grid stagger entrance
- Asymmetric editorial hero
- Minimal monochrome hero
- Orange-accented focus/reveal
- Reduced-motion static hero alternative

### B. Text, typography, and content reveal

- Fade/slide in
- Blur-to-sharp reveal
- Mask/clip reveal
- Word/character stagger
- Line-by-line paragraph reveal
- Scroll-triggered section reveal
- Text scramble/decode
- Typewriter and caret
- Rotating text
- Number/count-up animation
- Text highlight marker
- Underline draw
- Strikethrough transition
- Variable-font weight transition (when supported)
- Letter-spacing transition
- Inline status text transition
- Expandable disclosure text
- Read-more expansion
- Animated breadcrumb/title change
- Search-result highlight
- Citation/source reveal
- Empty-state text entrance

### C. Navigation, menus, and wayfinding

- Underline follows active nav item
- Sliding active indicator
- Animated tab indicator
- Dropdown open/close
- Mega-menu reveal
- Mobile drawer
- Full-screen navigation overlay
- Hamburger-to-close morph
- Breadcrumb transition
- Sidebar collapse/expand
- Nested navigation reveal
- Command palette open/close
- Search suggestion panel
- Search clear transition
- Sticky header compression
- Header hide/reveal on scroll (never trap navigation)
- Anchor scroll cue
- Active section/scroll spy indicator
- Pagination transition
- Back-to-top appearance
- Tooltip/popover
- Focus-visible navigation feedback

### D. Buttons, links, and controls

- Subtle hover lift
- Press/depress tactile feedback
- Border/underline reveal
- Background fill wipe
- Icon nudge
- Arrow slide
- Loading spinner
- Loading-to-success state
- Loading-to-error state
- Copy button feedback
- Toggle switch
- Checkbox check draw
- Radio selection indicator
- Segmented-control indicator
- Range slider thumb/track
- Focus ring transition
- Disabled-state transition
- Button group stagger
- Icon swap
- Hold/long-press progress (must have accessible alternative)
- Ripple only as an optional restrained variant; avoid excessive visual noise

### E. Cards, tiles, and grids

- Card fade/slide entrance
- Staggered card grid
- Hover elevation
- Border highlight
- Image zoom within clipped card
- Image-to-detail transition
- Expandable card
- Flip card (include non-flip accessible alternative)
- Stack/deck card
- Bento-grid reveal
- Masonry/grid appearance
- Drag-and-drop card
- Reorder list
- Selected-card outline
- Multi-select selection transition
- Card skeleton-to-content
- Empty-grid reveal
- Filtered grid exit/entry
- Layout morph / shared-element transition
- Responsive grid reflow without jarring motion

### F. Dialogs, sheets, popovers, and overlays

- Modal fade/scale
- Modal slide-up
- Bottom sheet
- Side drawer
- Popover
- Tooltip
- Context menu
- Lightbox
- Full-screen viewer
- Confirmation dialog
- Toast notification
- Snackbar
- Command palette
- Nested dialog policy example (avoid nested dialogs where possible)
- Backdrop opacity
- Focus entry/exit
- Escape-key close
- Focus restoration after dismissal
- Scroll-lock transition that does not cause page jumps

### G. Forms, input, validation, and onboarding

- Input focus border
- Floating label
- Input icon transition
- Password visibility toggle
- Validation success/error
- Inline error message reveal
- Form submit loading
- Submit success state
- Stepper/wizard transition
- Multi-step form progress
- Checkbox/radio reveal
- Select menu
- Autocomplete suggestions
- Token/chip input
- Tag add/remove
- File upload progress
- Drag/drop upload zone
- Upload complete/failure
- OTP input focus movement
- Inline onboarding coachmark
- Progress checklist
- Form section expand/collapse
- Unsaved-changes warning
- Accessible error summary and focus target

### H. Loading, skeletons, progress, and system feedback

- Spinner
- Dots/typing indicator
- Pulsing indicator (non-flashing)
- Skeleton shimmer
- Static skeleton for reduced motion
- Progress bar
- Indeterminate progress
- Circular progress
- Step progress
- Upload/download progress
- Queue/waiting state
- Optimistic update with rollback
- Retry state
- Offline/online transition
- Connection status indicator
- Empty state
- Error state
- Success state
- Warning banner
- Toast stack
- Status badge transition
- Background task completion
- Streaming text reveal
- Stop/cancel transition
- Retry/regenerate control feedback

### I. Data visualization and dashboard motion

- Count-up KPI
- Bar chart entrance
- Line chart draw
- Area chart reveal
- Pie/donut chart draw
- Progress ring
- Sparkline reveal
- Tooltip/data-point hover
- Legend toggle
- Series hide/show
- Axis/label transition
- Chart filter transition
- Time-range transition
- Table row highlight
- Sort indicator
- Table row expand
- Pagination transition
- Filter chips
- Metric comparison transition
- Heatmap reveal
- Network graph reveal (bounded)
- Data update pulse (subtle, not constant)
- Accessible data-table alternative for every essential chart

### J. Scroll, page, and section transitions

- Fade/slide on scroll
- Parallax layers
- Sticky section
- Scroll progress indicator
- Horizontal scroll gallery
- Pinned story section
- Section-to-section color/surface change
- Image reveal on scroll
- Scroll-linked scale/position
- Snap-scrolling demo (with keyboard/touch support and no trapping)
- Page transition fade
- Shared-element transition
- Route loading indicator
- View-transition API demo with fallback
- Reveal footer
- Back-to-top button
- Infinite-scroll sentinel example with explicit pagination alternative
- Scroll restoration when returning to results

### K. Image, media, and gallery motion

- Image fade-in
- Blur-up placeholder
- Progressive image reveal
- Clip-path wipe
- Pan/zoom
- Ken Burns effect
- Before/after slider
- Image comparison reveal
- Lightbox transition
- Thumbnail-to-viewer shared transition
- Carousel slide/fade
- Infinite carousel (with reduced-motion alternative)
- Swipe gallery
- Image stack
- Video poster-to-play
- Media controls reveal
- Audio waveform entrance (visual only unless user activates playback)
- Caption/subtitle reveal
- Lazy-loaded image placeholder
- Failed-image fallback
- Gallery “Show more” reveal
- Responsive image grid reflow

### L. 3D, WebGL, canvas, and shader effects

- Rotating 3D object
- 3D card tilt (pointer and touch fallback)
- Depth/parallax scene
- Particle field
- Particle burst (finite, not continuous)
- Noise/displacement shader
- Liquid distortion
- Refractive/glass-like surface
- Chromatic aberration (subtle and optional)
- Mesh deformation
- Morphing geometry
- Scroll-controlled 3D scene
- Pointer-reactive object
- Camera orbit
- 3D carousel
- Canvas drawing/reveal
- SVG path morph
- SVG stroke draw
- Procedural pattern
- WebGL capability/fallback example
- Static poster fallback and context-loss recovery

**Guardrails:** 3D/WebGL is opt-in per preview, lazy-load only when opened/visible, release GPU resources on unmount, respect device capability, avoid sustained high CPU/GPU usage, and provide a static reduced-motion alternative. Never assume WebGL is available.

### M. Particles, ambient backgrounds, and decorative effects

- Sparse floating particles
- Gentle grain/noise texture
- Dot-grid reveal
- Line-grid reveal
- Subtle spotlight following pointer (disable on touch/reduced motion)
- Ambient orbiting dots
- Wave field
- Mesh gradient demo
- Aurora effect (optional demo, not shell default)
- Constellation lines
- Connected-node graph
- Bokeh drift
- Soft glow pulse (finite and low contrast)
- Geometric line draw
- Circular orbit diagram
- Sound-reactive visualization only after explicit audio permission/activation
- Static fallback for every ambient effect

### N. SVG, icons, logos, and micro-interactions

- SVG line draw
- Icon morph
- Checkmark draw
- Loading-to-check icon
- Logo reveal
- Logo stroke-to-fill
- Geometric shape morph
- Animated badge
- Notification dot
- Counter badge update
- Connection status icon
- Copy icon to checkmark
- Plus-to-minus morph
- Chevron rotation
- Theme icon transition
- Adaptive light/dark logo
- NasrinAI-inspired orange accent mark (original, not a copied reference asset)

### O. Drag, gesture, and touch interactions

- Drag-and-drop target
- Drag card reorder
- Swipe-to-dismiss
- Swipe carousel
- Pull-to-refresh (never replace native refresh unexpectedly)
- Long-press context menu
- Drag handle feedback
- Magnetic hover (desktop-only and restrained)
- Pointer-following tilt
- Cursor spotlight (desktop only)
- Touch ripple (optional)
- Pinch/zoom demo with keyboard controls where practical
- Gesture progress indicator
- Drop-zone success/error
- Mobile-friendly fallback for every pointer-only pattern

### P. E-commerce, booking, and product flows

- Product image thumbnail selection
- Variant/color swatch transition
- Product detail image transition
- Add-to-cart feedback
- Cart drawer
- Cart quantity update
- Price/discount change emphasis
- Checkout stepper
- Booking calendar date selection
- Time-slot selection
- Seat/slot selection
- Reservation confirmation
- Order status timeline
- Shipping progress
- Rating/review interaction
- Favorite/heart toggle
- Comparison tray
- Filter/sort result transition
- Stock/availability status (no misleading fake live data)

### Q. Chat, AI, voice, and assistant interfaces

- Typing dots
- Streaming response reveal
- Message entrance
- Message group spacing/merge
- Stop-generation state
- Retry/regenerate feedback
- Copy response feedback
- Source/citation panel reveal
- Expand/collapse reasoning summary (never reveal hidden internal reasoning)
- Attachment chip entrance/removal
- File upload progress
- Tool/activity status timeline
- Task step progress
- Response completion indicator
- Voice waveform idle/listening/speaking states
- Microphone mute/unmute state
- Speech playback progress
- Pause/resume playback
- Expandable transcript
- Interrupt/stop speech state
- Voice activity indicator with static fallback
- AI-generated media job progress
- Image/video preview transition
- Chat search highlight
- Conversation switch transition
- Project-context selection transition
- Token/usage meter animation only when actual values are available; never fabricate values

### R. Calendar, timeline, and scheduling

- Calendar month navigation
- Date selection
- Range selection
- Event chip reveal
- Event drag/move
- Timeline progress
- Schedule conflict indicator
- Time-slot hover/focus
- Day/week/month/year view transition
- Agenda expand/collapse
- Reminder toast
- Countdown (only when based on a real date/time)
- Time-zone label transition
- Accessible list alternative to calendar grids

### S. Maps, spatial, and location-based UI

- Map marker drop
- Marker selection
- Cluster expand
- Route line draw
- Route step progress
- Location accuracy pulse (subtle; never imply live tracking without permission)
- Map layer transition
- Geofence outline reveal
- Map panel/drawer
- Place-card transition
- Distance/ETA update emphasis only for real values
- Keyboard-accessible list of places and route steps

### T. Pricing, billing, and plan selection

- Pricing card focus/selection
- Plan comparison highlight
- Billing-period toggle
- Feature accordion
- Usage meter
- Payment pending/success/failure
- Receipt panel reveal
- Invoice row expand
- Limit reached notice
- Upgrade/downgrade confirmation
- Usage reset countdown only when driven by actual configured reset data
- Clear non-animated fallback and no deceptive urgency effects

### U. Settings, preferences, and account UI

- Settings section transition
- Toggle state
- Theme transition
- Language selection
- Notification preference feedback
- Privacy controls
- Expandable advanced settings
- Connected account status
- Integration connect/disconnect state
- Security/session list expansion
- Data export progress
- Delete-account confirmation state
- Save/saved indicator
- Unsaved-changes indicator
- Responsive settings navigation

### V. Workflow, automation, and node editors

- Node add/remove
- Node connection draw
- Edge/connector animation
- Drag node
- Snap-to-grid
- Port hover/selection
- Workflow validation status
- Run/pause/stop controls
- Execution path highlight
- Step-by-step run timeline
- Success/failure node state
- Branch reveal
- Zoom/pan feedback
- Minimap viewport
- Undo/redo feedback
- Accessible list-based workflow representation where practical
- Clear distinction between a visual demo and an actual executed workflow

### W. Education, research, and documentation

- Citation/source card reveal
- Footnote/popover
- Table-of-contents active marker
- Code block copy feedback
- Code tab switch
- Syntax highlight loading fallback
- Diff line highlight
- Step-by-step tutorial reveal
- Progress checklist
- Quiz answer feedback
- Flashcard flip with accessible alternative
- Formula/diagram reveal
- Timeline of events
- Reading progress bar
- Reference list expansion
- Search-result match highlight
- Export/download progress

### X. Error, edge-case, and recovery motion

- 404 illustration/transition
- Offline banner
- Retry button state
- Permission-denied state
- Unsupported browser fallback
- WebGL unavailable fallback
- Animation asset failed fallback
- Network timeout state
- Session expired notice
- Form validation recovery
- Undo toast
- Optimistic action rollback
- Empty result recovery
- Reduced-motion static rendering
- Low-power/data-saver mode
- Error boundary fallback
- Avoid motion that hides errors or delays recovery controls

### Y. Brand, onboarding, and delight

- First-visit introduction
- Feature spotlight
- Progressive onboarding
- Checklist completion
- Original NasrinAI mark reveal
- Orange accent stroke draw
- Small success flourish (finite and optional)
- Confetti only for genuinely meaningful completion, with reduced-motion alternative
- Milestone progress
- Welcome panel transition
- Empty-state action reveal
- Easter egg only if it does not obstruct accessibility or performance

### Z. Advanced and missing patterns to add beyond the reference-inspired baseline

- FLIP/layout animation for list reordering
- Shared-element transitions between cards and detail pages
- CSS View Transitions API with robust fallback
- Scroll-driven CSS animations with JavaScript fallback
- Motion tokens and reusable timing/easing presets
- Spring/physics-based transitions with bounded duration
- State-machine-driven multi-stage transitions
- Interruptible/reversible transitions
- Nested animation coordination and stagger orchestration
- Animation timeline scrubbing
- Before/after motion comparison
- Side-by-side variant comparison
- Playback speed selector (for demos that support it)
- Reduced-motion preview mode
- Low-power mode
- Performance-cost label (low/medium/high, based on documented assessment, not an unmeasured claim)
- Browser support and fallback matrix
- Interaction recorder/gif/video poster only if safely generated and stored
- Design-token export for duration/easing
- Copy prompt templates for React, vanilla HTML/CSS/JS, and other supported targets only where actually tested
- Component state matrix (default, hover, focus, active, loading, success, error, disabled)
- Keyboard-only interaction demos
- Touch-first interaction demos
- RTL layout and direction-aware motion
- Localization-safe text transitions
- High-contrast mode behavior
- Font-loading/late-layout-shift resilience
- Resize/orientation transition resilience
- Visibility pause/resume and page lifecycle handling

---

## 5. Catalogue metadata and content model

Every entry should use a consistent validated schema. Start with static, version-controlled catalogue data unless scale or product requirements justify a database. Do not add a new database migration simply for convenience.

Required logical fields:

- `id`: immutable unique identifier.
- `slug`: unique URL-safe slug.
- `title`: human-readable name.
- `summary`: short description.
- `categoryId`: one primary category.
- `tags`: searchable tags.
- `trigger`: interaction trigger.
- `previewType`: CSS, SVG, canvas, isolated HTML, video/poster, or static.
- `previewAsset` / `implementationRef`: safe, repository-controlled reference.
- `implementationTargets`: supported formats/frameworks.
- `dependencies`: package/library name and version range if applicable.
- `durationMs`, `delayMs`, `easing`, `staggerMs`: when applicable.
- `complexity`: beginner/intermediate/advanced, defined consistently.
- `performanceCost`: low/medium/high plus rationale and measurement status.
- `reducedMotionSupported`: boolean and fallback description.
- `keyboardAccessible`: boolean and test status.
- `touchSupported`: boolean and fallback description.
- `browserSupport`: verified browsers or known limitations.
- `license` / `attribution`: explicit provenance; do not assume public code is license-free.
- `status`: draft, reviewed, tested, published, deprecated.
- `createdAt`, `updatedAt`: version-control or content timestamps as appropriate.
- `relatedIds`: valid references only.

Schema validation must reject duplicate IDs/slugs, unknown categories, unsafe paths, malformed metadata, unsupported preview types, and unlicensed copied assets. Missing optional fields should have intentional UI fallbacks; do not display invented metadata.

### Search and filtering

Search title, summary, category, tags, trigger, and supported implementation targets. Normalize case and whitespace; debounce input; keep keyboard behavior predictable. Do not transmit search queries to a third party. If a search index is used, build it locally or use the existing approved stack.

Filters should compose predictably. Result count must reflect the active query and filters. Clear-all resets every filter and returns to a helpful state. Empty states explain how to recover. Preserve state in the URL only if it is implemented safely and consistently with app conventions.

### Favorites and recent views

Optional follow-up feature, not a launch blocker:
- Prefer local preference storage for anonymous favorites unless account sync is explicitly requested.
- If synced, use the existing authenticated identity, tenant boundaries, and approved data access patterns.
- Do not add cross-user tracking or persist sensitive interaction data.
- Provide a clear way to clear recent views/favorites.

---

## 6. Implementation architecture and safety boundaries

### 6.1 Architecture principles

- Inspect the existing repository and current deployment layout before choosing files, routing, framework, build system, or hosting configuration.
- Reuse the existing project conventions, dependencies, design tokens, authentication approach, logging, CSP, and test infrastructure.
- The Gallery is a separate subdomain, but it may live in the same repository if the current architecture supports clean separation. Do not assume a separate Vercel project is required; inspect actual deployment configuration first.
- Keep route-specific assets and bundles isolated so Gallery code does not unnecessarily increase core chat payload.
- Avoid introducing a second copy of shared authentication, theme, or design primitives.
- The gallery must still render a useful error/fallback if a preview dependency fails.
- No preview may gain access to NasrinAI session cookies, local storage, API endpoints, or authenticated app origin by default.

### 6.2 Isolating demos

Treat all executable previews as potentially unsafe, even if the content is authored by the team.

Preferred order:
1. CSS/SVG previews rendered directly from trusted, reviewed components.
2. Canvas/WebGL demos implemented as reviewed first-party components with bounded resource usage.
3. HTML/JS demos rendered in a sandboxed iframe with the narrowest possible sandbox permissions and a restrictive CSP.
4. Static poster or recorded preview if safe execution is unavailable.

For sandboxed HTML demos:
- Use a distinct origin where feasible; otherwise use a sandboxed iframe with no same-origin privilege.
- Do not grant `allow-scripts` and `allow-same-origin` together for untrusted content.
- No access to parent DOM, parent storage, auth cookies, or internal APIs.
- No arbitrary network requests, popups, top navigation, downloads, or form submission unless a documented use case requires a narrowly scoped permission.
- Use a restrictive CSP and explicit allowlist for assets.
- Validate postMessage origin, message schema, and source window before accepting messages.
- Do not interpolate user input into HTML or JavaScript.
- Never execute pasted code merely because the user clicks a generic preview button.
- Provide a visible “Preview is isolated” note where helpful.
- Test sandbox escape assumptions and security headers.

### 6.3 Copy/download safety

- Escape and sanitize metadata and code display.
- Copy only the exact reviewed artifact represented by the entry.
- Download names must be normalized and path traversal prevented.
- Avoid bundling secrets, internal URLs, environment values, or private system prompts.
- Clearly label incomplete snippets and dependencies.
- Do not use dynamic `eval`, `new Function`, or equivalent arbitrary execution for previews.

### 6.4 Authentication and privacy

- Determine whether the Gallery is public, account-gated, or partially gated by inspecting product requirements and current access conventions. The catalogue itself should not require sign-in unless a real feature needs it.
- Public catalogue data must never expose user data.
- If favorites/settings are account-bound, enforce owner-scoped access through the existing server/database security model.
- Never weaken or bypass Supabase RLS, grants, tenant checks, or existing authorization.
- No new analytics by default. If operational telemetry is needed, collect only minimal event categories, avoid recording search terms/code/prompt contents, and document retention.
- Do not log full user prompts, copied code contents, auth tokens, cookies, or raw upstream errors.
- Keep privacy/legal changes out of scope unless data collection actually changes; if it does, update applicable notices before release.

### 6.5 Deployment and domain

Target: `gallery.nasrinai.com`.

- Inspect current Vercel projects, custom domains, root/output directories, build settings, and existing `vercel.json` before making changes.
- Add the domain only to the intended deployment project after confirming ownership and routing.
- Do not change DNS records or production environment variables speculatively.
- Keep preview and production environments distinct.
- Configure valid canonical URL, metadata, favicon, CSP, security headers, and error handling.
- Verify TLS certificate, redirect behavior, trailing-slash policy, direct navigation, refresh/deep links, and cache headers.
- Do not claim the subdomain is live until DNS, certificate, deployment, and browser checks confirm it.

---

## 7. Performance budgets and optimization

The Gallery must remain responsive even with hundreds of catalogue entries.

### Required measures

- Lazy-load preview code, 3D libraries, and heavy assets.
- Use route-level and component-level code splitting where the existing build supports it.
- Render only visible/near-visible previews; pause off-screen animations.
- Use pagination or incremental loading; do not mount every preview simultaneously.
- Compress images and use responsive sizes/modern formats where supported.
- Use deterministic poster/fallbacks to prevent layout shift.
- Cache immutable static catalogue assets with fingerprinted filenames; use safe cache policies for HTML and personalized responses.
- Minimize third-party requests; prefer local assets and dependencies.
- Debounce search input and avoid expensive recomputation on every keystroke.
- Memoize only measured expensive computations; avoid unnecessary re-renders and stale state.
- Release event listeners, animation frames, observers, WebGL resources, and media resources on cleanup.
- Use CSS transforms/opacity for common transitions; avoid repeatedly animating layout/paint-heavy properties.
- Avoid forced synchronous layout and read/write layout thrashing.
- Respect reduced-motion and low-power fallbacks.
- Keep initial shell useful before advanced preview modules load.
- Never add a load balancer, connection pool, or server cache without evidence the architecture needs it; this is primarily a catalogue/preview UI and should use the simplest adequate deployment.

### Suggested acceptance targets

Treat these as targets to measure, not guaranteed outcomes:
- Lighthouse Performance: aim for 90+ on representative desktop/mobile production pages, with exceptions documented.
- Accessibility: aim for 95+ and fix all known critical accessibility failures.
- Best Practices and SEO: aim for 95+ where applicable.
- No severe console errors, unhandled promise rejections, repeated network failures, or major layout shifts.
- Keep the initial JS bundle small and exclude heavy demo engines from the initial route.
- Measure mobile cold load and interaction responsiveness on a realistic device/throttling profile.
- Run at least one audit with an empty cache and one warm-cache audit.
- Record the audit date, URL, viewport, Lighthouse version, and key metrics in the implementation PR.

---

## 8. Accessibility and inclusive motion

Target WCAG 2.2 AA where applicable.

- Respect `prefers-reduced-motion` throughout the shell and every demo.
- Offer an in-app pause control for ongoing non-essential motion.
- No flashing content that could trigger photosensitive reactions.
- Avoid continuous movement that distracts from reading or controls.
- Keep controls keyboard-operable with visible focus.
- Maintain semantic headings, landmarks, labels, and meaningful button names.
- Ensure dialogs manage focus, support Escape when appropriate, and restore focus after closing.
- Do not rely on hover, color, sound, or motion alone to convey state.
- Provide static or textual equivalents for essential visual information.
- Keep text contrast and control contrast sufficient in light and dark themes.
- Ensure zoom/reflow at 200% and narrow viewports without loss of functionality.
- Support touch and keyboard alternatives for gestures.
- Avoid focus being hidden by sticky headers, sheets, or virtual keyboards.
- Keep animations short and purposeful; never delay a user's ability to interact.

---

## 9. Quality assurance and test matrix

### Unit and catalogue validation

- Unique IDs and slugs.
- Valid category and related-entry references.
- Search, filters, sort, result counts, clear-all, no-results.
- Missing optional metadata and broken asset fallback.
- Prompt/code copy content and clipboard failure handling.
- Stable URL/detail routing and back navigation.
- Invalid or unsafe implementation references rejected.
- No duplicate catalogue entries unless explicitly marked as variants.
- Reduced-motion metadata and fallback are present for every animated entry.

### Component and browser tests

- Desktop: 1440 px and 1280 px.
- Tablet: representative 768–1024 px widths.
- Mobile: 390 px and 320 px widths.
- iPhone Safari: current supported iOS/Safari; test keyboard, safe area, touch, back/forward, reload, theme, and orientation.
- Keyboard-only navigation.
- Light, dark, and system theme.
- Reduced-motion enabled.
- Touch device with no hover.
- Low-end/limited-GPU fallback.
- No JavaScript or preview module failure fallback.
- Direct deep link and page refresh.
- Search with special characters and long queries.
- Rapid filter changes and navigation during an active animation.
- Pause/resume behavior and off-screen pause.
- Clipboard denied/unavailable.
- WebGL unavailable/context lost.
- Sandbox iframe blocked-network attempt.
- CSP and security-header verification.

### Automated safety/performance checks

- Existing full test suite must pass.
- Add focused regression tests for each new behavior.
- Run the repository's actual secret scanner and dependency/security checks.
- Run lint/type/build checks if defined by the project.
- Run Lighthouse and capture report artifacts.
- Verify no cross-origin demo can read core NasrinAI data or make authenticated requests.
- Verify no preview can escape its sandbox or navigate the parent.
- Verify no unexpected third-party requests.
- Do not report a skipped test as passed.
- Do not merge while required checks are failing or conflicts remain unresolved.

### Manual release checklist

- [ ] Landing page renders with no console errors.
- [ ] Search and filters compose correctly.
- [ ] Each published entry has a visible preview or explicit fallback.
- [ ] Pause motion and reduced-motion work.
- [ ] Keyboard and screen-reader flow is usable.
- [ ] Mobile Safari has no clipped controls or broken sheets.
- [ ] Copy prompt works and gives accessible feedback.
- [ ] Copy/download code is only available for reviewed implementations.
- [ ] Isolated previews cannot access the main app origin.
- [ ] Performance audits are recorded.
- [ ] Domain, TLS, canonical URLs, CSP, and cache headers are verified.
- [ ] Existing NasrinAI chat, sign-in, settings, and Space remain unaffected.
- [ ] Owner Command Center/handoff documentation records PR, tests, deployment, and remaining work.

---

## 10. Delivery phases and acceptance gates

### Phase 0 — Repository reconnaissance (required before coding)

- Read `CLAUDE.md`, relevant architecture docs, deployment config, test commands, security baseline, and current PR/branch state.
- Identify existing framework, CSS system, routing, shared UI components, test setup, and deployment project.
- Inspect whether an existing Gallery/library implementation can be extended instead of duplicated.
- Identify route/subdomain mapping and any conflict with existing routes.
- Record exact files likely to change and out-of-scope areas.
- **Gate:** written implementation plan grounded in the current repository; no assumptions about infrastructure.

### Phase 1 — Catalogue schema and shell

- Add typed/validated catalogue model and category metadata.
- Build header, category navigation, search/filter/sort controls, cards, empty/loading/error states, detail panel, and responsive layout.
- Implement monochrome/orange visual tokens using the existing theme architecture.
- Add static representative entries across categories before scaling the catalogue.
- **Gate:** layout and data flow work on desktop and mobile; no heavy previews are loaded by default.

### Phase 2 — Core motion primitives

Implement and test reusable examples first:
- Text reveal and typewriter.
- Buttons and icon transitions.
- Cards and grid entrance/filter.
- Dialog, sheet, toast, tooltip.
- Loading/skeleton/progress.
- Scroll reveal and sticky navigation.
- Image/gallery transitions.
- Chart/dashboard motion.
- Chat/voice interaction patterns.
- SVG drawing/morph.
- **Gate:** each primitive has metadata, preview, accessibility/reduced-motion behavior, and regression tests.

### Phase 3 — Advanced previews and isolation

- Add canvas/WebGL/3D and any executable HTML examples behind lazy loading and isolation.
- Add compatibility checks, static fallbacks, lifecycle cleanup, and resource limits.
- Add copy prompt/code flows with provenance.
- **Gate:** security review demonstrates previews cannot access authenticated app context or escape allowed capabilities.

### Phase 4 — Catalogue breadth and curation

- Populate the categories in Section 4.
- Add tags, related entries, difficulty, dependency, performance, and browser metadata.
- Review for duplicate entries, broken previews, unclear licensing, and incomplete fallbacks.
- Add more entries only when quality and metadata meet the same bar.
- **Gate:** coverage checklist reviewed; no fabricated entry count or unsupported compatibility claim.

### Phase 5 — Performance, accessibility, and QA

- Run the complete test suite, secret scan, security checks, responsive tests, and Lighthouse.
- Fix issues rather than lowering thresholds or skipping failures.
- Verify reduced-motion, keyboard, screen-reader basics, touch, and Safari behavior.
- **Gate:** all required CI checks green and audit results documented.

### Phase 6 — Domain and release

- Configure `gallery.nasrinai.com` only after verifying Vercel project/domain mapping.
- Test preview deployment before production.
- Verify TLS, redirects, deep links, headers, cache, logs, and error fallback.
- Confirm the core NasrinAI app is unaffected.
- **Gate:** live production browser checks and owner sign-off; otherwise mark as not deployed.

### Phase 7 — Maintenance

- Track broken entries, dependency changes, browser regressions, accessibility findings, and performance regressions.
- Deprecate entries safely and preserve stable URLs where possible.
- Re-run checks after changes to preview isolation or rendering.
- Keep this document's status table current.

---

## 11. Progress and owner handoff record

This is the source of truth for Gallery-specific progress until a dedicated owner dashboard entry is created. Update it in the same PR as meaningful work.

| Workstream | Status at specification creation | Evidence required to mark complete |
|---|---|---|
| Product and scope | Documented | Owner review |
| Visual direction | Documented | Responsive implementation screenshots and review |
| Motion taxonomy | Documented; initial catalogue scope defined | Catalogue entries and coverage review |
| Data schema | Not implemented | Schema validation and tests |
| Gallery shell | Not implemented | Browser tests/screenshots |
| Search/filter/sort | Not implemented | Unit + browser tests |
| Preview lifecycle | Not implemented | Pause/off-screen/resource cleanup tests |
| Reduced motion/accessibility | Not implemented | Automated + manual verification |
| Preview isolation | Not implemented | Security tests and header review |
| Prompt/code copy | Not implemented | Copy tests and artifact review |
| Performance audit | Pending | Dated Lighthouse report and fixes |
| Subdomain/domain setup | Pending | Verified DNS, TLS, Vercel mapping |
| CI/security checks | Pending | Actual green required checks; no skipped checks called passed |
| Production verification | Pending | Live desktop + iPhone Safari validation |
| Owner Command Center/handoff | This document is the initial handoff record | Add PR link, current phase, blockers, test results, and deployment state |

### Implementation PR handoff template

When implementation begins, update the table above and record:

- **PR:** link and number.
- **Branch:** exact branch name.
- **Phase:** 0–7.
- **Changed files:** exact list.
- **Tests:** command and actual pass/fail counts.
- **Security:** secret scan, dependency scan, preview isolation review.
- **Accessibility:** reduced-motion and keyboard/mobile verification.
- **Performance:** Lighthouse URL/date/key scores and findings.
- **Deployment:** preview URL, domain status, production URL if verified.
- **Open blockers:** specific failure and owner/action.
- **Rollback:** exact safe rollback procedure.
- **Owner decisions needed:** only unresolved decisions; do not ask again for decisions already recorded here.

### Non-negotiable completion rule

A feature is not “done” because its code was written or a PR was opened. It is done only when required tests pass, the relevant security/accessibility/performance checks are evidenced, the PR is merged through the repository's normal process, and any deployment claim is confirmed against the live site. If deployment or external configuration is pending, label it clearly as pending.

---

## 12. Final acceptance definition

The Gallery is accepted when:

1. `gallery.nasrinai.com` serves the intended Gallery deployment with valid TLS and correct deep links.
2. The design is monochrome/minimalist/premium with restrained orange accents and is clearly distinct from the reference site's branding.
3. The browse/search/filter/card/detail flow is complete and responsive.
4. The motion catalogue covers all categories in Section 4 with real, curated entries—not placeholder count inflation.
5. Every published demo has a safe preview or an explicit fallback, metadata, licensing/provenance, and reduced-motion behavior.
6. Heavy demos are lazy-loaded and off-screen work is paused/cleaned up.
7. No preview can access NasrinAI authenticated context or escape its isolation.
8. Keyboard, touch, light/dark, reduced-motion, and iPhone Safari flows are verified.
9. Performance/security/accessibility findings are fixed or explicitly documented with an owner-approved exception.
10. Existing NasrinAI behavior and data security remain intact.
11. The implementation PR, checks, deployment evidence, and remaining work are recorded in the owner handoff/command center.

**Current truth:** this file is a comprehensive product and implementation specification. It does not mean the Gallery application, domain, or any animation has been implemented or deployed.
