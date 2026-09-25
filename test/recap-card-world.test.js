'use strict';

/* The shared recap card wears the world's scene (#1083).
 *
 * The card is the one world surface that LEAVES the app — a PNG someone posts
 * into a chat — and until now it carried the backdrop at .09 and the button
 * frame, i.e. the two quietest marks a world has. It now grows a band along its
 * foot and paints the world's scene into it at the empty state's bold alpha.
 *
 * ## Why these specs stub two things, and why that is not a weakened test
 *
 * jsdom has no 2d canvas: `getContext('2d')` answers null, so `recapTint` — the
 * one function here that needs a real one — cannot run. It is a top-level
 * function declaration, hence reachable through the harness's `set()` seam
 * (`.claude/rules/testing-views-under-jsdom.md`), and stubbing it lets
 * `drawRecapCard` run end to end against a recording context. What is under test
 * is the GEOMETRY — where the band goes, how tall it is, and what moves up out of
 * it — which is exactly what the recorder can see and what a browser screenshot
 * cannot assert. The tint's own compositing is browser-verified, per #800's
 * constraint 3.
 *
 * `Image` is stubbed for the same reason: `recapWorldMask` decodes a data URI,
 * and jsdom loads no images. The stub resolves the moment a src is assigned, so
 * what the spec proves is the token plumbing and the URI regex — the scene art
 * is full of SVG `transform` parentheses, which is the one thing that regex is
 * written to survive.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

// A period model with no optional blocks, so the height is the base card and any
// growth in it is the band and nothing else.
const MODEL = { heading: 'Freitagsrunde', periodLabel: 'August 2026', sessions: 4, gamesPlayed: 7 };

/* A recording 2d context. Every method drawRecapCard reaches for, and nothing
   more — an unexpected call throws by name rather than being silently absorbed,
   which is what keeps this from drifting into a stub that agrees with anything. */
function recorder() {
  const calls = { drawImage: [], fillText: [], fillRect: [] };
  const ctx = {
    calls,
    globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() {}, roundRect() {}, fill() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (s) => ({ width: String(s).length * 7 }),
    fillRect: (...a) => calls.fillRect.push(a),
    fillText(text, x, y) { calls.fillText.push({ text, x, y }); },
    drawImage(img, x, y, w, h) { calls.drawImage.push({ img, x, y, w, h }); },
  };
  return ctx;
}

const boot = () => {
  const dom = loadApp();
  // The tint needs a 2d canvas jsdom does not have; hand back what it was asked
  // to paint so the geometry stays observable.
  dom.set('recapTint', (mask, w, h) => ({ tint: mask, w, h }));
  return dom;
};

test('a world grows the card by the scene band; a palette round is unchanged', () => {
  const dom = boot();
  const base = dom.call('recapCardHeight', MODEL);
  const withScene = dom.call('recapCardHeight', MODEL, { scene: true });
  const bandH = dom.get('RECAP_CARD_SCENE_H');
  const W = dom.get('RECAP_CARD_W');
  // The art is 600x120 drawn the card's full width, so the band is the width's
  // fifth. Derived here too — a literal on both sides could agree while both are
  // wrong, and the squashed scene it would produce fails no other assertion.
  assert.equal(bandH, W / 5);
  assert.equal(withScene - base, bandH, 'the card must GROW by the band, not fit it in');
  assert.equal(dom.call('recapCardHeight', MODEL, null), base, 'a palette round must not grow');
  dom.close();
});

