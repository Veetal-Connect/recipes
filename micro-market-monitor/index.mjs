#!/usr/bin/env node
// Micro-market monitor — Veetal Connect API recipe
//
//   node --env-file=.env index.mjs --list
//   node --env-file=.env index.mjs --dates <location_search_id>
//   node --env-file=.env index.mjs <location_search_id> <date> [--vs <date>]

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VeetalError, getMarket, listImports, listLocationSearches } from './lib/client.mjs';
import { compare, importDates, normalise, summarise } from './lib/market.mjs';
import { csv, html, terminal } from './lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.VEETAL_API_KEY;

const USAGE = `Micro-market monitor — Veetal Connect API

  node --env-file=.env index.mjs --list                       your location searches
  node --env-file=.env index.mjs --dates <search-id>          dates that have data
  node --env-file=.env index.mjs <search-id> <date>           the market that day
  node --env-file=.env index.mjs <search-id> <date> --vs <date>   ...and what moved

The date is the check-in date the import searched for — not "today". Ask for it with
--dates; guessing returns 404. Put your key in .env as VEETAL_API_KEY (see .env.example).`;

function parseArgs(argv) {
  const args = { positional: [], vs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--vs') {
      args.vs = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--list') {
      args.list = true;
    } else if (arg === '--dates') {
      args.dates = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.list && !args.dates && args.positional.length < 2)) {
    console.log(USAGE);
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  if (!KEY) {
    console.error('Missing VEETAL_API_KEY. Copy .env.example to .env and put your key in it.');
    process.exitCode = 1;
    return;
  }

  if (args.list) {
    const body = await listLocationSearches(KEY);
    const searches = body.data || [];
    if (!searches.length) {
      console.log('No location searches on this account. Create one in the dashboard first.');
      return;
    }
    console.log(`\n  ${searches.length} location searches\n`);
    for (const s of searches) {
      const filters = [
        s.stars && s.stars.length ? `${s.stars.join('/')}★` : null,
        s.accommodationType && s.accommodationType.length ? s.accommodationType.join('/') : null,
        s.minPuntuation ? `score ≥ ${s.minPuntuation}` : null,
        s.nights ? `${s.nights}n` : null,
      ].filter(Boolean);
      console.log(`  ${s._id}  ${s.name}`);
      if (filters.length) console.log(`  ${' '.repeat(24)}${filters.join(' · ')}`);
    }
    console.log('');
    return;
  }

  const searchId = args.positional[0];

  if (args.dates) {
    if (!searchId) {
      console.error('Which search? Run with --list to see the ids.');
      process.exitCode = 1;
      return;
    }
    const dates = importDates(await listImports(KEY, searchId));
    if (!dates.length) {
      console.log('No completed imports for that search yet.');
      return;
    }
    console.log(`\n  ${dates.length} dates with data, most recent first\n`);
    console.log(dates.map((d) => `  ${d.date}   ${d.importId}`).join('\n'));
    console.log('');
    return;
  }

  const date = args.positional[1];

  // Cada fecha solo se puede leer con el import que la escribió: sin su id, el
  // feed devuelve la última ejecución y cualquier día anterior responde 404.
  const available = importDates(await listImports(KEY, searchId));
  const idFor = (wanted) => {
    const match = available.find((d) => d.date === wanted);
    if (!match) {
      const list = available.slice(0, 8).map((d) => d.date).join(', ');
      throw new Error(
        `No completed import for ${wanted}. Dates with data: ${list}${available.length > 8 ? '…' : ''}\n` +
          'Run with --dates to see them all.',
      );
    }
    return match.importId;
  };

  const [currentRaw, previousRaw] = await Promise.all([
    getMarket(KEY, searchId, date, { importId: idFor(date) }),
    args.vs ? getMarket(KEY, searchId, args.vs, { importId: idFor(args.vs) }) : Promise.resolve(null),
  ]);

  const hotels = normalise(currentRaw.accommodations);
  if (!hotels.length) {
    console.log(`The import for ${date} stored no accommodations.`);
    return;
  }
  if (currentRaw.truncated) {
    console.warn(`Note: stopped paging early — the market is larger than what is reported here.`);
  }

  const summary = summarise(hotels);
  const changes = previousRaw ? compare(hotels, normalise(previousRaw.accommodations)) : null;
  // El nombre real del mercado lo pone la propia respuesta, no hace falta pedirlo aparte.
  const name = hotels[0].area || searchId;

  const view = { name, date, vs: args.vs, summary, hotels, changes };

  console.log(terminal(view));

  const csvPath = path.join(HERE, 'market.csv');
  const htmlPath = path.join(HERE, 'market.html');
  await writeFile(csvPath, csv(view));
  await writeFile(htmlPath, html(view));
  console.log(`  Escrito ${path.relative(process.cwd(), csvPath)} y ${path.relative(process.cwd(), htmlPath)}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof VeetalError) {
    const hint =
      error.status === 401
        ? 'Check VEETAL_API_KEY — the API rejected it.'
        : error.status === 404
          ? 'No data for that search or that date. Run with --dates to see the dates that have it.'
          : error.status >= 500
            ? 'That is the API failing, not your call. Retry in a minute.'
            : '';
    console.error(`${error.message}${hint ? `\n${hint}` : ''}`);
    if (!hint) {
      const detail =
        error.body && typeof error.body === 'object'
          ? error.body.message || error.body.error || JSON.stringify(error.body)
          : String(error.body ?? '').trim().slice(0, 200);
      if (detail) console.error(detail);
    }
    process.exitCode = 1;
  } else {
    // Los errores que lanzamos nosotros ya vienen redactados: enseñarlos con su
    // pila delante rompe la promesa del README de fallar con una frase.
    console.error(error.message);
    process.exitCode = 1;
  }
}
