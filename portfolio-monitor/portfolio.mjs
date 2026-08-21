// Comparing hotels to each other is only meaningful when they were measured the same
// way. That is not a property of the data — it is a property of how each import was
// configured, and nothing in the payload complains when two hotels disagree.
//
// So this file does two jobs: it computes the numbers, and it works out whether the
// numbers are allowed to be compared at all.

/** Board level, most inclusive first: the flags stack, so AI also has breakfast set. */
export function board(rate) {
  const meal = rate.meal_plan || {};
  if (meal.all_inclusive) return 'AI';
  if (meal.full_board) return 'FB';
  if (meal.half_board) return 'HB';
  if (meal.breakfast) return 'BB';
  return 'RO';
}

/** free_cancellation decides; a rate can arrive with neither flag set. */
export function cancellation(rate) {
  return rate.cancellation?.free_cancellation ? 'flex' : 'nr';
}

export const productKey = (rate) => `${board(rate)}/${cancellation(rate)}`;

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How a hotel's rates were collected, as a single string. Two hotels with different
 * fingerprints are not comparable, however similar their prices look.
 *
 * The fields come from `_meta`, which the v7 endpoint attaches to every rate: which
 * OTA, whether the shopper was anonymous or logged in (a Genius price is not a public
 * price), and whether it was desktop or mobile (Booking shows mobile-only deals).
 */
export function fingerprint(rates) {
  const set = (pick) => [...new Set(rates.map(pick).filter(Boolean))].sort().join('+');
  return [
    set((r) => r.provider || r._meta?.provider),
    set((r) => r._meta?.visitor_type),
    set((r) => r._meta?.device_type),
  ].join(' · ');
}

/**
 * The cheapest rate of a hotel for one night, with the product it belongs to.
 *
 * Deliberately NOT filtered to a single product: a portfolio usually sells different
 * things in different properties, and forcing one product would blank half the table.
 * The product travels with the number instead, so the caller can see when two hotels
 * are being compared across different products.
 */
export function cheapestOfNight(rates) {
  let best = null;
  for (const rate of rates || []) {
    const price = rate.price_per_night;
    if (typeof price !== 'number') continue;
    if (!best || price < best.price) best = { price, product: productKey(rate), currency: rate.currency };
  }
  return best;
}

/**
 * One row per hotel: ADR over the window, how many nights it is built on, and which
 * products those nights came from.
 *
 * `nights` matters as much as `adr`. A hotel priced on four of fourteen nights has an
 * ADR built on a different — and usually cheaper — slice of the calendar, because the
 * nights that sell out first are the expensive ones.
 */
export function summarise(byHotel) {
  const rows = [];

  for (const [slug, { name, nights, rates }] of Object.entries(byHotel)) {
    const prices = [];
    const products = new Set();
    let currency = null;

    for (const dayRates of Object.values(nights)) {
      const best = cheapestOfNight(dayRates);
      if (!best) continue;
      prices.push(best.price);
      products.add(best.product);
      currency = currency || best.currency;
    }

    rows.push({
      slug,
      name: name || slug,
      adr: prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      nights: prices.length,
      products: [...products].sort(),
      fingerprint: fingerprint(rates),
      currency,
    });
  }

  return rows.sort((a, b) => (b.adr ?? -1) - (a.adr ?? -1));
}

/**
 * Deviation from the portfolio median, in percent. The median rather than the mean:
 * one 2.000 EUR property should not drag the reference every other hotel is judged by.
 */
export function withDeviation(rows) {
  const mid = median(rows.map((r) => r.adr).filter((v) => typeof v === 'number'));
  return {
    median: mid,
    rows: rows.map((r) => ({
      ...r,
      deviation_pct: typeof r.adr === 'number' && mid ? ((r.adr - mid) / mid) * 100 : null,
    })),
  };
}

/**
 * Everything that makes a row less comparable than it looks. Returned as findings
 * rather than thrown: the table is still worth printing, the reader just needs to know
 * which lines to distrust.
 */
export function comparability(rows) {
  const findings = [];

  const prints = [...new Set(rows.map((r) => r.fingerprint))];
  if (prints.length > 1) {
    for (const print of prints) {
      findings.push({
        type: 'fingerprint',
        fingerprint: print,
        hotels: rows.filter((r) => r.fingerprint === print).map((r) => r.slug),
      });
    }
  }

  const fullest = Math.max(0, ...rows.map((r) => r.nights));
  for (const row of rows) {
    if (row.nights < fullest) {
      findings.push({ type: 'coverage', slug: row.slug, nights: row.nights, of: fullest });
    }
    if (row.products.length > 1) {
      findings.push({ type: 'mixed_products', slug: row.slug, products: row.products });
    }
  }

  const currencies = [...new Set(rows.map((r) => r.currency).filter(Boolean))];
  if (currencies.length > 1) findings.push({ type: 'currency', currencies });

  return findings;
}
