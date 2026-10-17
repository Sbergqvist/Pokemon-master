import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, buildQuery, guessDexNumber, variantsOf, expandEntries,
  marketPriceDkk, effectivePrice, summarize, shopUrl, toCsv,
} from '../src/lib.js';

const settings = { ...DEFAULT_SETTINGS, eurToDkk: 7.5, usdToDkk: 7 };

const umbreonV = {
  id: 'swsh7-94', name: 'Umbreon V', number: '94', rarity: 'Rare Holo V', nationalPokedexNumbers: [197],
  set: { id: 'swsh7', name: 'Evolving Skies', releaseDate: '2021/08/27', printedTotal: 203 },
  cardmarket: { prices: { trendPrice: 4, avg30: 3, lowPrice: 2 } },
  tcgplayer: { prices: { holofoil: { market: 5 } } },
};
const umbreonCommon = {
  id: 'sv8-60', name: 'Umbreon', number: '60', rarity: 'Rare', nationalPokedexNumbers: [197],
  set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08', printedTotal: 191 },
  cardmarket: { prices: { trendPrice: 0.5, reverseHoloTrend: 1.2 } },
  tcgplayer: { prices: { holofoil: { market: 0.4 }, reverseHolofoil: { market: 1 } } },
};
const noTcp = {
  id: 'x-1', name: 'Umbreon', number: '10', rarity: 'Uncommon', nationalPokedexNumbers: [197],
  set: { id: 'x', name: 'X', releaseDate: '2003/01/01', printedTotal: 100 },
  cardmarket: { prices: { trendPrice: 1, reverseHoloTrend: 3 } },
};

test('buildQuery', () => {
  assert.equal(buildQuery(' 197 '), 'nationalPokedexNumbers:197');
  assert.equal(buildQuery('Umbreon'), 'name:"*Umbreon*" supertype:pokemon');
  assert.equal(buildQuery('Mr. "Mime"'), 'name:"*Mr. Mime*" supertype:pokemon');
});

test('guessDexNumber prefers the species whose name was searched', () => {
  const cards = [
    { name: 'Eevee', nationalPokedexNumbers: [133] },
    { name: 'Eevee ex', nationalPokedexNumbers: [133] },
    { name: 'Eevee & Snorlax GX', nationalPokedexNumbers: [133, 143] },
    { name: 'Flareon', nationalPokedexNumbers: [136] },
  ];
  assert.equal(guessDexNumber(cards, 'eevee'), 133);
  assert.equal(guessDexNumber([], 'eevee'), null);
});

test('variantsOf uses TCGplayer keys, falls back to Cardmarket', () => {
  assert.deepEqual(variantsOf(umbreonCommon), ['holofoil', 'reverseHolofoil']);
  assert.deepEqual(variantsOf(noTcp), ['normal', 'reverseHolofoil']);
  assert.deepEqual(variantsOf({ rarity: 'Rare Holo' }), ['holofoil']);
});

test('expandEntries sorts by release date then number', () => {
  const keys = expandEntries([umbreonCommon, umbreonV, noTcp]).map((e) => e.key);
  assert.deepEqual(keys, ['x-1|normal', 'x-1|reverseHolofoil', 'swsh7-94|holofoil', 'sv8-60|holofoil', 'sv8-60|reverseHolofoil']);
});

test('marketPriceDkk', () => {
  assert.equal(marketPriceDkk(umbreonV, 'holofoil', settings), 30);
  assert.equal(marketPriceDkk(umbreonV, 'holofoil', { ...settings, priceSource: 'cm-low' }), 15);
  assert.equal(marketPriceDkk(umbreonCommon, 'reverseHolofoil', settings), 9);
  // US import: 5 USD * 7 * 1.25 VAT
  assert.equal(marketPriceDkk(umbreonV, 'holofoil', { ...settings, priceSource: 'tcp-market' }), 43.75);
  assert.equal(marketPriceDkk(umbreonV, 'holofoil', { ...settings, priceSource: 'tcp-market', usImportVat: false }), 35);
  assert.equal(marketPriceDkk({ ...umbreonV, cardmarket: undefined }, 'holofoil', settings), null);
});

test('manual price overrides market price', () => {
  const [e] = expandEntries([umbreonV]);
  assert.deepEqual(effectivePrice(e, { manualPrice: 25 }, settings), { value: 25, source: 'manual' });
  assert.deepEqual(effectivePrice(e, { manualPrice: null }, settings), { value: 30, source: 'market' });
  assert.deepEqual(effectivePrice(e, {}, settings), { value: 30, source: 'market' });
});

test('summarize', () => {
  const entries = expandEntries([umbreonV, umbreonCommon]);
  const collection = {
    'swsh7-94|holofoil': { owned: true, paid: 20 },
    'sv8-60|holofoil': { excluded: true },
  };
  const s = summarize(entries, collection, settings);
  assert.deepEqual(s, { total: 2, owned: 1, ownedValue: 30, spent: 20, remainingCost: 9, unpriced: 0, excluded: 1 });
});

test('shopUrl and CSV', () => {
  assert.equal(shopUrl('https://x.dk/?q={q}', umbreonV), 'https://x.dk/?q=Umbreon%20V%2094%2F203%20Evolving%20Skies');
  const csv = toCsv(expandEntries([umbreonV]), { 'swsh7-94|holofoil': { owned: true, paid: 12.5, note: 'DBA; Odense' } }, settings);
  const [, row] = csv.split('\n');
  assert.equal(row, 'Evolving Skies;2021/08/27;94/203;Umbreon V;Rare Holo V;Holo;yes;;12,50;30,00;market;"DBA; Odense";swsh7-94');
});
