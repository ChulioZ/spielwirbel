'use strict';

/* One round shape for the Abzeichen view specs (#1388): the fields the repo
   returns, so a view renders a plausible screen rather than an empty one
   (.claude/rules/testing-views-under-jsdom.md §Fixtures). */

const RID = 'r1';

function night(id, day, { winnerIds = ['m1'], memberIds = ['m1', 'm2'], chosenGameId = 'g1', ...over } = {}) {
  return {
    id,
    createdAt: `2026-07-${String(day).padStart(2, '0')}T20:00:00.000Z`,
    gameIds: ['g1', 'g2'],
    memberIds,
    guests: [],
    votes: {},
    votedIds: memberIds,
    finished: true,
    cancelled: false,
    done: true,
    winnerIds,
    chosenGameId,
    events: [],
    ...over,
  };
}

function badgeRound(sessions, memberCount = 2) {
  const names = ['Anna', 'Ben', 'Clara', 'Dan', 'Eva', 'Finn', 'Greta', 'Hugo'];
  return {
    id: RID,
    name: 'Kartographen',
    background: null,
    tags: [],
    providers: [],
    members: names.slice(0, memberCount).map((name, i) => ({ id: `m${i + 1}`, name })),
    games: [{ id: 'g1', title: 'Catan', tagIds: [] }, { id: 'g2', title: 'Azul', tagIds: [] }],
    sessions,
  };
}

// The api stub every screen here needs: the round, no activities, no rounds list.
function stubApi(dom, round) {
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
}

const wideAt = (dom, wide) => dom.run(
  `window.matchMedia = (q) => ({ matches: ${wide} && /min-width/.test(q), addEventListener() {}, removeEventListener() {} });`
);

module.exports = { RID, night, badgeRound, stubApi, wideAt };
