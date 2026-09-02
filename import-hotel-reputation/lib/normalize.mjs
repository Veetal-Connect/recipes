// La respuesta del feed de reputación trae dos listas con una entrada por OTA:
// `accommodation` (el hotel) y `competitors` (su compset). Cada entrada dice de qué OTA
// viene (`provider`), la nota (`review_score`), el número de opiniones (`review_count`)
// y, en las OTAs que puntúan por categoría, el desglose en `category_score`
// [{name, score, label?}]. Google no puntúa categorías: trae `topics` (menciones por
// tema), que este informe no pinta. Una OTA que el import no pudo leer llega con
// `status` distinto de `processed` y sin nota.
//
// Contrato completo:
// https://developers.veetal.app/#tag/Feed-API/GET/feed/accommodation/{accommodation_slug}/reputation

const toNumber = (raw) => {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** `category_score` de una OTA → [{name, score}], sin las categorías que vienen sin nota. */
function normalizeCategories(entry) {
  if (!Array.isArray(entry?.category_score)) return [];
  return entry.category_score
    .map((category) => ({ name: category?.name ?? '', score: toNumber(category?.score) }))
    .filter((category) => category.name && category.score !== null);
}

const toRow = (entry) => ({
  ota: entry.provider,
  score: toNumber(entry.review_score),
  reviews: toNumber(entry.review_count),
  categories: normalizeCategories(entry),
});

/**
 * @returns {{rows: Array, skipped: string[], competitors: number}} una fila por OTA con
 *   datos legibles, las OTAs que el import no pudo leer (con su estado), y cuántos
 *   hoteles del compset venían en la respuesta.
 */
export function normalizeReputation(payload) {
  const rows = [];
  const skipped = [];

  const entries = Array.isArray(payload?.accommodation) ? payload.accommodation : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.provider) continue;

    // Bloqueo o error en el import: la OTA viene sin nota. Se reporta aparte en vez de
    // pintarse como una fila vacía.
    if (entry.status && entry.status !== 'processed') {
      skipped.push(`${entry.provider} (${entry.status})`);
      continue;
    }

    rows.push(toRow(entry));
  }

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const competitors = Array.isArray(payload?.competitors)
    ? new Set(payload.competitors.map((entry) => entry?.accommodation_slug).filter(Boolean)).size
    : 0;

  return { rows, skipped, competitors };
}

/** Metadatos de la ejecución de la que sale el dato. */
export function extractImportInfo(payload) {
  const node = payload?.import;
  if (!node || typeof node !== 'object') return null;
  return {
    id: node.import_id ?? null,
    // La fecha llega en ISO completo; para atribuir el dato basta el día.
    date: typeof node.date === 'string' ? node.date.slice(0, 10) : null,
  };
}
