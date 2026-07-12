# BoardGameGeek lookup: Cloudflare blocks datacenter IPs, and tests mock fetch

The add-game lookup (`lib/providers/bgg.js`, `routes/lookup.js`) calls the public
BGG XML API2 (`/xmlapi2/search`, `/xmlapi2/thing`) **server-side** — BGG sends no
CORS headers, so the browser can't call it directly.

**Gotcha:** from a sandbox / CI / cloud datacenter IP, BGG's Cloudflare returns
**HTTP 401 "Unauthorized. See …/using_the_xml_api"** even with a valid
User-Agent. This is IP-reputation bot-blocking, **not** a sign the API needs a
key or is unusable — it's public and free, and works fine from a residential
home network (where this app runs). Don't "fix" a 401 by swapping providers or
adding auth; it just can't be reached from here.

**Consequences for working on this feature:**

- You can't verify the live happy path from the sandbox. Verify the UI by
  temporarily stubbing `window.fetch` in the browser (a verification aid), or
  trust the tests. The graceful-degradation path *is* observable live: the real
  blocked call surfaces `lookup.error` ("BoardGameGeek nicht erreichbar").
- **Tests must never hit the network.** Unit-test the pure parsers
  (`parseSearch`/`parseThing`/`bucketDuration`, exported from `bgg.js`) directly,
  and for route/integration tests override the global `fetch`
  (`global.fetch = async () => ({ ok:true, text: async () => XML })`) and restore
  it in `afterEach`. The provider calls the global `fetch`, so this fully
  isolates it. See `test/providers-bgg.test.js`, `test/lookup.test.js`, and the
  cover-download tests in `test/games.test.js`.

**Cover downloads are host-allowlisted (SSRF guard):** `POST …/games` will only
download an `imageUrl` whose host a provider vouches for (`imageHostAllowed` /
`isAllowedImageUrl` — BGG's `geekdo-images.com`/`geekdo.com`/`boardgamegeek.com`).
Keep that guard when adding providers; don't fetch arbitrary client-supplied URLs.
