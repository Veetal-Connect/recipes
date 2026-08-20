// Everything the widget shows that the API does not hand you ready-made.
//
// The Connect API returns reviews and reputation: scores, counts, category scores,
// text. It does NOT return a sentiment field, and it does not return "cleanliness is
// trending up 12%". Those are derived here, from the scores, and the thresholds are
// this widget's opinion — not a number blessed by Veetal. Keep them in one file so
// the choice is visible and easy to argue with.

/** Scores are 0-10 across every OTA. Where a bucket starts is a product decision. */
export const POSITIVE_FROM = 9;
export const NEUTRAL_FROM = 7;

/** Trailing window, and the one before it, used for every delta. */
export const WINDOW_DAYS = 28;

/**
 * Below this many scores in a window, a delta is noise dressed up as a finding.
 * Measured on a real hotel: `location` had 47 samples in the current window and 23 in
 * the previous one, while `cleanliness` had 5 and 2. A "-4%" built on 5 against 2
 * reviews is one guest having a bad morning, and putting an arrow on it on a hotel's
 * own website is worse than saying nothing.
 */
export const MIN_SAMPLE = 8;

/**
 * Movements smaller than this are not shown as a trend. Measured on a real hotel,
 * `location` moved -0.3% between windows and the card rendered a solemn "↓0%" —
 * an arrow pointing at nothing, which reads as a problem where there is none.
 */
export const MIN_DELTA_PCT = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 'YYYY-MM-DD' -> Date at local midnight, or null. ~9% of Google reviews have no day. */
export function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Splits reviews into the trailing window and the one immediately before it. */
export function splitWindows(reviews, now = new Date(), days = WINDOW_DAYS) {
  const startCurrent = new Date(now.getTime() - days * DAY_MS);
  const startPrevious = new Date(now.getTime() - 2 * days * DAY_MS);
  const current = [];
  const previous = [];

  for (const review of reviews) {
    const day = parseDay(review.date);
    if (!day) continue; // undated reviews count in totals, never in a trend
    if (day > startCurrent) current.push(review);
    else if (day > startPrevious) previous.push(review);
  }
  return { current, previous };
}

/** How many reviews fall in each bucket, plus the shares the bar is drawn from. */
export function sentiment(reviews) {
  const scored = reviews.filter((review) => typeof review.score === 'number');
  if (!scored.length) return null;

  const positive = scored.filter((r) => r.score >= POSITIVE_FROM).length;
  const negative = scored.filter((r) => r.score < NEUTRAL_FROM).length;
  const neutral = scored.length - positive - negative;

  return {
    total: scored.length,
    positive,
    neutral,
    negative,
    // Shares are 0-1 fractions, so the bar never has to divide anything itself.
    positive_share: positive / scored.length,
    neutral_share: neutral / scored.length,
    negative_share: negative / scored.length,
  };
}

/**
 * Category averages for the window, with a delta against the previous one.
 *
 * Category names arrive already normalised across OTAs — `location` means the same
 * thing whether it came from Google or Tripadvisor — but each OTA exposes a different
 * subset, so merging is what makes the panel worth having. `delta` is null whenever
 * either window is too thin to say anything; the widget then renders the score alone.
 */
export function categories(reviews, now = new Date(), days = WINDOW_DAYS) {
  const { current, previous } = splitWindows(reviews, now, days);

  const collect = (rows) => {
    const byName = new Map();
    for (const review of rows) {
      for (const category of review.category_score || []) {
        if (!category || typeof category.score !== 'number') continue;
        if (!byName.has(category.name)) byName.set(category.name, []);
        byName.get(category.name).push(category.score);
      }
    }
    return byName;
  };

  const now_ = collect(current);
  const before = collect(previous);

  const out = [];
  for (const [name, scores] of now_) {
    const previousScores = before.get(name) || [];
    const currentMean = mean(scores);
    const previousMean = mean(previousScores);

    const comparable =
      scores.length >= MIN_SAMPLE && previousScores.length >= MIN_SAMPLE && previousMean > 0;
    const change = comparable ? ((currentMean - previousMean) / previousMean) * 100 : null;

    out.push({
      name,
      score: currentMean,
      sample: scores.length,
      // Percentage change against the previous window, or null when it would be noise.
      delta: change !== null && Math.abs(change) >= MIN_DELTA_PCT ? change : null,
    });
  }

  // Biggest movers first, then whatever has the most evidence behind it.
  return out.sort((a, b) => {
    const byDelta = Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
    return byDelta !== 0 ? byDelta : b.sample - a.sample;
  });
}

/**
 * One headline score out of several OTAs, weighted by how many reviews each one has.
 * An unweighted average lets an OTA with nine reviews shout as loudly as one with two
 * thousand.
 */
export function headline(sources) {
  const usable = sources.filter((s) => typeof s.score === 'number' && s.count > 0);
  if (!usable.length) return { score: null, count: 0, sources: sources.length };

  const totalCount = usable.reduce((sum, s) => sum + s.count, 0);
  const weighted = usable.reduce((sum, s) => sum + s.score * s.count, 0) / totalCount;

  return { score: weighted, count: totalCount, sources: usable.length };
}
