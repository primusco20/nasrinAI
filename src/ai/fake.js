import { ProviderError } from './provider.js';

// A stand-in model for tests and for running the server locally without any
// AI key. It never leaves the machine. Refused in production by registry.js.
export function createFakeProvider({ reply, failWith = null, dataLeavesServer = false, models = ['fake-echo'] } = {}) {
  const calls = [];
  return {
    id: 'fake',
    model: models[0],
    calls,
    capabilities: () => ({ local: !dataLeavesServer, dataLeavesServer }),
    async generate(request) {
      calls.push(request);
      if (typeof failWith === 'function') {
        const err = failWith(request);
        if (err) throw err;
      } else if (failWith) {
        throw new ProviderError(failWith, 'fake failure');
      }
      const last = request.messages.at(-1)?.content || '';
      const text = reply ? await reply(request) : `You said: ${last}`;
      return {
        text,
        inputTokens: Math.ceil((request.system.length + last.length) / 4),
        outputTokens: Math.ceil(String(text).length / 4),
        finishReason: 'stop',
        model: request.model || models[0]
      };
    },
    async listModels() { return models.slice(); },
    async healthCheck() { return true; }
  };
}
