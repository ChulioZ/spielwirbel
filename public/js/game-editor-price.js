/* Spielwirbel – the game page's purchase-price chip and editor (#1773).

   The arithmetic lives in purchase-price.js (pure, shared with the route); this
   file is the DOM half: what the Spielepass chip says and the editor it opens.
   Its own file rather than a sixth editor in game-editors.js, which sits at its
   token budget — the playtime editor (game-editor-playtime.js) set that shape.
   It takes the same `{ game, round, updateGame }` context the editors there do.

   Part of the frontend; all files share one global script scope (load order: see
   index.html). */

// A price in cents, in the reader's own notation („39,99 €", "£39.99"):
// fmtMoney formats through Intl with the locale's BCP-47 tag (locales.js).
function fmtPurchaseCents(cents, currency) {
  return fmtMoney(cents / 100, currency);
}

// The chip's text: the price alone until the game's first session, then the
// price and what each session with it has cost so far. `plays` is the shelf's
// own count (gameStats → playCounts), so this divides by the number the
// Spielwirbel-Score counts as picks.
function purchasePriceChipText(price, plays) {
  const total = fmtPurchaseCents(price.amount, price.currency);
  const per = costPerPlay(price, plays);
  if (per === null) return t('purchasePrice.chip', { price: total });
  return t('purchasePrice.chipPer', { price: total, per: t('purchasePrice.perSession', { price: fmtPurchaseCents(per, price.currency) }) });
}

// Which currency a new price defaults to: the one other priced games in this
// round already use (the most frequent), else euro. A round that keeps its
// prices in pounds should not have to re-pick pounds on every game.
function defaultPurchaseCurrency(round) {
  const counts = new Map();
  ((round && round.games) || []).forEach((g) => {
    if (g.purchasePrice && PURCHASE_PRICE_CURRENCIES.includes(g.purchasePrice.currency)) {
      counts.set(g.purchasePrice.currency, (counts.get(g.purchasePrice.currency) || 0) + 1);
    }
  });
  let best = 'EUR';
  PURCHASE_PRICE_CURRENCIES.forEach((c) => { if ((counts.get(c) || 0) > (counts.get(best) || 0)) best = c; });
  return best;
}

function openPurchasePricePopover(ctx, anchor) {
  const { game, round, updateGame } = ctx;
  openEditor(anchor, 'price', t('purchasePrice.title'), (el, close) => {
    const formRows = formSheetDesign();
    const current = isValidPurchasePrice(game.purchasePrice) ? game.purchasePrice : null;
    const amount = h('<input class="input" inputmode="decimal" maxlength="12" />');
    amount.placeholder = t('purchasePrice.amountLabel');
    amount.setAttribute('aria-label', t('purchasePrice.amountLabel'));
    // The editor shows the stored cents back in the reader's decimal notation,
    // which parsePurchaseAmount reads either way round.
    if (current) amount.value = (current.amount / 100).toLocaleString(localeTag(getLocale()), { minimumFractionDigits: 2, useGrouping: false });
    const currency = h('<select class="input pp-currency"></select>');
    currency.setAttribute('aria-label', t('purchasePrice.currencyLabel'));
    const chosen = current ? current.currency : defaultPurchaseCurrency(round);
    PURCHASE_PRICE_CURRENCIES.forEach((c) => {
      const o = h(`<option value="${c}">${c}</option>`);
      if (c === chosen) o.selected = true;
      currency.appendChild(o);
    });

    const okBtn = h(`<button class="btn btn--primary">${esc(t('common.apply'))}</button>`);
    const save = () => {
      const cents = parsePurchaseAmount(amount.value);
      if (cents === null) return toast(t('purchasePrice.invalid'));
      close();
      updateGame({ purchasePrice: { amount: cents, currency: currency.value } });
    };
    okBtn.addEventListener('click', save);
    amount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
    });

    let clear = null;
    if (current) {
      const label = t('purchasePrice.clear');
      clear = formRows ? editorRowButton('ti-trash', label, 'danger') : h(`<button type="button" class="link-btn pp-reset">${esc(label)}</button>`);
      clear.addEventListener('click', () => {
        close();
        updateGame({ purchasePrice: null });
      });
    }

    if (formRows) {
      const row = h(`<div class="editor-row" role="group" aria-labelledby="ppLabel">
          <span class="editor-row__label" id="ppLabel">${esc(t('purchasePrice.title'))}</span>
          <span class="editor-row__control"></span>
        </div>`);
      row.querySelector('.editor-row__control').append(amount, currency);
      el.append(row);
      if (clear) el.append(clear);
      el.append(editorActions(okBtn));
      return () => { amount.focus(); amount.select(); };
    }
    const row = h('<div class="pp-row"></div>');
    row.append(amount, currency, okBtn);
    el.appendChild(h(`<div class="muted pp-hint">${esc(t('purchasePrice.hint'))}</div>`));
    el.appendChild(row);
    if (clear) el.appendChild(clear);
    return () => { amount.focus(); amount.select(); };
  });
}

/* „Ins Regal" for a wish whose current price is on screen (#1773): offer to take
   that price over as the purchase price. An unticked option in the confirm the
   acquisition already is — the user decides; the cheapest listed offer is not
   necessarily what they paid. Resolves to `{ ok, purchasePrice }`, where
   `purchasePrice` is null unless the box was ticked. */
async function askAcquireWithPrice(game, live) {
  const cents = live && Number.isFinite(live.amount) ? Math.round(live.amount * 100) : null;
  const price = cents && PURCHASE_PRICE_CURRENCIES.includes(live.currency) ? { amount: cents, currency: live.currency } : null;
  if (!price || !isValidPurchasePrice(price)) return { ok: true, purchasePrice: null };
  const res = await confirmDialog({
    title: t('purchasePrice.acquireTitle', { title: game.title }),
    body: '',
    confirmLabel: t('wish.restore'),
    danger: false,
    icon: 'ti-cards',
    options: [{ id: 'price', label: t('purchasePrice.prefill', { price: fmtPurchaseCents(price.amount, price.currency) }), checked: false }],
  });
  return { ok: res.ok, purchasePrice: res.ok && res.picked.price ? price : null };
}
