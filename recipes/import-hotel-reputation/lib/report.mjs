// Dos decimales como mucho, sin ceros de relleno: 8.7 y 9, no 8.70 y 9.00.
const fmtScore = (n) => (n === null ? '—' : String(Number(n.toFixed(2))));
const fmtReviews = (n) => (n === null ? '—' : n.toLocaleString('en-US'));
const fmtCategories = (categories) =>
  categories.length
    ? categories.map((c) => `${c.name} ${fmtScore(c.score)}`).join(', ')
    : 'no breakdown';

/** Tabla de ancho fijo para la terminal. */
export function toTable(rows) {
  const header = ['OTA', 'Score', 'Reviews'];
  const body = rows.map((r) => [r.ota, fmtScore(r.score), fmtReviews(r.reviews)]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );

  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  const rule = widths.map((w) => '─'.repeat(w)).join('──');

  const out = [line(header), rule, ...body.map(line)];

  // El desglose por categorías no cabe en columnas: va debajo de la tabla.
  for (const row of rows.filter((r) => r.categories.length)) {
    out.push('', `${row.ota}: ${fmtCategories(row.categories)}`);
  }
  return out.join('\n');
}

const csvCell = (value) => {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(rows) {
  const lines = [['ota', 'score', 'reviews', 'category', 'category_score'].join(',')];
  for (const row of rows) {
    if (!row.categories.length) {
      lines.push([row.ota, row.score ?? '', row.reviews ?? '', '', ''].map(csvCell).join(','));
      continue;
    }
    // Una fila por categoría: así la hoja de cálculo pivota sin pelearse.
    for (const category of row.categories) {
      lines.push(
        [row.ota, row.score ?? '', row.reviews ?? '', category.name, category.score]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export function toHtml({ slug, rows, importInfo, generatedAt }) {
  const tableRows = rows
    .map(
      (r) => `      <tr>
        <td class="ota">${esc(r.ota)}</td>
        <td class="num">${esc(fmtScore(r.score))}</td>
        <td class="num">${esc(fmtReviews(r.reviews))}</td>
        <td class="cats">${esc(fmtCategories(r.categories))}</td>
      </tr>`,
    )
    .join('\n');

  const provenance = importInfo
    ? `<p class="meta">Data from import <code>${esc(importInfo.id ?? '—')}</code>${
        importInfo.date ? ` · ${esc(importInfo.date)}` : ''
      }</p>`
    : '<p class="meta">The response carried no import block.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reputation report · ${esc(slug)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; padding: 40px 24px; background: #fff; color: #14103a; }
  @media (prefers-color-scheme: dark) { body { background: #130f36; color: #edebfa; } }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 6px; }
  .meta { font-size: 14px; opacity: 0.65; margin: 0 0 24px; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 15px; }
  th, td { border-bottom: 1px solid rgba(128,128,128,0.3); padding: 10px 12px; text-align: left; vertical-align: top; }
  th { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
  .ota { font-weight: 700; text-transform: capitalize; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cats { opacity: 0.75; font-size: 14px; }
  code { font-family: ui-monospace, monospace; font-size: 0.9em; }
</style>
</head>
<body>
<main>
  <h1>${esc(slug)}</h1>
  ${provenance}
  <div class="scroll">
    <table>
      <thead><tr><th>OTA</th><th>Score</th><th>Reviews</th><th>Category breakdown</th></tr></thead>
      <tbody>
${tableRows}
      </tbody>
    </table>
  </div>
  <p class="meta">Generated ${esc(generatedAt)} · Veetal Connect API</p>
</main>
</body>
</html>
`;
}
