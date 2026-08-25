// Tres salidas del mismo dato: la tabla que lees en el terminal, el CSV que abres
// en una hoja de cálculo, y el HTML que pegas en un informe.

const fmt = (value, decimals = 0) =>
  typeof value === 'number' ? value.toFixed(decimals) : '—';

const pct = (value) => (typeof value === 'number' ? `${(value * 100).toFixed(0)}%` : '—');

const signed = (value, decimals = 0) =>
  typeof value === 'number' ? `${value > 0 ? '+' : ''}${value.toFixed(decimals)}` : '—';

const pad = (text, width) => String(text ?? '').padEnd(width).slice(0, width);
const padStart = (text, width) => String(text ?? '').padStart(width);

export function terminal({ name, date, vs, summary, hotels, changes }) {
  const lines = [];
  const cur = summary.currency || '';

  lines.push('');
  lines.push(`  ${name}`);
  lines.push(`  ${date}${vs ? `  ·  frente a ${vs}` : ''}`);
  lines.push('');
  lines.push(
    `  ${summary.hotels} hoteles   mediana ${fmt(summary.price_median)} ${cur}   ` +
      `rango ${fmt(summary.price_min)}–${fmt(summary.price_max)}   nota media ${fmt(summary.score_mean, 1)}`,
  );
  if (summary.closed) lines.push(`  ${summary.closed} cerrados, fuera de los cálculos`);
  lines.push(
    `  desayuno incluido ${pct(summary.breakfast_share)}   cancelación gratis ${pct(summary.free_cancellation_share)}`,
  );
  lines.push('');

  lines.push('  POR CATEGORÍA');
  lines.push(`  ${pad('estrellas', 11)}${padStart('hoteles', 8)}${padStart('mediana', 10)}${padStart('nota', 7)}`);
  for (const row of summary.by_stars) {
    lines.push(
      `  ${pad(row.stars ? '★'.repeat(row.stars) : 'sin estrellas', 11)}` +
        `${padStart(row.hotels, 8)}${padStart(fmt(row.price_median), 10)}${padStart(fmt(row.score_mean, 1), 7)}`,
    );
  }
  lines.push('');

  lines.push('  EL MERCADO');
  lines.push(
    `  ${padStart('#', 3)}  ${pad('hotel', 34)}${padStart('precio', 9)}${padStart('★', 4)}${padStart('nota', 6)}${padStart('reseñas', 9)}`,
  );
  for (const h of hotels) {
    lines.push(
      `  ${padStart(h.rank, 3)}  ${pad(h.name, 34)}${padStart(fmt(h.price), 9)}` +
        `${padStart(h.stars ?? '—', 4)}${padStart(fmt(h.score, 1), 6)}${padStart(h.reviews ?? '—', 9)}`,
    );
  }

  if (changes) {
    lines.push('');
    lines.push('  QUÉ SE HA MOVIDO');
    if (changes.entered.length) {
      lines.push(`  entran (${changes.entered.length}): ${changes.entered.map((h) => h.name).join(', ')}`);
    }
    if (changes.left.length) {
      lines.push(`  salen  (${changes.left.length}): ${changes.left.map((h) => h.name).join(', ')}`);
    }
    if (!changes.entered.length && !changes.left.length) {
      lines.push('  nadie entra ni sale del listado');
    }

    const top = changes.price_movers.slice(0, 8);
    if (top.length) {
      lines.push('');
      lines.push(`  ${pad('mayores cambios de precio', 34)}${padStart('antes', 9)}${padStart('ahora', 9)}${padStart('dif', 9)}${padStart('%', 8)}`);
      for (const h of top) {
        lines.push(
          `  ${pad(h.name, 34)}${padStart(fmt(h.price_before), 9)}${padStart(fmt(h.price), 9)}` +
            `${padStart(signed(h.price_delta), 9)}${padStart(signed(h.price_delta_pct, 1), 8)}`,
        );
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function csv({ hotels, changes }) {
  const byId = new Map((changes ? changes.moved : []).map((h) => [h.id, h]));
  const head = [
    'rank', 'name', 'slug', 'price', 'currency', 'stars', 'score', 'reviews',
    'room_type', 'breakfast', 'free_cancellation', 'address', 'transport',
    'price_before', 'price_delta', 'rank_delta',
  ];
  const esc = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = hotels.map((h) => {
    const moved = byId.get(h.id);
    return [
      h.rank, h.name, h.slug, h.price, h.currency, h.stars, h.score, h.reviews,
      h.roomType, h.breakfast ? 'yes' : 'no', h.freeCancellation ? 'yes' : 'no',
      h.address, h.transport,
      moved ? moved.price_before : '', moved ? moved.price_delta : '',
      moved ? moved.rank_delta : '',
    ].map(esc).join(',');
  });
  return [head.join(','), ...rows].join('\n');
}

// El HTML se escribe entero aquí porque el informe tiene que poder enviarse sin
// nada alrededor: un fichero, se abre, se lee.
export function html({ name, date, vs, summary, hotels, changes }) {
  const esc = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const cur = esc(summary.currency || '');

  const stat = (label, value) =>
    `<div class="stat"><div class="stat__label">${esc(label)}</div><div class="stat__value">${esc(value)}</div></div>`;

  const deltaCell = (value, decimals = 0) => {
    if (typeof value !== 'number') return '<td class="num">—</td>';
    const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
    return `<td class="num ${cls}">${esc(signed(value, decimals))}</td>`;
  };

  const moved = new Map((changes ? changes.moved : []).map((h) => [h.id, h]));

  const rows = hotels
    .map((h) => {
      const m = moved.get(h.id);
      return `<tr>
        <td class="num">${h.rank}</td>
        <td><div class="name">${esc(h.name)}</div><div class="sub">${esc(h.address || h.area || '')}</div>
            ${h.transport ? `<div class="sub">${esc(h.transport)}</div>` : ''}</td>
        <td class="num">${esc(fmt(h.price))}</td>
        ${deltaCell(m ? m.price_delta : null)}
        <td class="num">${h.stars ? '★'.repeat(h.stars) : '—'}</td>
        <td class="num">${esc(fmt(h.score, 1))}</td>
        <td class="num">${esc(h.reviews ?? '—')}</td>
        ${deltaCell(m ? m.rank_delta : null)}
      </tr>`;
    })
    .join('\n');

  const movement = changes
    ? `<section>
        <h2>Qué se ha movido</h2>
        <p class="lead">
          ${changes.entered.length} entran · ${changes.left.length} salen ·
          ${changes.price_movers.length} cambian de precio
        </p>
        ${changes.entered.length ? `<p><strong>Entran:</strong> ${esc(changes.entered.map((h) => h.name).join(', '))}</p>` : ''}
        ${changes.left.length ? `<p><strong>Salen:</strong> ${esc(changes.left.map((h) => h.name).join(', '))}</p>` : ''}
      </section>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — ${esc(date)}</title>
<style>
  :root { --page:#fbfaf7; --ink:#1c1a2e; --muted:#6b6880; --rule:rgba(28,26,46,.1);
          --accent:#7c5cff; --up:#c0392b; --down:#1e8449; --card:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --page:#12101f; --ink:#f2f0fa; --muted:#a5a1bb; --rule:rgba(255,255,255,.14);
            --accent:#a48cff; --up:#ff8a80; --down:#7ee2a8; --card:#1b1830; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
  .wrap { max-width:1040px; margin:0 auto; padding:56px 24px 96px; }
  .eyebrow { font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--accent); font-weight:700; margin:0 0 12px; }
  h1 { font-size:clamp(28px,4vw,40px); letter-spacing:-.02em; margin:0 0 6px; }
  .date { color:var(--muted); margin:0 0 32px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:40px; }
  .stat { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:16px; }
  .stat__label { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }
  .stat__value { font-size:22px; font-weight:700; }
  h2 { font-size:20px; margin:36px 0 12px; }
  .lead { color:var(--muted); margin:0 0 16px; }
  /* La tabla es ancha: que scrolle ella, no la página. */
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { padding:10px 12px; border-bottom:1px solid var(--rule); text-align:left; vertical-align:top; }
  th { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700; }
  td.num, th.num { text-align:right; white-space:nowrap; }
  .name { font-weight:600; }
  .sub { font-size:12.5px; color:var(--muted); }
  .up { color:var(--up); } .down { color:var(--down); }
  footer { margin-top:56px; padding-top:20px; border-top:1px solid var(--rule); font-size:13px; color:var(--muted); }
  footer a { color:var(--accent); }
</style>
</head>
<body><main class="wrap">
  <p class="eyebrow">Micro-market monitor</p>
  <h1>${esc(name)}</h1>
  <p class="date">${esc(date)}${vs ? ` · comparado con ${esc(vs)}` : ''}</p>

  <div class="stats">
    ${stat('Hoteles', summary.hotels)}
    ${stat(`Mediana ${cur}`, fmt(summary.price_median))}
    ${stat(`Rango ${cur}`, `${fmt(summary.price_min)}–${fmt(summary.price_max)}`)}
    ${stat('Nota media', fmt(summary.score_mean, 1))}
    ${stat('Con desayuno', pct(summary.breakfast_share))}
    ${stat('Cancelación gratis', pct(summary.free_cancellation_share))}
  </div>

  ${movement}

  <h2>El mercado</h2>
  <div class="scroll">
  <table>
    <thead><tr>
      <th class="num">#</th><th>Hotel</th><th class="num">Precio</th><th class="num">Dif</th>
      <th class="num">Estrellas</th><th class="num">Nota</th><th class="num">Reseñas</th><th class="num">Puestos</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>

  <footer>
    Generado con la <a href="https://connect-api.veetal.app/recipes">Veetal Connect API</a>.
    Los precios son los almacenados por el import de esa fecha, en ${cur || 'la moneda de la búsqueda'}.
  </footer>
</main></body>
</html>`;
}
