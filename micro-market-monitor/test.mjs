// Sin red y sin API key: un stub de la Connect API en localhost. Los datos imitan
// lo que devuelve de verdad el feed del Eixample, incluidos los campos que engañan:
// distanceToCenter es texto, displayPrice viene redondeado, y la paginación puede
// esconder medio mercado.
import assert from 'node:assert/strict';
import http from 'node:http';

const hotel = (over = {}) => ({
  bookingHotelId: 1,
  hotelName: 'Hotel Uno',
  slug: 'hotel-uno',
  priceOriginal: 270.416651098528,
  priceDiscount: 0,
  priceFinal: 270.416651098528,
  displayPrice: 270, // redondeado por Booking: no sirve para medias
  currency: 'USD',
  roomType: 'Twin Room',
  breakfastIncluded: false,
  freeCancellation: false,
  reviewScore: 9,
  reviewCount: 1166,
  starRating: 4,
  stars: 4,
  accType: 'hotel',
  distanceToCenter: 'Distance not available', // texto, nunca un número
  isClosed: false,
  locationDetails: {
    address: 'Calabria, 115-117',
    displayLocation: 'Eixample, Barcelona',
    publicTransportDistanceDescription: 'Rocafort Metro station is within 150 metres',
  },
  photos: { lowResolution: 'https://cf.bstatic.com/x.webp' },
  ...over,
});

// Dos páginas para el día actual: quedarse en la primera es ver medio mercado.
const PAGES = {
  '2026-08-19': [
    [hotel(), hotel({ bookingHotelId: 2, hotelName: 'Hotel Dos', priceFinal: 300, stars: 5, reviewScore: 9.4 })],
    [hotel({ bookingHotelId: 3, hotelName: 'Hotel Tres', priceFinal: 180, stars: 3, reviewScore: 8 })],
  ],
  '2026-08-18': [
    [
      hotel({ priceFinal: 250 }), // subirá 20.42
      hotel({ bookingHotelId: 4, hotelName: 'Hotel Cuatro', priceFinal: 210, stars: 4 }), // se irá
      hotel({ bookingHotelId: 2, hotelName: 'Hotel Dos', priceFinal: 320, stars: 5, reviewScore: 9.4 }),
    ],
  ],
};

const IMPORTS = [
  {
    code: 'feed-booking-location-search',
    imports: [
      { status: 'completed', scheduledFor: '2026-08-19T13:00:00.000Z', importExecutionIdentifier: 'run-19-13' },
      { status: 'completed', scheduledFor: '2026-08-18T13:00:00.000Z', importExecutionIdentifier: 'run-18-13' },
      { status: 'failed', scheduledFor: '2026-08-17T13:00:00.000Z', importExecutionIdentifier: 'run-17-13' },
      { status: 'completed', scheduledFor: '2026-08-18T07:00:00.000Z', importExecutionIdentifier: 'run-18-07' },
    ],
  },
];

const LATEST_DATE = '2026-08-19';
let seenPages = [];

const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname.endsWith('/account/location-search')) {
    return json(200, { data: [{ _id: 'abc', name: 'Eixample, Barcelona', stars: [4, 5], nights: 1 }] });
  }
  if (url.pathname.endsWith('/account/imports')) return json(200, IMPORTS);

  const m = /\/feed\/location-search\/[^/]+\/([\d-]+)\/booking-location-search/.exec(url.pathname);
  if (m) {
    const date = m[1];
    const importId = url.searchParams.get('import_id');
    // Así se comporta la API de verdad: sin import_id solo sirve la última
    // ejecución, y cualquier día anterior responde 404 aunque tenga datos.
    if (!importId && date !== LATEST_DATE) {
      return json(404, { error: 'NotFound', message: 'No data found for the requested date' });
    }
    const pages = PAGES[date];
    if (!pages) return json(404, { error: 'NotFound', message: 'No data found for the requested date' });
    const page = Number(url.searchParams.get('page') || '1');
    seenPages.push(page);
    return json(200, {
      accommodations: pages[page - 1] || [],
      pagination: { page, total: pages.flat().length, hasMore: page < pages.length },
    });
  }
  json(404, { error: 'not_found' });
});

await new Promise((r) => api.listen(0, '127.0.0.1', r));
process.env.VEETAL_API_URL = `http://127.0.0.1:${api.address().port}/v2`;

const { getMarket, listImports, VeetalError } = await import('./lib/client.mjs');
const { normalise, summarise, compare, importDates } = await import('./lib/market.mjs');
const { csv, html, terminal } = await import('./lib/report.mjs');

let checks = 0;
const check = (label, fn) => {
  fn();
  checks += 1;
  console.log('  ✓', label);
};

/* ------------------------------------------------------------------ paginación */
const current = await getMarket('k', 'abc', '2026-08-19', { limit: 2 });

check('recorre todas las páginas en vez de quedarse en la primera', () => {
  assert.deepEqual(seenPages, [1, 2]);
  assert.equal(current.accommodations.length, 3);
  assert.equal(current.truncated, false);
});

