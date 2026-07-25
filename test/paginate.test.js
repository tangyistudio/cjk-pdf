import test from 'node:test';
import assert from 'node:assert/strict';

import { planPages, planFit, estimatePageCount } from '../src/paginate.js';

// A4 in millimetres.
const A4 = { pageWidth: 210, pageHeight: 297 };

// A 700 px wide canvas maps to 210 mm at exactly 0.3 mm per pixel, which makes
// one page exactly 990 px tall. Using round numbers keeps the assertions about
// the algorithm rather than about floating point.
const EXACT_WIDTH = 700;
const EXACT_PAGE_PX = 990;

test('a single-page canvas produces exactly one page', () => {
  const plan = planPages({
    canvasWidth: EXACT_WIDTH,
    canvasHeight: EXACT_PAGE_PX,
    ...A4,
  });

  assert.equal(plan.mode, 'slice');
  assert.equal(plan.pageCount, 1);
  assert.equal(plan.mmPerPx, 0.3);

  const [page] = plan.pages;
  assert.deepEqual(page, {
    index: 0,
    sourceY: 0,
    sourceHeight: 990,
    x: 0,
    y: 0,
    width: 210,
    height: 297,
  });
});

test('the canonical 794 x 1123 A4 canvas does not spill a sliver page', () => {
  // 1123 px is the *rounded* pixel height of 297 mm, so the naive ceil() adds
  // a second page 0.06 px tall. It must not.
  const plan = planPages({ canvasWidth: 794, canvasHeight: 1123, ...A4 });
  assert.equal(plan.pageCount, 1);
  assert.equal(plan.pages[0].sourceHeight, 1123);
  assert.equal(plan.pages[0].height, 297, 'clamped to the printable height');
});

test('an exact multiple splits into whole pages with no trailing blank', () => {
  const plan = planPages({
    canvasWidth: EXACT_WIDTH,
    canvasHeight: EXACT_PAGE_PX * 2,
    ...A4,
  });

  assert.equal(plan.pageCount, 2);
  assert.equal(plan.pages[0].sourceY, 0);
  assert.equal(plan.pages[0].sourceHeight, 990);
  assert.equal(plan.pages[1].sourceY, 990);
  assert.equal(plan.pages[1].sourceHeight, 990);
  for (const page of plan.pages) {
    assert.equal(page.height, 297);
  }
});

test('a partial final page keeps its real height instead of stretching', () => {
  const plan = planPages({
    canvasWidth: EXACT_WIDTH,
    canvasHeight: 1500,
    ...A4,
  });

  assert.equal(plan.pageCount, 2);
  assert.equal(plan.pages[1].sourceY, 990);
  assert.equal(plan.pages[1].sourceHeight, 510);
  assert.equal(plan.pages[1].height, 153); // 510 px * 0.3 mm/px
  assert.ok(plan.pages[1].height < plan.pages[0].height);
});

test('slices cover the canvas exactly once, with no gaps or overlaps', () => {
  for (const canvasHeight of [500, 990, 991, 1500, 5000, 7777]) {
    const plan = planPages({ canvasWidth: EXACT_WIDTH, canvasHeight, ...A4 });
    let cursor = 0;
    for (const page of plan.pages) {
      assert.ok(
        Math.abs(page.sourceY - cursor) < 0.001,
        `slice starts where the previous ended (height ${canvasHeight})`
      );
      cursor += page.sourceHeight;
    }
    assert.ok(
      Math.abs(cursor - canvasHeight) < 0.001,
      `slices sum to the canvas height (height ${canvasHeight})`
    );
  }
});

test('no page is ever drawn taller than the printable area', () => {
  for (const canvasHeight of [10, 989, 990, 991, 3333]) {
    const plan = planPages({ canvasWidth: EXACT_WIDTH, canvasHeight, ...A4, margin: 12 });
    for (const page of plan.pages) {
      assert.ok(page.height <= plan.contentHeight + 1e-6);
      assert.ok(page.width <= plan.contentWidth + 1e-6);
    }
  }
});

