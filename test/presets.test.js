import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CSS_DPI,
  MM_PER_INCH,
  PAGE_SIZES,
  SCALE_PRESETS,
  mmToPx,
  pxToMm,
  resolvePageSize,
  resolveScale,
  scaleForDpi,
} from '../src/presets.js';

test('the CSS pixel is one ninety-sixth of an inch', () => {
  assert.equal(CSS_DPI, 96);
  assert.equal(MM_PER_INCH, 25.4);
  assert.equal(mmToPx(25.4), 96);
  assert.equal(pxToMm(96), 25.4);
});

test('mm and px conversions round-trip', () => {
  for (const mm of [1, 10, 210, 297, 431.8]) {
    assert.ok(Math.abs(pxToMm(mmToPx(mm)) - mm) < 1e-9);
  }
});

test('A4 portrait is the canonical 794 x 1123 CSS pixel box', () => {
  const page = resolvePageSize('a4', 'portrait');
  assert.equal(page.width, 210);
  assert.equal(page.height, 297);
  assert.equal(page.widthPx, 794);
  assert.equal(page.heightPx, 1123);
  assert.equal(page.dpi, 96);
});

test('landscape swaps both the mm and the px dimensions', () => {
  const page = resolvePageSize('a4', 'landscape');
  assert.equal(page.width, 297);
  assert.equal(page.height, 210);
  assert.equal(page.widthPx, 1123);
  assert.equal(page.heightPx, 794);
});

test('Letter resolves to 816 x 1056 CSS pixels', () => {
  const page = resolvePageSize('letter');
  assert.equal(page.widthPx, 816);
  assert.equal(page.heightPx, 1056);
});

test('preset names ignore case, spaces and hyphens', () => {
  const expected = resolvePageSize('a4');
  for (const alias of ['A4', ' a 4 ', 'A-4', 'a_4']) {
    assert.deepEqual(resolvePageSize(alias), expected);
  }
});

test('a higher DPI produces a proportionally larger pixel box', () => {
  const page = resolvePageSize('a4', 'portrait', 192);
  assert.equal(page.widthPx, 1587);
  assert.equal(page.heightPx, 2245);
  assert.equal(page.width, 210, 'millimetres are unaffected by DPI');
});

test('explicit millimetre dimensions are accepted', () => {
  const page = resolvePageSize({ width: 100, height: 200 }, 'portrait');
  assert.equal(page.name, 'custom');
  assert.equal(page.width, 100);
  assert.equal(page.height, 200);

  const rotated = resolvePageSize({ width: 100, height: 200 }, 'landscape');
  assert.equal(rotated.width, 200);
  assert.equal(rotated.height, 100);
});

test('an already-landscape custom size stays landscape', () => {
  const page = resolvePageSize({ width: 300, height: 100 }, 'landscape');
  assert.equal(page.width, 300);
  assert.equal(page.height, 100);
});

test('every built-in preset is defined portrait-first', () => {
  for (const [name, size] of Object.entries(PAGE_SIZES)) {
    assert.ok(size.width <= size.height, `${name} should be stored portrait-first`);
  }
});

test('unknown page sizes and orientations are rejected', () => {
  assert.throws(() => resolvePageSize('a9'), /Unknown page size/);
  assert.throws(() => resolvePageSize('a4', 'sideways'), /Unknown orientation/);
  assert.throws(() => resolvePageSize(null), TypeError);
  assert.throws(() => resolvePageSize({ width: 0, height: 10 }), TypeError);
});

test('scale accepts numbers and named presets', () => {
  assert.equal(resolveScale(2), 2);
  assert.equal(resolveScale('print'), SCALE_PRESETS.print);
  assert.equal(resolveScale('screen'), 1);
  assert.equal(resolveScale('HIGH'), 3);
  assert.throws(() => resolveScale('ultra'), /Unknown scale/);
  assert.throws(() => resolveScale(0), TypeError);
});

test('scaleForDpi maps a target DPI onto an html2canvas scale', () => {
  assert.equal(scaleForDpi(96), 1);
  assert.equal(scaleForDpi(192), 2);
  assert.equal(scaleForDpi(300), 3.125);
});
