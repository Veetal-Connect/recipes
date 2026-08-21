// One table for a whole portfolio: ADR per hotel over a window of nights, the outliers
// against the portfolio median, and everything that makes those numbers less comparable
// than they look.
//
//   node --env-file=.env index.mjs 2026-08-19 2026-09-01
//   node --env-file=.env index.mjs 2026-08-19 2026-09-01 --csv > portfolio.csv

import { summarise, withDeviation, comparability } from './portfolio.mjs';

const API = process.env.VEETAL_API_URL || 'https://api.veetal.app/v2';
const KEY = process.env.VEETAL_API_KEY;

const BOARD = { RO: 'room only', BB: 'breakfast', HB: 'half board', FB: 'full board', AI: 'all in' };
const POLICY = { flex: 'flex', nr: 'non-ref' };
const label = (p) => p.split('/').map((part, i) => (i ? POLICY[part] || part : BOARD[part] || part)).join(' · ');

async function veetal(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'veetal-api-key': KEY } });
  if (res.status === 401) throw new Error('Your API key was rejected. Check VEETAL_API_KEY.');
  if (!res.ok) return { __status: res.status };
  return res.json();
}

/** Every night between two dates, inclusive. */
function nightsBetween(from, to) {
  const out = [];
  const day = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (day <= end) {
    out.push(day.toISOString().slice(0, 10));
    day.setDate(day.getDate() + 1);
  }
  return out;
}

/**
 * `/account/accommodation` answers an object **indexed by slug**, not an array — and
 * the slug exists only as the key: there is no `slug` field inside the object. Reading
 * it with Object.values() gives you every hotel and loses the one identifier every
 * other endpoint asks for.
 */
async function listAccommodations() {
  const body = await veetal('/account/accommodation');
  const raw = body?.data ?? body;

  if (Array.isArray(raw)) {
    return raw.filter((a) => a?.slug).map((a) => ({ slug: a.slug, name: a.name }));
  }
  return Object.entries(raw || {})
    .filter(([slug, a]) => slug && a && typeof a === 'object')
    .map(([slug, a]) => ({ slug, name: a.name || slug }));
}

async function collect(hotels, nights) {
  const byHotel = {};

  for (const hotel of hotels) {
    const entry = { name: hotel.name, nights: {}, rates: [] };

    for (const night of nights) {
      const body = await veetal(`/feed/accommodation/${hotel.slug}/rate/v7/${night}`);
      // 404 on a night nobody imported is the normal case, not an error.
      if (body?.__status || !body?.report) continue;

      // The report carries the comp set too; a portfolio view wants only our own.
      const own = (body.report[hotel.slug] || []).filter((r) => r._meta?.is_primary !== false);
      if (!own.length) continue;

      entry.nights[night] = own;
      entry.rates.push(...own);
    }

    if (entry.rates.length) byHotel[hotel.slug] = entry;
  }

  return byHotel;
}

function money(v, currency) {
  return typeof v === 'number' ? `${v.toFixed(2)} ${currency || ''}`.trim() : '—';
}

function printTable({ median, rows }) {
  const w = Math.max(20, ...rows.map((r) => r.name.length));
  console.log(`\nPortfolio ADR · median ${money(median, rows[0]?.currency)}\n`);
  console.log(
    'HOTEL'.padEnd(w) + 'ADR'.padStart(14) + 'VS MEDIAN'.padStart(12) + 'NIGHTS'.padStart(9) + '  PRODUCT',
  );
  console.log('-'.repeat(w + 44));

  for (const r of rows) {
    const dev = typeof r.deviation_pct === 'number'
      ? `${r.deviation_pct > 0 ? '+' : ''}${r.deviation_pct.toFixed(1)}%`
      : '—';
    console.log(
      r.name.padEnd(w) +
        money(r.adr, r.currency).padStart(14) +
        dev.padStart(12) +
        String(r.nights).padStart(9) +
        '  ' +
        r.products.map(label).join(', '),
    );
  }
}

function printFindings(findings) {
  if (!findings.length) {
    console.log('\nEvery hotel was collected the same way and priced on the same nights.');
    return;
  }

  console.log('\nRead these before you rank anything\n');
  for (const f of findings) {
    if (f.type === 'fingerprint') {
      console.log(`  · collected as [${f.fingerprint}]: ${f.hotels.join(', ')}`);
    } else if (f.type === 'coverage') {
      console.log(`  · ${f.slug} is priced on ${f.nights} of ${f.of} nights — its ADR is a different slice of the calendar`);
    } else if (f.type === 'mixed_products') {
      console.log(`  · ${f.slug} mixes products across nights (${f.products.map(label).join(', ')})`);
    } else if (f.type === 'currency') {
      console.log(`  · the portfolio reports in more than one currency (${f.currencies.join(', ')}) — these ADRs are not addable`);
    }
  }
  if (findings.some((f) => f.type === 'fingerprint')) {
    console.log(
      '\n  A different fingerprint means a different question was asked of Booking:\n' +
      '  another OTA, a logged-in shopper, or a mobile device. Same-looking numbers,\n' +
      '  different measurement. Fix the import config before trusting the ranking.',
    );
  }
}

async function main() {
  if (!KEY) throw new Error('Missing VEETAL_API_KEY. Copy .env.example to .env and put your key in it.');

  const args = process.argv.slice(2);
  const csv = args.includes('--csv');
  const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (dates.length !== 2) {
    throw new Error('Pass the window you want: node --env-file=.env index.mjs 2026-08-19 2026-09-01');
  }

  const [from, to] = dates.sort();
  const hotels = await listAccommodations();
  if (!hotels.length) throw new Error('No accommodations on this account yet.');

  const nights = nightsBetween(from, to);
  if (!csv) console.error(`Reading ${hotels.length} hotels over ${nights.length} nights…`);

  const byHotel = await collect(hotels, nights);
  if (!Object.keys(byHotel).length) {
    throw new Error(`No rates stored between ${from} and ${to}. The feed only answers for nights an import has covered.`);
  }

  const { median, rows } = withDeviation(summarise(byHotel));

  if (csv) {
    console.log(['hotel', 'adr', 'min', 'max', 'nights', 'deviation_pct', 'products', 'fingerprint', 'currency'].join(','));
    for (const r of rows) {
      console.log([
        r.slug, r.adr?.toFixed(2) ?? '', r.min?.toFixed(2) ?? '', r.max?.toFixed(2) ?? '',
        r.nights, r.deviation_pct?.toFixed(1) ?? '', `"${r.products.join(' ')}"`,
        `"${r.fingerprint}"`, r.currency || '',
      ].join(','));
    }
    return;
  }

  printTable({ median, rows });
  printFindings(comparability(rows));
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
