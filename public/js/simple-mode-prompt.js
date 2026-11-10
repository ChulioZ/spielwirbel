/* Spielwirbel – the one-time „Einfacher Modus" prompt on the Start tab (#1768). */

'use strict';

/* „Einfacher Modus" (#1646) lives on Konto, where nobody who would want it goes
   looking. So every account is offered the choice ONCE, as a card on the round
   hub's Start tab, the first time it opens a round that has a finished session
   — the moment trophies, stats and suggestions start appearing at all.

   Its own file for the token budget: views-round-start.js sits just under it,
   and this is a concern of its own (one predicate, one card, one answer path).
   Loaded after hub-cards.js, whose card frame it uses so every design styles it,
   and before views-round-start.js, which places it. Called only at render
   time. */

/* Whether this account is still owed the prompt for this round. Every clause is
   a reason NOT to ask:
   - no account (accounts-off instance, or logged out): nothing to store on;
   - a demo: a ten-minute visitor is shown the full app, and the prompt would be
     one more card between them and the invitation;
   - already answered — on this card, or by setting the mode on Konto, which
     the server counts as an answer (PATCH /me stamps the same field);
   - a mode that is not the default: the account has already chosen, even if it
     predates the stamp;
   - a round with nothing played yet: nothing the mode hides is on screen. */
function simpleModePromptDue(round) {
  const me = accountUser;
  if (!me || isDemoAccount() || me.simpleModePromptSeen) return false;
  const pref = normalizeSimpleMode(me.simpleMode);
  if (pref.all || pref.except.length) return false;
  return (round.sessions || []).some((s) => s.finished);
}

/* The card. Two equal buttons — neither answer is the one the app wants — plus
   a × that counts as „keep everything", and a line pointing at Konto for the
   finer choice. The card goes away on the click, before the request returns:
   an answer that waits on the network is an answer the user gives twice. */
function simpleModePromptCard(round) {
  if (!simpleModePromptDue(round)) return null;
  const card = hubCard('ti-eye-off', t('simplePrompt.title'));
  card.classList.add('hub-card--prompt', 'simple-prompt');
  card.setAttribute('aria-labelledby', 'simplePromptTitle');
  const title = card.querySelector('.hub-card__title');
  title.id = 'simplePromptTitle';
  const close = h(`<button type="button" class="sheet__close simple-prompt__close" aria-label="${esc(t('simplePrompt.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>`);
  title.appendChild(close);
  const body = card.querySelector('.hub-card__body');
  body.appendChild(h(`<p class="simple-prompt__text">${esc(t('simplePrompt.body'))}</p>`));
  const actions = h(`<div class="simple-prompt__actions">
      <button type="button" class="btn btn--sm simple-prompt__keep">${esc(t('simplePrompt.keep'))}</button>
      <button type="button" class="btn btn--sm simple-prompt__simple">${esc(t('simplePrompt.simple'))}</button>
    </div>`);
  body.appendChild(actions);
  const note = h(`<p class="hub-card__facts muted simple-prompt__note">${esc(t('simplePrompt.settingsNote'))} <a class="link-btn simple-prompt__link"></a></p>`);
  const link = note.querySelector('a');
  link.textContent = t('simplePrompt.settingsLink');
  navLink(link, '/konto', () => showAccount());
  body.appendChild(note);

  const answer = (simple) => {
    // Gone at once, and marked answered locally so a re-render before the
    // server replies cannot bring it back. The cached account follows the
    // server's answer once it lands.
    card.remove();
    setCachedPref('simpleModePromptSeen', new Date().toISOString());
    const next = simple ? { simpleMode: { all: true, except: [] } } : {};
    if (simple) setCachedPref('simpleMode', next.simpleMode);
    accountApi('POST', '/simple-mode-prompt-seen', next).then((data) => {
      if (data && data.simpleModePromptSeen) setCachedPref('simpleModePromptSeen', data.simpleModePromptSeen);
      if (simple) {
        if (data && data.simpleMode) setCachedPref('simpleMode', normalizeSimpleMode(data.simpleMode));
        toast(t('konto.simple.saved'));
      }
    }).catch((ex) => {
      if (simple) {
        // The mode did not reach the server: say so, and put the screen back
        // the way the server has it, so nothing looks switched that is not.
        setCachedPref('simpleMode', { all: false, except: [] });
        if (ex.message !== 'auth') toast(t('auth.error.network'), { tone: 'error' });
        if (currentView) currentView();
      }
    });
    // „Simple" changes what the hub shows, so the screen redraws under the new
    // mode; „keep" changes nothing but the card, which is already gone.
    if (simple && currentView) currentView();
  };
  actions.querySelector('.simple-prompt__keep').addEventListener('click', () => answer(false));
  actions.querySelector('.simple-prompt__simple').addEventListener('click', () => answer(true));
  close.addEventListener('click', () => answer(false));
  return card;
}
