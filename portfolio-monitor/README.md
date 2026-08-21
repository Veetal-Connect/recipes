# Portfolio monitor

One table for a whole portfolio: ADR per hotel over a window of nights, the outliers
against the portfolio median, and everything that makes those numbers less comparable
than they look. Node 20, no dependencies, no build step.

Full walkthrough:
<https://connect-api.veetal.app/recipes/portfolio-performance-monitoring>

## The number that is easy to get wrong

Run it over a real portfolio and the table is the easy half:

```
Portfolio ADR · median 376.20 EUR

HOTEL                                     ADR   VS MEDIAN   NIGHTS  PRODUCT
---------------------------------------------------------------------------
Hotel Arts Barcelona               861.06 EUR     +128.9%       11  room only · non-ref
Monument Hotel                     624.38 EUR      +66.0%       13  room only · non-ref
...
Hotel Barcelona Catedral           248.48 EUR      -34.0%        8  room only · flex
Praktik Rambla                     168.72 EUR      -55.2%       11  room only · flex
```

Read that as a ranking and you conclude Hotel Barcelona Catedral is underpricing the
portfolio by a third. Look at the `NIGHTS` column and the conclusion falls apart: it is
priced on **8 of 13 nights**. The five missing nights are not missing at random — the
nights a hotel sells out first are its most expensive ones, so an ADR built on what is
left is systematically low.

Same for the `PRODUCT` column. A hotel whose cheapest rate is room-only on Monday and
breakfast-included on Friday has an ADR that mixes two products. It is not wrong, but
it is not the same measurement as a hotel that sold room-only all week.

None of that is visible in a single ADR figure, which is why this prints all three.

## The failure that never announces itself

Every rate carries a `_meta` block saying **how it was collected**: which OTA, whether
the shopper was anonymous or logged in, desktop or mobile. Those are import settings,
not data — and Booking answers a different question for each:

- a Genius price is not a public price
- a mobile price is not a desktop price
- Expedia is not Booking

Two hotels configured differently produce numbers that look identical in a table and
mean different things. Nothing errors. The comparison is simply wrong.

So this builds a **fingerprint** per hotel — `booking · anonymous · desktop` — and when
the portfolio contains more than one, it says so and tells you which hotels sit in each
group. Fix the import config before trusting the ranking.

## Before you start

This reads a **Feed** dataset, so it only returns what an import has already written:

1. Your hotels added in [Accommodations](https://dashboard.veetal.app/account/accommodations).
2. An **Accommodation Rates** import that has run over the nights you want, with the
   **same configuration for every property** — same OTAs, same occupancy, same device.
   That sameness is the whole point.
3. Ideally a schedule, so the window keeps moving forward.

## Run it

```bash
git clone https://github.com/Veetal-Connect/recipes.git
cd recipes/portfolio-monitor
cp .env.example .env          # your VEETAL_API_KEY
node --env-file=.env index.mjs 2026-08-19 2026-09-01
```

Add `--csv` for one row per hotel, ready for a spreadsheet:

```bash
node --env-file=.env index.mjs 2026-08-19 2026-09-01 --csv > portfolio.csv
```

## What it costs

Nothing per run. Feed reads are not billed per request — the credits go on the imports
that collect the rates. Note that it makes one call per hotel per night, so a portfolio
of twenty hotels over a month is 600 requests: cheap, but not instant.

## Two API traps worth knowing

**`/account/accommodation` answers an object indexed by slug, not an array** — and the
slug exists *only as the key*. There is no `slug` field inside the object, so reading it
with `Object.values()` gives you every hotel and loses the one identifier every other
endpoint asks for. Use `Object.entries()`.

**Use `/rate/v7/{date}`, not `/rate`.** The older path proxies to a legacy backend and
answers a different shape.

## How the numbers are built

All of it is in [`portfolio.mjs`](portfolio.mjs):

| Value | Rule |
| --- | --- |
| Night price | cheapest `price_per_night` of that hotel that night, with the product it came from |
| ADR | mean of those night prices, over the nights that have one |
| Median | portfolio median, not mean — one 2.000 EUR property should not move everyone's reference |
| Deviation | percent against that median |
| Fingerprint | `provider · visitor_type · device_type`, from `_meta` |

Competitor rates are filtered out: a portfolio view wants your own hotels, and the v7
report carries the comp set in the same payload.

## Tests

```bash
node test.mjs
```

No network and no API key. The fixtures reproduce the three ways a portfolio lies — a
hotel measured on mobile among desktop ones, a hotel priced on fewer nights, and a hotel
whose cheapest rate changes product — and assert that each one is reported, that the
deviation is measured against the median rather than the mean, and that a homogeneous
portfolio produces no warnings at all.
