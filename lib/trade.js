import Groq from 'groq-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Shared by the AI endpoints. The model only reads text into structured data;
// all values come from values.json so answers always match the published list.
export const TICKET_VALUE = 55;
export const FAIR_MARGIN = 0.1; // Within 10% of the bigger side counts as fair.
export const MAX_PROMPT_LENGTH = 1000;
// Units whose value depends on serial number, so a listed value can't judge a trade.
export const SERIAL_VALUED_UNITS = new Set(['10M Speaker Man']);
// Supports strict JSON-schema output on Groq.
const MODEL = 'qwen/qwen3.8-27b';

export const units = JSON.parse(readFileSync(join(process.cwd(), 'values.json'), 'utf8'));
export const unitByName = new Map(units.map(unit => [unit.name, unit]));
const unitNames = units.map(unit => unit.name);
export const unitValue = unit => Number(String(unit.value).replaceAll(',', '')) || 0;

export const unitListText = units.map(unit => `- ${unit.name} (${unit.rarity})`).join('\n');
export const SLANG_RULE = '- Players use slang and shorthand: "cam" = Camera Man, "tv" = TV Man, "speaker" = Speaker Man, "dj" = DJ Speaker Man, "ptv" or "party titan tv" = Party Titan TV Man, "engi" = Engineer, "tsm" = Titan Speaker Man, "uts"/"upts"/"ts 2.0"/"tsm 2.0" = Titan Speaker Man 2.0, "tcm" = Titan Camera Man, "utc"/"uptc" = Upgraded Titan Camera Man, "builder"/"constructor" = Builder Camera Man. Map each mention to the closest unit on the list and record the guess in assumptions when it is not obvious.';

export const unitNameSchema = { type: 'string', enum: unitNames };
export const sideSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: unitNameSchema,
      quantity: { type: 'integer' },
    },
    required: ['name', 'quantity'],
    additionalProperties: false,
  },
};

export function scoreSide(entries, tickets) {
  const lines = entries
    .filter(entry => entry.quantity > 0 && unitByName.has(entry.name))
    .map(entry => {
      const unit = unitByName.get(entry.name);
      const value = unitValue(unit);
      return { name: unit.name, image: unit.image, rarity: unit.rarity, demand: unit.demand, status: unit.status, quantity: entry.quantity, value, total: value * entry.quantity };
    });
  const ticketCount = Math.max(0, tickets || 0);
  return { lines, tickets: ticketCount, total: lines.reduce((sum, line) => sum + line.total, 0) + ticketCount * TICKET_VALUE };
}

// W/L/F from the user's side: fair when within FAIR_MARGIN of the bigger side.
export function verdictFor(gives, gets) {
  const diff = gets.total - gives.total;
  const bigger = Math.max(gives.total, gets.total);
  if (bigger === 0 || Math.abs(diff) <= bigger * FAIR_MARGIN) return 'F';
  return diff > 0 ? 'W' : 'L';
}

export class AiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Every configured key gets its own client. Requests take turns between them, and a
// rate-limited key is skipped until Groq says it can be used again.
const apiKeys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean);
// With several keys, the other key is the retry, so the SDK doesn't retry the same one.
const clients = apiKeys.length > 1
  ? apiKeys.map(apiKey => ({ client: new Groq({ apiKey, maxRetries: 0 }), limitedUntil: 0 }))
  : [{ client: new Groq(), limitedUntil: 0 }];
const DEFAULT_COOLDOWN_MS = 30000;
let nextClient = Math.floor(Math.random() * clients.length); // Random start spreads cold starts.

function clientOrder() {
  const start = nextClient;
  nextClient = (nextClient + 1) % clients.length;
  const ordered = clients.map((_, offset) => clients[(start + offset) % clients.length]);
  const now = Date.now();
  // Ready keys first, in turn order; limited keys last in case their limit has already reset.
  return [...ordered.filter(entry => entry.limitedUntil <= now), ...ordered.filter(entry => entry.limitedUntil > now)];
}

function cooldownFor(error) {
  const seconds = Number(error.headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_COOLDOWN_MS;
}

// Returns the parsed JSON the model produced for the schema, or throws an AiError.
export async function readWithModel(name, schema, systemPrompt, prompt) {
  let response, lastError;
  try {
    for (const entry of clientOrder()) {
      try {
        response = await entry.client.chat.completions.create({
          model: MODEL,
          temperature: 0,
          response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } },
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        });
        break;
      } catch (error) {
        const retryable = error instanceof Groq.RateLimitError || error instanceof Groq.InternalServerError || error instanceof Groq.APIConnectionError;
        if (!retryable || clients.length === 1) throw error;
        if (error instanceof Groq.RateLimitError) entry.limitedUntil = Date.now() + cooldownFor(error);
        lastError = error;
      }
    }
    if (!response) throw lastError;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof Groq.RateLimitError) throw new AiError(429, 'Too many checks right now. Try again in a minute.');
    if (error instanceof Groq.BadRequestError) throw new AiError(400, 'That input could not be read. Try different wording.');
    console.error(`AI ${name} request failed`, error);
    throw new AiError(502, 'The AI check is unavailable. Try again shortly.');
  }
  const choice = response.choices[0];
  if (choice?.finish_reason === 'length') throw new AiError(502, 'The AI response was cut off. Try again.');
  try {
    return JSON.parse(choice?.message?.content);
  } catch {
    throw new AiError(502, 'The AI returned an unreadable answer. Try again.');
  }
}

// Handles method/prompt checks and AI errors so each endpoint only builds its answer.
export function aiHandler(answer) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Use POST.' });
    }
    // Keycap emoji like 8️⃣ or 🔟 become plain digits so counts aren't missed.
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.replace(/([0-9#*])\uFE0F?\u20E3/g, '$1').replaceAll('🔟', '10').trim().slice(0, MAX_PROMPT_LENGTH) : '';
    if (!prompt) return res.status(400).json({ error: 'Type a question first.' });
    try {
      return res.status(200).json(await answer(prompt));
    } catch (error) {
      if (error instanceof AiError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  };
}
