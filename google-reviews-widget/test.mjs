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
  accommodation: [{ accommodation_name: 'Hotel Example', review_score: 9.2, review_count: 1373 }],
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

check('la cabecera trae nombre, nota y número de reseñas', () => {
  assert.equal(payload.name, 'Hotel Example');
  assert.equal(payload.score, 9.2);
  assert.equal(payload.count, 1373);
});

check('include_competitors=false va en la petición', () => {
  assert.ok(seenReviewUrl.includes('include_competitors=false'), seenReviewUrl);
  assert.ok(seenReviewUrl.includes('provider=google'), seenReviewUrl);
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

server.close();
api.close();
console.log(`\nOK — ${checks} comprobaciones`);
