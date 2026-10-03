---
paths:
  - "public/js/guide-paths.js"
  - "lib/guide.js"
  - "lib/routes/guide.js"
  - "public/sitemap.xml"
---
# A non-ASCII path arrives PERCENT-ENCODED — compare the encoded form, everywhere

The Korean guide slug (#1171) is Hangul: `/ko/오늘-무슨-보드게임-할까`. Every
consumer that is not a human reading an address bar sees it encoded instead,
and a lookup written against the decoded string matches nothing — the request
falls through to the SPA and answers **200 with the app shell**, so the page
looks served and is not.

| Where | What it holds |
|---|---|
| `req.path` in Express | `/ko/%EC%98%A4%EB%8A%98-…` (encoded, uppercase hex) |
| a sitemap `<loc>` | must be encoded (the protocol requires escaped URLs) |
| `<link rel="canonical">` / `hreflang` | encoded, so they equal the sitemap entry byte for byte |
| an `<a href>` in the SPA | either works — the browser encodes before sending |

So `lib/guide.js` keeps ONE derived form, `encodedGuidePath(code) =
encodeURI(guidePath(code))`, and the router, the limiter's exempt set, the
canonical, the hreflang set and the sitemap expectation all use exactly that.
The decoded `guidePath()` is for display and for the client's links.

## Two things that cost a cycle while testing it

- **supertest encodes the path for you.** `request(app).get('/ko/오늘-…')` sends
  the encoded form, so a "the raw Hangul request must miss" assertion is
  untestable this way and fails for the opposite reason. Test the encoded path
  with `encodeURI(…)`, which is what a browser sends.
- **A malformed escape is ALREADY a 400 here, before any router of ours.**
  `express.static` (via `send`) decodes the path and answers 400 on
  `/round/%E0%A4%A`. A first draft of the guide router claimed to be avoiding
  that 400 — the SPA fallback never answered it. Check the baseline before
  crediting a design with preserving it.

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (why the slug
table is one file), `.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md`
§2 (the SPA fallback answering 200 for anything it does not recognise).
