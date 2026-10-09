/* Spielwirbel – price watches (#680). Part of the frontend; all files share one
   global script scope (load order: see index.html).

   A watch belongs to the ACCOUNT and a BGG game, not to a wish or a round: it is
   set from a wished game's price box or from the watch list (/preisalarme), and
   shows on every wished copy of that game in any round. The daily job writes a
   price-drop item into the inbox; this file holds the list screen and the
   control under the price box. Nothing here mails anyone (lib/notify.js). */

'use strict';

// Whether this instance has price lookups at all — and the account to watch
// with. Read off the cached /api/config, synchronously, because the account menu
// is built synchronously on every open (account-chrome.js).
function priceWatchesAvailable() {
  return accountsActive() && isLoggedIn() && !!(accountCfg && accountCfg.prices);
}

// The same answer for a caller that may run before /api/config has: a cold load
// of /preisalarme routes here at boot, and reading the flag synchronously then
// would send the visitor Home on an instance that has the feature.
function priceWatchesReady() {
  if (!(accountsActive() && isLoggedIn())) return Promise.resolve(false);
  if (accountCfg) return Promise.resolve(priceWatchesAvailable());
  // withAppConfig never calls back on a network failure, so the wait is bounded:
  // an unanswered config reads as "no watches here" rather than a blank screen.
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    withAppConfig(() => { clearTimeout(timer); resolve(priceWatchesAvailable()); });
  });
}

const fmtCents = (cents, currency) => fmtMoney(cents / 100, currency);

// A typed threshold („24,99" or „25") to cents, or null for anything that is no
// positive amount. No upper bound here: the route owns it (invalid_threshold),
// and a second copy of the number on this side would be the drift
// .claude/rules/shared-constants-across-the-stack.md exists to prevent.
function parseThreshold(text) {
  const n = parseFloat(String(text || '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * 100);
  return cents >= 1 ? cents : null;
}

function priceWatchError(code) {
  const map = {
    quota_price_watches: 'priceWatch.err.quota',
    invalid_threshold: 'priceWatch.err.threshold',
  };
  return t(map[code] || 'priceWatch.err.generic');
}

/* The control under a wished game's price box. `price` is the live answer the
   box just rendered (its currency is the market the reader would watch in), or
   null when there is none — then an EXISTING watch still shows, editable and
   stoppable, because a watch belongs on every wished copy of its game; only
   setting a new one needs today's price. `anchor` is replaced, so the caller
   only has to reserve the spot. */
async function renderPriceWatchControl(anchor, game, price) {
  // Decided BEFORE the first await wherever the answer is already known, so the
  // empty anchor never outlives the render that placed it (a screen without
  // accounts or without prices must look exactly as it did before #680).
  if (!(accountsActive() && isLoggedIn()) || (accountCfg && !accountCfg.prices)) return anchor.remove();
  // Without a live price there is only an existing watch to show, and no reason
  // to hold a placeholder open while /api/config is still on its way.
  if (!price && !accountCfg) return anchor.remove();
  if (!(await priceWatchesReady())) return anchor.remove();
  let watches;
  try {
    ({ watches } = await api('GET', '/api/price-watches'));
  } catch {
    return anchor.remove();
  }
  if (!anchor.isConnected) return undefined;
  const externalId = String(game.source.externalId);
  let watch = (watches || []).find((w) => w.externalId === externalId) || null;
  if (!watch && !price) return anchor.remove();
  const box = h('<div class="section gd-watch"></div>');
  anchor.replaceWith(box);

  const render = () => {
    box.replaceChildren();
    if (watch) {
      box.appendChild(h(`<p class="gd-watch__state"><i class="ti ti-bell" aria-hidden="true"></i> ${esc(t('priceWatch.watching', { price: fmtCents(watch.thresholdCents, watch.currency) }))}</p>`));
      const row = h(`<div class="toolbar gd-watch__actions">
          <button type="button" class="btn btn--sm" id="gdWatchEdit">${esc(t('priceWatch.edit'))}</button>
          <button type="button" class="btn btn--sm btn--ghost" id="gdWatchStop">${esc(t('priceWatch.stop'))}</button>
          <a class="link-btn gd-watch__all" href="/preisalarme">${esc(t('priceWatch.all'))}</a>
        </div>`);
      navLink(row.querySelector('.gd-watch__all'), '/preisalarme', () => showPriceWatches());
      row.querySelector('#gdWatchEdit').addEventListener('click', () => renderForm(watch.thresholdCents));
      row.querySelector('#gdWatchStop').addEventListener('click', async () => {
        try {
          await api('DELETE', `/api/price-watches/${encodeURIComponent(watch.id)}`);
          watch = null;
          toast(t('priceWatch.toast.stopped'));
          render();
        } catch {
          toast(t('priceWatch.err.generic'), { tone: 'error' });
        }
      });
      box.appendChild(row);
    } else if (price) {
      renderForm(null);
    } else {
      // Stopped while no price is on screen: nothing to offer a new watch from.
      box.remove();
    }
  };

  // Prefilled BELOW today's price: "tell me when it is cheaper than now" is the
  // common case, and a prefill equal to today's price would alert on the first
  // check for a price that never moved (39,00 € floors to 39). The next whole
  // amount below, or a cent below for a price under 1. The reader may change it.
  const belowToday = (amount) => {
    const whole = Math.ceil(amount) - 1;
    return whole >= 1 ? whole : Math.max(0.01, (Math.round(amount * 100) - 1) / 100);
  };
  const renderForm = (cents) => {
    box.replaceChildren();
    const start = cents != null ? cents / 100 : belowToday(price.amount);
    // An existing watch compares in the currency it was SET in, whatever market
    // this reader would see today — label the amount with that one.
    const currency = watch ? watch.currency : price.currency;
    const form = h(`<form class="gd-watch__form">
        <label for="gdWatchAt" class="gd-watch__label"><i class="ti ti-bell" aria-hidden="true"></i> ${esc(t('priceWatch.label', { currency }))}</label>
        <div class="gd-watch__row">
          <input id="gdWatchAt" class="input gd-watch__input" type="text" inputmode="decimal" autocomplete="off" value="${esc(String(start))}">
          <button type="submit" class="btn">${esc(t(watch ? 'priceWatch.save' : 'priceWatch.start'))}</button>
        </div>
        <p class="muted field__hint">${esc(t('priceWatch.hint'))}</p>
      </form>`);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const thresholdCents = parseThreshold(form.querySelector('#gdWatchAt').value);
      if (thresholdCents === null) { toast(t('priceWatch.err.threshold'), { tone: 'error' }); return; }
      try {
        const res = await api('POST', '/api/price-watches', {
          externalId, title: game.title, thresholdCents, lang: getLocale(),
          editionLanguages: (game.edition && game.edition.languages) || [],
        });
        watch = res.watch;
        toast(t('priceWatch.toast.saved'), { tone: 'success' });
        render();
      } catch (err) {
        toast(priceWatchError(err.message), { tone: 'error' });
      }
    });
    box.appendChild(form);
  };

  render();
  return undefined;
}

