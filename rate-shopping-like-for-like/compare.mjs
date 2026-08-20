// The whole opinion of this recipe lives here: a rate is only comparable to another
// rate that sells the same thing.
//
// "Cheapest rate per hotel" is the comparison everyone builds first, and it is wrong
// in a way that is hard to see: it silently puts your flexible room-only against a
// competitor's non-refundable half board and calls the difference a price gap. It
// isn't. It is two different products.

/** The four board levels Booking reports, most inclusive first. */
export function board(rate) {
  const meal = rate.meal_plan || {};
  if (meal.all_inclusive) return 'AI';
  if (meal.full_board) return 'FB';
  if (meal.half_board) return 'HB';
  if (meal.breakfast) return 'BB';
  return 'RO'; // room only
}

/**
 * Flexible or non-refundable. Booking exposes both flags and they are not always
 * each other's opposite — a rate can have neither set, which is why free_cancellation
 * is the one that decides and no_refundable is only a fallback.
 */
export function cancellation(rate) {
  const policy = rate.cancellation || {};
  if (policy.free_cancellation) return 'flex';
  if (policy.no_refundable) return 'nr';
  return 'nr';
}

/** The product a rate belongs to. Two rates are comparable when this matches. */
export function productKey(rate) {
  return `${board(rate)}/${cancellation(rate)}`;
}

/** Cheapest price per product for one hotel's rate list. */
export function cheapestByProduct(rates) {
  const out = new Map();
  for (const rate of rates || []) {
    const price = rate.price_per_night;
    if (typeof price !== 'number') continue;
    const key = productKey(rate);
    const current = out.get(key);
    if (!current || price < current.price) {
      out.set(key, { price, room_type: rate.room_type, currency: rate.currency });
    }
  }
  return out;
}

/**
 * Turns the API's `report` into a product × hotel matrix.
 *
 * A cell can be missing, and that is a finding rather than a hole to fill with a
 * zero: it means the competitor does not sell that product on that night. Measured
 * on a real compset, one competitor had no flexible rate at all — every comparison
 * against its "cheapest rate" was a comparison against a non-refundable.
 */
export function buildMatrix(report) {
  const hotels = [];
  const byHotel = new Map();

  for (const [slug, rates] of Object.entries(report || {})) {
    const meta = (rates && rates[0] && rates[0]._meta) || {};
    hotels.push({
      slug,
      name: meta.accommodation_name || slug,
      isPrimary: meta.is_primary === true,
    });
    byHotel.set(slug, cheapestByProduct(rates));
  }

  // Your hotel first, then the compset by name: the eye should not have to hunt.
  hotels.sort((a, b) => (b.isPrimary - a.isPrimary) || a.name.localeCompare(b.name));

  const products = [...new Set(hotels.flatMap((h) => [...byHotel.get(h.slug).keys()]))].sort();

  const rows = products.map((product) => ({
    product,
    cells: hotels.map((hotel) => {
      const hit = byHotel.get(hotel.slug).get(product);
      return { slug: hotel.slug, price: hit ? hit.price : null, currency: hit ? hit.currency : null };
    }),
  }));

  return { hotels, rows };
}

/**
 * Where your hotel sits on each product, counting only hotels that actually sell it.
 * `comparable` is the honest denominator: being "1 of 2" on a product half the
 * compset does not sell is a very different claim from being "1 of 5".
 */
export function position(matrix) {
  const primary = matrix.hotels.find((h) => h.isPrimary);
  if (!primary) return [];

  return matrix.rows.map((row) => {
    const priced = row.cells.filter((c) => typeof c.price === 'number');
    const mine = row.cells.find((c) => c.slug === primary.slug);

    if (!mine || typeof mine.price !== 'number') {
      return { product: row.product, selling: false, comparable: priced.length };
    }

    const cheaper = priced.filter((c) => c.price < mine.price).length;
    const cheapest = Math.min(...priced.map((c) => c.price));

    return {
      product: row.product,
      selling: true,
      price: mine.price,
      rank: cheaper + 1,
      comparable: priced.length,
      // Against the cheapest competitor on the same product, not on any product.
      gap_pct: cheapest > 0 ? ((mine.price - cheapest) / cheapest) * 100 : null,
    };
  });
}
