# Any row deletion that can hold a cover must hand the image paths back (#280)

A cover object's storage key exists in exactly **one** place: the `image` field
of the row that references it. `save()` returns `/uploads/<key>` and nothing else
records it — there is no index, no listing, no reverse lookup. So the moment a
row is deleted, its object becomes **unreachable forever**: on disk it is a file
nothing links to, on S3/R2 a billable object no code path can ever name again.

**Rule:** a repo method that deletes rows which may carry an `image` must collect
those paths **before** deleting and return them to the route, which then removes
the objects. The route — never the repo — touches storage.

This is the shape `deleteGame` (`{ image }`), `setBackground` (`{ previous }`),
`eraseAccount` (`{ images }`) and, since #280, `deleteRound` (`{ images }`) all
use. `deleteRound` is the one that got it wrong: it returned a bare boolean, the
games cascaded away with the round (`ON DELETE CASCADE` in Postgres, a plain
`splice` in JSON), and every cover of every deleted round was orphaned. It looked
correct because the *rows* were gone — the leak is invisible from the app.

Three things that are easy to get wrong when adding such a path:

- **Collect inside the same transaction, before the delete.** In Postgres the
  children are already gone by the time the `del()` resolves, so a read afterwards
  returns nothing and silently reports zero images. Await the SELECT then the
  DELETE sequentially — one transaction is one connection (see
  `postgres-backend.md`).
- **Dedupe, then guard with `isImageReferenced` at the route.** `createRound`'s
  `importFromRoundId` copies the cover *path*, not the file, so one object can be
  referenced by several games and several rounds. Deleting a round whose cover an
  imported round still shows would blank a cover that is still in use.
- **Return `null` for not-found, not `false`.** An object return has to stay
  distinguishable from "no such row"; `if (!deleted)` on a `{ images: [] }` is
  fine but brittle — routes check `=== null`, matching `deleteGame`.

Note the two shapes of `game.image` do **not** need a check at the call site:
`storage.remove()` ignores anything that isn't a `/uploads/` path, which is what
keeps hotlinked provider covers (#172) safe by construction — see
`.claude/rules/provider-cover-hotlinking.md`.

**Out of scope of #280:** objects already orphaned by past round deletions. A
sweeper would need to list the bucket and diff it against every referenced path;
worth its own issue only if the bucket turns out to hold a meaningful number.
