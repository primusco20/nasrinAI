// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM server.js:617-617 | chatLimiter (30 req/min per IP)
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
// @@ END VERBATIM
