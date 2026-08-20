// Proxy between your website and the Veetal Connect API.
//
// The Connect API answers `access-control-allow-origin: *`, so a page COULD call it
// from the browser. It must not: the request carries your veetal-api-key, and anyone
// with devtools open would walk away with it and read your whole account. The key
// stays here; the browser only ever talks to your own domain.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentiment, categories, headline, WINDOW_DAYS } from './insights.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const API = process.env.VEETAL_API_URL || 'https://api.veetal.app/v2';
const KEY = process.env.VEETAL_API_KEY;
const SLUG = process.env.VEETAL_ACCOMMODATION_SLUG;
const PORT = Number(process.env.PORT) || 8787;

// Feed reads are not billed per request, but they are not free to serve either, and a
// busy page would hammer them for data that changes once a day at most.
const TTL_MS = 15 * 60 * 1000;

let cache = { at: 0, body: null };

async function veetal(pathname) {
  const res = await fetch(`${API}${pathname}`, { headers: { 'veetal-api-key': KEY } });
  if (!res.ok) throw new Error(`Veetal ${res.status} on ${pathname}`);
  return res.json();
}

// Reputation is served from the latest import. If that run did not cover Google it
// answers 404 (784) — the review list is still good, so the header degrades instead of
// taking the whole widget down with it.
async function veetalOptional(pathname) {
  try {
    return await veetal(pathname);
  } catch (err) {
    console.warn('[reviews-widget] optional call failed:', err.message);
    return null;
  }
}

// Google glues its own English translation in front of what the hotel actually wrote.
// Keep the original: the visitor reads the reply in the language it was written in.
export function originalText(value) {
  if (!value) return null;
  const m = /\(Translated by Google\)[\s\S]*?\n\n\(Original\)\n([\s\S]*)$/.exec(value);
  return (m ? m[1] : value).trim() || null;
}

export async function build() {
  const [reputation, reviews] = await Promise.all([
    // No provider filter: one entry per OTA the hotel has, which is what turns this
    // from a Google widget into a reputation widget.
    veetalOptional(`/feed/accommodation/${SLUG}/reputation`),
    // include_competitors defaults to TRUE. Forget it and your hotel's own website
    // starts showing your competitors' reviews.
    // limit maxes out at 200 (error 226 above that). Two 28-day windows fit inside
    // the 200 most recent reviews for any hotel with normal traffic; a busier one
    // would need to page with ?page=2.
    veetal(`/feed/accommodation/${SLUG}/reviews?include_competitors=false&limit=200`),
  ]);

  const own = (reputation && reputation.accommodation) || [];
  const all = reviews.reviews || [];

  // Sentiment and trends need every scored review, including the ones with no text.
  // The list below needs the opposite. Same payload, two different populations.
  const sources = own.map((entry) => ({
    provider: entry.provider,
    score: entry.review_score ?? null,
    count: entry.review_count ?? null,
  }));

  const now = new Date();

  return {
    name: (own[0] && own[0].accommodation_name) || null,
    window_days: WINDOW_DAYS,
    headline: headline(sources),
    sources,
    sentiment: sentiment(all),
    categories: categories(all, now).slice(0, 6),
    reviews: all
      // 27 of every 100 Google reviews carry a score and no text at all.
      .filter((r) => r.text && r.text.trim())
      .slice(0, 12)
      .map((r) => ({
        id: r.review_id,
        provider: r.provider,
        date: r.date, // null on ~9%: Google publishes a relative age, not always a day
        score: r.score,
        text: r.text.trim(),
        author: r.author,
        reply:
          r.management_response && r.management_response.text
            ? { date: r.management_response.date, text: originalText(r.management_response.text) }
            : null,
      })),
  };
}

export function createApp() {
  const app = express();

  app.get('/reviews-widget.json', async (_req, res) => {
    if (cache.body && Date.now() - cache.at < TTL_MS) return res.json(cache.body);
    try {
      const body = await build();
      cache = { at: Date.now(), body };
      res.set('Cache-Control', 'public, max-age=900').json(body);
    } catch (err) {
      console.error('[reviews-widget]', err.message);
      // A failed refresh should not blank a page that was working a minute ago.
      if (cache.body) return res.json(cache.body);
      res.status(502).json({ error: 'reviews_unavailable' });
    }
  });

  app.use(express.static(path.join(HERE, 'public')));
  return app;
}

// Importing this file for the tests must not start a server.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!KEY) {
    console.error('Missing VEETAL_API_KEY. Copy .env.example to .env and put your key in it.');
    process.exit(1);
  }
  if (!SLUG) {
    console.error(
      'Missing VEETAL_ACCOMMODATION_SLUG. The copy icon next to the hotel in the dashboard gives it to you.',
    );
    process.exit(1);
  }
  createApp().listen(PORT, () => {
    console.log(`Reviews widget on http://localhost:${PORT}`);
    console.log(`Payload at    http://localhost:${PORT}/reviews-widget.json`);
  });
}
