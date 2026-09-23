'use strict';
const themeToggle = document.querySelector('#theme-toggle');
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  themeToggle.setAttribute('aria-label', dark ? 'Light mode' : 'Dark mode');
}
applyTheme(document.documentElement.dataset.theme);
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('atd.theme', theme); } catch { /* Theme still works without storage. */ }
});

const state = { allItems: [], currentPage: 1, itemsPerPage: 8, selectedRarity: '', searchTerm: '', sortMode: 'default', showTickets: false };
const grid = document.querySelector('#items-grid');
const message = document.querySelector('#message');
const numberFormat = new Intl.NumberFormat('en-US');
const ticketFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const rarityNames = ['Basic', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Exclusive', 'Event'];
const numericValue = item => item.value == null || String(item.value).trim() === '' ? null : Number(String(item.value).replaceAll(',', ''));
const rarityKey = item => String(item.rarity || 'Unknown').toLowerCase();
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function filteredItems() {
  const items = state.allItems.filter(item => String(item.name || '').toLowerCase().includes(state.searchTerm) && (!state.selectedRarity || rarityKey(item) === state.selectedRarity));
  if (state.sortMode === 'default') items.sort((a, b) => Number(rarityKey(b) === 'event') - Number(rarityKey(a) === 'event'));
  if (state.sortMode.startsWith('name-')) items.sort((a, b) => String(a.name).localeCompare(String(b.name)) * (state.sortMode === 'name-asc' ? 1 : -1));
  if (state.sortMode.startsWith('value-')) items.sort((a, b) => {
    const av = numericValue(a), bv = numericValue(b);
    const aMissing = av === null || !Number.isFinite(av), bMissing = bv === null || !Number.isFinite(bv);
    if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
    return (av - bv) * (state.sortMode === 'value-asc' ? 1 : -1);
  });
  return items;
}
function createCard(item) {
  const card = element('article', 'card');
  const rarity = rarityKey(item);
  card.dataset.rarity = [...rarityNames.map(name => name.toLowerCase()), 'unknown'].includes(rarity) ? rarity : 'unknown';
  const area = element('div', 'image-area');
  const placeholder = element('span', 'placeholder');
  placeholder.setAttribute('aria-hidden', 'true');
  area.append(placeholder);
  if (item.image) {
    const image = element('img');
    image.src = item.image;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('load', () => { placeholder.hidden = true; });
    image.addEventListener('error', () => { image.remove(); placeholder.hidden = false; });
    area.append(image);
  }
  const name = element('h2', '', item.name || 'Unknown Unit');
  name.title = item.name || 'Unknown Unit';
  area.append(name, element('span', 'rarity-badge', item.rarity || 'Unknown'));
  const bottom = element('div', 'card-bottom');
  const value = numericValue(item);
  const valueLabel = element('span', 'value');
  const coin = element('span', state.showTickets ? 'ticket-icon' : 'coin', state.showTickets ? '🎟' : '$');
  coin.setAttribute('aria-hidden', 'true');
  valueLabel.append(coin, document.createTextNode(state.showTickets ? 'Tickets: ' : 'Value: '), element('strong', '', value !== null && Number.isFinite(value) ? (state.showTickets ? ticketFormat.format(value / TICKET_VALUE) : numberFormat.format(value)) : '—'));
  const status = String(item.status || item.trend || '').toLowerCase();
  const trends = { stable: ['stable', '↔ Stable'], flat: ['stable', '↔ Stable'], rising: ['rising', '↗ Rising'], up: ['rising', '↗ Rising'], dropping: ['dropping', '↓ Dropping'], down: ['dropping', '↓ Dropping'] };
  const trend = trends[status] || ['', '—'];
  const badge = element('span', `trend ${trend[0]}`, trend[1]);
  badge.title = item.demand ? `Demand: ${item.demand}` : 'Demand unavailable';
  bottom.append(valueLabel, badge);
  card.append(area, bottom);
  return card;
}
function pageButton(label, page, options = {}) {
  const button = element('button', options.arrow ? 'arrow' : '', label);
  button.type = 'button';
  button.disabled = Boolean(options.disabled);
  button.setAttribute('aria-label', options.label || `Page ${page}`);
  if (options.current) button.setAttribute('aria-current', 'page');
  button.addEventListener('click', () => { state.currentPage = page; render(); });
  return button;
}
function render() {
  const items = filteredItems();
  const pageCount = Math.ceil(items.length / state.itemsPerPage);
  state.currentPage = Math.min(state.currentPage, Math.max(1, pageCount));
  const start = (state.currentPage - 1) * state.itemsPerPage;
  grid.replaceChildren(...items.slice(start, start + state.itemsPerPage).map(createCard));
  message.hidden = items.length > 0;
  message.textContent = 'No items found.';
  document.querySelector('#counter').textContent = `Showing ${items.length ? start + 1 : 0} - ${Math.min(start + state.itemsPerPage, items.length)} of ${items.length} items`;
  const pagination = document.querySelector('#pagination');
  pagination.replaceChildren();
  if (pageCount) {
    pagination.append(pageButton('‹', state.currentPage - 1, { arrow: true, disabled: state.currentPage === 1, label: 'Previous page' }));
    for (let page = 1; page <= pageCount; page++) pagination.append(pageButton(String(page), page, { current: page === state.currentPage }));
    pagination.append(pageButton('›', state.currentPage + 1, { arrow: true, disabled: state.currentPage === pageCount, label: 'Next page' }));
  }
  document.querySelectorAll('.rarity-filter').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rarity === state.selectedRarity)));
}
async function init() {
  const filters = document.querySelector('#rarity-filters');
  rarityNames.forEach(name => {
    const button = element('button', 'rarity-filter');
    const icon = element('span', '', '●');
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon, document.createTextNode(name));
    button.type = 'button';
    button.dataset.rarity = name.toLowerCase();
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      state.selectedRarity = state.selectedRarity === button.dataset.rarity ? '' : button.dataset.rarity;
      state.currentPage = 1;
      render();
    });
    filters.append(button);
  });
  try {
    const response = await fetch('./values.json');
    if (!response.ok) throw new Error(`values.json: HTTP ${response.status}`);
    const items = await response.json();
    if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Expected an array of tower objects.');
    state.allItems = items;
    document.querySelector('#calculator-loading').hidden = true;
    document.querySelectorAll('.add-unit').forEach(button => { button.disabled = false; });
    render();
    document.querySelector('#search').addEventListener('input', event => { state.searchTerm = event.target.value.trim().toLowerCase(); state.currentPage = 1; render(); });
    document.querySelector('#sort').addEventListener('change', event => { state.sortMode = event.target.value; document.querySelector('#sort-label').textContent = event.target.selectedOptions[0].textContent; state.currentPage = 1; render(); });
  } catch (error) {
    message.hidden = false;
    message.textContent = 'Unable to load value data.';
    document.querySelector('#calculator-loading').textContent = 'Unable to load units. Reload to try again.';
    document.querySelectorAll('.toolbar button, .toolbar input, .toolbar select').forEach(control => { control.disabled = true; });
    console.error('Unable to load value data.', error);
  } finally {
    grid.setAttribute('aria-busy', 'false');
  }
}

