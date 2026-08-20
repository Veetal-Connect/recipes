/**
 * Veetal reviews widget — one file, no dependencies, no build step.
 *
 * Reads its configuration from the data-* attributes on its own <script> tag and
 * renders inside a Shadow DOM. The shadow root isolates styles in both directions:
 * the host page cannot bleed into the widget, and the widget cannot bleed out.
 *
 * Everything is built with textContent, never innerHTML. These are texts written by
 * strangers being rendered onto someone's commercial website — there is no version of
 * that where string-concatenating HTML is acceptable.
 *
 *   <script src="/veetal-reviews-widget.js"
 *           data-endpoint="/reviews-widget.json"
 *           data-target="#reviews"
 *           data-limit="5"
 *           data-locale="es"
 *           data-panel="full"
 *           data-theme="light"></script>
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var cfg = {
    endpoint: script.getAttribute('data-endpoint') || '/reviews-widget.json',
    target: script.getAttribute('data-target') || null,
    limit: parseInt(script.getAttribute('data-limit') || '5', 10),
    locale: script.getAttribute('data-locale') || document.documentElement.lang || 'en',
    // full = score + sentiment + categories + reviews · summary = panel only · list = reviews only
    panel: script.getAttribute('data-panel') || 'full',
    theme: script.getAttribute('data-theme') || 'light',
  };

  var lang = String(cfg.locale).slice(0, 2).toLowerCase() === 'es' ? 'es' : 'en';

  var T = {
    en: {
      average: 'Average',
      sources: function (n) { return n + (n === 1 ? ' source' : ' sources'); },
      days: function (n) { return n + ' days'; },
      sentiment: 'Sentiment',
      positive: 'Positive',
      neutral: 'Neutral',
      negative: 'Negative',
      topics: 'Trending topics',
      reply: 'Reply from the property',
      guest: 'Guest',
      empty: 'No reviews to show yet.',
      reviews: 'reviews',
    },
    es: {
      average: 'Media',
      sources: function (n) { return n + (n === 1 ? ' fuente' : ' fuentes'); },
      days: function (n) { return n + ' días'; },
      sentiment: 'Sentimiento',
      positive: 'Positivas',
      neutral: 'Neutras',
      negative: 'Negativas',
      topics: 'Temas en tendencia',
      reply: 'Respuesta del alojamiento',
      guest: 'Huésped',
      empty: 'Todavía no hay opiniones que mostrar.',
      reviews: 'opiniones',
    },
  }[lang];

  // The API returns category names already normalised across OTAs, in snake_case.
  // Anything not on this list is prettified rather than dropped: a new category
  // appearing upstream should show up as "Sleep quality", never as a blank card.
  var CATEGORY = {
    en: {
      cleanliness: 'Cleanliness', staff: 'Staff', location: 'Location', rooms: 'Rooms',
      service: 'Service', sleep_quality: 'Sleep quality', value_for_money: 'Value',
      facilities: 'Facilities', comfort: 'Comfort', breakfast: 'Breakfast', wifi: 'WiFi',
    },
    es: {
      cleanliness: 'Limpieza', staff: 'Personal', location: 'Ubicación', rooms: 'Habitaciones',
      service: 'Servicio', sleep_quality: 'Descanso', value_for_money: 'Calidad-precio',
      facilities: 'Instalaciones', comfort: 'Confort', breakfast: 'Desayuno', wifi: 'WiFi',
    },
  }[lang];

  function categoryLabel(name) {
    if (CATEGORY[name]) return CATEGORY[name];
    var pretty = String(name || '').replace(/_/g, ' ');
    return pretty.charAt(0).toUpperCase() + pretty.slice(1);
  }

  // Without data-target the widget renders exactly where the <script> sits.
  var host = document.createElement('div');
  if (cfg.target) {
    var mount = document.querySelector(cfg.target);
    if (!mount) return;
    mount.appendChild(host);
  } else {
    script.parentNode.insertBefore(host, script);
  }
  var root = host.attachShadow({ mode: 'open' });

  /* ---------------------------------------------------------------- helpers */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function num(value, decimals) {
    try {
      return value.toLocaleString(cfg.locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch (e) {
      return value.toFixed(decimals);
    }
  }

  // 'YYYY-MM-DD' -> local Date. new Date('2026-08-14') parses as UTC and can shift the
  // day backwards for anyone west of Greenwich.
  function parseDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  function formatDay(iso) {
    var d = parseDay(iso);
    if (!d) return null;
    try {
      return d.toLocaleDateString(cfg.locale, { year: 'numeric', month: 'long' });
    } catch (e) {
      return iso;
    }
  }

  // Scores come out of 10. Google rates 1-5, so per-review values are always even and
  // land on whole stars; only the average is ever fractional.
  function starRow(score) {
    var value = typeof score === 'number' ? Math.max(0, Math.min(10, score)) / 2 : 0;
    var row = el('div', 'stars');
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', value.toFixed(1) + '/5');
    for (var i = 0; i < 5; i++) {
      var pct = Math.max(0, Math.min(1, value - i)) * 100;
      var star = el('span', 'star');
      star.appendChild(el('span', 'star-bg', '★'));
      var fill = el('span', 'star-fill', '★');
      fill.style.width = pct + '%';
      star.appendChild(fill);
      row.appendChild(star);
    }
    return row;
  }

  /* ------------------------------------------------------------------ panel */

  function heroBlock(data) {
    var head = data.headline || {};
    if (typeof head.score !== 'number') return null;

    var hero = el('div', 'hero');

    var figure = el('div', 'figure');
    // Out of 5: it is the scale every guest recognises from the OTAs themselves.
    figure.appendChild(el('div', 'figure-num', num(head.score / 2, 2)));
    hero.appendChild(figure);

    var meta = [T.average];
    if (head.sources) meta.push(T.sources(head.sources));
    if (data.window_days) meta.push(T.days(data.window_days));
    hero.appendChild(el('div', 'figure-meta', meta.join(' · ')));

    if (typeof head.count === 'number' && head.count > 0) {
      hero.appendChild(el('div', 'figure-count', num(head.count, 0) + ' ' + T.reviews));
    }
    return hero;
  }

  function sentimentBlock(sent) {
    if (!sent || !sent.total) return null;

    var box = el('div', 'block');
    box.appendChild(el('div', 'block-title', T.sentiment));

    var bar = el('div', 'bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute(
      'aria-label',
      T.positive + ' ' + Math.round(sent.positive_share * 100) + '%, ' +
        T.neutral + ' ' + Math.round(sent.neutral_share * 100) + '%, ' +
        T.negative + ' ' + Math.round(sent.negative_share * 100) + '%',
    );

    [
      ['pos', sent.positive_share],
      ['neu', sent.neutral_share],
      ['neg', sent.negative_share],
    ].forEach(function (pair) {
      if (!pair[1]) return;
      var seg = el('span', 'seg seg-' + pair[0]);
      seg.style.width = (pair[1] * 100).toFixed(2) + '%';
      bar.appendChild(seg);
    });
    box.appendChild(bar);

    var legend = el('div', 'legend');
    [
      ['pos', T.positive, sent.positive],
      ['neu', T.neutral, sent.neutral],
      ['neg', T.negative, sent.negative],
    ].forEach(function (row) {
      var item = el('span', 'legend-item');
      item.appendChild(el('span', 'dot dot-' + row[0]));
      item.appendChild(el('span', 'legend-label', row[1]));
      item.appendChild(el('span', 'legend-value', String(row[2])));
      legend.appendChild(item);
    });
    box.appendChild(legend);
    return box;
  }

  function categoriesBlock(rows, windowDays) {
    if (!rows || !rows.length) return null;

    var box = el('div', 'block');
    var title = T.topics;
    if (windowDays) title += ' · ' + T.days(windowDays);
    box.appendChild(el('div', 'block-title', title));

    var grid = el('div', 'grid');
    rows.forEach(function (row) {
      var card = el('div', 'card');
      card.appendChild(el('span', 'card-name', categoryLabel(row.name)));

      // A card with no delta is not a failure: it is a category whose sample was too
      // thin to compare. It still shows its score, which is the honest half.
      if (typeof row.delta === 'number') {
        var up = row.delta >= 0;
        var trend = el('span', 'trend ' + (up ? 'up' : 'down'));
        trend.appendChild(el('span', 'arrow', up ? '↑' : '↓'));
        trend.appendChild(el('span', null, num(Math.abs(row.delta), 0) + '%'));
        card.appendChild(trend);
      } else if (typeof row.score === 'number') {
        card.appendChild(el('span', 'card-score', num(row.score / 2, 1)));
      }
      grid.appendChild(card);
    });

    box.appendChild(grid);
    return box;
  }

  /* ----------------------------------------------------------------- review */

  function reviewItem(review) {
    var item = el('li', 'item');

    var head = el('div', 'item-head');
    head.appendChild(el('span', 'author', review.author || T.guest));
    head.appendChild(starRow(review.score));
    item.appendChild(head);

    var sub = [];
    // 9% carry no date: Google publishes a relative age, not the day.
    var date = formatDay(review.date);
    if (date) sub.push(date);
    // With several OTAs merged, saying where a review came from stops being optional.
    if (review.provider) sub.push(review.provider);
    if (sub.length) item.appendChild(el('div', 'date', sub.join(' · ')));

    // Google never reports the language and the texts are multilingual. dir="auto"
    // lets the browser decide review by review, so right-to-left ones read correctly.
    var text = el('p', 'text', review.text);
    text.setAttribute('dir', 'auto');
    item.appendChild(text);

    if (review.reply && review.reply.text) {
      var reply = el('div', 'reply');
      reply.appendChild(el('p', 'reply-by', T.reply));
      var replyText = el('p', 'reply-text', review.reply.text);
      replyText.setAttribute('dir', 'auto');
      reply.appendChild(replyText);
      item.appendChild(reply);
    }

    return item;
  }

  /* ------------------------------------------------------------------ styles */

  var CSS = [
    ':host{all:initial;display:block;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg)}',
    ':host{--fg:#14103a;--muted:#6b6880;--line:rgba(20,16,58,.12);--card:#fff;--star:#f5a623;',
    '--pos:#3f9c53;--neu:#c9c7d4;--neg:#c0564f;--surface:rgba(20,16,58,.03)}',
    ':host([data-theme="dark"]){--fg:#edebfa;--muted:#a6a3bd;--line:rgba(255,255,255,.16);--card:#1b1740;',
    '--neu:#4a4763;--surface:rgba(255,255,255,.05)}',
    '*{box-sizing:border-box;margin:0;padding:0}',

    /* hero — the number is the widget's whole first impression, so it gets the room */
    '.hero{margin-bottom:26px}',
    '.figure-num{font-size:clamp(56px,13vw,92px);font-weight:800;line-height:.86;letter-spacing:-.04em;font-variant-numeric:tabular-nums}',
    '.figure-meta{margin-top:12px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.figure-count{margin-top:4px;font-size:13px;color:var(--muted)}',

    '.block{margin-bottom:24px}',
    '.block-title{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}',

    /* sentiment bar */
    '.bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--surface)}',
    '.seg{display:block;height:100%}',
    '.seg-pos{background:var(--pos)}.seg-neu{background:var(--neu)}.seg-neg{background:var(--neg)}',
    '.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:13px;color:var(--muted)}',
    '.legend-item{display:inline-flex;align-items:center;gap:6px}',
    '.dot{width:8px;height:8px;border-radius:50%}',
    '.dot-pos{background:var(--pos)}.dot-neu{background:var(--neu)}.dot-neg{background:var(--neg)}',
    '.legend-value{font-weight:700;color:var(--fg);font-variant-numeric:tabular-nums}',

    /* category cards */
    '.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
    '@media (max-width:420px){.grid{grid-template-columns:1fr}}',
    '.card{display:flex;align-items:center;justify-content:space-between;gap:10px;',
    'border:1px solid var(--line);border-radius:999px;padding:12px 18px;background:var(--card)}',
    '.card-name{font-size:15px;font-weight:600}',
    '.card-score{font-size:15px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.trend{display:inline-flex;align-items:center;gap:3px;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}',
    '.trend.up{color:var(--pos)}.trend.down{color:var(--neg)}',
    '.arrow{font-size:14px;line-height:1}',

    /* reviews */
    '.list{list-style:none;display:grid;gap:14px}',
    '.item{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}',
    '.item-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}',
    '.author{font-weight:650;font-size:15px}',
    '.date{font-size:13px;color:var(--muted);margin-bottom:8px;text-transform:capitalize}',
    '.text{font-size:15px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.reply{margin-top:12px;padding-left:12px;border-left:3px solid var(--line)}',
    '.reply-by{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px}',
    // The hotel answers 81% of reviews and its replies run long. Unclamped, the card
    // becomes hotel PR instead of guest opinion; four lines still show it replies.
    '.reply-text{font-size:14px;line-height:1.5;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}',
    '.stars{display:inline-flex;gap:2px;line-height:1}',
    '.star{position:relative;display:inline-block;width:1em;height:1em;font-size:15px}',
    '.star-bg,.star-fill{position:absolute;inset:0;overflow:hidden}',
    '.star-bg{color:var(--line)}',
    '.star-fill{color:var(--star)}',
    '.msg{font-size:14px;color:var(--muted)}',
  ].join('');

  /* ------------------------------------------------------------------ render */

  function render(data) {
    root.textContent = '';
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var reviews = (data.reviews || []).slice(0, cfg.limit);
    var wantsPanel = cfg.panel !== 'list';
    var wantsList = cfg.panel !== 'summary';

    var blocks = [];
    if (wantsPanel) {
      blocks.push(heroBlock(data));
      blocks.push(sentimentBlock(data.sentiment));
      blocks.push(categoriesBlock(data.categories, data.window_days));
    }
    blocks = blocks.filter(Boolean);

    if (!blocks.length && !reviews.length) {
      root.appendChild(el('p', 'msg', T.empty));
      return;
    }

    blocks.forEach(function (block) {
      root.appendChild(block);
    });

    if (wantsList && reviews.length) {
      var list = el('ul', 'list');
      reviews.forEach(function (review) {
        list.appendChild(reviewItem(review));
      });
      root.appendChild(list);
    }
  }

  // 'auto' tiene que SEGUIR al esquema del sistema, no leerlo una vez y olvidarse:
  // quien cambia de claro a oscuro con la página abierta se quedaba con un widget del
  // tema contrario, y la cabecera —que no lleva fondo propio— se volvía ilegible.
  function applyTheme() {
    var dark =
      cfg.theme === 'dark' ||
      (cfg.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) host.setAttribute('data-theme', 'dark');
    else host.removeAttribute('data-theme');
  }
  applyTheme();
  if (cfg.theme === 'auto') {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    if (query.addEventListener) query.addEventListener('change', applyTheme);
    else if (query.addListener) query.addListener(applyTheme); // Safari < 14
  }

  fetch(cfg.endpoint, { headers: { accept: 'application/json' } })
    .then(function (res) {
      if (!res.ok) throw new Error('endpoint ' + res.status);
      return res.json();
    })
    .then(render)
    .catch(function (err) {
      // A widget that cannot load must not leave a broken box on a commercial page.
      console.warn('[veetal-reviews-widget]', err.message);
      host.remove();
    });
})();
