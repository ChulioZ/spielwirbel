'use strict';

/*
 * Real, decodable image fixtures for the upload specs.
 *
 * THE "DECODABLE" PART IS THE WHOLE POINT (#867). Until covers were re-encoded
 * server-side, an upload only had to satisfy the magic-byte sniff (#133), so
 * these fixtures were a valid signature followed by zero padding — bytes that
 * are not an image at all. saveUploadedImage now decodes and re-encodes, so
 * such a buffer is correctly refused with a 400, and every spec that used one
 * would fail for a reason that has nothing to do with what it is testing.
 *
 * They are 8x8 rather than 1x1 so a spec can tell "the stored object kept its
 * size" from "the ceiling clamped it" without building its own fixture.
 */

// 8x8 RGBA PNG, solid brand orange.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA'
  + 'EklEQVQYlWM45Mj9Hx9mGBkKAKHVg0Fi+lZ+AAAAAElFTkSuQmCC',
  'base64',
);

// 8x8 JPEG, same colour. Kept alongside the PNG because the stored extension
// must follow OUR encoder rather than the input type, and a spec proving that
// needs two different input formats to be convincing.
const JPEG_BYTES = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYn'
  + 'KSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo'
  + 'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAA'
  + 'AAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/'
  + 'xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCXACFPf//Z',
  'base64',
);

module.exports = { PNG_BYTES, JPEG_BYTES };
