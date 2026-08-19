#!/usr/bin/env node
// Lee la reputación multi-OTA de un alojamiento y la deja en tres formatos:
// tabla en terminal, report.csv y report.html.
//
//   node --env-file=.env index.mjs <accommodation-slug>
//   node --env-file=.env index.mjs --list
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getReputation, listAccommodations, VeetalError } from './lib/client.mjs';
import { extractImportInfo, normalizeReputation } from './lib/normalize.mjs';
import { toCsv, toHtml, toTable } from './lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`Multi-OTA reputation report — Veetal Connect API

  node --env-file=.env index.mjs <accommodation-slug>   report one accommodation
  node --env-file=.env index.mjs --list                 list the slugs on your account

The slug is the one the dashboard copies next to the hotel. Put your key in .env
as VEETAL_API_KEY (see .env.example).`);
}

async function listSlugs(apiKey) {
  const accommodations = await listAccommodations(apiKey);
  const entries = Object.entries(accommodations ?? {});
  if (!entries.length) {
    console.log('No accommodations on this account yet. Add one from the dashboard.');
    return;
  }
  const width = Math.max(...entries.map(([slug]) => slug.length));
  for (const [slug, data] of entries) {
    const city = data?.location?.city?.name;
    console.log(`${slug.padEnd(width)}  ${data?.name ?? ''}${city ? ` · ${city}` : ''}`);
  }
}

async function report(apiKey, slug) {
  const payload = await getReputation(apiKey, slug);
  const { rows, skipped } = normalizeReputation(payload);

  if (!rows.length) {
    console.error(`No reputation data for "${slug}".

The endpoint answered, but with nothing to read. That normally means no import has
finished for this accommodation yet — launch one from the dashboard (Reputation →
Accommodations → Launch new import) and try again in a couple of minutes.`);
    process.exitCode = 1;
    return;
  }

  const importInfo = extractImportInfo(payload);
  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');

  console.log(`\n${slug}\n`);
  console.log(toTable(rows));
  if (importInfo) {
    console.log(`\nFrom import ${importInfo.id ?? '—'}${importInfo.date ? ` · ${importInfo.date}` : ''}`);
  }
  // Los bloques hermanos (competitors, accommodation…) no son un error, pero
  // conviene verlos por si la respuesta trae algo que no estamos pintando.
  if (skipped.length) console.log(`\nOther blocks in the response: ${skipped.join(', ')}`);

  const csvPath = path.join(HERE, 'report.csv');
  const htmlPath = path.join(HERE, 'report.html');
  await writeFile(csvPath, toCsv(rows));
  await writeFile(htmlPath, toHtml({ slug, rows, importInfo, generatedAt }));
  console.log(`\nWrote ${path.relative(process.cwd(), csvPath)} and ${path.relative(process.cwd(), htmlPath)}\n`);
}

async function main() {
  const [arg] = process.argv.slice(2);

  if (!arg || arg === '--help' || arg === '-h') {
    usage();
    process.exitCode = arg ? 0 : 1;
    return;
  }

  const apiKey = process.env.VEETAL_API_KEY;
  if (!apiKey) {
    console.error('Missing VEETAL_API_KEY. Copy .env.example to .env and put your key in it.');
    process.exitCode = 1;
    return;
  }

  if (arg === '--list') return listSlugs(apiKey);
  return report(apiKey, arg);
}

try {
  await main();
} catch (error) {
  if (error instanceof VeetalError) {
    // 401 y 502 se leen distinto: uno es tuyo, el otro no.
    const hint =
      error.status === 401
        ? 'Check VEETAL_API_KEY — the API rejected it.'
        : error.status === 404
          ? 'That slug is not on your account. Run with --list to see the ones that are.'
          : error.status >= 500
            ? 'That is the API failing, not your call. Retry in a minute.'
            : '';
    console.error(`${error.message}${hint ? `\n${hint}` : ''}`);
    if (typeof error.body === 'object') console.error(JSON.stringify(error.body, null, 2));
    process.exitCode = 1;
  } else {
    throw error;
  }
}
