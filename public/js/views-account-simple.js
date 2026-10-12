/* Spielwirbel – the „Einfacher Modus" section of Konto (#1646). */

'use strict';

/* A parent checkbox over one „… ausblenden" box per feature, the familiar
   select-all pattern: ticking the parent hides everything, a mixed set shows it
   indeterminate, and a click on the parent is uniform and clears every
   exception (public/js/simple-mode.js owns all three rules, so this file only
   paints and saves).

   Every change saves at once, like the other preferences on this screen, and
   the cached /me follows the server's answer so the rest of the app reads the
   new value on its next render. The form repaints itself from that answer
   rather than re-rendering Konto: nothing on this screen depends on the mode,
   and a full re-render would close Der Tisch's open row under the user's
   finger.

   The quiz and the price alerts are offered only where the instance runs them
   (the same cached-config gates the account menu uses), and the parent's state
   is computed over the boxes actually on screen — so a mode with every SHOWN
   option ticked reads as „all", whatever an unoffered one says.

   Its own file for views-account-tisch.js's reason: views-account.js is on the
   token budget's allowlist, and this is a concern of its own. Loaded after
   views-account.js; called only at render time. */
function buildSimpleModeForm(me) {
  const wrap = h(`<div class="konto-notify konto-simple">
      <p class="muted konto-notify__intro">${esc(t('konto.simple.intro'))}</p>
    </div>`);
  const offered = (f) => (f === 'quiz' ? quizAvailable() : f === 'priceAlerts' ? priceWatchesAvailable() : true);
  const shown = SIMPLE_MODE_FEATURES.filter(offered);
  let pref = normalizeSimpleMode(me.simpleMode);

  const row = (label, hint) => h(`<label class="ds-row konto-notify__row konto-simple__row">
      <div class="ds-row__main"><span>${esc(label)}</span>${hint ? `<span class="field__hint muted konto-simple__hint">${esc(hint)}</span>` : ''}</div>
      <div class="ds-row__meta"><input type="checkbox" class="provider-row__box" /></div>
    </label>`);

  const parentRow = row(t('konto.simple.all'));
  parentRow.classList.add('konto-simple__all');
  const parent = parentRow.querySelector('input');
  wrap.appendChild(parentRow);

  const boxes = new Map();
  for (const group of SIMPLE_MODE_GROUPS) {
    const features = group.features.filter(offered);
    if (!features.length) continue;
    const list = h(`<div class="konto-simple__group" role="group">
        <p class="konto-simple__group-h">${esc(t(`konto.simple.group.${group.id}`))}</p>
      </div>`);
    const head = list.querySelector('.konto-simple__group-h');
    head.id = `kontoSimple-${group.id}`;
    list.setAttribute('aria-labelledby', head.id);
    for (const f of features) {
      const r = row(t(`konto.simple.f.${f}`), t(`konto.simple.f.${f}.hint`));
      r.dataset.feature = f;
      boxes.set(f, r.querySelector('input'));
      list.appendChild(r);
    }
    wrap.appendChild(list);
  }

  const paint = () => {
    const state = simpleModeParentState(pref, shown);
    parent.checked = state === 'on';
    // A native checkbox's `indeterminate` is what exposes aria-checked="mixed".
    parent.indeterminate = state === 'mixed';
    for (const [f, box] of boxes) box.checked = simpleModeHides(pref, f);
  };
  const all = [parent, ...boxes.values()];

  const save = async (next) => {
    all.forEach((b) => { b.disabled = true; }); // one request at a time
    try {
      const data = await accountApi('PATCH', '/me', { simpleMode: next });
      pref = normalizeSimpleMode(data.simpleMode);
      setCachedPref('simpleMode', pref);
      toast(t('konto.simple.saved'));
    } catch (ex) {
      if (ex.message !== 'auth') toast(t('auth.error.network'), { tone: 'error' });
    }
    all.forEach((b) => { b.disabled = false; });
    paint(); // the stored value, refused or not — never the click
  };

  parent.addEventListener('change', () => save(simpleModeToggleAll(pref, shown)));
  for (const [f, box] of boxes) box.addEventListener('change', () => save(simpleModeToggle(pref, f)));
  paint();
  return wrap;
}
