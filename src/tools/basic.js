import { evaluate } from '../ai/logic.js';

// The first tools (Phase 5): read-only, exact, no outside services, no
// personal data. Risky tools (write, money) come later, behind confirmation.

const UNITS = {
  // length (metres)
  mm: ['length', 0.001], cm: ['length', 0.01], m: ['length', 1], km: ['length', 1000],
  in: ['length', 0.0254], ft: ['length', 0.3048], yd: ['length', 0.9144], mi: ['length', 1609.344],
  // mass (kilograms)
  g: ['mass', 0.001], kg: ['mass', 1], lb: ['mass', 0.45359237], oz: ['mass', 0.028349523125],
  // volume (litres)
  ml: ['volume', 0.001], l: ['volume', 1], gal: ['volume', 3.785411784], cup: ['volume', 0.2365882365],
  // temperature (special)
  c: ['temperature'], f: ['temperature'], k: ['temperature']
};
const toKelvin = { c: (v) => v + 273.15, f: (v) => (v - 32) * 5 / 9 + 273.15, k: (v) => v };
const fromKelvin = { c: (v) => v - 273.15, f: (v) => (v - 273.15) * 9 / 5 + 32, k: (v) => v };
const round = (v) => Number(v.toPrecision(10));

export const basicTools = [
  {
    name: 'calculate',
    description: 'Exact arithmetic: numbers, + - * / ^ and parentheses. Use it instead of computing in your head.',
    risk: 'read',
    who: ['guest', 'user', 'service'],
    parameters: { properties: { expression: { type: 'string', maxLength: 200, pattern: '^[0-9.+\\-*/^() ]+$' } }, required: ['expression'] },
    run({ expression }) {
      const value = evaluate(expression);
      if (value === null) throw new Error('not a valid expression');
      return { expression, value: round(value) };
    }
  },
  {
    name: 'current_time',
    description: 'The current date and time in a time zone (IANA name, for example Asia/Manila).',
    risk: 'read',
    who: ['guest', 'user', 'service'],
    parameters: { properties: { time_zone: { type: 'string', maxLength: 60, pattern: '^[A-Za-z_]+(/[A-Za-z0-9_+\\-]+){0,2}$' } }, required: [] },
    run({ time_zone = 'Asia/Manila' }, ctx, now = new Date()) {
      let text;
      try {
        text = new Intl.DateTimeFormat('en-PH', { timeZone: time_zone, dateStyle: 'full', timeStyle: 'short' }).format(now);
      } catch { throw new Error('unknown time zone'); }
      return { time_zone, now: text };
    }
  },
  {
    name: 'convert_units',
    description: 'Convert length (mm cm m km in ft yd mi), mass (g kg lb oz), volume (ml l gal cup) or temperature (c f k).',
    risk: 'read',
    who: ['guest', 'user', 'service'],
    parameters: {
      properties: {
        value: { type: 'number', minimum: -1e12, maximum: 1e12 },
        from: { type: 'string', enum: Object.keys(UNITS) },
        to: { type: 'string', enum: Object.keys(UNITS) }
      },
      required: ['value', 'from', 'to']
    },
    run({ value, from, to }) {
      const [a, fa] = UNITS[from]; const [b, fb] = UNITS[to];
      if (a !== b) throw new Error('units of different kinds');
      const result = a === 'temperature' ? fromKelvin[to](toKelvin[from](value)) : value * fa / fb;
      return { value, from, to, result: round(result) };
    }
  }
];
