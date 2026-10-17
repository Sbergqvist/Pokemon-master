// Pure helpers: no DOM, no network. Shared by the app and the tests.

export const API_BASE = 'https://api.pokemontcg.io/v2';

// Default exchange rates. DKK is pegged to EUR (ERM II, central rate 7.46038),
// so the EUR rate barely moves; the USD rate is only an approximation.
export const DEFAULT_SETTINGS = {
  eurToDkk: 7.46,
  usdToDkk: 6.9,
  priceSource: 'cm-trend', // see PRICE_SOURCES
  usImportVat: true, // add 25% Danish VAT (moms) when pricing from US (TCGplayer) data
  apiKey: '',
  shopLinks: [
    { name: 'DBA', url: 'https://www.dba.dk/recommerce/forsale/search?q={q}' },
    { name: 'Cardmarket', url: 'https://www.cardmarket.com/en/Pokemon/Products/Search?searchString={q}' },
  ],
};

export const PRICE_SOURCES = {
  'cm-trend': 'Cardmarket trend (EUR)',
  'cm-avg30': 'Cardmarket 30-day average (EUR)',
  'cm-low': 'Cardmarket lowest listing (EUR)',
  'tcp-market': 'TCGplayer market (USD, import from US)',
};

export const VARIANT_LABELS = {
  normal: 'Normal',
  holofoil: 'Holo',
  reverseHolofoil: 'Reverse Holo',
  '1stEditionNormal': '1st Edition',
  '1stEditionHolofoil': '1st Edition Holo',
  unlimitedHolofoil: 'Unlimited Holo',
  unlimited: 'Unlimited',
};

const VARIANT_ORDER = Object.keys(VARIANT_LABELS);

