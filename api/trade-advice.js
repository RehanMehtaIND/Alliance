import { FAIR_MARGIN, SERIAL_VALUED_UNITS, SLANG_RULE, TICKET_VALUE, aiHandler, readWithModel, scoreSide, sideSchema, unitByName, unitListText, unitNameSchema, unitValue, units } from '../lib/trade.js';

// The model only reads which units the question is about. Fair packages are built
// here from values.json so suggestions always match the published value list.
const MAX_PIECES = 4; // Largest mixed package suggested.
const MAX_BULK = 10; // Largest stack of a single unit suggested.
const MIN_SHARE = 0.05; // Skip filler units worth under 5% of the target.
const MAX_SUGGESTIONS = 4;

const adviceSchema = {
  type: 'object',
  properties: {
    is_question: { type: 'boolean', description: 'False if the input does not ask what a unit or set of units is worth in trades.' },
    units: sideSchema,
    tickets: { type: 'integer' },
    direction: { type: 'string', enum: ['selling', 'buying', 'unclear'] },
    prefer_units: { type: 'array', items: unitNameSchema, description: 'Units the user says they want in the other side of the trade.' },
    avoid_units: { type: 'array', items: unitNameSchema, description: 'Units the user says they do not want in the other side of the trade.' },
    unrecognized: { type: 'array', items: { type: 'string' }, description: 'Items mentioned that match no unit on the list.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'Short notes on any guesses made, e.g. which unit a nickname was read as.' },
  },
  required: ['is_question', 'units', 'tickets', 'direction', 'prefer_units', 'avoid_units', 'unrecognized', 'assumptions'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You read trade questions for the Roblox game Toilet Tower Defense and turn them into structured data. You do not suggest trades yourself; the site builds fair offers from its own value list.

The units on the value list, with rarity:
${unitListText}

How to read the input:
${SLANG_RULE}
- units is the unit or units the question is about, e.g. "what should I ask for my 2 tcm" means 2 Titan Camera Man. Counts like "2", "x2", "two" set the quantity. Missing counts mean 1.
- direction is "selling" when the user owns those units and asks what to get for them ("what should I ask for my…", "what can I get for…"), "buying" when the user wants those units and asks what to offer ("what should I trade for…", "how do I get…"), otherwise "unclear".
- If the user names units they want or don't want in return ("I want tcms", "no dj"), put them in prefer_units or avoid_units.
- Tickets are a currency; put ticket amounts in tickets, not as units.
- Anything that matches no unit on the list goes in unrecognized, never forced onto a wrong unit.
- If the input is not a question about trading specific units, set is_question to false and leave units empty.`;

const demandScore = unit => Number(String(unit.demand || '').split('/')[0]) || 0;

// Every multiset of up to MAX_PIECES candidates, plus bulk stacks of one unit.
function* packages(candidates, target) {
  function* mixed(start, picked) {
    if (picked.length) yield picked;
    if (picked.length === MAX_PIECES) return;
    for (let i = start; i < candidates.length; i++) yield* mixed(i, [...picked, candidates[i]]);
  }
  yield* mixed(0, []);
  for (const unit of candidates) {
    const count = Math.round(target / unitValue(unit));
    if (count > MAX_PIECES && count <= MAX_BULK) yield Array(count).fill(unit);
  }
}

function suggest(target, direction, prefer, avoid) {
  const exclude = new Set([...target.lines.map(line => line.name), ...avoid]);
  const candidates = units.filter(unit => {
    const value = unitValue(unit);
    return value > 0 && value >= target.total * MIN_SHARE && value <= target.total * (1 + FAIR_MARGIN) && !exclude.has(unit.name) && !SERIAL_VALUED_UNITS.has(unit.name);
  });
  const scored = [];
  for (const pieces of packages(candidates, target.total)) {
    const total = pieces.reduce((sum, unit) => sum + unitValue(unit), 0);
    const diff = total - target.total;
    if (Math.abs(diff) > Math.max(total, target.total) * FAIR_MARGIN) continue;
    const off = Math.abs(diff) / target.total;
    // Lean slightly high when asking for more, slightly low when offering.
    const wrongWay = direction === 'selling' && diff < 0 || direction === 'buying' && diff > 0 ? off * 30 : 0;
    const demand = pieces.reduce((sum, unit) => sum + demandScore(unit), 0) / pieces.length;
    const dropping = pieces.filter(unit => unit.status === 'dropping').length;
    const preferred = pieces.filter(unit => prefer.has(unit.name)).length;
    const distinct = new Set(pieces).size;
    scored.push({ pieces, score: off * 20 + wrongWay + distinct + pieces.length * 0.4 + dropping - demand * 0.3 - preferred * 3 });
  }
  scored.sort((a, b) => a.score - b.score);

  // Keep variety: each suggestion is led by a different unit.
  const leads = new Set();
  const picks = [];
  for (const { pieces } of scored) {
    const lead = pieces.reduce((best, unit) => unitValue(unit) > unitValue(best) ? unit : best).name;
    if (leads.has(lead)) continue;
    leads.add(lead);
    const counts = new Map();
    pieces.forEach(unit => counts.set(unit.name, (counts.get(unit.name) || 0) + 1));
    const side = scoreSide([...counts].map(([name, quantity]) => ({ name, quantity })), 0);
    picks.push({ ...side, difference: side.total - target.total });
    if (picks.length === MAX_SUGGESTIONS) break;
  }
  return picks;
}

export default aiHandler(async prompt => {
  const question = await readWithModel('advice', adviceSchema, SYSTEM_PROMPT, prompt);
  const target = scoreSide(question.units, question.tickets);
  const base = { direction: question.direction, unrecognized: question.unrecognized, assumptions: question.assumptions };
  if (!question.is_question || !target.lines.length && !target.tickets) return { ...base, isQuestion: false };

  const notes = [];
  const serial = target.lines.filter(line => SERIAL_VALUED_UNITS.has(line.name));
  serial.forEach(line => notes.push(`${line.name}'s value changes with its serial number, so fair trades for it can't be worked out from the value list.`));
  if (!serial.length && target.total === 0) notes.push('That has no listed trade value, so there is nothing to balance it against.');
  const prefer = new Set(question.prefer_units.filter(name => unitByName.has(name)));
  const avoid = new Set(question.avoid_units.filter(name => unitByName.has(name)));
  const suggestions = notes.length ? [] : suggest(target, question.direction, prefer, avoid);
  if (!notes.length && !suggestions.length) notes.push('No mix of units on the value list lands within the fair range for that. Tickets are the closest match.');

  return {
    ...base,
    isQuestion: true,
    target,
    suggestions,
    ticketEquivalent: serial.length || target.total === 0 ? null : Math.round(target.total / TICKET_VALUE),
    fairMargin: FAIR_MARGIN,
    assumptions: [...notes, ...question.assumptions],
  };
});
