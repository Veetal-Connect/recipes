// Sin red y sin API key: se levanta un stub de la Connect API en localhost y se
// comprueba lo que la receta promete. Los datos del stub reproducen los casos reales
// medidos sobre 100 reseñas de Google: reseñas sin texto, respuestas con la traducción
// de Google pegada delante, y fechas ausentes.
import assert from 'node:assert/strict';
import http from 'node:http';

const REVIEWS = {
  reviews: [
    {
      review_id: 'r1',
      date: '2026-08-14',
      score: 10,
      text: 'El desayuno espectacular ! Mónica súper simpática y muy atenta!',
      author: 'M********',
      management_response: {
        date: '2026-08-18',
        text: '(Translated by Google) Dear Mari Carmen, thank you so much for your words.\n\n(Original)\nEstimada Mari Carmen, muchas gracias por sus palabras.',
      },
    },
    // 27 de cada 100 traen puntuación y ningún texto: no deben llegar al navegador.
    { review_id: 'r2', date: '2026-08-10', score: 8, text: null, author: 'J***', management_response: null },
    { review_id: 'r3', date: '2026-08-09', score: 6, text: '   ', author: 'A***', management_response: null },
    // ~9% no traen fecha: Google publica una antigüedad relativa.
    {
      review_id: 'r4',
      date: null,
      score: 10,
      text: 'Great location, very clean.',
      author: 'K****',
      management_response: { date: null, text: 'Thank you!' },
    },
  ],
};

const REPUTATION = {
  accommodation: [
    { accommodation_name: 'Hotel Example', provider: 'google', review_score: 9.4, review_count: 1200 },
    { accommodation_name: 'Hotel Example', provider: 'tripadvisor', review_score: 8.6, review_count: 300 },
  ],
};

let seenReviewUrl = null;
let failReviews = false;

const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname.endsWith('/reviews')) {
    seenReviewUrl = req.url;
    if (failReviews) return json(500, { error: 'boom' });
    return json(200, REVIEWS);
  }
  if (url.pathname.endsWith('/reputation')) return json(200, REPUTATION);
  json(404, { error: 'not_found' });
});

await new Promise((r) => api.listen(0, '127.0.0.1', r));
const apiPort = api.address().port;

process.env.VEETAL_API_URL = `http://127.0.0.1:${apiPort}/v2`;
process.env.VEETAL_API_KEY = 'test-key';
process.env.VEETAL_ACCOMMODATION_SLUG = 'hotel-example';

const { build, originalText, createApp } = await import('./server.mjs');

let checks = 0;
const check = (label, fn) => {
  fn();
  checks += 1;
  console.log('  ✓', label);
};

/* ------------------------------------------------------- la carga que se sirve */
const payload = await build();

check('las reseñas sin texto no llegan al navegador', () => {
  assert.deepEqual(
    payload.reviews.map((r) => r.id),
    ['r1', 'r4'],
  );
});

check('la respuesta del hotel se queda en su idioma original', () => {
  assert.equal(payload.reviews[0].reply.text, 'Estimada Mari Carmen, muchas gracias por sus palabras.');
});

check('una respuesta sin traducción pegada se deja intacta', () => {
  assert.equal(payload.reviews[1].reply.text, 'Thank you!');
});

check('la fecha ausente sobrevive como null, no como cadena rota', () => {
  assert.equal(payload.reviews[1].date, null);
});

check('la cabecera pondera la nota por número de reseñas de cada OTA', () => {
  assert.equal(payload.name, 'Hotel Example');
  assert.equal(payload.headline.sources, 2);
  assert.equal(payload.headline.count, 1500);
  // (9.4*1200 + 8.6*300) / 1500 = 9.24 — no 9.0, que sería la media sin ponderar
  assert.equal(Number(payload.headline.score.toFixed(2)), 9.24);
});

check('include_competitors=false va en la petición y no se filtra por OTA', () => {
  assert.ok(seenReviewUrl.includes('include_competitors=false'), seenReviewUrl);
  assert.ok(!seenReviewUrl.includes('provider='), 'sin provider entran todas las OTAs');
});

check('originalText aguanta null y cadena vacía', () => {
  assert.equal(originalText(null), null);
  assert.equal(originalText('   '), null);
});

/* ------------------------------------------------- el endpoint y su red de seguridad */
const app = createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const first = await (await fetch(`${base}/reviews-widget.json`)).json();
check('el endpoint responde la carga completa', () => {
  assert.equal(first.reviews.length, 2);
});