/* ------------------------------------------------------------- normalización */
const hotels = normalise(current.accommodations);

check('el orden del listado se conserva como rango', () => {
  assert.deepEqual(hotels.map((h) => h.rank), [1, 2, 3]);
});

check('usa priceFinal, no el displayPrice redondeado', () => {
  assert.equal(hotels[0].price, 270.416651098528);
});

check('los datos de ubicación sobreviven a la normalización', () => {
  assert.equal(hotels[0].address, 'Calabria, 115-117');
  assert.match(hotels[0].transport, /Rocafort/);
});

/* -------------------------------------------------------------------- resumen */
const summary = summarise(hotels);

check('la mediana es la mediana, no la media', () => {
  // 180, 270.41, 300 -> la de en medio
  assert.equal(summary.price_median, 270.416651098528);
  assert.equal(summary.hotels, 3);
});

check('agrupa por categoría de estrellas, de mayor a menor', () => {
  assert.deepEqual(summary.by_stars.map((r) => r.stars), [5, 4, 3]);
});

check('un hotel cerrado no entra en los cálculos', () => {
  const withClosed = summarise(normalise([...current.accommodations, hotel({ bookingHotelId: 9, isClosed: true })]));
  assert.equal(withClosed.hotels, 3);
  assert.equal(withClosed.closed, 1);
});

/* ---------------------------------------------------------------- comparación */
const previous = normalise(
  (await getMarket('k', 'abc', '2026-08-18', { limit: 10, importId: 'run-18-13' })).accommodations,
);
const changes = compare(hotels, previous);

check('detecta quién entra y quién sale del listado', () => {
  assert.deepEqual(changes.entered.map((h) => h.name), ['Hotel Tres']);
  assert.deepEqual(changes.left.map((h) => h.name), ['Hotel Cuatro']);
});

check('el cambio de precio se calcula sobre el precio real', () => {
  const uno = changes.price_movers.find((h) => h.name === 'Hotel Uno');
  assert.equal(Number(uno.price_delta.toFixed(2)), 20.42);
  assert.equal(Number(uno.price_delta_pct.toFixed(2)), 8.17);
});

check('subir puestos da delta positivo', () => {
  const dos = changes.moved.find((h) => h.name === 'Hotel Dos');
  assert.equal(dos.rank_before, 3);
  assert.equal(dos.rank, 2);
  assert.equal(dos.rank_delta, 1);
});

/* --------------------------------------------------------------------- fechas */
const dates = importDates(await listImports('k', 'abc'));
check('cada fecha viene emparejada con el import que la escribió', () => {
  assert.deepEqual(dates, [
    { date: '2026-08-19', importId: 'run-19-13' },
    { date: '2026-08-18', importId: 'run-18-13' },
  ]);
});

check('de dos ejecuciones el mismo día gana la más tardía', () => {
  assert.equal(dates.find((d) => d.date === '2026-08-18').importId, 'run-18-13');
});

let staleHistory = null;
try {
  // Sin import_id, un día que no es el último responde 404. Es EL error de esta API.
  await getMarket('k', 'abc', '2026-08-18', { limit: 10 });
} catch (err) {
  staleHistory = err;
}
check('leer histórico sin import_id da 404, como hace la API real', () => {
  assert.ok(staleHistory instanceof VeetalError);
  assert.equal(staleHistory.status, 404);
});

/* -------------------------------------------------------------------- errores */
let notFound = null;
try {
  await getMarket('k', 'abc', '2026-01-01');
} catch (err) {
  notFound = err;
}
check('pedir una fecha sin import lanza VeetalError 404', () => {
  assert.ok(notFound instanceof VeetalError);
  assert.equal(notFound.status, 404);
});

/* -------------------------------------------------------------------- salidas */
const view = { name: 'Eixample, Barcelona', date: '2026-08-19', vs: '2026-08-18', summary, hotels, changes };

check('el CSV lleva una fila por hotel más la cabecera', () => {
  const lines = csv(view).trim().split('\n');
  assert.equal(lines.length, hotels.length + 1);
  assert.match(lines[0], /^rank,name,slug,price/);
  assert.match(lines[1], /Rocafort/); // el transporte llega al CSV
});

check('el CSV escapa las comas de las direcciones', () => {
  const line = csv(view).split('\n')[1];
  assert.ok(line.includes('"Calabria, 115-117"'), line);
});

check('el HTML escapa el contenido en vez de concatenarlo a pelo', () => {
  const evil = { ...view, hotels: [{ ...hotels[0], name: '<script>alert(1)</script>' }] };
  const out = html(evil);
  assert.ok(!out.includes('<script>alert(1)</script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

check('la tabla del terminal sale sin reventar con valores nulos', () => {
  const bare = normalise([hotel({ priceFinal: null, reviewScore: null, stars: null, reviewCount: null })]);
  const out = terminal({ name: 'x', date: 'd', vs: null, summary: summarise(bare), hotels: bare, changes: null });
  assert.ok(out.includes('—'));
});

api.close();
console.log(`\nOK — ${checks} comprobaciones`);
