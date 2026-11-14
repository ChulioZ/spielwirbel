'use strict';

/*
 * Session photos (issue #1774) — an index, no schema change.
 *
 * The photo is a key inside the session's JSONB blob (`data.photo`, a
 * '/uploads/<key>' path), like every other session field, so storing it needs
 * no migration at all. What does need one is the READ: /uploads answers "whose
 * object is this?" on every image GET (lib/upload-access.js → findImageOwner),
 * and a photo's owner is found by matching that path against every session on
 * the instance. Without an index that is a sequential scan of `sessions` per
 * uncached photo request; with this partial expression index it is one probe,
 * and the index holds only the sessions that actually carry a photo.
 *
 * Purely additive, so nothing here runs into FORCE RLS
 * (.claude/rules/rls-blocks-data-migrations.md).
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE INDEX IF NOT EXISTS sessions_photo_idx ON sessions ((data->>'photo'))
  WHERE data->>'photo' IS NOT NULL;
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS sessions_photo_idx');
};
