/* Spielwirbel – a game's purchase price and what each session with it cost (#1773).

   The STORED shape is `purchasePrice: { amount, currency }` on the game row,
   `amount` in integer minor units (cents) so two prices compare exactly and a
   cost per session never accumulates a float. The key is ABSENT on a game with
   no price — a clear deletes it, never stores null — for the absent-key parity
   both repo backends keep (.claude/rules/postgres-backend.md).

   Everything derived is computed ON DEMAND from the shelf's own play count
   (`playCounts`, vote-score.js — the number the Spielwirbel-Score counts as
   picks since #1721), never stored: a deleted session simply stops counting,
   exactly like every other figure on the Spielepass.

   Shared across the stack (.claude/rules/shared-constants-across-the-stack.md):
   the editor OFFERS `PURCHASE_PRICE_CURRENCIES` and the ceiling, and
   `PATCH …/games/:gid` VALIDATES with `isValidPurchasePrice` from this same
   file, so the editor cannot accept a value the route then 400s. The currency
   list is the price feature's own (lib/prices/boardgameprices.js CURRENCIES),
   so a current price the wish page shows can always be taken over as a
   purchase price. All five have two minor digits, which is what lets `amount`
   be "cents" for every one of them.

   Loaded as a shared-scope script by index.html and required from Node, so it
   is dependency-free. */

'use strict';

const PURCHASE_PRICE_CURRENCIES = ['EUR', 'GBP', 'USD', 'DKK', 'SEK'];
// 100 000,00 in any of them — a sanity ceiling, not a statement about prices.
const PURCHASE_PRICE_MAX_CENTS = 10000000;
// „Bester Kauf" needs this many sessions behind a game before it may win: one
// lucky evening makes any box look like a bargain.
const BEST_BUY_MIN_PLAYS = 3;

function isValidPurchasePrice(p) {
  return !!p && typeof p === 'object' && !Array.isArray(p)
    && Object.keys(p).length === 2
    && Number.isInteger(p.amount) && p.amount >= 1 && p.amount <= PURCHASE_PRICE_MAX_CENTS
    && PURCHASE_PRICE_CURRENCIES.includes(p.currency);
}

/* What the user typed, as cents — or null when it is not an amount.
   Accepts both decimal separators („39,99", "39.99") and a thousands separator
   when both appear („1.234,56", "1,234.56"): the LAST separator is the decimal
   one. At most two decimals; anything else is refused rather than guessed. */
function parsePurchaseAmount(text) {
  let s = String(text == null ? '' : text).replace(/[\s\u00a0\u202f]/g, '');
  if (!s) return null;
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (last !== -1 && /[.,]/.test(s.slice(0, last))) {
    s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1);
  } else {
    s = s.replace(',', '.');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return cents >= 1 && cents <= PURCHASE_PRICE_MAX_CENTS ? cents : null;
}

// The price ÷ the sessions it was played in, in cents (possibly fractional) —
// or null before the first one, when there is nothing to divide by yet.
function costPerPlay(price, plays) {
  if (!isValidPurchasePrice(price) || !Number.isInteger(plays) || plays < 1) return null;
  return price.amount / plays;
}

/* „Bester Kauf": the lowest cost per session among priced games with at least
   BEST_BUY_MIN_PLAYS sessions. Tie-aware — every game sharing the lowest cost
   is returned, compared as exact fractions (a·q === b·p) so 30/3 and 40/4 tie.

   Costs are only comparable within ONE currency (conversion is out of scope),
   so the candidates are narrowed to the currency most of them carry; on a tie
   of counts the earlier currency in PURCHASE_PRICE_CURRENCIES wins, which keeps
   the answer stable across renders.

   `plays` is the shelf's Map from `playCounts`. A wish or a guest game holds no
   purchase of the round's, so neither can win; a RETIRED or completed game can,
   since the money was spent and the sessions happened — a record, like
   „Meistgespielt" (.claude/rules/active-games-filter-sites.md). */
function bestBuy(games, plays) {
  const pool = (games || []).filter((g) => g && !g.wish && !g.guestGame
    && isValidPurchasePrice(g.purchasePrice)
    && ((plays && plays.get(g.id)) || 0) >= BEST_BUY_MIN_PLAYS);
  if (!pool.length) return null;
  const counts = new Map();
  pool.forEach((g) => counts.set(g.purchasePrice.currency, (counts.get(g.purchasePrice.currency) || 0) + 1));
  let currency = null;
  PURCHASE_PRICE_CURRENCIES.forEach((c) => {
    if ((counts.get(c) || 0) > (counts.get(currency) || 0)) currency = c;
  });
  let best = null;
  pool.filter((g) => g.purchasePrice.currency === currency).forEach((g) => {
    const n = plays.get(g.id);
    const a = g.purchasePrice.amount;
    if (!best) { best = { amount: a, plays: n, games: [g] }; return; }
    const cmp = a * best.plays - best.amount * n; // a/n vs best.amount/best.plays
    if (cmp < 0) best = { amount: a, plays: n, games: [g] };
    else if (cmp === 0) best.games.push(g);
  });
  return { currency, cents: best.amount / best.plays, games: best.games };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PURCHASE_PRICE_CURRENCIES, PURCHASE_PRICE_MAX_CENTS, BEST_BUY_MIN_PLAYS,
    isValidPurchasePrice, parsePurchaseAmount, costPerPlay, bestBuy,
  };
}
