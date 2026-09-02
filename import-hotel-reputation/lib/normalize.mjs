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
 * Lista de entradas por OTA → filas legibles, ordenadas por nota, y las OTAs que el
 * import no pudo leer (bloqueo, error), con su estado, para decirlas en vez de pintar
 * una fila vacía.
 */
function toRows(entries) {
  const rows = [];
  const skipped = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object' || !entry.provider) continue;

    if (entry.status && entry.status !== 'processed') {
      skipped.push(`${entry.provider} (${entry.status})`);
      continue;
    }

    rows.push(toRow(entry));
  }

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { rows, skipped };
}

/**
 * @returns {{rows: Array, skipped: string[], competitors: Array<{slug: string, name: string|null, rows: Array, skipped: string[]}>}}
 *   las filas del hotel, sus OTAs no leídas, y un bloque por cada hotel del compset.
 */
export function normalizeReputation(payload) {
  const own = toRows(payload?.accommodation);

  // El compset llega plano, una entrada por (hotel, OTA): se agrupa por hotel.
  const bySlug = new Map();
  for (const entry of Array.isArray(payload?.competitors) ? payload.competitors : []) {
    const slug = entry?.accommodation_slug;
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, name: entry.accommodation_name ?? null, entries: [] });
    bySlug.get(slug).entries.push(entry);
  }

  const competitors = [...bySlug.values()].map(({ slug, name, entries }) => ({ slug, name, ...toRows(entries) }));

  return { rows: own.rows, skipped: own.skipped, competitors };
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
