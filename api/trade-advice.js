import { FAIR_MARGIN, SERIAL_RULE, SIGN_RULE, SLANG_RULE, TICKET_VALUE, aiHandler, readWithModel, scoreSide, sideSchema, unitByName, unitListText, unitNameSchema, unitValue, units, unpricedNotes, verdictFor } from '../lib/trade.js';

// The model only reads which units the question is about. Fair packages are built
// here from values.json so suggestions always match the published value list.
const MAX_PIECES = 4; // Largest mixed package suggested.
const MAX_BULK = 10; // Largest stack of a single unit suggested.
const MIN_SHARE = 0.05; // Skip filler units worth under 5% of the target.
const MAX_SUGGESTIONS = 4;
// Gain aimed for when the user asks for profit or to overpay without saying how much.
const DEFAULT_GAIN = { fair: 0, profit: 0.25, overpay: 0.1 };
const GOAL_TOLERANCE = 0.05; // Profit/overpay packages land within 5% of the aimed total.

const adviceSchema = {
  type: 'object',
  properties: {
    is_question: { type: 'boolean', description: 'False if the input does not ask what a unit or set of units is worth in trades.' },
    units: sideSchema,
    tickets: { type: 'integer' },
    direction: { type: 'string', enum: ['selling', 'buying', 'unclear'] },
    goal: { type: 'string', enum: ['fair', 'profit', 'overpay'] },
    payment: { type: 'string', enum: ['any', 'tickets', 'units'], description: 'What the other side of the trade should be made of.' },
    goal_percent: { type: 'integer', description: 'How much profit or overpay as a percent of the unit value, or 0 if not said.' },
    goal_amount: { type: 'integer', description: 'How much profit or overpay in value points, or 0 if not said.' },
    prefer_units: { type: 'array', items: unitNameSchema, description: 'Units the user says they want in the other side of the trade.' },
    avoid_units: { type: 'array', items: unitNameSchema, description: 'Units the user says they do not want in the other side of the trade.' },
    unrecognized: { type: 'array', items: { type: 'string' }, description: 'Items mentioned that match no unit on the list.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'Short notes on any guesses made, e.g. which unit a nickname was read as.' },
  },
  required: ['is_question', 'units', 'tickets', 'direction', 'goal', 'payment', 'goal_percent', 'goal_amount', 'prefer_units', 'avoid_units', 'unrecognized', 'assumptions'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You read trade questions for the Roblox game Toilet Tower Defense and turn them into structured data. You do not suggest trades yourself; the site builds fair offers from its own value list.

The units on the value list, with rarity:
${unitListText}

How to read the input:
${SLANG_RULE}
${SIGN_RULE}
${SERIAL_RULE}
- units is the unit or units the question is about, e.g. "what should I ask for my 2 tcm" means 2 Titan Camera Man. Counts like "2", "x2", "two" set the quantity. Missing counts mean 1.
- direction is "selling" when the user owns those units and asks what to get for them ("what should I ask for my…", "what can I get for…"), "buying" when the user wants those units and asks what to offer ("what should I trade for…", "how do I get…"), otherwise "unclear".
- goal is "profit" when the user wants to come out ahead ("most profit", "a W", "overpay me", "win"), "overpay" when they accept coming out behind ("I'll take an L", "I can overpay", "quick sell", "less is fine"), otherwise "fair".
- For profit or overpay, put how much in goal_percent ("20% profit" → 20) or goal_amount in value points ("5k less" → 5000; tickets count as ${TICKET_VALUE} points each). Leave both 0 when no amount is given.
- payment is "tickets" when the user only wants tickets in return or only wants to pay in tickets ("for how many tickets", "tickets only", "how many tix"), "units" when they only want units ("no tickets", "units only"), otherwise "any".
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

function suggest(target, aim, direction, prefer, avoid) {
  const exclude = new Set([...target.lines.map(line => line.name), ...avoid]);
  const candidates = units.filter(unit => {
    const value = unitValue(unit);
    return value > 0 && value >= aim.total * MIN_SHARE && value <= aim.total * (1 + aim.tolerance) && !exclude.has(unit.name) && !unit.serials;
  });
  const scored = [];
  for (const pieces of packages(candidates, aim.total)) {
    const total = pieces.reduce((sum, unit) => sum + unitValue(unit), 0);
    const diff = total - aim.total;
    if (Math.abs(diff) > Math.max(total, aim.total) * aim.tolerance) continue;
    const off = Math.abs(diff) / aim.total;
    // Lean slightly your way when asking for more or offering.
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
    const [gives, gets] = direction === 'buying' ? [side, target] : [target, side];
    picks.push({ ...side, difference: side.total - target.total, verdict: verdictFor(gives, gets), gain: (gets.total - gives.total) / gives.total });
    if (picks.length === MAX_SUGGESTIONS) break;
  }
  return picks;
}

// A tickets-only answer, rounded your way: up when asking, down when offering.
function ticketsFor(target, aim, direction) {
  const exact = aim.total / TICKET_VALUE;
  const count = Math.max(1, direction === 'buying' ? Math.floor(exact) : Math.ceil(exact));
  const side = scoreSide([], count);
  const [gives, gets] = direction === 'buying' ? [side, target] : [target, side];
  return { ...side, difference: side.total - target.total, verdict: verdictFor(gives, gets), gain: (gets.total - gives.total) / gives.total };
}

// The package total to aim for. Gain is from the user's side: when selling they get
// the package for their unit, when buying they give the package for the unit.
function aimFor(target, direction, goal, percent, amount) {
  const sign = goal === 'profit' ? 1 : goal === 'overpay' ? -1 : 0;
  const buying = direction === 'buying';
  let total;
  if (sign && amount > 0) total = target.total + (buying ? -sign : sign) * amount;
  else {
    const gain = sign * (percent > 0 ? percent / 100 : DEFAULT_GAIN[goal]);
    total = buying ? target.total / (1 + gain) : target.total * (1 + gain);
  }
  const gain = buying ? target.total / total - 1 : total / target.total - 1;
  return { goal: sign ? goal : 'fair', total, gain, tolerance: sign ? GOAL_TOLERANCE : FAIR_MARGIN };
}

export default aiHandler(async prompt => {
  const question = await readWithModel('advice', adviceSchema, SYSTEM_PROMPT, prompt);
  const target = scoreSide(question.units, question.tickets);
  const base = { direction: question.direction, unrecognized: question.unrecognized, assumptions: question.assumptions };
  if (!question.is_question || !target.lines.length && !target.tickets) return { ...base, isQuestion: false };

  const notes = unpricedNotes(target);
  const unpriced = notes.length > 0;
  if (!unpriced && target.total === 0) notes.push('That has no listed trade value, so there is nothing to balance it against.');
  const prefer = new Set(question.prefer_units.filter(name => unitByName.has(name)));
  const avoid = new Set(question.avoid_units.filter(name => unitByName.has(name)));
  const aim = aimFor(target, question.direction, question.goal, question.goal_percent, question.goal_amount);
  if (!notes.length && !(aim.total > 0 && Number.isFinite(aim.gain))) notes.push('That much of a loss leaves nothing to trade for. Try a smaller amount.');
  const payment = question.payment;
  const suggestions = notes.length ? [] : payment === 'tickets' ? [ticketsFor(target, aim, question.direction)] : suggest(target, aim, question.direction, prefer, avoid);
  if (!notes.length && !suggestions.length && payment === 'units') notes.push('No mix of units on the value list lands close to that.');
  else if (!notes.length && !suggestions.length) notes.push(`No mix of units on the value list lands close to that. Tickets are the closest match: about ${Math.round(aim.total / TICKET_VALUE)}.`);

  return {
    ...base,
    isQuestion: true,
    target,
    suggestions,
    goal: aim.goal,
    payment,
    goalGain: aim.gain,
    ticketEquivalent: unpriced || target.total === 0 ? null : Math.round(target.total / TICKET_VALUE),
    fairMargin: FAIR_MARGIN,
    assumptions: [...notes, ...question.assumptions],
  };
});
