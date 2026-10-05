// Estimates what a message needs, without calling a model.
// Returns { task, level, reasons } where level is the routing tier:
//   1 cheapest / free   simple chat, translation, short answers, formatting
//   2 low-cost GPT      moderate: simple code, multi-step questions, longer text
//   3 GPT-5-class       complex: debugging, analysis, careful technical work
//   4 GPT-6-class       very complex: architecture, security design, large refactors
//   5 strongest         extreme: whole-system redesigns, long-horizon planning
// These are heuristics. Telemetry (usage_events.task/level/outcome) shows
// whether they route well, and the rules here are tuned from it.

const has = (re, s) => re.test(s);

const CODE = /```|\b(function|class|const|let|var|def|import|return|select\s+.+\s+from|insert into|regex|stack ?trace|exception|traceback|typeerror|referenceerror|syntaxerror|null pointer|segfault|compile|npm|pip|sql|api endpoint|json schema|typescript|javascript|python|java|c\+\+|rust|golang|kotlin|swift)\b/i;
const DEBUG = /\b(bug|debug|error|fails?|failing|broken|crash(es|ing)?|doesn'?t work|not working|exception|stack ?trace|why does .* (fail|break))\b/i;
const ANALYSIS = /\b(analy[sz]e|compare|trade-?offs?|pros and cons|evaluate|step[- ]by[- ]step|explain (why|how)|prove|derive|optimi[sz]e|strategy|plan for|business plan|forecast)\b/i;
const HARD = /\b(architecture|architect|system design|design (a|the) (system|platform|service)|scalab(le|ility)|distributed|security (model|architecture|review)|threat model|refactor|migration plan|database (design|schema|redesign)|authentication (flow|architecture)|multi-?tenant|orchestrat)/i;
const EXTREME = /\b(entire (codebase|repository|system)|whole (codebase|system|platform)|end-to-end (design|architecture)|long-term roadmap|multi-?system|from scratch.*(platform|system)|research (paper|proposal)|formal proof)\b/i;
const DEEPER = /\b(think (hard|deeply|carefully)|be (very )?thorough|in depth|in-depth|deep (dive|analysis)|detailed analysis)\b/i;
const SIMPLE = /^(hi|hello|hey|thanks?|thank you|ok(ay)?|good (morning|afternoon|evening|night)|salamat|kumusta|maayong|who are you|what can you do)\b/i;
const TRANSLATE = /\b(translate|translation|in (english|tagalog|filipino|bisaya|cebuano|spanish|japanese|korean|chinese|french))\b/i;
const WRITE = /\b(write|draft|rewrite|summari[sz]e|reply to|email|message|caption|post|description)\b/i;

export function classify({ message, history = [], attachments = [] }) {
  const text = String(message || '');
  const len = text.length;
  const reasons = [];
  let task = 'chat';
  let level = 1;
  const raise = (to, why) => { if (to > level) { level = to; reasons.push(why); } };

  if (has(SIMPLE, text.trim()) && len < 80) {
    reasons.push('greeting or small talk');
  } else {
    if (has(TRANSLATE, text)) task = 'translate';
    else if (has(WRITE, text)) task = 'writing';
    if (has(CODE, text)) { task = 'coding'; raise(2, 'code'); }
    if (has(DEBUG, text) && task === 'coding') { task = 'debugging'; raise(3, 'debugging code'); }
    if (has(ANALYSIS, text)) { if (task === 'chat') task = 'analysis'; raise(2, 'analysis'); }
    if (has(HARD, text)) { task = task === 'chat' || task === 'analysis' ? 'design' : task; raise(task === 'coding' || task === 'debugging' || task === 'design' ? 4 : 3, 'architecture or system design'); }
    if (has(EXTREME, text)) raise(5, 'whole-system scope');
    if (len > 1500) raise(Math.min(level + 1, 3), 'long request');
    if (len > 6000) raise(Math.min(level + 1, 4), 'very long request');
    if (attachments.some((a) => a.kind === 'pdf')) raise(2, 'PDF to read');
    if (has(DEEPER, text)) raise(Math.min(level + 1, 5), 'asked for deeper thinking');
    // A long back-and-forth on a hard topic keeps its level; small talk stays cheap.
    if (history.length > 16 && level >= 2) raise(Math.min(level + 1, 4), 'long technical conversation');
  }
  return { task, level, reasons };
}
