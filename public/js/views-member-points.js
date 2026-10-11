/* Spielwirbel – „Bestleistungen" (#1631): a player's best points per game, on
   the member page (one round) and on the profile (every round the account sits
   in). Part of the frontend; all files share one global script scope (load
   order: see index.html).

   Its own file rather than more of views-member.js, which sat at the 700-line
   budget: the panel is one block both screens place in their card, and the two
   renderers share the row markup and the meta line.

   Both are HIDDEN when there is nothing to say — no personal best and no record
   held. Most rounds never count points, and an empty „Bestleistungen" box on
   every member page would advertise a feature the round does not use (the same
   call the owned-games section makes). The member page derives its figures from
   memberPointRecords (point-records.js); the profile receives the account-wide
   merge lib/user-stats.js computes from the same function. */

/* The meta line: records held and bests bettered, each only when non-zero. A
   member can hold a record with no row of their own — a team's record counts
   for every member of the team (#1631), and a team score is never a personal
   best — which is why `held` is a count here and not derived from the rows. */
function pointsMetaText(held, bettered) {
  const parts = [];
  if (held) parts.push(tn(held, 'member.pointsHeldOne', 'member.pointsHeld', { n: fmtCount(held) }));
  if (bettered) parts.push(tn(bettered, 'member.pointsBetteredOne', 'member.pointsBettered', { n: fmtCount(bettered) }));
  return parts.join(' · ');
}

// One panel shell; `rows` are appended by the caller.
function pointsPanelShell(held, bettered) {
  const meta = pointsMetaText(held, bettered);
  return h(`<div class="member-points">
       <h2 class="member-points__title">${iconText('ti-medal', t('member.pointsTitle'))}</h2>
       ${meta ? `<p class="member-points__meta">${esc(meta)}</p>` : ''}
       <ul class="member-points__list"></ul>
     </div>`);
}

// One row's inner markup. `when` is the date of the best (member page only —
// the profile payload carries no dates, see lib/user-stats.js).
function pointsRowInner(title, points, when, record) {
  return `<span class="member-points__name"><span class="member-points__game">${esc(title)}</span>${when
    ? `<span class="member-points__when">${esc(when)}</span>` : ''}</span>`
    + `<span class="member-points__value">${esc(fmtCount(points))}</span>
    <span class="member-points__mark">${record
    ? `<i class="ti ti-medal member-points__record" role="img" aria-label="${esc(t('member.pointsRecord'))}" title="${esc(t('member.pointsRecord'))}"></i>`
    : ''}</span>`;
}

const pointsByTitle = (a, b) => a.localeCompare(b, getLocale(), { sensitivity: 'base' });

// The member page's panel, or null. Each row links to its game.
function memberPointsPanel(round, member) {
  const rec = memberPointRecords(round, member.id);
  if (!rec.bests.length && !rec.held.length) return null;
  const panel = pointsPanelShell(rec.held.length, rec.bettered.length);
  const list = panel.querySelector('.member-points__list');
  rec.bests
    .slice()
    .sort((a, b) => pointsByTitle(a.game.title, b.game.title))
    .forEach((b) => {
      const li = h(`<li><a class="member-points__row">${pointsRowInner(b.game.title, b.points,
        fmtDate(b.session.createdAt), rec.held.includes(b.game.id))}</a></li>`);
      makeGameLink(li.querySelector('a'), round.id, b.game.id);
      list.appendChild(li);
    });
  if (!list.children.length) list.remove();
  return panel;
}

/* The profile's panel, or null. `points` is the payload's `stats.points`:
   { bests: [{ title, image, points, record }], held, bettered }, absent when the
   account has no points anywhere. Plain rows — a profile has no round context
   to link into (.claude/rules/in-app-nav-links.md, views-profile.js). */
function profilePointsPanel(points) {
  if (!points || (!(points.bests || []).length && !points.held)) return null;
  const panel = pointsPanelShell(points.held || 0, points.bettered || 0);
  const list = panel.querySelector('.member-points__list');
  (points.bests || [])
    .slice()
    .sort((a, b) => pointsByTitle(a.title, b.title))
    .forEach((b) => list.appendChild(h(`<li><span class="member-points__row">${pointsRowInner(b.title, b.points, null, b.record)}</span></li>`)));
  if (!list.children.length) list.remove();
  return panel;
}
