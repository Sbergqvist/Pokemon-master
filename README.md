# Pokémon Master Set tracker (DKK)

A small browser app for collecting a **master set of one Pokémon**: every English card of it, in every printed
variant (normal, holo, reverse holo, 1st edition…). All prices are shown in **Danish kroner**.

## What it does

- **Finds every card of a Pokémon.** Type a name (`Umbreon`) or a National Pokédex number (`197`). A name is
  resolved to its Pokédex number, so the set also includes cards like *Dark Umbreon*, *Umbreon VMAX* and tag teams
  such as *Umbreon & Darkrai GX*.
- **Splits each card into its variants.** Each variant is a separate checklist entry, because that is what a
  master set counts.
- **Prices in DKK, from the market Danes actually buy on.** By default it uses the **Cardmarket** trend price,
  converted from EUR to DKK. Cardmarket is an EU marketplace, so there is no customs or extra VAT. You can switch to
  the Cardmarket 30-day average or the lowest listing. You can also use TCGplayer (US) prices, with the 25% Danish
  import VAT (moms) added.
- **Your own prices win.** If you find a card cheaper (or only) on DBA, Facebook or in a local shop, enter
  *My price* and the totals use it instead.
- **Tracks your collection:** owned, condition (MT/NM/EX/GD/LP/PL/PO), what you paid and notes. Shows progress,
  the value of what you own, what you have spent and **what is left to buy**.
- **Exclude cards** you don't count toward your set, for example certain promos or Japanese-only prints.
- **Quick search links** for each card: the exact Cardmarket listing, DBA and Cardmarket search. You can add
  more shops in Settings using a `{q}` placeholder, e.g. `My shop | https://shop.dk/search?q={q}`.
- **Export:** a CSV file (semicolon-separated, so Danish Excel opens it correctly) and a JSON backup with restore.

Your collection is saved in your browser's `localStorage`. Nothing is sent anywhere except requests to the card API.
Export a backup now and then.

## Running it

It is plain HTML, CSS and JavaScript, so there is nothing to build. Because it uses ES modules, you need to
serve it over HTTP rather than open the file directly:

```sh
npm start            # or: python3 -m http.server 8000
# open http://localhost:8000
```

To get it on your phone, enable **GitHub Pages** for the repository (Settings → Pages → deploy from branch,
root folder).

## Data sources

- Card data and prices: [Pokémon TCG API](https://pokemontcg.io). It works without a key, but a free key from
  [dev.pokemontcg.io](https://dev.pokemontcg.io) gives higher rate limits. Enter it in Settings.
- Exchange rates: defaults are EUR→DKK 7.46 (the krone is pegged to the euro) and an approximate USD rate.
  *Fetch today's rates* in Settings pulls ECB rates from [frankfurter.app](https://frankfurter.app).

### Known limitations

- The API covers **English** cards only. Japanese prints aren't listed.
- Variant detection is based on which variants have price data. Very new or obscure cards may be missing a
  variant. Older sets sometimes list one that wasn't actually printed; mark those as excluded.
- Cardmarket gives one price for "non-reverse" and one for reverse holo. So 1st Edition and Unlimited prints of
  the same card show the same Cardmarket price. Use *My price* for those, or switch the price source to TCGplayer.

## Development

```sh
npm test   # unit tests for the pricing / variant / summary logic (Node 18+)
```

- `src/lib.js`: pure logic (queries, variants, pricing, totals, CSV)
- `src/app.js`: UI, storage and API calls