// Con la API caída, una página que funcionaba hace un minuto no puede quedarse en blanco.
failReviews = true;
const cached = await fetch(`${base}/reviews-widget.json`);
check('si la API falla se sirve la última carga buena', () => {
  assert.equal(cached.status, 200);
});

const widget = await fetch(`${base}/veetal-reviews-widget.js`);
const widgetBody = await widget.text();
check('veetal-reviews-widget.js se sirve y no usa innerHTML', () => {
  assert.equal(widget.status, 200);
  assert.ok(widgetBody.includes('attachShadow'), 'debe renderizar en Shadow DOM');
  assert.ok(!/\.innerHTML\s*=/.test(widgetBody), 'no debe asignar innerHTML');
});

/* ------------------------------------------------ sentimiento, categorías y tendencia */
// Las funciones derivadas se prueban aparte, con datos de mentira y sin red: son las
// que deciden qué flecha ve el huésped, así que su umbral tiene que estar clavado.
const { sentiment, categories, headline, splitWindows, MIN_SAMPLE } = await import('./insights.mjs');

const day = (offset) => {
  const d = new Date(Date.now() - offset * 86400000);
  return d.toISOString().slice(0, 10);
};

check('el sentimiento reparte por umbrales, no por estrellas redondeadas', () => {
  const s = sentiment([{ score: 10 }, { score: 9 }, { score: 8 }, { score: 6 }, { score: null }]);
  assert.equal(s.total, 4); // el score null no cuenta
  assert.equal(s.positive, 2); // >= 9
  assert.equal(s.neutral, 1); // 7 - 8.9
  assert.equal(s.negative, 1); // < 7
  assert.equal(Number(s.positive_share.toFixed(2)), 0.5);
});

check('sin ninguna puntuación el sentimiento es null, no un cero engañoso', () => {
  assert.equal(sentiment([{ score: null }]), null);
});

check('las reseñas sin fecha quedan fuera de las ventanas', () => {
  const { current, previous } = splitWindows([{ date: null, score: 10 }, { date: day(3), score: 10 }]);
  assert.equal(current.length, 1);
  assert.equal(previous.length, 0);
});

check('una categoría con muestra suficiente trae su delta', () => {
  const many = (n, offset, score) =>
    Array.from({ length: n }, () => ({ date: day(offset), category_score: [{ name: 'rooms', score }] }));
  const rows = categories([...many(MIN_SAMPLE, 3, 8), ...many(MIN_SAMPLE, 35, 10)]);
  const rooms = rows.find((r) => r.name === 'rooms');
  assert.equal(rooms.sample, MIN_SAMPLE);
  assert.equal(Math.round(rooms.delta), -20); // de 10 a 8
});

check('una categoría con muestra pobre no inventa una flecha', () => {
  const rows = categories([
    { date: day(2), category_score: [{ name: 'cleanliness', score: 8 }] },
    { date: day(40), category_score: [{ name: 'cleanliness', score: 10 }] },
  ]);
  const cleanliness = rows.find((r) => r.name === 'cleanliness');
  assert.equal(cleanliness.delta, null, 'con 1 contra 1 no hay tendencia que enseñar');
  assert.equal(cleanliness.score, 8, 'pero la nota del periodo sí se muestra');
});

check('un movimiento por debajo del 1% no pinta flecha', () => {
  const many = (n, offset, score) =>
    Array.from({ length: n }, () => ({ date: day(offset), category_score: [{ name: 'location', score }] }));
  // 9.97 contra 10: un -0,3% que redondeaba a un "↓0%" sin sentido.
  const rows = categories([...many(MIN_SAMPLE, 3, 9.97), ...many(MIN_SAMPLE, 35, 10)]);
  const location = rows.find((r) => r.name === 'location');
  assert.equal(location.delta, null);
  assert.ok(location.score > 9.9, 'la nota del periodo se sigue mostrando');
});

check('las categorías se mezclan entre OTAs distintas', () => {
  const rows = categories([
    { date: day(2), category_score: [{ name: 'location', score: 10 }] },
    { date: day(3), category_score: [{ name: 'value_for_money', score: 7 }] },
  ]);
  assert.deepEqual(rows.map((r) => r.name).sort(), ['location', 'value_for_money']);
});

check('headline sin ninguna OTA utilizable no explota', () => {
  const h = headline([{ provider: 'google', score: null, count: null }]);
  assert.equal(h.score, null);
  assert.equal(h.count, 0);
});

server.close();
api.close();

console.log(`\nOK — ${checks} comprobaciones`);
