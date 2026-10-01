/* Spielwirbel – Die Brücke's session loop (#1240): the setup (B2.3 at 390,
   B4.1 at 1440, B16.1 with twelve people), the vote card's side columns (B2.4,
   B4.2), the result's two panels (B2.5, B4.3, B16.3 the tie) and the several
   tables (B4.4). Sheets: docs/design/bruecke/Bruecke-B2-Phone-Kern.dc.html,
   Bruecke-B4-Session-Desktop.dc.html and Bruecke-B16-Dichte.dc.html. #1241
   added the shared vote (B4.5, B6.9) and the pass-device blind (B4.6, B6.10)
   — composeBrueckeLobby() and brueckeBlind() at the end of the file, sheets
   B4 and Bruecke-B6-Phone-Rest.dc.html.

   Like Ocean's (views-session-ocean.js), everything here RE-COMPOSES markup the
   shared paths have already built: every control keeps its node, its id and the
   listener showStartSession()/startVoting()/showResults() wired onto it. The vote
   card, the result Tafel and the split tables are the composed builders Der Tisch
   and Ocean share; this file only adds what Die Brücke draws around them.
   Klassisch never runs a line of it.

   The design's own words are exactly the five §2 of the vocabulary addendum
   allows (docs/design/bruecke/README.md): the pot is the POOL, the count asks
   „Sonden · wie viele werden gezogen?", the button reads „Zündung", the vote
   asks for „Schub" from „kein Schub" to „volle Kraft", and the reveal is
   „entschlüsseln". Everything else is the app's own string.

   Frontend shared-scope script; nothing here runs at load time, so its place in
   index.html only has to be before main.js
   (.claude/rules/frontend-script-load-order.md). No module.exports — it builds
   DOM, and the spec reaches it through the jsdom harness
   (test/bruecke-session.test.js). */

'use strict';

/* The setup, re-composed. `head` is the page head, `form` the `.setup-grid`
   showStartSession() has just built; ids stay, because it finds every node by
   id after this.

   - The step rail „1 Wer spielt mit? ▸ 2 Pool ▸ 3 Zündung" goes into the head.
     It numbers the three questions this one screen asks, without a leading
     zero (review R2-5). It is a picture of the screen's own sections, which
     are headed in the markup below it, so it is hidden from assistive tech
     rather than announced a second time.
   - The seats' label row carries the tap hint beside it.
   - The pool becomes its own panel headed „Pool": the filter row at its top,
     the count „9 Spiele im Pool" as its big number, the covers, and the owners
     line under them. The compact strip is hidden in bruecke.css — one
     presentation of the pool at every width.
   - The count asks the design's question, and the button reads „Zündung". A
     line under the summary says the ratings stay sealed until they are
     decrypted — the design's reveal verb, where the sheet prints it.
   DOM order is visual order at every width (WCAG 2.4.3). */
function composeBrueckeSetup(head, form) {
  head.classList.add('page-head--bruecke');
  const steps = [
    t('startSession.membersLabel'),
    t('startSession.poolBruecke'),
    t('startSession.ignitionBruecke'),
  ];
  head.appendChild(h(`<ol class="bruecke-steps" aria-hidden="true">${steps
    .map((s, i) => `<li class="bruecke-steps__step${i === 0 ? ' is-current' : ''}"><span class="bruecke-steps__n">${i + 1}</span> ${esc(s)}</li>`)
    .join('')}</ol>`));
  form.classList.add('setup-grid--bruecke');

  const main = form.querySelector('.setup-grid__main');
  const seatsLabel = main.querySelector('#seatsLabel');
  const seatsHead = h('<div class="bruecke-setup__head"></div>');
  seatsLabel.before(seatsHead);
  seatsHead.append(seatsLabel, h(`<span class="bruecke-setup__hint">${esc(t('startSession.seatsTapHint'))}</span>`));

  const aside = form.querySelector('.setup-grid__aside');
  const panel = aside.querySelector('.setup-panel');
  const pool = h(`<section class="bruecke-pool" aria-labelledby="poolTitle">
      <div class="bruecke-pool__head"><span class="bruecke-kicker" aria-hidden="true">${esc(t('startSession.poolBruecke'))}</span></div>
    </section>`);
  pool.querySelector('.bruecke-pool__head').appendChild(aside.querySelector('.setup-filterbar'));
  pool.appendChild(panel);
  // The owners line is inserted after #poolReset by showStartSession(), so it
  // lands here too, as the panel's foot.
  pool.appendChild(aside.querySelector('#poolReset'));
  aside.prepend(pool);

  const bar = aside.querySelector('.setup-bar');
  bar.querySelector('.setup-bar__count label').textContent = t('startSession.countQuestionBruecke');
  const go = bar.querySelector('#go');
  go.innerHTML = `${esc(t('startSession.ignitionBruecke'))} <i class="ti ti-arrow-right" aria-hidden="true"></i>`;
  bar.querySelector('#barSummary').after(h(`<p class="bruecke-setup__sealed">${esc(t('startSession.sealedBruecke'))}</p>`));
}

