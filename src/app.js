import {
  API_BASE, DEFAULT_SETTINGS, PRICE_SOURCES, VARIANT_LABELS, CONDITIONS,
  buildQuery, guessDexNumber, expandEntries, effectivePrice, marketPriceDkk,
  summarize, formatDkk, shopUrl, toCsv,
} from './lib.js';

const STORAGE_KEY = 'pokemon-master-set:v1';
const CARD_FIELDS = 'id,name,supertype,number,rarity,artist,set,images,cardmarket,tcgplayer,nationalPokedexNumbers';

const $ = (sel) => document.querySelector(sel);

// ---------- persistence ----------

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (raw && raw.projects) return { ...raw, settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
  } catch { /* fall through to a fresh store */ }
  return { settings: { ...DEFAULT_SETTINGS }, projects: {}, active: null };
}

let store = loadStore();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    setStatus(`Could not save to browser storage: ${err.message}. Export a backup!`, true);
  }
}

const ui = { filter: 'all', text: '', sort: 'release', view: 'grid' };

// ---------- API ----------

async function apiCards(q) {
  const cards = [];
  for (let page = 1; ; page++) {
    const url = `${API_BASE}/cards?q=${encodeURIComponent(q)}&page=${page}&pageSize=250&select=${CARD_FIELDS}`;
    const headers = store.settings.apiKey ? { 'X-Api-Key': store.settings.apiKey } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Pokémon TCG API responded ${res.status}`);
    const body = await res.json();
    cards.push(...body.data);
    if (cards.length >= body.totalCount || body.data.length === 0) break;
  }
  return cards;
}

/** Resolve the user's input to a project: every card of that Pokémon. */
async function fetchProject(input) {
  const term = input.trim();
  if (/^\d+$/.test(term)) {
    const cards = await apiCards(buildQuery(term));
    if (!cards.length) throw new Error(`No cards found for Pokédex #${term}`);
    return { id: `dex-${Number(term)}`, label: labelFor(cards, Number(term)), query: buildQuery(term), cards };
  }
  const byName = await apiCards(buildQuery(term));
  if (!byName.length) throw new Error(`No cards found for "${term}"`);
  const dex = guessDexNumber(byName, term);
  if (dex == null) {
    return { id: `name-${term.toLowerCase()}`, label: term, query: buildQuery(term), cards: byName };
  }
  const q = buildQuery(String(dex));
  const cards = await apiCards(q);
  return { id: `dex-${dex}`, label: labelFor(cards, dex), query: q, cards };
}

function labelFor(cards, dex) {
  // Shortest single-Pokémon card name is usually the plain species name.
  const names = cards.filter((c) => c.nationalPokedexNumbers?.length === 1).map((c) => c.name);
  const name = names.sort((a, b) => a.length - b.length)[0] || cards[0]?.name || 'Pokémon';
  return `${name} #${dex}`;
}

// ---------- actions ----------

async function loadProject(input) {
  setStatus(`Searching for ${input}…`);
  setBusy(true);
  try {
    const p = await fetchProject(input);
    const existing = store.projects[p.id];
    store.projects[p.id] = {
      ...p,
      fetchedAt: new Date().toISOString(),
      collection: existing?.collection || {},
    };
    store.active = p.id;
    save();
    setStatus(`Loaded ${p.cards.length} cards (${expandEntries(p.cards).length} variants) for ${p.label}.`);
    render();
  } catch (err) {
    setStatus(friendlyError(err), true);
  } finally {
    setBusy(false);
  }
}

async function refreshActive() {
  const p = activeProject();
  if (!p) return;
  setStatus('Refreshing card list and prices…');
  setBusy(true);
  try {
    p.cards = await apiCards(p.query);
    p.fetchedAt = new Date().toISOString();
    save();
    setStatus(`Updated ${p.cards.length} cards.`);
    render();
  } catch (err) {
    setStatus(friendlyError(err), true);
  } finally {
    setBusy(false);
  }
}