test('the scene is painted in that band at the foot, full width, at the bold alpha', () => {
  const dom = boot();
  const W = dom.get('RECAP_CARD_W');
  const bandH = dom.get('RECAP_CARD_SCENE_H');
  const height = dom.call('recapCardHeight', MODEL, { scene: true });
  const ctx = recorder();
  dom.call('drawRecapCard', ctx, MODEL, height, { scene: { id: 'scene' }, scale: 2 });

  const band = ctx.calls.drawImage.find((d) => d.img && d.img.tint && d.img.tint.id === 'scene');
  assert.ok(band, 'the world scene is never drawn');
  assert.equal(band.x, 0);
  assert.equal(band.w, W, 'the scene must span the card');
  assert.equal(band.h, bandH);
  assert.equal(band.y, height - bandH, 'the band must sit at the very foot of the card');
  // The tint is rendered at the band's own size, not stretched into it afterwards.
  assert.equal(band.img.h, bandH, 'the scene is tinted at the wrong height, so it paints squashed');
  dom.close();
});

test('the band is text-free: the wordmark and the frame corner move up out of it', () => {
  /* This is the whole licence for the bold .36 — the same bargain slot 5 makes
     on screen. A card that grew by the band and then kept drawing its foot at
     `height` would put „Spielwirbel" on top of the scene, which is the one
     failure the geometry above cannot see on its own. */
  const dom = boot();
  const bandH = dom.get('RECAP_CARD_SCENE_H');
  const height = dom.call('recapCardHeight', MODEL, { scene: true });
  const ctx = recorder();
  dom.call('drawRecapCard', ctx, MODEL, height, { scene: { id: 'scene' }, frame: { id: 'frame' }, scale: 2 });

  const foot = height - bandH;
  const wordmark = ctx.calls.fillText.find((f) => f.text === 'Spielwirbel');
  assert.ok(wordmark, 'the wordmark is gone');
  assert.ok(wordmark.y <= foot, `the wordmark sits at ${wordmark.y}, on the band that starts at ${foot}`);
  for (const f of ctx.calls.fillText) {
    assert.ok(f.y <= foot, `"${f.text}" is drawn at ${f.y}, on the scene band starting at ${foot}`);
  }
  dom.close();
});

test('a palette round draws no band, and its foot is where it always was', () => {
  /* The control. Without it every assertion above is satisfied by a card that
     grew and shifted unconditionally — which would move the wordmark of the
     overwhelming majority of cards, none of which have a scene to make room for. */
  const dom = boot();
  const height = dom.call('recapCardHeight', MODEL, null);
  const ctx = recorder();
  dom.call('drawRecapCard', ctx, MODEL, height, { frame: { id: 'frame' }, scale: 2 });

  assert.equal(ctx.calls.drawImage.filter((d) => d.h === dom.get('RECAP_CARD_SCENE_H')).length, 0,
    'a palette round paints a scene band');
  const wordmark = ctx.calls.fillText.find((f) => f.text === 'Spielwirbel');
  assert.equal(wordmark.y, height - dom.get('RECAP_CARD_PAD'));
  dom.close();
});

test('the scene mask is read off the world token, parentheses and all', () => {
  const dom = boot();
  // Resolves as soon as a src is assigned: recapWorldMask sets onload first.
  dom.set('Image', class {
    set src(v) { this._src = v; Promise.resolve().then(() => this.onload && this.onload()); }
    get src() { return this._src; }
  });
  // The shape the registry actually declares — a transform with parentheses
  // inside single quotes, inside a double-quoted url(). A regex ending at the
  // first ')' returns null here and the card silently loses its scene.
  const uri = "url(\"data:image/svg+xml,%3Csvg%3E%3Cpath transform='rotate(-45 11 11)'/%3E%3C/svg%3E\")";
  dom.run(`document.documentElement.style.setProperty('--world-scene', ${JSON.stringify(uri)})`);

  return dom.call('recapWorldMask', '--world-scene').then((img) => {
    assert.ok(img, 'the scene token did not decode — the card falls back to no scene');
    assert.match(img.src, /^data:image\/svg\+xml,/);
    assert.match(img.src, /rotate\(-45 11 11\)/, 'the URI was cut at the first parenthesis');
    return dom.call('recapWorldMask', '--world-stage').then((none) => {
      assert.equal(none, null, 'an undeclared token must resolve to null, not to a broken Image');
      dom.close();
    });
  });
});
