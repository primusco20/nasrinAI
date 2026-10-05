import { HttpError } from './http/errors.js';
import { ProviderError } from './ai/provider.js';
import { buildSystemPrompt, fitHistory } from './ai/prompt.js';
import { cleanReply, cleanUserText } from './ai/output.js';
import { redactForProvider } from './ai/redact.js';
import { publicMessage } from './conversations.js';

const unavailable = (retryAfter) => new HttpError(503, 'ai_unavailable',
  'NasrinAI cannot answer right now. Please try again in a moment.', retryAfter ? { retryAfter } : {});

// One chat turn, in a fixed order so nothing is skipped:
//   validate -> limits -> conversation (owner-checked) -> save the user's message
//   -> history from the database -> redact if it leaves the server -> model
//   -> check the output -> save the reply -> usage record
// The browser sends only { conversation_id?, message, model? }; anything else is ignored.
// The model must be one the caller is allowed to pick (see ai/models.js).
export function createChat({ conversations, limiter, usageLog, provider, models, config, logger, now = () => Date.now() }) {
  return async function chat(caller, body, ip) {
    const message = cleanUserText(body.message, config.ai.maxMessageChars);
    if (!message) {
      throw new HttpError(400, 'invalid_message', `Send a message of 1 to ${config.ai.maxMessageChars} characters.`);
    }
    if (body.conversation_id !== undefined && typeof body.conversation_id !== 'string') {
      throw new HttpError(400, 'invalid_conversation', 'conversation_id must be a string.');
    }
    if (!provider) throw unavailable();
    const model = await models.resolve(caller, body.model);

    await limiter.message(caller, ip);
    await limiter.budget(caller);

    const conv = body.conversation_id
      ? await conversations.get(caller, body.conversation_id)
      : await conversations.create(caller);

    const userMessage = await conversations.add(conv, 'user', message);
    if (!conv.title) {
      await conversations.setTitle(conv, message.split('\n')[0].slice(0, 60)).catch(() => {});
    }

    let history = fitHistory(await conversations.history(conv, 50), config.ai.historyChars);
    if (config.ai.redactExternal && provider.capabilities().dataLeavesServer) {
      history = history.map((m) => ({ role: m.role, content: redactForProvider(m.content) }));
    }

    const started = now();
    let result;
    try {
      result = await provider.generate({
        system: buildSystemPrompt({ now: new Date(started) }),
        messages: history,
        model,
        maxTokens: config.ai.maxReplyTokens
      });
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : 'unexpected';
      await usageLog.record(caller, {
        provider: provider.id, model, latencyMs: now() - started,
        outcome: kind === 'timeout' ? 'timeout' : 'provider_error'
      });
      // A model the provider will not run for chat is set aside, so the menu
      // stops offering it. The default model is never set aside this way.
      if (kind === 'config' && (err.status === 400 || err.status === 404) && model !== provider.model) {
        models.markUnusable(model);
        logger.warn('model refused by provider', { model, error: err.message });
        throw new HttpError(400, 'model_unavailable', 'That model cannot be used for chat right now. Pick another.');
      }
      (kind === 'config' || kind === 'unexpected' ? logger.error : logger.warn)('model call failed', { kind, model, error: err.message });
      throw unavailable(kind === 'busy' ? 30 : undefined);
    }

    const reply = cleanReply(result.text);
    await usageLog.record(caller, {
      provider: provider.id, model,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      latencyMs: now() - started, outcome: reply ? 'ok' : 'rejected_output'
    });
    if (!reply) throw unavailable();

    const assistant = await conversations.add(conv, 'assistant', reply);
    return {
      conversation_id: conv.id,
      user_message_id: userMessage.id,
      model,
      message: publicMessage(assistant)
    };
  };
}