/* /preisalarme — every watch of this account, editable, plus a search to add
   one for a game that is on no wish list. A MAIN page (reached from the account
   menu), so no back control
   (.claude/rules/persistent-chrome-defines-the-main-pages.md). */
async function showPriceWatches() {
  const view = () => showPriceWatches();
  currentView = view;
  if (!(await priceWatchesReady())) return showHome();
  if (currentView !== view) return undefined;
  syncUrl('/preisalarme');
  setContext(t('priceWatch.title'));
  setDocTitle(t('priceWatch.title'));
  applyMarker(null);
  app.innerHTML = '';
  if (designIs('bruecke')) app.appendChild(brueckeUpLink());
  const head = h(`<div class="lobby-head${designIs('tisch') ? ' lobby-head--felt' : ''}"><h1>${esc(t('priceWatch.title'))}</h1></div>`);
  app.appendChild(head);

  let data;
  try {
    data = await api('GET', '/api/price-watches');
  } catch {
    app.appendChild(h(`<p class="muted">${esc(t('priceWatch.err.generic'))}</p>`));
    return;
  }
  // A newer screen took over while the list loaded.
  if (!head.isConnected) return;
  let watches = data.watches || [];
  const limit = data.limit;

  const intro = h(`<p class="muted price-watches__intro"></p>`);
  const list = h('<div class="ds-list price-watches__list"></div>');
  const search = renderWatchSearch(() => watches, (w) => { watches = [...watches.filter((x) => x.id !== w.id), w]; paint(); });
  app.appendChild(intro);
  app.appendChild(search);
  app.appendChild(list);

  function paint() {
    intro.textContent = t('priceWatch.intro', { n: watches.length, max: limit });
    if (!watches.length) {
      list.replaceChildren(h(`<p class="muted price-watches__empty">${esc(t('priceWatch.empty'))}</p>`));
      return;
    }
    list.replaceChildren(...watches.map((w) => watchRow(w, (next) => {
      watches = next ? watches.map((x) => (x.id === next.id ? next : x)) : watches.filter((x) => x.id !== w.id);
      paint();
    })));
  }
  paint();
}

