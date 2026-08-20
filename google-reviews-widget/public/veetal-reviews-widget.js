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
 *           data-locale="en"
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
    theme: script.getAttribute('data-theme') || 'light',
  };

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

  function reviewItem(review) {
    var item = el('li', 'item');

    var head = el('div', 'item-head');
    head.appendChild(el('span', 'author', review.author || 'Guest'));
    head.appendChild(starRow(review.score));
    item.appendChild(head);

    // 9% carry no date: Google publishes a relative age, not the day.
    var date = formatDay(review.date);
    if (date) item.appendChild(el('div', 'date', date));

    // Google never reports the language and the texts are multilingual. dir="auto"
    // lets the browser decide review by review, so right-to-left ones read correctly.
    var text = el('p', 'text', review.text);
    text.setAttribute('dir', 'auto');
    item.appendChild(text);

    if (review.reply && review.reply.text) {
      var reply = el('div', 'reply');
      reply.appendChild(el('p', 'reply-by', 'Reply from the property'));
      var replyText = el('p', 'reply-text', review.reply.text);
      replyText.setAttribute('dir', 'auto');
      reply.appendChild(replyText);
      item.appendChild(reply);
    }

    return item;
  }

  function header(data) {
    var box = el('div', 'header');
    if (data.name) box.appendChild(el('div', 'name', data.name));

    // The reputation call is optional — when the last import skipped Google there is
    // no score, and the widget shows the reviews without a summary rather than nothing.
    if (typeof data.score === 'number') {
      var summary = el('div', 'summary');
      summary.appendChild(el('span', 'score', (data.score / 2).toFixed(1)));
      summary.appendChild(starRow(data.score));
      if (typeof data.count === 'number') {
        summary.appendChild(el('span', 'count', data.count.toLocaleString(cfg.locale) + ' reviews'));
      }
      box.appendChild(summary);
    }
    return box;
  }

  /* ------------------------------------------------------------------ styles */

  var CSS = [
    ':host{all:initial;display:block;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg)}',
    ':host{--fg:#14103a;--muted:#5b5875;--line:rgba(20,16,58,.12);--card:#fff;--star:#f5a623}',
    ':host([data-theme="dark"]){--fg:#edebfa;--muted:#a6a3bd;--line:rgba(255,255,255,.16);--card:#1b1740}',
    '*{box-sizing:border-box;margin:0;padding:0}',
    '.header{margin-bottom:18px}',
    '.name{font-size:18px;font-weight:700;margin-bottom:6px}',
    '.summary{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.score{font-size:26px;font-weight:700;line-height:1}',
    '.count{font-size:14px;color:var(--muted)}',
    '.list{list-style:none;display:grid;gap:14px}',
    '.item{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}',
    '.item-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}',
    '.author{font-weight:650;font-size:15px}',
    '.date{font-size:13px;color:var(--muted);margin-bottom:8px}',
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
    if (!reviews.length) {
      root.appendChild(el('p', 'msg', 'No reviews to show yet.'));
      return;
    }

    root.appendChild(header(data));
    var list = el('ul', 'list');
    reviews.forEach(function (review) {
      list.appendChild(reviewItem(review));
    });
    root.appendChild(list);
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