const TICKET_VALUE = 40;
const MAX_AMOUNT = 1000000;
const offers = { your: { units: new Map(), tickets: 0 }, their: { units: new Map(), tickets: 0 } };
let pickerSide = 'your';
function wholeAmount(value, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(MAX_AMOUNT, Math.floor(number))) : minimum;
}
function offerTotal(offer) {
  let total = offer.tickets * TICKET_VALUE;
  for (const [index, quantity] of offer.units) total += numericValue(state.allItems[index]) * quantity;
  return total;
}
function updateBalance() {
  const yours = offerTotal(offers.your), theirs = offerTotal(offers.their);
  document.querySelector('#balance-your-total').textContent = numberFormat.format(yours);
  document.querySelector('#balance-their-total').textContent = numberFormat.format(theirs);
  for (const side of ['your', 'their']) {
    document.querySelector(`#${side}-total`).textContent = `${numberFormat.format(offerTotal(offers[side]))} points`;
    document.querySelector(`#${side}-ticket-value`).textContent = `${numberFormat.format(offers[side].tickets * TICKET_VALUE)} points`;
  }
  const hasOffer = side => offers[side].units.size > 0 || offers[side].tickets > 0;
  const ready = hasOffer('your') && hasOffer('their');
  const diff = theirs - yours;
  const verdict = document.querySelector('#verdict');
  verdict.textContent = !ready ? 'Add items to both offers' : diff === 0 ? 'Equal value' : diff > 0 ? 'Win for you' : 'Loss for you';
  verdict.dataset.result = !ready || diff === 0 ? 'equal' : diff > 0 ? 'win' : 'loss';
  document.querySelector('#balance-fill').style.width = `${yours + theirs ? yours / (yours + theirs) * 100 : 50}%`;
  document.querySelector('#trade-difference').textContent = !ready ? 'Build both offers to compare their value.' : diff === 0 ? 'Both offers have the same listed value.' : `${diff > 0 ? 'You receive' : 'You give'} ${numberFormat.format(Math.abs(diff))} more value points.${yours > 0 ? ` (${numberFormat.format(Math.round(Math.abs(diff) / yours * 1000) / 10)}% of your offer.)` : ''}`;
}
function renderOffer(side) {
  const container = document.querySelector(`#${side}-units`);
  container.replaceChildren();
  for (const [index, quantity] of offers[side].units) {
    const item = state.allItems[index];
    const card = element('article', 'offer-item');
    if (item.image) {
      const image = element('img'); image.src = item.image; image.alt = ''; image.addEventListener('error', () => image.remove()); card.append(image);
    }
    card.append(element('h3', '', item.name), element('small', '', `${item.rarity} · Demand: ${item.demand || '—'}`));
    const label = element('label', 'quantity', 'Qty ');
    const input = element('input'); input.type = 'number'; input.min = '1'; input.max = String(MAX_AMOUNT); input.step = '1'; input.value = quantity;
    input.setAttribute('aria-label', `${item.name} quantity in ${side} offer`);
    input.addEventListener('input', () => { offers[side].units.set(index, wholeAmount(input.value, 1)); updateBalance(); });
    input.addEventListener('change', () => { input.value = offers[side].units.get(index); });
    label.append(input); card.append(label);
    const remove = element('button', 'remove-unit', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${item.name} from ${side} offer`);
    remove.addEventListener('click', () => { offers[side].units.delete(index); renderOffer(side); });
    card.append(remove); container.append(card);
  }
  if (!offers[side].units.size) container.append(element('p', 'offer-empty', 'Add units or crates to this offer.'));
  updateBalance();
}
function renderPicker() {
  const query = document.querySelector('#picker-search').value.trim().toLowerCase();
  const results = document.querySelector('#picker-results'); results.replaceChildren();
  state.allItems.forEach((item, index) => {
    if (!`${item.name} ${item.rarity}`.toLowerCase().includes(query)) return;
    const value = numericValue(item);
    const button = element('button', 'picker-item'); button.type = 'button';
    button.disabled = value === null || !Number.isFinite(value) || value < 0;
    if (item.image) { const image = element('img'); image.src = item.image; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => image.remove()); button.append(image); }
    const details = element('span'); details.append(element('strong', '', item.name), element('small', '', `${item.rarity} · ${button.disabled ? 'Value unavailable' : numberFormat.format(value) + ' points'}`)); button.append(details, element('span', '', '+'));
    button.addEventListener('click', () => {
      offers[pickerSide].units.set(index, Math.min(MAX_AMOUNT, (offers[pickerSide].units.get(index) || 0) + 1));
      renderOffer(pickerSide); document.querySelector('#unit-picker').close();
    });
    results.append(button);
  });
  if (!results.children.length) results.append(element('p', '', 'No units or crates found.'));
}
function initCalculator() {
  const views = ['list', 'calculator', 'ai'];
  for (const view of views) {
    document.querySelector(`#${view}-tab`).addEventListener('click', () => {
      for (const target of views) {
        const active = target === view, button = document.querySelector(`#${target}-tab`);
        document.querySelector(`#${target}-section`).hidden = !active;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
      }
    });
  }
  for (const side of ['your', 'their']) {
    const panel = element('section', 'offer-panel');
    panel.innerHTML = `<header><h2>${side === 'your' ? 'Your' : 'Their'} offer</h2><button type="button" class="clear-offer">Clear</button></header><div id="${side}-units" class="offer-units"></div><button type="button" class="add-unit" disabled>＋ Add unit / crate</button><label class="ticket-input">🎟 Tickets <input id="${side}-tickets" type="number" min="0" max="${MAX_AMOUNT}" step="1" value="0" aria-label="Tickets in ${side} offer"><span id="${side}-ticket-value">0 points</span></label><div class="offer-total">Total value <strong id="${side}-total">0 points</strong></div>`;
    document.querySelector('#offers').append(panel);
    panel.querySelector('.clear-offer').addEventListener('click', () => { offers[side].units.clear(); offers[side].tickets = 0; document.querySelector(`#${side}-tickets`).value = 0; renderOffer(side); });
    panel.querySelector('.add-unit').addEventListener('click', () => { pickerSide = side; document.querySelector('#picker-title').textContent = `Add to ${side} offer`; document.querySelector('#picker-search').value = ''; renderPicker(); document.querySelector('#unit-picker').showModal(); document.querySelector('#picker-search').focus(); });
    const tickets = document.querySelector(`#${side}-tickets`);
    tickets.addEventListener('input', () => { offers[side].tickets = wholeAmount(tickets.value); updateBalance(); });
    tickets.addEventListener('change', () => { tickets.value = offers[side].tickets; });
  }
  for (const side of ['your', 'their']) renderOffer(side);
  document.querySelector('#picker-search').addEventListener('input', renderPicker);
  document.querySelector('#close-picker').addEventListener('click', () => document.querySelector('#unit-picker').close());
}

