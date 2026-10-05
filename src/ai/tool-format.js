// Tool calls in the Chat Completions format (OpenAI, Gemini's OpenAI-compatible
// endpoint, local servers that support it). Shared by the providers.
//
// Our messages: { role: 'user' | 'assistant', content }
//             | { role: 'assistant', content, toolCalls: [{ id, name, arguments }] }
//             | { role: 'tool', toolCallId, content }

export const MAX_CALLS_PER_TURN = 3;

export function toChatTurns(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) };
    }
    return { role: m.role, content: m.content };
  });
}

// The model's tool requests, checked for shape only (the registry checks the
// rest): at most MAX_CALLS_PER_TURN, function calls with a short name and
// string arguments.
export function readToolCalls(message) {
  const list = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const out = [];
  for (const c of list) {
    const name = c?.function?.name;
    const args = c?.function?.arguments;
    if (c?.type !== undefined && c.type !== 'function') continue;
    if (typeof name !== 'string' || name.length > 64) continue;
    out.push({ id: typeof c.id === 'string' && c.id ? c.id.slice(0, 100) : `call_${out.length + 1}`, name, arguments: typeof args === 'string' ? args.slice(0, 4096) : JSON.stringify(args ?? {}).slice(0, 4096) });
    if (out.length === MAX_CALLS_PER_TURN) break;
  }
  return out;
}
