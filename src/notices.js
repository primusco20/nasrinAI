import BASE_NOTICES from '../config/notices.json' with { type: 'json' };
import { NOTICE_ID, readPrefs } from './settings.js';
import { planName } from './plans.js';

// In-app notices: short messages shown when the app opens or a new chat
// starts. The list lives in config/notices.json (edit it, no code change):
//
//   { id, type, when, audience, title, body, from?, until?, action?, requires? }
//     type      info | success | warning | error | security | feature
//     when      open | new_chat | both
//     audience  all | guest | user
//     from/until  ISO dates (a date alone is midnight UTC); shown from `from`
//               up to, not including, `until`
//     action    { label, target }: target is one of TARGETS (in-app places
//               only, never a link)
//     requires  'professional': only while Professional AI is available
//
// Some notices are made for one person (their plan is ending soon). Text is
// plain (the page shows it with textContent). Optional kinds can be turned
// off in Settings; security, warning and error notices always show.
// Signed-in people's closed notices are kept with their account
// (prefs.seen); guests' on their device.

export const TYPES = Object.freeze(['info', 'success', 'warning', 'error', 'security', 'feature']);
export const WHENS = Object.freeze(['open', 'new_chat', 'both']);
export const AUDIENCES = Object.freeze(['all', 'guest', 'user']);
export const TARGETS = Object.freeze(['plans', 'professional', 'privacy', 'security', 'signin', 'settings']);
export const MAX_SHOWN = 3;
const RANK = { security: 0, error: 1, warning: 2, feature: 3, info: 4, success: 5 };
const PLAN_WARN_DAYS = 3;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const day = (v) => (v === undefined ? null : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : NaN);

// Checks the list; a bad entry is left out with a warning, never shown.
export function loadNotices(raw = BASE_NOTICES, logger = null) {
  const out = [];
  const ids = new Set();
  for (const n of Array.isArray(raw) ? raw : []) {
    const from = day(n?.from);
    const until = day(n?.until);
    const ok = n && typeof n === 'object'
      && typeof n.id === 'string' && NOTICE_ID.test(n.id) && !n.id.startsWith('plan-') && !ids.has(n.id)
      && TYPES.includes(n.type) && WHENS.includes(n.when) && AUDIENCES.includes(n.audience)
      && text(n.title, 80) && text(n.body, 240)
      && !Number.isNaN(from) && !Number.isNaN(until)
      && (n.action === undefined || (n.action && text(n.action.label, 30) && TARGETS.includes(n.action.target)))
      && (n.requires === undefined || n.requires === 'professional');
    if (!ok) { if (logger) logger.warn('notice skipped: not valid', { id: typeof n?.id === 'string' ? n.id.slice(0, 64) : null }); continue; }
    ids.add(n.id);
    out.push(Object.freeze({
      id: n.id, type: n.type, when: n.when, audience: n.audience, title: n.title.trim(), body: n.body.trim(),
      from, until, action: n.action ? Object.freeze({ label: n.action.label.trim(), target: n.action.target }) : null,
      requires: n.requires || null
    }));
  }
  return Object.freeze(out);
}

const shape = (n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, action: n.action || null });

export function createNotices({ list = loadNotices(), plans = null, store = null, config, now = () => Date.now() }) {
  const live = (n, when, audience) => {
    const t = now();
    return (n.from === null || n.from <= t) && (n.until === null || t < n.until)
      && (n.when === 'both' || n.when === when)
      && (n.audience === 'all' || n.audience === audience)
      && (n.requires !== 'professional' || config.professional?.enabled !== false);
  };
  const sorted = (items) => items.sort((a, b) => RANK[a.type] - RANK[b.type]).slice(0, MAX_SHOWN).map(shape);

  return {
    // Everyone's notices for this moment; guests filter what they closed on their device.
    general(when) {
      return sorted(list.filter((n) => live(n, when, 'guest')));
    },

    // A signed-in person's notices: their choices and closed notices applied.
    async forUser(caller, when) {
      const prefs = readPrefs({ nasrin_prefs: caller.prefs || {} });
      const items = list.filter((n) => live(n, when, 'user'));
      if (when === 'open' && plans && config.plans?.enabled) {
        const p = await plans.current(caller).catch(() => null);
        const ends = p && p.plan !== 'free' && !p.open && p.endsAt ? Date.parse(p.endsAt) : NaN;
        if (ends > now() && ends - now() <= PLAN_WARN_DAYS * 86_400_000) {
          const local = new Date(ends + 8 * 3_600_000);   // Manila time (UTC+8, no daylight saving)
          const date = `${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
          items.push({
            id: 'plan-ends-' + local.toISOString().slice(0, 10), type: 'warning',
            title: `Your ${planName(p.plan)} plan ends soon`,
            body: `It ends on ${date}. After that, your account is on Free.`,
            action: { label: 'See plans', target: 'plans' }
          });
        }
        if (store) {
          const dayStart = new Date(new Date(now() + 8 * 3_600_000).setUTCHours(0, 0, 0, 0) - 8 * 3_600_000);
          const used = await store.tokensSince({ since: dayStart, tenantId: caller.tenantId, actorType: 'user', actorId: caller.actor.id }).catch(() => 0);
          const limit = Number(config.limits?.userDailyTokens) || 0;
          if (limit > 0 && used >= limit) {
            items.push({
              id: 'usage-limit-chat-' + new Date(now()).toISOString().slice(0, 10),
              type: 'warning',
              title: 'You reached today’s chat limit',
              body: p?.plan === 'ultra' ? 'Your daily chat limit has been reached. It resets at midnight (Manila time).' : 'Your daily chat limit has been reached. Upgrade your plan for more capacity.',
              action: p?.plan === 'ultra' ? null : { label: 'Upgrade plan', target: 'plans' }
            });
          } else if (limit > 0 && used / limit >= 0.9) {
            items.push({
              id: 'usage-near-chat-' + new Date(now()).toISOString().slice(0, 10),
              type: 'warning',
              title: 'You’re close to today’s chat limit',
              body: p?.plan === 'ultra' ? 'You have used at least 90% of today’s chat allowance. Your limit resets at midnight (Manila time).' : 'You have used at least 90% of today’s chat allowance. Consider upgrading before you run out.',
              action: p?.plan === 'ultra' ? null : { label: 'See plans', target: 'plans' }
            });
          }
        }
      }
      return sorted(items.filter((n) => !prefs.seen.includes(n.id)
        && (n.type !== 'feature' || prefs.notices.features)
        && ((n.type !== 'info' && n.type !== 'success') || prefs.notices.tips)));
    }
  };
}
