const MAX_PROMPT = 4000;
const normalize = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// POST /api/chat  { prompt }  ->  { answer, cached, similarity? }
//
//   embed -> search -> hit?  return the stored answer
//                      miss? ask the AI -> store prompt+answer+embedding -> return
//
// The cache is an optimisation, never a dependency: if embedding, search or
// saving fails, the user still gets an answer from the AI.
export function createChatController({ cache, askAI, logger = console }) {
  const inflight = new Map();   // identical prompts at the same moment share one AI call

  return async function chat(req, res) {
    const scope = req.user?.id;   // set by your auth middleware
    if (!scope) return res.status(401).json({ error: 'sign_in_required' });

    const prompt = normalize(req.body?.prompt);
    if (!prompt || prompt.length > MAX_PROMPT) {
      return res.status(400).json({ error: 'invalid_prompt', message: `Send a prompt of 1-${MAX_PROMPT} characters.` });
    }

    // 1-3. Embed and search. Any failure here is a miss, not an error.
    let embedding = null;
    try {
      const found = await cache.lookup(prompt, scope);
      embedding = found.embedding;
      if (found.hit) {
        cache.touch(found.hit.id).catch((e) => logger.warn(e.message));   // statistics only; do not wait
        return res.json({ answer: found.hit.response, cached: true, similarity: Number(found.hit.similarity.toFixed(4)) });
      }
    } catch (err) {
      embedding = err.embedding ?? embedding;   // embedding worked but the search failed: still storable
      logger.warn('semantic cache lookup skipped: ' + err.message);
    }

    // 4-5. Miss: ask the AI, save, then answer.
    const key = scope + '\u0000' + prompt;
    let call = inflight.get(key);
    if (!call) {
      call = (async () => {
        const answer = await askAI(prompt);
        if (embedding) {
          try { await cache.store({ scope, prompt, response: answer, embedding }); }
          catch (err) { logger.warn('semantic cache save skipped: ' + err.message); }
        }
        return answer;
      })().finally(() => inflight.delete(key));
      inflight.set(key, call);
    }

    try {
      return res.json({ answer: await call, cached: false });
    } catch (err) {
      logger.error('AI API failed: ' + err.message);
      return res.status(502).json({ error: 'ai_unavailable', message: 'The assistant cannot answer right now. Please try again.' });
    }
  };
}
