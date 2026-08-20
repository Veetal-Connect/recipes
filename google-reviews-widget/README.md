# Google reviews widget

Renders a hotel's Google reviews on its own website, behind a proxy that keeps the
Veetal API key server-side. No build step, no framework, one dependency.

Full walkthrough, with the payload measurements this is built on:
<https://connect-api.veetal.app/recipes/google-reviews-widget>

## Before you start

This reads a **Feed** dataset, so it only returns what an import has already written.
In the dashboard you need:

1. The hotel added in [Accommodations](https://dashboard.veetal.app/account/accommodations),
   with **Google** among its detected profiles.
2. One finished import in
   [Reputation → Accommodations](https://dashboard.veetal.app/feed-api/feed-reputation/entities),
   with Google selected. Set a schedule while you are there — with a daily run the
   widget never shows reviews older than a day.
3. The **slug** the API identifies the hotel by: the copy icon next to it gives it to you.

## Run it

Requires Node 20 or newer.

```bash
git clone https://github.com/Veetal-Connect/recipes.git
cd recipes/google-reviews-widget
npm install
cp .env.example .env      # your VEETAL_API_KEY and VEETAL_ACCOMMODATION_SLUG
npm start
```

Then open <http://localhost:8787>. The demo page is a mock hotel site with the widget
embedded, so you see it in the context it is meant for.

## Embed it

Serve `public/veetal-reviews-widget.js` from your own site and point it at your proxy:

```html
<div id="reviews"></div>

<script src="/veetal-reviews-widget.js"
        data-endpoint="/reviews-widget.json"
        data-target="#reviews"
        data-limit="5"
        data-locale="en"
        data-theme="auto"></script>
```

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-endpoint` | `/reviews-widget.json` | Your proxy's JSON endpoint |
| `data-target` | — | CSS selector to render into. Without it the widget renders where the `<script>` sits |
| `data-limit` | `5` | How many reviews to show |
| `data-locale` | `<html lang>` | Formats dates and the review count |
| `data-theme` | `light` | `light`, `dark` or `auto` (follows the system, and keeps following it) |

## Why a proxy

The Connect API answers `access-control-allow-origin: *`, so a page *could* call it
straight from the browser. It must not: the request carries your `veetal-api-key`, and
anyone with devtools open walks away with it and can read your whole account. The key
stays on your server; the browser only ever talks to your own domain.

The proxy also caches for fifteen minutes and, if a refresh fails, serves the last good
payload — a page that worked a minute ago should not go blank because an API call did.

## What the widget handles

Built against the 100 most recent Google reviews of a real hotel:

- **27% carry no text**, only a score. Filtered out in the proxy.
- **81% have a reply from the hotel**, and Google glues its own English translation in
  front of it. The widget keeps the original, clamped to four lines so the card stays
  guest opinion rather than hotel PR.
- **9% have no date.** Google publishes a relative age, not always a day.
- **The language is never reported** and the texts are multilingual, so every text
  carries `dir="auto"` and right-to-left reviews read correctly.
- **Scores are out of 10** but Google rates 1–5, so per-review values are always even.

## Tests

```bash
node test.mjs
```

No network and no API key: it stands up a stub Connect API on localhost and checks what
the recipe promises — the filtering, the untranslated reply, `include_competitors=false`
on the request, the stale-payload fallback, and that the widget uses a shadow root and
never touches `innerHTML`.
