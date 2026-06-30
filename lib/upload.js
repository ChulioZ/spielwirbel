'use strict';

/* Image upload (multer): stores cover images as files under data/uploads/. */

const multer = require('multer');
const path = require('path');
const { UPLOAD_DIR, id } = require('./store');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, id() + ext);
  },
});

module.exports = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB is plenty for a cover
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});
