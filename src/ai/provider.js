// The provider interface. Business logic talks to this, never to a vendor's
// API, so a local model (Phase 3) or another vendor can be added without
// touching the chat code.
//
//   provider.id                 short name stored in usage records ('openai', 'local', ...)
//   provider.model              model name stored in usage records
//   provider.capabilities()     { local: boolean, dataLeavesServer: boolean }
//   provider.listModels()       resolves the model ids this provider can use
//   provider.generate({ system, messages, model, reasoningEffort, attachments, maxTokens, signal })
//       model: optional; defaults to provider.model
//       messages: [{ role: 'user' | 'assistant', content: string }]
//       resolves { text, inputTokens, outputTokens, finishReason }
//       rejects with ProviderError on any failure
//   provider.healthCheck()      resolves true / false, never throws

export class ProviderError extends Error {
  // kind: 'timeout' | 'unavailable' | 'busy' | 'config'
  // status: the provider's HTTP status, when there was one
  constructor(kind, detail, status = null) {
    super(detail);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}

export function assertProvider(p) {
  for (const name of ['generate', 'healthCheck', 'capabilities', 'listModels']) {
    if (typeof p?.[name] !== 'function') throw new Error(`AI provider is missing ${name}()`);
  }
  if (!p.id || !p.model) throw new Error('AI provider needs an id and a model');
  return p;
}
