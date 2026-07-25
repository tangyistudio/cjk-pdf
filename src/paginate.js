/**
 * Multi-page slicing math.
 *
 * A single html2canvas render produces one tall canvas. To turn that into a
 * multi-page PDF you have to decide, for every page, which horizontal band of
 * the canvas goes where. This module does only that arithmetic — no DOM, no
 * jsPDF — so it can be unit tested with `node --test`.
 *
 * Two modes:
 *   - `slice` (default): scale the canvas to the content width, then cut it
 *     into page-height bands. Content taller than one page flows onto the next.
 *   - `fit`: shrink the whole canvas to fit inside one page and centre it.
 *     Use this when the source element is already laid out as a single page.
 */

/**
 * @typedef {object} PagePlacement
 * @property {number} index      Zero-based page index.
 * @property {number} sourceY    Top of the band, in canvas pixels.
 * @property {number} sourceHeight Height of the band, in canvas pixels.
 * @property {number} x          Left offset on the page, in mm.
 * @property {number} y          Top offset on the page, in mm.
 * @property {number} width      Drawn width on the page, in mm.
 * @property {number} height     Drawn height on the page, in mm.
 */

/**
 * @typedef {object} PagePlan
 * @property {'slice' | 'fit'} mode
 * @property {number} pageCount
 * @property {number} contentWidth   Printable width, in mm.
 * @property {number} contentHeight  Printable height, in mm.
 * @property {number} mmPerPx        Scale factor from canvas px to mm.
 * @property {PagePlacement[]} pages
 */

/** Tolerance used so floating point noise does not add a blank trailing page. */
const EPSILON = 1e-6;

/**
 * A leftover band this small (in canvas pixels) is folded into the previous
 * page instead of getting one of its own. Without it, the canonical A4 canvas
 * of 794 x 1123 px spills a 0.06 px tall second page, because 1123 is the
 * *rounded* pixel height of 297 mm.
 */
const REMAINDER_TOLERANCE_PX = 1;

/**
 * Build a page plan for one canvas.
 *
 * @param {object} input
 * @param {number} input.canvasWidth  Canvas width in pixels.
 * @param {number} input.canvasHeight Canvas height in pixels.
 * @param {number} input.pageWidth    Page width in mm.
 * @param {number} input.pageHeight   Page height in mm.
 * @param {number} [input.margin=0]   Uniform margin in mm.
 * @param {'slice' | 'fit'} [input.mode='slice']
 * @returns {PagePlan}
 */
export function planPages({
  canvasWidth,
  canvasHeight,
  pageWidth,
  pageHeight,
  margin = 0,
  mode = 'slice',
}) {
  assertPositive(canvasWidth, 'canvasWidth');
  assertPositive(canvasHeight, 'canvasHeight');
  assertPositive(pageWidth, 'pageWidth');
  assertPositive(pageHeight, 'pageHeight');
  assertNonNegative(margin, 'margin');

  if (mode !== 'slice' && mode !== 'fit') {
    throw new TypeError(`Unknown mode "${mode}". Expected "slice" or "fit".`);
  }

  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  if (contentWidth <= 0 || contentHeight <= 0) {
    throw new RangeError(
      `margin ${margin}mm leaves no printable area on a ${pageWidth}x${pageHeight}mm page.`
    );
  }

  if (mode === 'fit') {
    return planFit({ canvasWidth, canvasHeight, contentWidth, contentHeight, margin });
  }

  // Scale so the canvas exactly spans the printable width.
  const mmPerPx = contentWidth / canvasWidth;
  const sliceHeightPx = contentHeight / mmPerPx;
  const pageCount = Math.max(
    1,
    Math.ceil((canvasHeight - REMAINDER_TOLERANCE_PX) / sliceHeightPx - EPSILON)
  );

  const pages = [];
  for (let index = 0; index < pageCount; index += 1) {
    const sourceY = index * sliceHeightPx;
    const isLast = index === pageCount - 1;
    // The final page absorbs any sub-pixel remainder so the slices always add
    // up to the full canvas height with no dropped row.
    const sourceHeight = isLast ? canvasHeight - sourceY : sliceHeightPx;
    pages.push({
      index,
      sourceY: round(sourceY),
      sourceHeight: round(sourceHeight),
      x: round(margin),
      y: round(margin),
      width: round(contentWidth),
      height: round(Math.min(sourceHeight * mmPerPx, contentHeight)),
    });
  }

  return {
    mode: 'slice',
    pageCount,
    contentWidth: round(contentWidth),
    contentHeight: round(contentHeight),
    mmPerPx: round(mmPerPx, 10),
    pages,
  };
}

/**
 * Single page, contain-and-centre. Exposed separately because it is useful on
 * its own when you already render one element per page.
 */
export function planFit({ canvasWidth, canvasHeight, contentWidth, contentHeight, margin = 0 }) {
  assertPositive(canvasWidth, 'canvasWidth');
  assertPositive(canvasHeight, 'canvasHeight');
  assertPositive(contentWidth, 'contentWidth');
  assertPositive(contentHeight, 'contentHeight');

  const mmPerPx = Math.min(contentWidth / canvasWidth, contentHeight / canvasHeight);
  const width = canvasWidth * mmPerPx;
  const height = canvasHeight * mmPerPx;

  return {
    mode: 'fit',
    pageCount: 1,
    contentWidth: round(contentWidth),
    contentHeight: round(contentHeight),
    mmPerPx: round(mmPerPx, 10),
    pages: [
      {
        index: 0,
        sourceY: 0,
        sourceHeight: round(canvasHeight),
        x: round(margin + (contentWidth - width) / 2),
        y: round(margin + (contentHeight - height) / 2),
        width: round(width),
        height: round(height),
      },
    ],
  };
}

/**
 * How many pages a canvas of this size would need. Cheap enough to call in a
 * progress bar before rendering anything.
 */
export function estimatePageCount(input) {
  return planPages(input).pageCount;
}

/** Round to a fixed number of decimals so plans compare cleanly in tests. */
function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function assertPositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a finite positive number, received: ${value}`);
  }
}

function assertNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number, received: ${value}`);
  }
}
