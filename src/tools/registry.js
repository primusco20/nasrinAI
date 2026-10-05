import { checkArgs } from './schema.js';

// The tool engine (Phase 5, step 1). A tool is something code does for the
// model: the model may only *ask*; this file decides, in plain code, whether
// the call runs. The model is never the authority on permissions.
//
//   tool = { name, description, risk: 'read' | 'write' | 'money',
//            who: ['guest', 'user', 'service'],   // actor types allowed
//            parameters: schema (see schema.js), run(args, ctx) -> JSON }
//
// Every call: known tool -> caller allowed -> arguments parsed (size cap) and
// checked against the schema -> risk rule (only 'read' runs without a
// confirmation; 'write'/'money' need confirmed = true, which comes from the
// person tapping Confirm, never from the model) -> run with a time limit ->
// result size cap -> usage record (tool name, outcome, time; no arguments,
// no results). ctx carries tenant and actor from the credential only, never
// from the arguments, so a tool cannot reach another person's data.

const MAX_ARGS = 4096;
const MAX_RESULT = 8192;

export class ToolError extends Error {
  // code: unknown_tool | not_allowed | invalid_arguments | needs_confirmation | failed | timeout
  constructor(code, detail) { super(detail); this.name = 'ToolError'; this.code = code; }
}

export function createToolRegistry({ tools, usageLog = null, logger = null, timeoutMs = 3000, now = () => Date.now() }) {
  const byName = new Map();
  for (const t of tools) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(t.name) || byName.has(t.name)) throw new Error(`tool name ${t.name} is invalid or repeated`);
    if (!['read', 'write', 'money'].includes(t.risk)) throw new Error(`tool ${t.name} needs a risk level`);
    if (typeof t.run !== 'function' || !t.parameters || !Array.isArray(t.who)) throw new Error(`tool ${t.name} is incomplete`);
    byName.set(t.name, Object.freeze({ ...t }));
  }

  const record = (caller, name, outcome, started) => usageLog && usageLog.record(caller, {
    provider: 'tool', model: name, outcome, task: 'tool', latencyMs: now() - started, costUsd: 0
  });

  return {
    // One tool's public facts (for the Confirm card), or null.
    get(name) {
      const t = byName.get(name);
      return t ? { name: t.name, description: t.description, risk: t.risk, parameters: t.parameters } : null;
    },

    // The tools this caller may use, in the shape the model API takes.
    specsFor(caller) {
      return [...byName.values()].filter((t) => t.who.includes(caller.actor.type) && (!t.allowed || t.allowed(caller))).map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: { type: 'object', additionalProperties: false, ...t.parameters } }
      }));
    },

    // Runs one call the model asked for. rawArgs: a JSON string (as models
    // send it) or an object. Resolves the tool's result; rejects with ToolError.
    async run(caller, name, rawArgs, { confirmed = false } = {}) {
      const started = now();
      const fail = async (code, detail, outcome = 'rejected_output') => {
        await record(caller, byName.has(name) ? name : 'unknown', outcome, started);
        if (logger) logger.warn('tool call refused', { tool: byName.has(name) ? name : 'unknown', code });
        throw new ToolError(code, detail);
      };
      const tool = byName.get(name);
      if (!tool) return fail('unknown_tool', 'There is no such tool.');
      if (!tool.who.includes(caller.actor.type) || (tool.allowed && !tool.allowed(caller))) return fail('not_allowed', 'This tool is not available to you.');

      let args = rawArgs ?? {};
      if (typeof args === 'string') {
        if (args.length > MAX_ARGS) return fail('invalid_arguments', 'The tool input is too long.');
        try { args = args.trim() ? JSON.parse(args) : {}; } catch { return fail('invalid_arguments', 'The tool input is not valid JSON.'); }
      } else if (JSON.stringify(args).length > MAX_ARGS) {
        return fail('invalid_arguments', 'The tool input is too long.');
      }
      const problem = checkArgs(tool.parameters, args);
      if (problem) return fail('invalid_arguments', problem);
      if (tool.risk !== 'read' && confirmed !== true) return fail('needs_confirmation', 'This action needs your confirmation first.');

      const ctx = Object.freeze({ tenantId: caller.tenantId, actor: Object.freeze({ ...caller.actor }) });
      let timer;
      let result;
      try {
        result = await Promise.race([
          Promise.resolve().then(() => tool.run(args, ctx)),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new ToolError('timeout', 'The tool took too long.')), timeoutMs); })
        ]);
      } catch (err) {
        const timeout = err instanceof ToolError && err.code === 'timeout';
        return fail(timeout ? 'timeout' : 'failed', timeout ? err.message : 'The tool could not finish.', timeout ? 'timeout' : 'provider_error');
      } finally {
        clearTimeout(timer);
      }
      let text;
      try { text = JSON.stringify(result); } catch { text = undefined; }
      if (text === undefined || text.length > MAX_RESULT) return fail('failed', 'The tool returned something that cannot be used.', 'provider_error');
      await record(caller, name, 'ok', started);
      return JSON.parse(text);
    }
  };
}