function friendlyError(err) {
  if (err instanceof TypeError) return 'Could not reach the Pokémon TCG API. Check your connection and try again.';
  if (/429/.test(err.message)) return 'Rate limited by the Pokémon TCG API. Wait a minute or add a free API key in Settings.';
  return err.message;
}

function activeProject() {
  return store.projects[store.active] || null;
}

// ---------- rendering ----------

function setStatus(msg, isError = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function setBusy(busy) {
  document.querySelectorAll('#search-form button, #refresh-btn').forEach((b) => { b.disabled = busy; });
}

function renderProjectSelect() {
  const sel = $('#project-select');
  const ids = Object.keys(store.projects);
  sel.hidden = ids.length === 0;
  sel.replaceChildren(...ids.map((id) => {
    const o = new Option(store.projects[id].label, id);
    o.selected = id === store.active;
    return o;
  }));
}

function visibleEntries(entries, collection) {
  const text = ui.text.toLowerCase();
  let list = entries.filter((e) => {
    const st = collection[e.key] || {};
    if (ui.filter === 'excluded') { if (!st.excluded) return false; }
    else if (st.excluded) return false;
    if (ui.filter === 'missing' && st.owned) return false;
    if (ui.filter === 'owned' && !st.owned) return false;
    if (!text) return true;
    const hay = `${e.card.name} ${e.card.set?.name} ${e.card.set?.series} ${e.card.rarity} ${VARIANT_LABELS[e.variant]} ${e.card.number} ${st.note || ''}`;
    return hay.toLowerCase().includes(text);
  });
  if (ui.sort !== 'release') {
    const dir = ui.sort === 'price-desc' ? -1 : 1;
    const price = (e) => effectivePrice(e, collection[e.key], store.settings).value;
    list = [...list].sort((a, b) => {
      const pa = price(a); const pb = price(b);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return (pa - pb) * dir;
    });
  }
  return list;
}

function render() {
  renderProjectSelect();
  const p = activeProject();
  $('#empty').hidden = !!p;
  $('#collection').hidden = !p;
  if (!p) return;

  const entries = expandEntries(p.cards);
  const s = summarize(entries, p.collection, store.settings);
  const pct = s.total ? (s.owned / s.total) * 100 : 0;

  $('#project-title').textContent = p.label;
  $('#progress-bar').style.width = `${pct}%`;
  $('#stat-owned').textContent = `${s.owned} / ${s.total} (${pct.toFixed(1)}%)`;
  $('#stat-value').textContent = formatDkk(s.ownedValue);
  $('#stat-spent').textContent = formatDkk(s.spent);
  $('#stat-remaining').textContent = formatDkk(s.remainingCost);
  const notes = [
    `Prices: ${PRICE_SOURCES[store.settings.priceSource]}, updated ${new Date(p.fetchedAt).toLocaleDateString('da-DK')}.`,
  ];
  if (s.unpriced) notes.push(`${s.unpriced} missing card(s) have no price and aren't counted in “Left to buy”.`);
  if (s.excluded) notes.push(`${s.excluded} excluded.`);
  $('#stat-note').textContent = notes.join(' ');

  const list = visibleEntries(entries, p.collection);
  const container = $('#cards');
  container.className = `cards ${ui.view}`;
  if (!list.length) {
    const msg = document.createElement('p');
    msg.className = 'muted';
    msg.textContent = 'Nothing matches this filter.';
    container.replaceChildren(msg);
    return;
  }
  container.replaceChildren(...list.map((e) => cardTile(e, p.collection[e.key] || {})));
}

function cardTile(entry, st) {
  const { card, variant } = entry;
  const price = effectivePrice(entry, st, store.settings);
  const el = document.createElement('article');
  el.className = 'tile';
  el.classList.toggle('owned', !!st.owned);
  el.classList.toggle('excluded', !!st.excluded);
  el.dataset.key = entry.key;
  el.innerHTML = `
    <button class="tile-img" type="button" data-action="edit" aria-label="Edit">
      <img loading="lazy" alt="">
      <span class="badge"></span>
    </button>
    <div class="tile-info">
      <div class="tile-name"></div>
      <div class="tile-set muted small"></div>
      <div class="tile-price"></div>
    </div>
    <label class="tile-own"><input type="checkbox" data-action="toggle"> Owned</label>`;
  el.querySelector('img').src = card.images?.small || '';
  el.querySelector('img').alt = `${card.name} ${card.set?.name} ${card.number}`;
  el.querySelector('.badge').textContent = VARIANT_LABELS[variant] || variant;
  el.querySelector('.badge').dataset.variant = variant;
  el.querySelector('.tile-name').textContent = card.name;
  el.querySelector('.tile-set').textContent =
    `${card.set?.name} · ${card.number}/${card.set?.printedTotal ?? '?'} · ${card.rarity || 'No rarity'}`;
  const priceEl = el.querySelector('.tile-price');
  priceEl.textContent = formatDkk(price.value);
  if (price.source === 'manual') priceEl.title = 'Your price';
  priceEl.classList.toggle('manual', price.source === 'manual');
  el.querySelector('input').checked = !!st.owned;
  return el;
}

// ---------- card dialog ----------

let editingKey = null;

function openCardDialog(key) {
  const p = activeProject();
  const entry = expandEntries(p.cards).find((e) => e.key === key);
  if (!entry) return;
  editingKey = key;
  const st = p.collection[key] || {};
  const { card, variant } = entry;

  $('#cd-img').src = card.images?.large || card.images?.small || '';
  $('#cd-img').alt = card.name;
  $('#cd-title').textContent = `${card.name} — ${VARIANT_LABELS[variant] || variant}`;
  $('#cd-meta').textContent =
    `${card.set?.series} · ${card.set?.name} (${card.set?.releaseDate}) · #${card.number}/${card.set?.printedTotal ?? '?'} · ${card.rarity || 'No rarity'}${card.artist ? ` · Illus. ${card.artist}` : ''}`;

  const cmSettings = (src) => ({ ...store.settings, priceSource: src });
  const parts = ['cm-trend', 'cm-avg30', 'cm-low', 'tcp-market']
    .map((src) => [src, marketPriceDkk(card, variant, cmSettings(src))])
    .filter(([, v]) => v != null)
    .map(([src, v]) => `${PRICE_SOURCES[src].replace(/ \(.*\)/, '')}: ${formatDkk(v)}`);
  $('#cd-prices').textContent = parts.length ? parts.join(' · ') : 'No market price available.';

  $('#cd-owned').checked = !!st.owned;
  $('#cd-condition').value = st.condition || '';
  $('#cd-paid').value = st.paid ?? '';
  $('#cd-manual').value = st.manualPrice ?? '';
  $('#cd-note').value = st.note || '';
  $('#cd-excluded').checked = !!st.excluded;

  const links = [];
  if (card.cardmarket?.url) links.push(['Cardmarket listing', card.cardmarket.url]);
  for (const s of store.settings.shopLinks) links.push([`Search ${s.name}`, shopUrl(s.url, card)]);
  $('#cd-links').replaceChildren(...links.map(([label, href]) => {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label;
    return a;
  }));

  $('#card-dialog').returnValue = '';
  $('#card-dialog').showModal();
}

function saveCardDialog() {
  const p = activeProject();
  const num = (v) => (v === '' ? null : Number(v));
  const st = {
    owned: $('#cd-owned').checked,
    condition: $('#cd-condition').value,
    paid: num($('#cd-paid').value),
    manualPrice: num($('#cd-manual').value),
    note: $('#cd-note').value.trim(),
    excluded: $('#cd-excluded').checked,
  };
  const empty = !st.owned && !st.condition && st.paid == null && st.manualPrice == null && !st.note && !st.excluded;
  if (empty) delete p.collection[editingKey];
  else p.collection[editingKey] = st;
  save();
  render();
}

// ---------- settings dialog ----------

function openSettings() {
  const s = store.settings;
  $('#st-eur').value = s.eurToDkk;
  $('#st-usd').value = s.usdToDkk;
  $('#st-source').value = s.priceSource;
  $('#st-vat').checked = s.usImportVat;
  $('#st-key').value = s.apiKey;
  $('#st-links').value = s.shopLinks.map((l) => `${l.name} | ${l.url}`).join('\n');
  $('#settings-dialog').returnValue = '';
  $('#settings-dialog').showModal();
}

function saveSettings() {
  const links = $('#st-links').value.split('\n')
    .map((line) => line.split('|').map((x) => x.trim()))
    .filter(([name, url]) => name && url && /^https?:\/\//.test(url))
    .map(([name, url]) => ({ name, url }));
  store.settings = {
    ...store.settings,
    eurToDkk: Number($('#st-eur').value) || DEFAULT_SETTINGS.eurToDkk,
    usdToDkk: Number($('#st-usd').value) || DEFAULT_SETTINGS.usdToDkk,
    priceSource: $('#st-source').value,
    usImportVat: $('#st-vat').checked,
    apiKey: $('#st-key').value.trim(),
    shopLinks: links,
  };
  save();
  render();
}

async function fetchLiveRates() {
  const btn = $('#st-live');
  btn.disabled = true;
  try {
    const [eur, usd] = await Promise.all(['EUR', 'USD'].map(async (from) => {
      const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=DKK`);
      if (!res.ok) throw new Error(res.status);
      return (await res.json()).rates.DKK;
    }));
    $('#st-eur').value = eur;
    $('#st-usd').value = usd;
    btn.textContent = 'Rates updated ✓';
  } catch {
    btn.textContent = 'Could not fetch rates';
  } finally {
    btn.disabled = false;
  }
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  download(`pokemon-master-set-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2), 'application/json');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data.projects) throw new Error('Not a backup file');
    if (!confirm('Replace your current collection with this backup?')) return;
    store = { ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
    save();
    $('#settings-dialog').close();
    render();
    setStatus('Backup imported.');
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
}

// ---------- wiring ----------

function init() {
  $('#cd-condition').replaceChildren(...CONDITIONS.map((c) => new Option(c || '—', c)));
  $('#st-source').replaceChildren(...Object.entries(PRICE_SOURCES).map(([v, l]) => new Option(l, v)));

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#search-input').value.trim();
    if (v) loadProject(v);
  });
  $('#project-select').addEventListener('change', (e) => {
    store.active = e.target.value;
    save();
    render();
  });
  $('#refresh-btn').addEventListener('click', refreshActive);
  $('#delete-btn').addEventListener('click', () => {
    const p = activeProject();
    if (!p || !confirm(`Remove ${p.label} and everything you've recorded for it?`)) return;
    delete store.projects[store.active];
    store.active = Object.keys(store.projects)[0] || null;
    save();
    render();
  });
  $('#csv-btn').addEventListener('click', () => {
    const p = activeProject();
    const csv = toCsv(expandEntries(p.cards), p.collection, store.settings);
    download(`${p.label.replace(/\W+/g, '-')}.csv`, `﻿${csv}`, 'text/csv');
  });

  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    ui.filter = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    ui.view = b.dataset.view;
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));
  $('#filter-text').addEventListener('input', (e) => { ui.text = e.target.value; render(); });
  $('#sort-select').addEventListener('change', (e) => { ui.sort = e.target.value; render(); });

  $('#cards').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (e.target.closest('[data-action="edit"]')) openCardDialog(tile.dataset.key);
  });
  $('#cards').addEventListener('change', (e) => {
    if (e.target.dataset.action !== 'toggle') return;
    const key = e.target.closest('.tile').dataset.key;
    const p = activeProject();
    const st = { ...(p.collection[key] || {}), owned: e.target.checked };
    p.collection[key] = st;
    save();
    render();
  });

  $('#card-dialog').addEventListener('close', () => {
    if ($('#card-dialog').returnValue === 'save') saveCardDialog();
  });
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-dialog').addEventListener('close', () => {
    if ($('#settings-dialog').returnValue === 'save') saveSettings();
  });
  $('#st-live').addEventListener('click', fetchLiveRates);
  $('#st-export').addEventListener('click', exportBackup);
  $('#st-import').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  render();
}

init();