/* B10.1 „Die Zündung" (#1248): „Zündung" ignites ONCE on a press that got
   past the draw's guards — the caller only reaches this after them, so a
   refused draw never ignites. Feedback on the press, never a wait (#1122): the
   lobby replaces the screen as soon as the draw returns, mid-run if need be.
   Removed and re-added so a second press after a failed draw runs again. The
   motion is bruecke.css's; without it the class is inert. */
function brueckeIgnite(form) {
  const go = form.querySelector('#go');
  if (!go) return;
  go.classList.remove('is-igniting');
  void go.offsetWidth; // restart the animation
  go.classList.add('is-igniting');
}

/* B2.4/B4.2's side panels. `people` is everyone voting in this session,
   `person` the one rating now, `votedIds` who is already in, `left` how many of
   this person's cards come after the current one.

   „Wer hat schon gewertet" is drawn at both widths (under the card on a phone,
   beside it on a desktop); „Verdeckt" — the cards still to come, sealed — only
   where B4.2 draws it, and not at all on the last card, which has nothing
   after it. Neither holds a control, so where the desktop grid places them
   changes no focus order; in the DOM they follow the card, which is the thing
   the screen is for. */
function brueckeVoteSides(round, people, person, votedIds, left) {
  const voted = new Set(votedIds || []);
  const rows = people.map((p) => {
    const state = p.id === person.id ? 'now' : voted.has(p.id) ? 'done' : 'open';
    const key = { now: 'vote.raterNow', done: 'vote.raterDone', open: 'vote.raterOpen' }[state];
    return `<li class="bruecke-raters__row is-${state}">
         <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
         <span class="bruecke-raters__name">${esc(personLabel(p))}</span>
         <span class="bruecke-raters__state">${esc(t(key))}</span>
       </li>`;
  }).join('');
  const raters = h(`<aside class="bruecke-raters" aria-labelledby="brueckeRatersTitle">
       <h2 class="bruecke-kicker" id="brueckeRatersTitle">${esc(t('vote.ratersTitleBruecke'))}</h2>
       <ul class="bruecke-raters__list">${rows}</ul>
       <p class="bruecke-raters__note">${esc(t('vote.sealedNoteBruecke'))}</p>
     </aside>`);
  const sealed = left > 0 ? h(`<aside class="bruecke-sealed" aria-labelledby="brueckeSealedTitle">
       <h2 class="bruecke-kicker" id="brueckeSealedTitle">${esc(t('vote.sealedTitleBruecke'))}</h2>
       <p class="bruecke-sealed__text">${esc(tn(left, 'vote.sealedTextBrueckeOne', 'vote.sealedTextBruecke'))}</p>
       <span class="bruecke-sealed__cards" aria-hidden="true">${`<span class="bruecke-sealed__card">${esc(t('vote.sealedCardBruecke'))}</span>`.repeat(Math.min(left, 2))}</span>
     </aside>`) : null;
  return { raters, sealed };
}

/* The two ends of the scale, in the design's words (§2: „kein Schub" and
   „volle Kraft"). The middle three keep the app's words — only the ends are
   themed, and they follow into the result's veto line below. */
function brueckeVoteWord(n) {
  if (n === RATING_MIN) return t('vote.scaleLowBruecke');
  if (n === RATING_MAX) return t('vote.scaleHighBruecke');
  return null;
}

/* „1× kein Schub" — the score's veto reason in the design's end word. Never
   „1× kein Veto": the count is of the lowest rung, which here is named
   „kein Schub", and the sentence has to keep saying that it was GIVEN. */
function brueckeScoreReason(st) {
  return st.vetoes ? tn(st.vetoes, 'score.reasonVetoBrueckeOne', 'score.reasonVetoBruecke', { n: st.vetoes }) : '';
}

/* The result, in two panels (B4.3): the sentence, who was there and the Tafel
   on the large panel; the chosen game's band, the foot and „Noch eine Runde"
   in the column beside it. On a phone the same order is one column (B2.5).
   Called once at the end of showResults(), after the foot is appended; the
   builders hold their nodes by reference, so moving them changes nothing they
   do. */
function composeBrueckeResult(screen) {
  screen.classList.add('result-screen--bruecke');
  const main = h('<div class="bruecke-result__main"></div>');
  const side = h('<div class="bruecke-result__side"></div>');
  [...screen.children].forEach((el) => {
    const toSide = el.classList.contains('tisch-slot') || el.classList.contains('result-foot');
    (toSide ? side : main).appendChild(el);
  });
  screen.replaceChildren(main, side);
}