const ticketDisplayToggle = document.querySelector('#ticket-display-toggle');
try { state.showTickets = localStorage.getItem('atd.showTickets') === 'true'; } catch { /* Default to points. */ }
ticketDisplayToggle.setAttribute('aria-pressed', String(state.showTickets));
ticketDisplayToggle.addEventListener('click', () => {
  state.showTickets = !state.showTickets;
  ticketDisplayToggle.setAttribute('aria-pressed', String(state.showTickets));
  try { localStorage.setItem('atd.showTickets', String(state.showTickets)); } catch { /* Works without storage. */ }
  if (state.allItems.length) render();
});
initCalculator();
init();

const aiResult = document.querySelector('#ai-result');
function tradeSide(title, side) {
  const panel = element('div', 'ai-side');
  panel.append(element('h3', '', title));
  const list = element('ul');
  for (const line of side.lines) {
    const row = element('li');
    if (line.image) { const image = element('img'); image.src = line.image; image.alt = ''; image.addEventListener('error', () => image.remove()); row.append(image); }
    const details = element('span');
    details.append(element('strong', '', `${line.quantity > 1 ? `${line.quantity}× ` : ''}${line.name}`), element('small', '', `${numberFormat.format(line.value)} each · Demand ${line.demand || '—'}${line.status && line.status !== 'stable' ? ` · ${line.status}` : ''}`));
    row.append(details, element('b', '', numberFormat.format(line.total)));
    list.append(row);
  }
  if (side.tickets) {
    const row = element('li');
    row.append(element('span', '', `🎟 ${numberFormat.format(side.tickets)} tickets`), element('b', '', numberFormat.format(side.tickets * TICKET_VALUE)));
    list.append(row);
  }
  panel.append(list, element('div', 'ai-side-total', `Total ${numberFormat.format(side.total)}`));
  return panel;
}
function renderAiResult(result) {
  aiResult.replaceChildren();
  aiResult.hidden = false;
  if (!result.isTrade) {
    aiResult.append(element('p', 'ai-note', 'Couldn’t find a full trade in that. Name what each side gives, like “2 party titan tv for engineer”.'));
  } else {
    const labels = { W: ['W', 'Win for you'], L: ['L', 'Loss for you'], F: ['F', 'Fair trade'] };
    const [letter, label] = labels[result.verdict] || ['?', 'No verdict'];
    const header = element('div', 'ai-verdict');
    header.dataset.result = result.verdict || 'none';
    const diff = Math.abs(result.difference);
    const percent = Math.round(diff / Math.max(result.gives.total, result.gets.total) * 1000) / 10;
    const summary = !result.verdict ? 'This trade has a unit whose value depends on its serial number. See the note below.' : result.difference === 0 ? 'Both sides have the same listed value.' : `You ${result.difference > 0 ? 'get' : 'give'} ${numberFormat.format(diff)} more value (${percent}%). Fair means within ${result.fairMargin * 100}%.`;
    header.append(element('span', 'ai-letter', letter), element('div', '', ''));
    header.lastChild.append(element('strong', '', label), element('p', '', summary));
    const sides = element('div', 'ai-sides');
    sides.append(tradeSide('You give', result.gives), tradeSide('You get', result.gets));
    aiResult.append(header, sides);
  }
  const notes = aiNotes(result);
  if (notes) aiResult.append(notes);
  aiResult.append(element('small', '', 'Verdict uses listed values. Demand and player preferences can affect trades.'));
}
function aiNotes(result) {
  const notes = [...(result.assumptions || []), ...(result.unrecognized || []).map(name => `Not on the value list, so not counted: ${name}`)];
  if (!notes.length) return null;
  const list = element('ul', 'ai-notes');
  notes.forEach(note => list.append(element('li', '', note)));
  return list;
}
const adviceResult = document.querySelector('#advice-result');
function renderAdviceResult(result) {
  adviceResult.replaceChildren();
  adviceResult.hidden = false;
  if (!result.isQuestion) {
    adviceResult.append(element('p', 'ai-note', 'Couldn’t tell which unit you mean. Try something like “what should I ask for my tcm?”.'));
  } else {
    const buying = result.direction === 'buying';
    const heading = element('div', 'advice-heading');
    heading.append(element('strong', '', result.suggestions.length ? buying ? 'Offer one of these' : result.direction === 'selling' ? 'Ask for one of these' : 'Fair trades for it' : 'No suggestions'));
    if (result.suggestions.length) heading.append(element('p', '', `Each option is within ${result.fairMargin * 100}% of the listed value.${result.ticketEquivalent ? ` In tickets, that's about ${numberFormat.format(result.ticketEquivalent)}.` : ''}`));
    adviceResult.append(heading, tradeSide(buying ? 'Unit you want' : 'Your unit', result.target));
    if (result.suggestions.length) {
      const options = element('div', 'ai-sides');
      result.suggestions.forEach((option, index) => {
        const diff = option.difference === 0 ? 'same value' : `${option.difference > 0 ? '+' : '−'}${numberFormat.format(Math.abs(option.difference))} vs yours`;
        options.append(tradeSide(`Option ${index + 1} · ${diff}`, option));
      });
      adviceResult.append(options);
    }
  }
  const notes = aiNotes(result);
  if (notes) adviceResult.append(notes);
  adviceResult.append(element('small', '', 'Suggestions use listed values. Demand and player preferences can affect trades.'));
}
function initAiForm(name, url, busyText, render) {
  const form = document.querySelector(`#${name}-form`);
  const status = document.querySelector(`#${name}-status`);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const prompt = document.querySelector(`#${name}-prompt`).value.trim();
    if (!prompt) { status.textContent = 'Type something first.'; return; }
    const submit = document.querySelector(`#${name}-submit`);
    submit.disabled = true;
    status.textContent = busyText;
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The AI check is unavailable. Try again shortly.');
      status.textContent = '';
      render(result);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}
initAiForm('ai', '/api/trade-check', 'Reading the trade…', renderAiResult);
initAiForm('advice', '/api/trade-advice', 'Finding fair trades…', renderAdviceResult);
