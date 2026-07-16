'use strict';

/*
 * Cover-image storage — picks the backend once, at require time (issue #128),
 * mirroring lib/repo/index.js.
 *
 *   S3_BUCKET set -> ./s3.js   (S3-compatible object storage; the stateless
 *                               app-tier path for a hosted deployment)
 *   otherwise     -> ./disk.js (the default: files under DATA_DIR/uploads)
 *
 * Both expose the same tiny contract — async save(buffer, ext) -> '/uploads/<key>',
 * async remove(publicPath), and an Express `serve` handler mounted at /uploads —
 * so nothing else in the app changes when the backend does. The default stays
 * local disk, so local dev, existing installs, and the test suite need no S3 (and
 * the @aws-sdk/client-s3 dependency is only loaded when S3 is configured).
 */

module.exports = process.env.S3_BUCKET ? require('./s3')() : require('./disk');