/* The pass-device blind (#1241 — B4.6 at 1440, B6.10 at 390): the screen that
   covers the device between two people in one-device mode. It replaces the
   Klassisch handover card rather than repainting it, the way Ocean's does
   (views-session-ocean.js), because that card is one full-bleed person colour
   and Die Brücke's blind is the night with a panel on it.

   It shows NOTHING of the person before: no rating, no score, no game, and not
   even who rated — both sheets say so on the screen, and it is the blind's
   whole purpose. So unlike Ocean's there is no relay row; the only person on it
   is the one being handed the device. Every word is the app's (`vote.turn`,
   `vote.handoverSub`, `vote.go`) except the kicker, which is one of the
   decorative lines the vocabulary addendum lets the design keep.

   The ids stay Klassisch's (#goBtn, #backBtn), so startVoting() wires this
   exactly as it wires the card. The person's colour is the avatar's edge and
   its initial — a glyph far above rule 1's 24px floor — never a fill with text
   on it. */
function brueckeBlind(round, person, canBack) {
  const color = personColor(round, person);
  return h(`<div class="handover handover--bruecke">
      <span class="bruecke-blind__signal" aria-hidden="true">${esc(t('vote.signalBruecke'))}</span>
      <span class="handover__avatar" style="--person:${color}">${avatarFace(initials(person.name), { userId: person.userId })}</span>
      <h1 class="handover__name">${esc(t('vote.turn', { name: personLabel(person) }))}</h1>
      <p class="handover__sub">${esc(t('vote.handoverSub'))}</p>
      <button class="handover__go" id="goBtn">${esc(t('vote.go'))}</button>
      ${canBack ? `<button class="handover__back" id="backBtn"><i class="ti ti-chevron-left" aria-hidden="true"></i> ${esc(t('vote.back'))}</button>` : ''}
    </div>`);
}

/* The shared vote (#1241 — B4.5 at 1440, B6.9 at 390), re-composed from the
   lobby showSessionLobby() has just built. Three blocks, in this order at every
   width — one column on a phone, three from 1100px:

   1. WHO — „Wer spielt mit?" over the people, with the count in words, and
      „Deine Stimme ist da" once your own is in (it was the actions column's).
   2. SHARE — the panel: the link and the QR code, and nothing else. The code
      stays a control that opens the server-drawn code (showVoteQrSheet) rather
      than being printed inline as the sheets draw it: the link is minted on
      demand, because a token that exists is a token that can leak (#652), and
      an inline code would mint one for every lobby anyone opens.
   3. THIS DEVICE — the actions column: the leading button, „An diesem Gerät
      abstimmen" and its people, and last „Abstimmung beenden" with the line
      naming who is still open, moved out of the panel. B4.5 puts closing in the
      page head; it goes to the end of this column instead, where B6.9 draws it
      on the phone, so the DOM order and the visual order stay one order at
      every width (WCAG 2.4.3) — a head placement would put the last action a
      keyboard reaches at the top of the screen.

   With every vote in, the panel has nothing left to share and goes. Every node
   keeps its listener: nothing here builds a control, it only moves them and
   adds the headings. */
function composeBrueckeLobby(root, people, voted) {
  root.classList.add('live-vote--bruecke');
  const peopleEl = root.querySelector('.live-vote__people');
  const actions = root.querySelector('.live-vote__actions');
  const panel = root.querySelector('.live-vote__panel');

  const n = people.filter((p) => voted.has(p.id)).length;
  peopleEl.prepend(h(`<div class="bruecke-lobby__head">
      <h2 class="bruecke-kicker">${esc(t('startSession.membersLabel'))}</h2>
      <span class="bruecke-lobby__count">${esc(t('lobby.progress', { n, total: people.length }))}</span>
    </div>`));
  const done = actions.querySelector('.live-vote__done');
  if (done) peopleEl.appendChild(done);
  // B4.5's footnote under the people; the phone sheet leaves it out (CSS).
  peopleEl.appendChild(h(`<p class="bruecke-lobby__sealed">${esc(t('vote.sealedNoteBruecke'))}</p>`));

  const qr = panel.querySelector('.live-vote__qr');
  if (qr) {
    qr.innerHTML = `<i class="ti ti-qrcode" aria-hidden="true"></i>
      <span class="bruecke-qr__text"><span class="bruecke-qr__title">${esc(t('lobby.qr'))}</span>
      <span class="bruecke-qr__hint">${esc(t('lobby.qrHint'))}</span></span>`;
  }
  ['.live-vote__close', '.live-vote__waiting'].forEach((sel) => {
    const el = panel.querySelector(sel);
    if (el) actions.appendChild(el);
  });
  if (panel.children.length) root.insertBefore(panel, actions);
  else panel.remove();
}