test('margins shrink the printable box and offset every page', () => {
  const plan = planPages({
    canvasWidth: EXACT_WIDTH,
    canvasHeight: 2000,
    ...A4,
    margin: 10,
  });

  assert.equal(plan.contentWidth, 190);
  assert.equal(plan.contentHeight, 277);
  for (const page of plan.pages) {
    assert.equal(page.x, 10);
    assert.equal(page.y, 10);
    assert.equal(page.width, 190);
  }
});

test('a wide canvas in fit mode is centred vertically', () => {
  const plan = planPages({
    canvasWidth: 1000,
    canvasHeight: 500,
    ...A4,
    mode: 'fit',
  });

  assert.equal(plan.mode, 'fit');
  assert.equal(plan.pageCount, 1);

  const [page] = plan.pages;
  assert.equal(page.width, 210);
  assert.equal(page.height, 105);
  assert.equal(page.x, 0);
  assert.equal(page.y, 96); // (297 - 105) / 2
});

test('a tall canvas in fit mode is centred horizontally and never overflows', () => {
  const plan = planPages({
    canvasWidth: 500,
    canvasHeight: 2000,
    ...A4,
    mode: 'fit',
  });

  const [page] = plan.pages;
  assert.ok(page.height <= 297 + 1e-6);
  assert.ok(page.width <= 210 + 1e-6);
  assert.ok(page.x > 0, 'letterboxed on the left');
  assert.ok(Math.abs(page.x * 2 + page.width - 210) < 0.001, 'horizontally centred');
});

test('fit mode never enlarges beyond the printable box with margins', () => {
  const plan = planFit({
    canvasWidth: 794,
    canvasHeight: 1123,
    contentWidth: 190,
    contentHeight: 277,
    margin: 10,
  });

  const [page] = plan.pages;
  assert.ok(page.width <= 190 + 1e-6);
  assert.ok(page.height <= 277 + 1e-6);
  assert.ok(page.x >= 10 - 1e-6);
  assert.ok(page.y >= 10 - 1e-6);
});

test('estimatePageCount agrees with planPages', () => {
  const input = { canvasWidth: EXACT_WIDTH, canvasHeight: 4000, ...A4 };
  assert.equal(estimatePageCount(input), planPages(input).pageCount);
});

test('the raster scale does not change the page count or layout', () => {
  // A 2x render is four times the pixels but must produce the same document.
  const at1x = planPages({ canvasWidth: EXACT_WIDTH, canvasHeight: 2500, ...A4 });
  const at2x = planPages({ canvasWidth: EXACT_WIDTH * 2, canvasHeight: 5000, ...A4 });
  assert.equal(at1x.pageCount, at2x.pageCount);
  assert.deepEqual(
    at1x.pages.map((p) => [p.x, p.y, p.width, p.height]),
    at2x.pages.map((p) => [p.x, p.y, p.width, p.height])
  );
});

test('landscape pages are handled by swapping the inputs', () => {
  const plan = planPages({
    canvasWidth: 1123,
    canvasHeight: 794,
    pageWidth: 297,
    pageHeight: 210,
  });
  assert.equal(plan.pageCount, 1);
  assert.equal(plan.contentWidth, 297);
});

test('invalid dimensions are rejected', () => {
  assert.throws(() => planPages({ canvasWidth: 0, canvasHeight: 100, ...A4 }), TypeError);
  assert.throws(() => planPages({ canvasWidth: 100, canvasHeight: -1, ...A4 }), TypeError);
  assert.throws(
    () => planPages({ canvasWidth: 100, canvasHeight: 100, pageWidth: 210, pageHeight: NaN }),
    TypeError
  );
  assert.throws(
    () => planPages({ canvasWidth: 100, canvasHeight: 100, ...A4, margin: -5 }),
    TypeError
  );
});

test('an unknown mode is rejected', () => {
  assert.throws(
    () => planPages({ canvasWidth: 100, canvasHeight: 100, ...A4, mode: 'squish' }),
    /Unknown mode/
  );
});

test('a margin that swallows the page is rejected', () => {
  assert.throws(
    () => planPages({ canvasWidth: 100, canvasHeight: 100, ...A4, margin: 150 }),
    RangeError
  );
});
