'use strict';
const themeToggle = document.querySelector('#theme-toggle');
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  themeToggle.firstElementChild.textContent = dark ? '☀' : '☾';
}
applyTheme(document.documentElement.dataset.theme);
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('atd.theme', theme); } catch { /* Theme still works without storage. */ }
});

const state = { allItems: [], currentPage: 1, itemsPerPage: 12, selectedRarity: '', searchTerm: '', sortMode: 'default', showTickets: false };
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
    const icon = element('span', '', '◆');
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
    document.querySelector('#sort').addEventListener('change', event => { state.sortMode = event.target.value; state.currentPage = 1; render(); });
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
  for (const view of ['list', 'calculator']) {
    document.querySelector(`#${view}-tab`).addEventListener('click', () => {
      for (const target of ['list', 'calculator']) {
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
