import { FAIR_MARGIN, SERIAL_RULE, SIGN_RULE, SLANG_RULE, aiHandler, readWithModel, scoreSide, sideSchema, unitListText, unpricedNotes, verdictFor } from '../lib/trade.js';

// The model only reads the trade (which units are on which side). Scoring is done
// here from values.json so verdicts always match the published value list.
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
${unitListText}

How to read the input:
${SLANG_RULE}
${SIGN_RULE}
${SERIAL_RULE}
- Counts like "2", "x2", "two" set the quantity. Missing counts mean 1.
- In "A for B" or "A → B", the user gives A and gets B. "My offer"/"I give" is what the user gives; "their offer"/"for their"/"I get" is what the user gets. If the direction is ambiguous, assume the user gives the side mentioned first and say so in assumptions.
- Tickets are a currency; put ticket amounts in the tickets fields, not as units.
- Anything that matches no unit on the list goes in unrecognized, never forced onto a wrong unit.
- If the input is not a trade at all, set is_trade to false and leave both sides empty.`;

export default aiHandler(async prompt => {
  const trade = await readWithModel('trade', tradeSchema, SYSTEM_PROMPT, prompt);
  if (!trade.is_trade) return { isTrade: false, assumptions: trade.assumptions };
  const gives = scoreSide(trade.user_gives, trade.user_gives_tickets);
  const gets = scoreSide(trade.user_gets, trade.user_gets_tickets);
  if (!gives.lines.length && !gives.tickets || !gets.lines.length && !gets.tickets) {
    return { isTrade: false, unrecognized: trade.unrecognized, assumptions: [...trade.assumptions, 'Both sides of the trade are needed to judge it.'] };
  }
  const unpriced = unpricedNotes(gives, gets);
  return {
    isTrade: true,
    verdict: unpriced.length ? null : verdictFor(gives, gets),
    gives,
    gets,
    difference: gets.total - gives.total,
    fairMargin: FAIR_MARGIN,
    unrecognized: trade.unrecognized,
    assumptions: [...unpriced, ...trade.assumptions],
  };
});