export const CONDITIONS = ['', 'MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

/**
 * Build the API search query for a user's input.
 * A number (e.g. "197") searches by National Pokédex number, which also catches
 * cards like "Dark Umbreon", "Umbreon VMAX" and tag teams.
 */
export function buildQuery(input) {
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return `nationalPokedexNumbers:${Number(s)}`;
  const safe = s.replace(/["\\]/g, '');
  return `name:"*${safe}*" supertype:pokemon`;
}

/**
 * Pick the most common National Pokédex number among cards whose name contains
 * the search term, so "eevee" resolves to 133 rather than an Eeveelution.
 */
export function guessDexNumber(cards, term) {
  const t = term.trim().toLowerCase();
  const counts = new Map();
  for (const c of cards) {
    const nums = c.nationalPokedexNumbers || [];
    // Only count single-Pokémon cards so tag teams don't skew the result.
    if (nums.length !== 1) continue;
    if (!c.name.toLowerCase().includes(t)) continue;
    counts.set(nums[0], (counts.get(nums[0]) || 0) + 1);
  }
  let best = null;
  for (const [n, k] of counts) if (best === null || k > counts.get(best)) best = n;
  return best;
}

/** Which printed variants exist for a card, best guess from the price data. */
export function variantsOf(card) {
  const tcp = card.tcgplayer?.prices;
  let keys = tcp ? Object.keys(tcp).filter((k) => tcp[k]) : [];
  if (keys.length === 0) {
    const foil = /holo|ultra|secret|illustration|hyper|rainbow|amazing|radiant|double|shiny|special/i;
    keys = [foil.test(card.rarity || '') ? 'holofoil' : 'normal'];
    const cm = card.cardmarket?.prices;
    if (cm && (cm.reverseHoloTrend > 0 || cm.reverseHoloSell > 0) && !keys.includes('reverseHolofoil')) {
      keys.push('reverseHolofoil');
    }
  }
  return keys.sort((a, b) => rank(a) - rank(b));
}

function rank(v) {
  const i = VARIANT_ORDER.indexOf(v);
  return i === -1 ? 99 : i;
}

/** Expand cards into one entry per variant — the units of a master set. */
export function expandEntries(cards) {
  const out = [];
  for (const card of cards) {
    for (const variant of variantsOf(card)) {
      out.push({ key: `${card.id}|${variant}`, card, variant });
    }
  }
  return out.sort(compareEntries);
}

function compareEntries(a, b) {
  const da = a.card.set?.releaseDate || '';
  const db = b.card.set?.releaseDate || '';
  if (da !== db) return da < db ? -1 : 1;
  if (a.card.set?.id !== b.card.set?.id) return (a.card.set?.id || '') < (b.card.set?.id || '') ? -1 : 1;
  const na = numberSortKey(a.card.number);
  const nb = numberSortKey(b.card.number);
  if (na !== nb) return na < nb ? -1 : 1;
  return rank(a.variant) - rank(b.variant);
}

function numberSortKey(n) {
  const m = String(n || '').match(/^(\D*)(\d+)(.*)$/);
  if (!m) return String(n || '');
  return `${m[1]}${m[2].padStart(5, '0')}${m[3]}`;
}

/**
 * Market price for one variant in DKK, or null if unknown.
 * Cardmarket only separates reverse holo from "everything else", so all other
 * variants share the base Cardmarket price.
 */
export function marketPriceDkk(card, variant, settings) {
  const src = settings.priceSource;
  if (src === 'tcp-market') {
    const p = card.tcgplayer?.prices?.[variant];
    const usd = p?.market ?? p?.mid ?? null;
    if (!usd) return null;
    return usd * settings.usdToDkk * (settings.usImportVat ? 1.25 : 1);
  }
  const cm = card.cardmarket?.prices;
  if (!cm) return null;
  const rev = variant === 'reverseHolofoil';
  const pick = {
    'cm-trend': rev ? cm.reverseHoloTrend : cm.trendPrice,
    'cm-avg30': rev ? cm.reverseHoloAvg30 : cm.avg30,
    'cm-low': rev ? cm.reverseHoloLow : cm.lowPrice,
  }[src];
  const eur = pick || (rev ? cm.reverseHoloSell : cm.averageSellPrice) || null;
  return eur ? eur * settings.eurToDkk : null;
}

/** Effective price: the user's own Danish price beats the converted market price. */
export function effectivePrice(entry, state, settings) {
  const manual = state?.manualPrice;
  if (manual != null && manual !== '' && !Number.isNaN(Number(manual))) {
    return { value: Number(manual), source: 'manual' };
  }
  const v = marketPriceDkk(entry.card, entry.variant, settings);
  return { value: v, source: v == null ? 'none' : 'market' };
}

/** Collection totals over the entries the user hasn't excluded. */
export function summarize(entries, collection, settings) {
  const s = { total: 0, owned: 0, ownedValue: 0, spent: 0, remainingCost: 0, unpriced: 0, excluded: 0 };
  for (const e of entries) {
    const st = collection[e.key] || {};
    if (st.excluded) { s.excluded++; continue; }
    s.total++;
    const price = effectivePrice(e, st, settings).value;
    if (st.owned) {
      s.owned++;
      s.ownedValue += price || 0;
      s.spent += Number(st.paid) || 0;
    } else if (price == null) {
      s.unpriced++;
    } else {
      s.remainingCost += price;
    }
  }
  return s;
}

export function formatDkk(v) {
  if (v == null || Number.isNaN(v)) return '–';
  return new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' }).format(v);
}

export function shopUrl(template, card) {
  const q = `${card.name} ${card.number}/${card.set?.printedTotal ?? ''} ${card.set?.name ?? ''}`.replace(/\s+/g, ' ').trim();
  return template.replace('{q}', encodeURIComponent(q));
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Semicolon-separated so Danish Excel (comma decimal separator) opens it cleanly. */
export function toCsv(entries, collection, settings) {
  const head = ['Set', 'Release date', 'Number', 'Name', 'Rarity', 'Variant', 'Owned', 'Condition', 'Paid DKK', 'Price DKK', 'Price source', 'Note', 'Card ID'];
  const rows = [head];
  const num = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
  for (const e of entries) {
    const st = collection[e.key] || {};
    if (st.excluded) continue;
    const p = effectivePrice(e, st, settings);
    rows.push([
      e.card.set?.name, e.card.set?.releaseDate, `${e.card.number}/${e.card.set?.printedTotal ?? ''}`,
      e.card.name, e.card.rarity, VARIANT_LABELS[e.variant] || e.variant,
      st.owned ? 'yes' : 'no', st.condition || '', num(st.paid), num(p.value), p.source, st.note || '', e.card.id,
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(';')).join('\n');
}
