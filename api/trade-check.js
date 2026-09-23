import Groq from 'groq-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The model only reads the trade (which units are on which side). Scoring is done
// here from values.json so verdicts always match the published value list.
const TICKET_VALUE = 40;
const FAIR_MARGIN = 0.1; // Within 10% of the bigger side counts as fair.
const MAX_PROMPT_LENGTH = 1000;
// Supports strict JSON-schema output on Groq.
const MODEL = 'qwen/qwen3.8-27b';

const units = JSON.parse(readFileSync(join(process.cwd(), 'values.json'), 'utf8'));
const unitByName = new Map(units.map(unit => [unit.name, unit]));
const unitNames = units.map(unit => unit.name);

const sideSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', enum: unitNames },
      quantity: { type: 'integer' },
    },
    required: ['name', 'quantity'],
    additionalProperties: false,
  },
};
const tradeSchema = {
  type: 'object',
  properties: {
    is_trade: { type: 'boolean', description: 'False if the input does not describe a trade.' },
    user_gives: sideSchema,
    user_gives_tickets: { type: 'integer' },
    user_gets: sideSchema,
    user_gets_tickets: { type: 'integer' },
    unrecognized: { type: 'array', items: { type: 'string' }, description: 'Items mentioned that match no unit on the list.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'Short notes on any guesses made, e.g. which unit a nickname was read as.' },
  },
  required: ['is_trade', 'user_gives', 'user_gives_tickets', 'user_gets', 'user_gets_tickets', 'unrecognized', 'assumptions'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You read trade offers for the Roblox game Toilet Tower Defense and turn them into structured data. You do not judge the trade; the site scores it from its own value list.

The units on the value list, with rarity:
${units.map(unit => `- ${unit.name} (${unit.rarity})`).join('\n')}

How to read the input:
- Players use slang and shorthand: "cam" = Camera Man, "tv" = TV Man, "speaker" = Speaker Man, "dj" = DJ Speaker Man, "ptv" or "party titan tv" = Party Titan TV Man, "engi" = Engineer, "tsm" = Titan Speaker Man, "tcm" = Titan Camera Man, "utc"/"uptc" = Upgraded Titan Camera Man. Map each mention to the closest unit on the list and record the guess in assumptions when it is not obvious.
- Counts like "2", "x2", "two" set the quantity. Missing counts mean 1.
- In "A for B" or "A → B", the user gives A and gets B. "My offer"/"I give" is what the user gives; "their offer"/"for their"/"I get" is what the user gets. If the direction is ambiguous, assume the user gives the side mentioned first and say so in assumptions.
- Tickets are a currency; put ticket amounts in the tickets fields, not as units.
- Anything that matches no unit on the list goes in unrecognized, never forced onto a wrong unit.
- If the input is not a trade at all, set is_trade to false and leave both sides empty.`;

const client = new Groq();

function scoreSide(entries, tickets) {
  const lines = entries
    .filter(entry => entry.quantity > 0 && unitByName.has(entry.name))
    .map(entry => {
      const unit = unitByName.get(entry.name);
      const value = Number(unit.value) || 0;
      return { name: unit.name, image: unit.image, rarity: unit.rarity, demand: unit.demand, status: unit.status, quantity: entry.quantity, value, total: value * entry.quantity };
    });
  const ticketCount = Math.max(0, tickets || 0);
  return { lines, tickets: ticketCount, total: lines.reduce((sum, line) => sum + line.total, 0) + ticketCount * TICKET_VALUE };
}

function verdictFor(gives, gets) {
  const diff = gets.total - gives.total;
  const bigger = Math.max(gives.total, gets.total);
  if (bigger === 0 || Math.abs(diff) <= bigger * FAIR_MARGIN) return 'F';
  return diff > 0 ? 'W' : 'L';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, MAX_PROMPT_LENGTH) : '';
  if (!prompt) return res.status(400).json({ error: 'Describe the trade first.' });

  let response;
  try {
    response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'trade', schema: tradeSchema, strict: true } },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
    });
  } catch (error) {
    if (error instanceof Groq.RateLimitError) return res.status(429).json({ error: 'Too many checks right now. Try again in a minute.' });
    if (error instanceof Groq.BadRequestError) return res.status(400).json({ error: 'That input could not be read. Try different wording.' });
    console.error('Trade check failed', error);
    return res.status(502).json({ error: 'The AI check is unavailable. Try again shortly.' });
  }

  const choice = response.choices[0];
  if (choice?.finish_reason === 'length') return res.status(502).json({ error: 'The AI response was cut off. Try again.' });
  const text = choice?.message?.content;
  let trade;
  try {
    trade = JSON.parse(text);
  } catch {
    return res.status(502).json({ error: 'The AI returned an unreadable answer. Try again.' });
  }

  if (!trade.is_trade) return res.status(200).json({ isTrade: false, assumptions: trade.assumptions });
  const gives = scoreSide(trade.user_gives, trade.user_gives_tickets);
  const gets = scoreSide(trade.user_gets, trade.user_gets_tickets);
  if (!gives.lines.length && !gives.tickets || !gets.lines.length && !gets.tickets) {
    return res.status(200).json({ isTrade: false, unrecognized: trade.unrecognized, assumptions: [...trade.assumptions, 'Both sides of the trade are needed to judge it.'] });
  }
  return res.status(200).json({
    isTrade: true,
    verdict: verdictFor(gives, gets),
    gives,
    gets,
    difference: gets.total - gives.total,
    fairMargin: FAIR_MARGIN,
    unrecognized: trade.unrecognized,
    assumptions: trade.assumptions,
  });
}
