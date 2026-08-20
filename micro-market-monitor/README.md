# Micro-market monitor

Map a micro-market from Booking.com and watch it move. Not a city — a **district**,
an airport, a five-kilometre radius: the handful of hotels a guest actually chooses
between when they choose yours.

For any location search configured on your account, this reads the stored extraction
and prints the whole market: who is listed, at what price, in what order, with what
score, how far from the metro. Point it at two dates and it tells you what changed —
who entered the listing, who disappeared, who moved the price and who climbed.

Built on the **Feed · Booking location search** dataset.

## Run it

Requires Node 20 or newer. No dependencies to install.

```bash
git clone https://github.com/Veetal-Connect/recipes.git
cd recipes/micro-market-monitor
cp .env.example .env          # put your VEETAL_API_KEY in it

node --env-file=.env index.mjs --list                    # your location searches
node --env-file=.env index.mjs --dates <search-id>       # dates that have data
node --env-file=.env index.mjs <search-id> <date>        # the market that day
node --env-file=.env index.mjs <search-id> <date> --vs <other-date>
```

It prints a table, and writes `market.csv` and `market.html` next to itself.

## The two things that cost a 404

This endpoint has a contract that is easy to get wrong, and both mistakes look
identical from outside — error `510`, "No data found for the requested date".

**1. The date is not "today".** It is the check-in date the import searched for,
which for a daily schedule is the day that run executed. You cannot pick a future
date and expect an answer. Ask for the valid ones with `--dates`.

**2. Without an `import_id`, only the latest extraction exists.** Every earlier day
answers 404 even though its import completed and its data is stored. To read
history you must pass the `import_id` of that run **together with its own date**.

The recipe does this for you: `--dates` lists each date next to the import that
wrote it, and a report resolves the pairing before it asks for anything.

## What you get

```
  Eixample, Barcelona
  2026-08-19  ·  frente a 2026-08-13

  10 hoteles   mediana 501 USD   rango 270–712   nota media 9.2

  POR CATEGORÍA
  estrellas   hoteles   mediana   nota
  ★★★★★             6       572    9.1
  ★★★★              4       331    9.2
```

...then the ranked market, then what moved. The HTML report is a single file you can
send to someone; the CSV opens in a spreadsheet.

## What the data actually looks like

Measured against a real district (Eixample, Barcelona, 4–5★, score ≥ 9):

| Field | What to know |
|---|---|
| `priceFinal` | The one to use. `displayPrice` is Booking's rounding and ruins any average |
| `priceOriginal` / `priceDiscount` | A discount of 197 on 583 is common — the headline price is not the price |
| listing order | The array order **is** the rank. Booking's own sort, and it moves |
| `distanceToCenter` | A **string**, often `"Distance not available"`. Never a number |
| `locationDetails` | Address, `displayLocation`, and the transit line in plain English |
| `publicTransportDistanceDescription` | Free text: `"Rocafort Metro station is within 150 metres"` |
| `currency` | Comes from the search entity. It may not be the currency you expected |
| `pagination.hasMore` | A district returned 10; a city returns hundreds. Page or you see a slice |
| composition | Between two dates a week apart, the set of listed hotels genuinely turns over |

The filters live on the **search entity**, not on the query: stars, accommodation
type, minimum score, distance from centre. The market you see is the market you
configured — change the entity and you are looking at a different one.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `No data found for the requested date` (`510`) | Wrong date, or history without its `import_id` | Run `--dates` and use a pair from that list |
| Fewer hotels than you expect | The entity's filters, or unpaged results | Check the filters with `--list`; the recipe pages for you |
| Everything "enters" the listing | You compared against a partial extraction | Make sure both dates paged fully |
| Prices in an unexpected currency | The search entity sets it | Change it on the entity in the dashboard |

## What's next

- Cross the market with `feed_events` for the same city: a price spike the day a
  congress lands is a different story from a random one.
- Track one hotel's rank over every stored date to get its position curve.
- Add `feed_accommodation_parity` to see whether the listed price is the one the
  hotel meant to publish.
