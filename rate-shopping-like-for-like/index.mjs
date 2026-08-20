// Reads the accommodation rates feed for one night and prints a like-for-like
// comparison of your hotel against its comp set.
//
//   node --env-file=.env index.mjs 2026-08-21
//   node --env-file=.env index.mjs 2026-08-21 --csv > rates.csv

import { buildMatrix, position } from './compare.mjs';

const API = process.env.VEETAL_API_URL || 'https://api.veetal.app/v2';
const KEY = process.env.VEETAL_API_KEY;
const SLUG = process.env.VEETAL_ACCOMMODATION_SLUG;

const BOARD_NAME = { RO: 'Room only', BB: 'Breakfast', HB: 'Half board', FB: 'Full board', AI: 'All inclusive' };
const POLICY_NAME = { flex: 'Free cancellation', nr: 'Non-refundable' };

function productLabel(product) {
  const [b, c] = product.split('/');
  return `${BOARD_NAME[b] || b} · ${POLICY_NAME[c] || c}`;
}

function money(value, currency) {
  if (typeof value !== 'number') return '—';
  return `${value.toFixed(2)} ${currency || ''}`.trim();
}

async function fetchRates(date) {
  const url = `${API}/feed/accommodation/${SLUG}/rate/v7/${date}`;
  const res = await fetch(url, { headers: { 'veetal-api-key': KEY } });

  if (res.status === 401) throw new Error('Your API key was rejected. Check VEETAL_API_KEY.');
  if (res.status === 404) {
    throw new Error(
      `No rates stored for ${date}. The feed only answers for dates an import has already covered — check the Imports tab.`,
    );
  }
  if (!res.ok) throw new Error(`The API answered ${res.status} for ${date}.`);

  const body = await res.json();
  return body.report || {};
}

function printTable(matrix, date) {
  const { hotels, rows } = matrix;
  const nameWidth = Math.max(22, ...rows.map((r) => productLabel(r.product).length));
  const colWidth = Math.max(16, ...hotels.map((h) => h.name.length + 2));

  const header = 'PRODUCT'.padEnd(nameWidth) + hotels.map((h) => h.name.padStart(colWidth)).join('');
  console.log(`\nRates for ${date}\n`);
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    const cells = row.cells.map((c) => money(c.price, c.currency).padStart(colWidth)).join('');
    console.log(productLabel(row.product).padEnd(nameWidth) + cells);
  }
}

function printPosition(matrix) {
  const rows = position(matrix);
  if (!rows.length) return;

  const width = Math.max(...rows.map((r) => productLabel(r.product).length)) + 3;
  console.log('\nWhere you stand, product by product\n');
  for (const row of rows) {
    const label = productLabel(row.product).padEnd(width);
    if (!row.selling) {
      console.log(`${label}you do not sell this — ${row.comparable} competitor(s) do`);
      continue;
    }
    if (row.comparable < 2) {
      console.log(`${label}only you sell this on this night`);
      continue;
    }
    const gap = row.gap_pct === null ? '' :
      row.gap_pct === 0 ? ' · you are the cheapest' :
      ` · ${row.gap_pct > 0 ? '+' : ''}${row.gap_pct.toFixed(1)}% vs the cheapest`;
    console.log(`${label}#${row.rank} of ${row.comparable}${gap}`);
  }
}

function printCsv(matrix, date) {
  console.log(['date', 'product', 'hotel', 'price_per_night', 'currency'].join(','));
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      if (typeof cell.price !== 'number') continue;
      console.log([date, row.product, cell.slug, cell.price.toFixed(2), cell.currency || ''].join(','));
    }
  }
}

async function main() {
  if (!KEY) throw new Error('Missing VEETAL_API_KEY. Copy .env.example to .env and put your key in it.');
  if (!SLUG) throw new Error('Missing VEETAL_ACCOMMODATION_SLUG. The copy icon next to the hotel in the dashboard gives it to you.');

  const args = process.argv.slice(2);
  const csv = args.includes('--csv');
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!date) throw new Error('Pass the night you want, as YYYY-MM-DD. Example: node --env-file=.env index.mjs 2026-08-21');

  const report = await fetchRates(date);
  if (!Object.keys(report).length) throw new Error(`The feed answered nothing for ${date}.`);

  const matrix = buildMatrix(report);

  if (csv) return printCsv(matrix, date);

  printTable(matrix, date);
  printPosition(matrix);

  const missing = matrix.rows.flatMap((r) => r.cells.filter((c) => c.price === null)).length;
  if (missing) {
    console.log(
      `\n${missing} empty cell(s): that competitor does not sell that product on this night. ` +
      'They are not zeros, and averaging over them is how a comp set report starts lying.',
    );
  }
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
