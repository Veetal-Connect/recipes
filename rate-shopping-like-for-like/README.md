# Rate shopping, like for like

Compares your hotel against its comp set on Booking **product by product** — same
board, same cancellation policy — instead of hotel by hotel. Node 20, no
dependencies, no build step.

Full walkthrough:
<https://connect-api.veetal.app/recipes/rate-shopping-like-for-like>

## The mistake this exists to avoid

Every rate shopping report starts the same way: cheapest rate per hotel, side by side.
It is the wrong comparison, and it fails quietly.

On a real comp set, one night, this is what the feed returned:

| | Room only · Flex | Breakfast · Flex | Room only · NR | Breakfast · NR |
| --- | --- | --- | --- | --- |
| **Your hotel** | 411,40 | 435,20 | — | — |
| Competitor A | — | — | 567,40 | 631,40 |
| Competitor B | 1.010,90 | 1.041,70 | 2.220,90 | 2.251,70 |

Cheapest-per-hotel says: 411,40 against 567,40 against 1.010,90. You look 28 % cheaper
than Competitor A.

You are not. **Competitor A does not sell a flexible rate at all.** Its 567,40 is
non-refundable, and you are comparing it against your flexible one. On the product you
actually both sell, there is no comparison to make — and that is the finding.

Two more things that table shows and a single number cannot:

- Competitor B's **non-refundable is more expensive than its flexible** (2.220,90 vs
  1.010,90). "Non-refundable is the cheap one" is an assumption, not a rule.
- You sell nothing at all in the non-refundable column. Whether that is a decision or
  an oversight is your call, but you cannot make it if the report averages it away.

## Before you start

This reads a **Feed** dataset, so it only returns what an import has already written:

1. The hotel added in [Accommodations](https://dashboard.veetal.app/account/accommodations),
   with its comp set filled in — the competitors are what turns this from a price list
   into a comparison.
2. One finished import in
   [Accommodation Rates](https://dashboard.veetal.app/feed-api/feed-accommodation-rates).
   Set a schedule while you are there.
3. The **slug** the API identifies the hotel by: the copy icon next to it gives it to you.

## Run it

```bash
git clone https://github.com/Veetal-Connect/recipes.git
cd recipes/rate-shopping-like-for-like
cp .env.example .env          # your VEETAL_API_KEY and VEETAL_ACCOMMODATION_SLUG
node --env-file=.env index.mjs 2026-08-21
```

```
PRODUCT                          Your Hotel     Competitor A     Competitor B
--------------------------------------------------------------------------------
Breakfast · Free cancellation    435.20 EUR                —     1041.70 EUR
Breakfast · Non-refundable                —      631.40 EUR      2251.70 EUR
Room only · Free cancellation    411.40 EUR                —     1010.90 EUR
Room only · Non-refundable                —      567.40 EUR      2220.90 EUR

Where you stand, product by product

Breakfast · Free cancellation   #1 of 2 · you are the cheapest
Breakfast · Non-refundable      you do not sell this — 2 competitor(s) do
Room only · Free cancellation   #1 of 2 · you are the cheapest
Room only · Non-refundable      you do not sell this — 2 competitor(s) do
```

Add `--csv` to get one row per hotel and product instead, for a spreadsheet or a
warehouse:

```bash
node --env-file=.env index.mjs 2026-08-21 --csv > rates.csv
```

## What it costs

Nothing per run. Feed reads are not billed per request — the credits go on the imports
that collect the rates, and the dashboard estimates those before you launch them.

## How the comparison works

All of it lives in [`compare.mjs`](compare.mjs), in one file, so the rules are visible:

| Step | Rule |
| --- | --- |
| Board | `meal_plan` → `AI` › `FB` › `HB` › `BB` › `RO`, most inclusive first |
| Cancellation | `free_cancellation` decides; `no_refundable` is only the fallback, because a rate can have neither flag set |
| Product | the pair, e.g. `BB/flex`. Two rates are comparable when this matches |
| Cheapest | lowest `price_per_night` **within** a product, never across products |
| Position | rank among the hotels that **sell that product**, so the denominator is honest |
| Gap | against the cheapest competitor on the same product |

A missing cell stays `null`. It is never a zero and never averaged over: it means the
competitor does not sell that product that night, which is information.

## What the endpoint gives you

`GET /v2/feed/accommodation/{slug}/rate/v7/{date}` answers
`{ report: { [slug]: [rate, ...] } }` — your hotel and every competitor in the same
payload, each rate tagged with a `_meta` block that carries `is_primary`,
`accommodation_name`, `rate_date`, `visitor_type` and `device_type`.

Worth knowing:

- **Use `v7`.** The older `/rate` path proxies to a legacy backend and answers a
  different shape.
- `?min_rates=true` collapses each hotel to its single cheapest rate. Convenient, and
  exactly the shortcut this recipe argues against — it is the parameter that hides the
  product mix.
- There is also `/rate/v7/{year}/{month}` for a whole month, and filters for `regime`,
  `cancel_policy`, `adults`, `genius` and `mobile_device` if you would rather have the
  API narrow it than do it here.

## Tests

```bash
node test.mjs
```

No network and no API key. The fixtures reproduce the two cases from the table above —
a competitor with no flexible rate, and one whose non-refundable costs more than its
flexible — and assert that the denominator only counts hotels that sell the product,
that gaps are measured within a product, and that an empty cell never becomes a zero.
