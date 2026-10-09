// Answers come from your own providers, tried in order. If one fails (down,
// out of credit, rate limited), the next one answers. Embeddings stay local.
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;

async function post(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const PROVIDERS = {
  openai: {
    key: () => process.env.OPENAI_API_KEY,
    async ask(prompt) {
      const d = await post('https://api.openai.com/v1/chat/completions',
        { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        { model: process.env.OPENAI_MODEL || 'gpt-5.4-nano', messages: [{ role: 'user', content: prompt }] });
      return d.choices?.[0]?.message?.content;
    }
  },
  gemini: {
    key: () => process.env.GEMINI_API_KEY,
    async ask(prompt) {
      const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { 'x-goog-api-key': process.env.GEMINI_API_KEY },
        { contents: [{ role: 'user', parts: [{ text: prompt }] }] });
      return d.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
    }
  },
  anthropic: {
    key: () => process.env.ANTHROPIC_API_KEY,
    async ask(prompt) {
      const d = await post('https://api.anthropic.com/v1/messages',
        { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        { model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] });
      return d.content?.filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
  }
};

export async function askAI(prompt, { logger = console } = {}) {
  const order = (process.env.AI_PROVIDERS || 'gemini,openai,anthropic').split(',').map((s) => s.trim());
  const errors = [];
  for (const name of order) {
    const p = PROVIDERS[name];
    if (!p || !p.key()) continue;
    try {
      const text = String((await p.ask(prompt)) ?? '').trim();
      if (text) return text;
      errors.push(`${name}: empty answer`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
    logger.warn?.(`AI provider failed, trying the next: ${errors.at(-1)}`);
  }
  throw new Error('no AI provider answered (' + (errors.join('; ') || 'no keys set') + ')');
}