// One watch: what is watched, at what price, where, and what it last cost.
function watchRow(w, onChange) {
  const last = w.lastPrice
    ? t('priceWatch.lastSeen', { price: fmtCents(w.lastPrice.amountCents, w.lastPrice.currency), date: fmtDate(w.lastPrice.observedAt) })
    : t(w.lastCheckedAt ? 'priceWatch.noOffer' : 'priceWatch.notYet');
  const where = t('priceWatch.market', { dest: w.destination, edition: w.editionLang || '—' });
  const row = h(`<div class="ds-row ds-row--static price-watch">
      <div class="ds-row__main">
        <div class="price-watch__title">${esc(w.title)}</div>
        <div class="muted price-watch__meta">${esc(t('priceWatch.at', { price: fmtCents(w.thresholdCents, w.currency) }))} · ${esc(last)}</div>
        <div class="muted price-watch__where">${esc(where)}</div>
      </div>
      <div class="ds-row__meta price-watch__actions">
        <button type="button" class="btn btn--sm price-watch__edit">${esc(t('priceWatch.edit'))}</button>
        <button type="button" class="btn btn--sm btn--ghost price-watch__stop">${esc(t('priceWatch.stop'))}</button>
      </div>
    </div>`);
  row.querySelector('.price-watch__stop').addEventListener('click', async () => {
    try {
      await api('DELETE', `/api/price-watches/${encodeURIComponent(w.id)}`);
      toast(t('priceWatch.toast.stopped'));
      onChange(null);
    } catch {
      toast(t('priceWatch.err.generic'), { tone: 'error' });
    }
  });
  row.querySelector('.price-watch__edit').addEventListener('click', () => {
    const form = thresholdForm(w.thresholdCents / 100, t('priceWatch.save'), async (cents) => {
      const res = await api('PATCH', `/api/price-watches/${encodeURIComponent(w.id)}`, { thresholdCents: cents });
      toast(t('priceWatch.toast.saved'), { tone: 'success' });
      onChange(res.watch);
    });
    row.querySelector('.price-watch__actions').replaceWith(form);
    form.querySelector('input').focus();
  });
  return row;
}

// The inline "at most X" form the list uses twice (edit, and add from search).
function thresholdForm(start, label, onSubmit) {
  const form = h(`<form class="price-watch__form">
      <input class="input price-watch__input" type="text" inputmode="decimal" autocomplete="off"
        aria-label="${esc(t('priceWatch.thresholdAria'))}" value="${esc(start == null ? '' : String(start))}">
      <button type="submit" class="btn btn--sm">${esc(label)}</button>
    </form>`);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = parseThreshold(form.querySelector('input').value);
    if (cents === null) { toast(t('priceWatch.err.threshold'), { tone: 'error' }); return; }
    try {
      await onSubmit(cents);
    } catch (err) {
      toast(priceWatchError(err.message), { tone: 'error' });
    }
  });
  return form;
}

