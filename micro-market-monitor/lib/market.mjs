// Lo que convierte una lista de hoteles en un mercado: normalizar, agregar por
// categoría, y comparar dos días para ver qué se ha movido.

/**
 * La posición en el listado ES un dato: Booking ordena por su propio criterio y
 * subir o bajar puestos importa tanto como el precio. El feed las devuelve en ese
 * orden, así que el índice del array es el rango.
 */
export function normalise(accommodations) {
  return (accommodations || []).map((a, i) => {
    const loc = a.locationDetails || {};
    return {
      rank: i + 1,
      id: a.bookingHotelId ?? a.slug ?? null,
      slug: a.slug ?? null,
      name: a.hotelName ?? null,
      // priceFinal es el que se cobra; displayPrice viene ya redondeado por Booking
      // y no sirve para calcular medias.
      price: typeof a.priceFinal === 'number' ? a.priceFinal : null,
      original: typeof a.priceOriginal === 'number' ? a.priceOriginal : null,
      discount: typeof a.priceDiscount === 'number' ? a.priceDiscount : 0,
      currency: a.currency ?? null,
      stars: typeof a.stars === 'number' ? a.stars : (a.starRating ?? null),
      score: typeof a.reviewScore === 'number' ? a.reviewScore : null,
      reviews: typeof a.reviewCount === 'number' ? a.reviewCount : null,
      roomType: a.roomType ?? null,
      breakfast: Boolean(a.breakfastIncluded),
      freeCancellation: Boolean(a.freeCancellation),
      closed: Boolean(a.isClosed),
      type: a.accType ?? null,
      address: loc.address ?? null,
      area: loc.displayLocation ?? null,
      // Texto libre de Booking ("Rocafort Metro station is within 150 metres"),
      // no un número: sirve para leerlo, no para ordenar por él.
      transport: loc.publicTransportDistanceDescription ?? null,
      photo: (a.photos && a.photos.lowResolution) ?? null,
    };
  });
}

const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (values) => {
  const nums = values.filter((v) => typeof v === 'number');
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

/** Retrato del mercado: cuántos, a cuánto, y cómo se reparte por categoría. */
export function summarise(hotels) {
  const open = hotels.filter((h) => !h.closed);
  const prices = open.map((h) => h.price);

  const byStars = new Map();
  for (const h of open) {
    const key = h.stars ?? 0;
    if (!byStars.has(key)) byStars.set(key, []);
    byStars.get(key).push(h);
  }

  return {
    hotels: open.length,
    closed: hotels.length - open.length,
    currency: open.find((h) => h.currency)?.currency ?? null,
    price_median: median(prices),
    price_min: prices.filter((p) => typeof p === 'number').length ? Math.min(...prices.filter((p) => typeof p === 'number')) : null,
    price_max: prices.filter((p) => typeof p === 'number').length ? Math.max(...prices.filter((p) => typeof p === 'number')) : null,
    score_mean: mean(open.map((h) => h.score)),
    breakfast_share: open.length ? open.filter((h) => h.breakfast).length / open.length : null,
    free_cancellation_share: open.length ? open.filter((h) => h.freeCancellation).length / open.length : null,
    by_stars: [...byStars.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([stars, list]) => ({
        stars,
        hotels: list.length,
        price_median: median(list.map((h) => h.price)),
        score_mean: mean(list.map((h) => h.score)),
      })),
  };
}

/**
 * Qué ha cambiado entre dos días. Las entradas y salidas del listado son la señal
 * más útil y la que nadie mira: un hotel que desaparece está lleno o ha cerrado
 * ventas, y uno que aparece acaba de abrir inventario.
 */
export function compare(current, previous) {
  const prevById = new Map(previous.map((h) => [h.id, h]));
  const currById = new Map(current.map((h) => [h.id, h]));

  const entered = current.filter((h) => !prevById.has(h.id));
  const left = previous.filter((h) => !currById.has(h.id));

  const moved = current
    .filter((h) => prevById.has(h.id))
    .map((h) => {
      const before = prevById.get(h.id);
      const priceDelta =
        typeof h.price === 'number' && typeof before.price === 'number'
          ? h.price - before.price
          : null;
      return {
        ...h,
        price_before: before.price,
        price_delta: priceDelta,
        // En porcentaje sobre el precio anterior; sin precio anterior no hay
        // porcentaje que calcular, y un 0 aquí mentiría.
        price_delta_pct:
          priceDelta !== null && before.price ? (priceDelta / before.price) * 100 : null,
        rank_before: before.rank,
        rank_delta: before.rank - h.rank, // positivo = ha subido puestos
      };
    });

  return {
    entered,
    left,
    moved,
    price_movers: moved
      .filter((h) => h.price_delta !== null && Math.abs(h.price_delta) >= 0.01)
      .sort((a, b) => Math.abs(b.price_delta) - Math.abs(a.price_delta)),
    rank_movers: moved
      .filter((h) => h.rank_delta !== 0)
      .sort((a, b) => Math.abs(b.rank_delta) - Math.abs(a.rank_delta)),
  };
}

/**
 * Las fechas con datos, cada una con el import que las escribió. El id es
 * obligatorio para leer cualquier día que no sea el último, así que fecha e id
 * viajan juntos o no sirven de nada.
 *
 * Si un día tuvo dos ejecuciones (las hay a las 07:00 y a las 13:00), gana la
 * última: es la foto más fresca de ese mercado.
 */
export function importDates(imports) {
  const service = (imports || []).find((s) => s.code === 'feed-booking-location-search');
  const runs = (service && service.imports) || [];

  const byDate = new Map();
  for (const run of runs) {
    if (run.status !== 'completed' || !run.scheduledFor) continue;
    const date = String(run.scheduledFor).slice(0, 10);
    const previous = byDate.get(date);
    if (!previous || String(run.scheduledFor) > previous.scheduledFor) {
      byDate.set(date, { date, importId: run.importExecutionIdentifier, scheduledFor: String(run.scheduledFor) });
    }
  }

  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(({ date, importId }) => ({ date, importId }));
}
