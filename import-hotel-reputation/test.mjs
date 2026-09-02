// Smoke test: levanta un stub del endpoint de reputación y comprueba que la CLI
// lo lee, lo pinta y escribe los dos ficheros. No toca la API real ni necesita key.
//
//   node test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

// La forma real del feed de reputación (contrato en developers.veetal.app): una
// entrada por OTA en `accommodation`, con desglose por categoría en unas y no en
// otras, una OTA que el import no pudo leer, el compset en `competitors` y el
// bloque `import` con la ejecución de la que sale el dato.
const ota = (provider, extra) => ({
  accommodation_slug: 'avenidapalace',
  accommodation_name: 'El Avenida Palace',
  provider,
  status: 'processed',
  ...extra,
});

const REPUTATION = {
  status: 'success',
  provider: null,
  accommodation: [
    ota('booking', {
      review_score: 8.7,
      review_count: 2023,
      category_score: [
        { name: 'location', score: 9.8, label: 'Ubicación' },
        { name: 'staff', score: 9.4, label: 'Personal' },
        { name: 'free_wifi', score: 9.2, label: 'WiFi gratis' },
        { name: 'comfort', score: 8.9, label: 'Confort' },
        { name: 'cleanliness', score: 8.8, label: 'Limpieza' },
        { name: 'facilities', score: 8.5, label: 'Instalaciones y servicios' },
        { name: 'value_for_money', score: 8.3, label: 'Relación calidad-precio' },
      ],
    }),
    // Google no puntúa categorías: trae temas con recuentos de menciones.
    ota('google', {
      review_score: 9,
      review_count: 1373,
      topics: [{ name: 'location', label: 'Location', mentions: 412, positive_mentions: 388, negative_mentions: 24 }],
    }),
    ota('tripadvisor', {
      review_score: 8.8,
      review_count: 2588,
      category_score: [
        { name: 'location', score: 9.73, label: 'Ubicación' },
        { name: 'cleanliness', score: 9.1, label: 'Limpieza' },
      ],
    }),
    // Bloqueada por la OTA durante el import: sin nota y con su estado.
    ota('expedia', { review_score: null, review_count: null, status: 'blocked' }),
  ],
  competitors: [
    {
      accommodation_slug: 'rival-hotel',
      accommodation_name: 'Rival Hotel',
      provider: 'booking',
      review_score: 9.3,
      review_count: 2346,
      category_score: [],
      status: 'processed',
    },
  ],
  import: {
    import_id: 'Veetal-MANUAL-20260818-120142854-ARP',
    process_id: '68a1f0c2d3b4a5e6f7081234',
    date: '2026-08-18T12:01:42.854Z',
  },
};

const server = createServer((req, res) => {
  if (req.headers['veetal-api-key'] !== 'test-key') {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid API key' }));
  }
  // Solo un alojamiento existe: así se puede probar el camino del 404.
  if (req.url.endsWith('/reputation')) {
    const known = req.url.includes('/avenidapalace/');
    res.writeHead(known ? 200 : 404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(known ? REPUTATION : { error: 'Accommodation not found' }));
  }
  if (req.url.includes('/account/accommodation')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(
      JSON.stringify({ avenidapalace: { name: 'El Avenida Palace', location: { city: { name: 'Barcelona' } } } }),
    );
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, VEETAL_API_KEY: 'test-key', VEETAL_API_URL: base };
const cli = (args, overrides = {}) =>
  run('node', [path.join(HERE, 'index.mjs'), ...args], { env: { ...env, ...overrides } });

const csvPath = path.join(HERE, 'report.csv');
const htmlPath = path.join(HERE, 'report.html');
await rm(csvPath, { force: true });
await rm(htmlPath, { force: true });

try {
  // 1. El informe pinta las tres OTAs, ordenadas por nota descendente.
  const { stdout } = await cli(['avenidapalace']);
  assert.match(stdout, /booking/);
  assert.match(stdout, /2,023/, 'los miles se separan');
  assert.ok(
    stdout.indexOf('google') < stdout.indexOf('tripadvisor'),
    'ordena por nota: google 9 antes que tripadvisor 8.8',
  );
  assert.match(stdout, /location 9\.8/, 'saca el desglose de categorías');
  assert.match(stdout, /Veetal-MANUAL-20260818-120142854-ARP · 2026-08-18/, 'atribuye el dato a su ejecución, con el día');
  assert.match(stdout, /OTAs the import could not read: expedia \(blocked\)/, 'la OTA bloqueada se dice, no se pinta');
  assert.doesNotMatch(stdout, /^expedia/m, 'la OTA bloqueada no ocupa fila');
  assert.match(stdout, /Comp set in the response: 1 hotel/, 'el compset se cuenta, no se pinta');
  assert.doesNotMatch(stdout, /rival-hotel|Rival Hotel/, 'los competidores no se mezclan con el hotel');

  // 2. El CSV trae una fila por categoría y una sola para la OTA sin desglose.
  const csv = await readFile(csvPath, 'utf8');
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'ota,score,reviews,category,category_score');
  assert.equal(lines.length, 1 + 7 + 1 + 2, 'cabecera + booking(7) + google(1) + tripadvisor(2)');
  assert.ok(lines.includes('google,9,1373,,'), 'la OTA sin desglose ocupa una fila');

  // 3. El HTML es autocontenido y escapa lo que pinta.
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Veetal-MANUAL-20260818/);
  assert.doesNotMatch(html, /<script/i, 'no inyecta scripts');

  // 4. Una key mala se explica, no revienta.
  const bad = await cli(['avenidapalace'], { VEETAL_API_KEY: 'nope' }).catch((e) => e);
  assert.match(bad.stderr, /401/);
  assert.match(bad.stderr, /Check VEETAL_API_KEY/);

  // 5. Un slug que no existe se distingue de un problema de key.
  const missing = await cli(['no-such-hotel']).catch((e) => e);
  assert.match(missing.stderr, /--list/);

  // 6. --list resuelve los slugs de la cuenta.
  const list = await cli(['--list']);
  assert.match(list.stdout, /avenidapalace\s+El Avenida Palace · Barcelona/);

  console.log('OK — 6 comprobaciones');
} finally {
  await rm(csvPath, { force: true });
  await rm(htmlPath, { force: true });
  server.close();
}