// Search BGG by name and watch a hit. On Enter or the button, never per
// keystroke — BGG's terms ask for gentleness, and this screen is no race.
function renderWatchSearch(current, onAdded) {
  const box = h(`<form class="price-watches__search" role="search">
      <label for="watchSearch" class="field__label">${esc(t('priceWatch.searchLabel'))}</label>
      <div class="price-watches__search-row">
        <input id="watchSearch" class="input" type="search" autocomplete="off" placeholder="${esc(t('priceWatch.searchPlaceholder'))}" autocorrect="off" spellcheck="false">
        <button type="submit" class="btn"><i class="ti ti-search" aria-hidden="true"></i> ${esc(t('priceWatch.search'))}</button>
      </div>
      <div class="ds-list price-watches__results" aria-live="polite"></div>
    </form>`);
  const results = box.querySelector('.price-watches__results');
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = box.querySelector('#watchSearch').value.trim();
    if (q.length < 2) return;
    results.replaceChildren(h(`<p class="muted">${esc(t('priceWatch.searching'))}</p>`));
    let hits;
    try {
      ({ results: hits } = await api('GET', `/api/price-watches/search?q=${encodeURIComponent(q)}`));
    } catch {
      results.replaceChildren(h(`<p class="muted">${esc(t('priceWatch.err.search'))}</p>`));
      return;
    }
    if (!hits.length) {
      results.replaceChildren(h(`<p class="muted">${esc(t('priceWatch.noHits'))}</p>`));
      return;
    }
    results.replaceChildren(...hits.map((hit) => {
      const watched = current().some((w) => w.externalId === hit.externalId);
      const row = h(`<div class="ds-row ds-row--static price-watches__hit">
          <div class="ds-row__main">${esc(hit.title)}${hit.year ? ` <span class="muted">(${esc(String(hit.year))})</span>` : ''}</div>
          <div class="ds-row__meta"></div>
        </div>`);
      const meta = row.querySelector('.ds-row__meta');
      if (watched) {
        meta.appendChild(h(`<span class="muted">${esc(t('priceWatch.already'))}</span>`));
      } else {
        const add = h(`<button type="button" class="btn btn--sm">${esc(t('priceWatch.start'))}</button>`);
        add.addEventListener('click', () => {
          const form = thresholdForm(null, t('priceWatch.save'), async (cents) => {
            const res = await api('POST', '/api/price-watches', { externalId: hit.externalId, title: hit.title, thresholdCents: cents, lang: getLocale() });
            toast(t('priceWatch.toast.saved'), { tone: 'success' });
            row.remove();
            onAdded(res.watch);
          });
          meta.replaceChildren(form);
          form.querySelector('input').focus();
        });
        meta.appendChild(add);
      }
      return row;
    }));
  });
  return box;
}

/* A price-drop item in the inbox (#680). Everything it states was frozen when
   the job saw the price, and it says WHEN: the upstream updates nightly, so the
   price may be a day old and must not read as live (#679's PAngV notes). The
   aggregator link and source line are their terms' condition for showing a
   price at all. Read-on-click and dismiss behave like every other item. */
function renderPriceDropItem(item) {
  const p = item.payload || {};
  const shipping = t(p.shippingKnown ? 'price.inclShipping' : 'price.plusShipping');
  const link = typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null;
  const row = h(`<div class="ds-row${item.read ? ' ds-row--static' : ''} inbox-row inbox-row--price${item.read ? '' : ' inbox-row--unread'}">
      <div class="ds-row__main">
        <div class="ds-row__date">${unreadDot(item)}${esc(t('priceWatch.inbox.title', { title: p.title || '' }))}</div>
        <div class="inbox-row__price">${esc(t('priceWatch.inbox.body', {
          price: fmtCents(p.amountCents, p.currency), shipping, threshold: fmtCents(p.thresholdCents, p.currency),
        }))}</div>
        <div class="ds-row__status muted">${esc(t('priceWatch.inbox.seen', { when: fmtDateTime(p.observedAt) }))}</div>
        ${link ? `<a class="link-out inbox-row__offers" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(t('price.viewOffers'))}</a>` : ''}
        <div class="muted inbox-row__source">${esc(t('price.sourceBgp'))}</div>
      </div>
      <div class="ds-row__meta">
        <button class="link-btn inbox-row__stop" type="button">${esc(t('priceWatch.stop'))}</button>
        <button class="link-btn inbox-row__del" type="button" aria-label="${esc(t('inbox.dismiss'))}"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>
    </div>`);

  if (!item.read) {
    row.addEventListener('click', async (ev) => {
      if (ev.target.closest('button, a')) return; // each control has its own handler
      try {
        await accountApi('POST', `/inbox/${item.id}/read`);
        item.read = true;
        row.classList.remove('inbox-row--unread');
        row.classList.add('ds-row--static');
        const d = row.querySelector('.inbox-row__dot');
        if (d) d.remove();
        refreshInboxBadge();
      } catch {}
    });
  }
  // „Beenden" means "stop watching this GAME": it ends whichever watch on the
  // game is live now — which may be a newer one than the watch that wrote this
  // item, if the reader ended that one and set another since.
  row.querySelector('.inbox-row__stop').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      const { watches } = await api('GET', '/api/price-watches');
      const live = (watches || []).find((w) => w.externalId === p.externalId);
      if (live) await api('DELETE', `/api/price-watches/${encodeURIComponent(live.id)}`);
    } catch {
      toast(t('priceWatch.err.generic'), { tone: 'error' });
      return;
    }
    toast(t('priceWatch.toast.stopped'));
    // Ending the watch removed this item server-side too; take it off screen.
    row.remove();
    afterRemove();
  });
  row.querySelector('.inbox-row__del').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      await accountApi('DELETE', `/inbox/${item.id}`);
      row.remove();
      afterRemove();
    } catch {}
  });
  return row;
}
