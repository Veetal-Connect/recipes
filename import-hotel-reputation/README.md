# Import a hotel's reputation from Booking

Reads a hotel's reputation from every OTA it is listed on — score, review count and
category breakdown — and turns it into a terminal table, a CSV and a standalone HTML
report.

Recipe page: <https://connect-api.veetal.app/recipes/import-hotel-reputation>

## Before you run it

Reputation is a **Feed** dataset: the endpoint reads what an import wrote, so the
accommodation has to exist on your account and an import has to have finished. Both
are one-off steps in the dashboard — the recipe page walks through every screen.

You also need the **Feed · Reputation** API active on your account.

## Run it

Requires Node 20 or newer. No dependencies to install.

```bash
git clone https://github.com/Veetal-Connect/recipes.git
cd recipes/import-hotel-reputation
cp .env.example .env      # put your VEETAL_API_KEY in it
node --env-file=.env index.mjs --list
node --env-file=.env index.mjs <accommodation-slug>
```

`--list` prints the slugs on your account, so you don't have to go back to the
dashboard to copy one.

## What you get

```
avenidapalace

OTA          Score  Reviews
───────────  ─────  ───────
google       9      1,373
tripadvisor  8.8    2,588
booking      8.7    2,023

booking: location 9.8, staff 9.4, free_wifi 9.2, comfort 8.9, cleanliness 8.8, …
tripadvisor: location 9.73, cleanliness 9.1

From import Veetal-MANUAL-20260818-120142854-ARP · 2026-08-18

Wrote report.csv and report.html
```

`report.csv` has one row per OTA **per category**, which is the shape a spreadsheet
pivots without a fight. `report.html` is a self-contained page you can send to
someone.

## The call behind it

```
GET /v2/feed/accommodation/{accommodation_slug}/reputation
```

One request per hotel. The response carries one entry per OTA in `accommodation`
(`provider`, `review_score`, `review_count` and, on the OTAs that score categories,
`category_score`), the same for your comp set in `competitors` (empty if you have
none), and an `import` block naming the run the numbers come from. The full contract
is on [developers.veetal.app](https://developers.veetal.app/#tag/Feed-API/GET/feed/accommodation/{accommodation_slug}/reputation).

## Notes

- **Google has no category breakdown.** It counts mentions per topic instead
  (`topics`), which this report does not render; Google shows up with its score and
  review count only.
- **An OTA the import could not read** (blocked, error) arrives with a `status` other
  than `processed` and no score. It is listed under "OTAs the import could not read"
  rather than rendered as an empty row.
- **The comp set is not rendered.** The response includes it; the report only counts
  how many hotels came along.
