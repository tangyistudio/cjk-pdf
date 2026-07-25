/**
 * Page size and resolution presets.
 *
 * Everything in this module is pure: no DOM, no side effects. Page dimensions
 * are stored in millimetres (the unit jsPDF works in) and converted to CSS
 * pixels on demand, because html2canvas measures the DOM in CSS pixels.
 *
 * The CSS pixel is defined as 1/96 inch, so A4 (210 x 297 mm) is
 * 794 x 1123 CSS px. That is the magic number you see hard coded in every
 * "export my HTML to PDF" snippet on the internet.
 */

/** Millimetres per inch. */
export const MM_PER_INCH = 25.4;

/** CSS pixels per inch, per the CSS spec. */
export const CSS_DPI = 96;

/**
 * Named page sizes, in millimetres, portrait orientation.
 * @type {Readonly<Record<string, { width: number, height: number }>>}
 */
export const PAGE_SIZES = Object.freeze({
  a3: { width: 297, height: 420 },
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  a6: { width: 105, height: 148 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
  tabloid: { width: 279.4, height: 431.8 },
});

/** Supported orientations. */
export const ORIENTATIONS = Object.freeze(['portrait', 'landscape']);

/**
 * html2canvas `scale` presets. `scale` is a device-pixel multiplier: the
 * rasterised canvas is `scale` times larger than the CSS layout, so memory
 * cost grows with the square of this value.
 */
export const SCALE_PRESETS = Object.freeze({
  screen: 1, // 96 DPI  - fastest, visibly soft when printed
  print: 2, // 192 DPI - the sane default
  high: 3, // 288 DPI - large files, use for small pages only
});

/** Convert millimetres to CSS pixels at the given DPI. */
export function mmToPx(mm, dpi = CSS_DPI) {
  assertPositive(mm, 'mm');
  assertPositive(dpi, 'dpi');
  return (mm / MM_PER_INCH) * dpi;
}

/** Convert CSS pixels to millimetres at the given DPI. */
export function pxToMm(px, dpi = CSS_DPI) {
  assertPositive(px, 'px');
  assertPositive(dpi, 'dpi');
  return (px / dpi) * MM_PER_INCH;
}

/**
 * Translate a target output DPI into an html2canvas `scale` value.
 *
 * @example scaleForDpi(300) // => 3.125
 */
export function scaleForDpi(dpi, baseDpi = CSS_DPI) {
  assertPositive(dpi, 'dpi');
  assertPositive(baseDpi, 'baseDpi');
  return dpi / baseDpi;
}

/**
 * Resolve a page size descriptor into concrete dimensions.
 *
 * @param {string | { width: number, height: number }} [size='a4']
 *   A preset name (case and hyphen insensitive) or an explicit `{ width,
 *   height }` pair in millimetres.
 * @param {'portrait' | 'landscape'} [orientation='portrait']
 * @param {number} [dpi=96] DPI used for the CSS pixel conversion.
 * @returns {{
 *   name: string,
 *   orientation: string,
 *   width: number,
 *   height: number,
 *   widthPx: number,
 *   heightPx: number,
 *   dpi: number
 * }} Width/height in mm, widthPx/heightPx in CSS pixels.
 */
export function resolvePageSize(size = 'a4', orientation = 'portrait', dpi = CSS_DPI) {
  if (!ORIENTATIONS.includes(orientation)) {
    throw new TypeError(
      `Unknown orientation "${orientation}". Expected one of: ${ORIENTATIONS.join(', ')}`
    );
  }

  let name = 'custom';
  let base;

  if (typeof size === 'string') {
    name = normalizeName(size);
    base = PAGE_SIZES[name];
    if (!base) {
      throw new TypeError(
        `Unknown page size "${size}". Expected one of: ${Object.keys(PAGE_SIZES).join(', ')}, ` +
          'or an explicit { width, height } object in millimetres.'
      );
    }
  } else if (size && typeof size === 'object') {
    assertPositive(size.width, 'size.width');
    assertPositive(size.height, 'size.height');
    base = { width: size.width, height: size.height };
  } else {
    throw new TypeError('size must be a preset name or a { width, height } object.');
  }

  const portrait = base.width <= base.height;
  const wantsPortrait = orientation === 'portrait';
  const width = portrait === wantsPortrait ? base.width : base.height;
  const height = portrait === wantsPortrait ? base.height : base.width;

  return {
    name,
    orientation,
    width,
    height,
    widthPx: Math.round(mmToPx(width, dpi)),
    heightPx: Math.round(mmToPx(height, dpi)),
    dpi,
  };
}

/**
 * Resolve a scale value, accepting either a number or a `SCALE_PRESETS` key.
 */
export function resolveScale(scale = 'print') {
  if (typeof scale === 'number') {
    assertPositive(scale, 'scale');
    return scale;
  }
  const preset = SCALE_PRESETS[String(scale).toLowerCase()];
  if (!preset) {
    throw new TypeError(
      `Unknown scale "${scale}". Expected a positive number or one of: ` +
        Object.keys(SCALE_PRESETS).join(', ')
    );
  }
  return preset;
}

function normalizeName(value) {
  return String(value).toLowerCase().replace(/[\s_-]/g, '');
}

function assertPositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a finite positive number, received: ${value}`);
  }
}
