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

/**
 * CSS font stacks that actually resolve to a CJK face on the machines your
 * users have.
 *
 * The browser does the shaping, so the export is only as good as the fonts the
 * rendering machine owns. A stack of `sans-serif` alone gets you whatever the
 * system picked as its default — frequently a Latin face with a fallback that
 * renders Traditional Chinese with Simplified glyph shapes, or nothing at all.
 *
 * Each stack is ordered the same way, and the order is the point:
 *
 *   1. **Noto Sans TC/SC/JP/KR** — the webfont. If you loaded one, it wins, and
 *      the output is identical on every machine. If you did not, the name
 *      simply does not match and the browser moves on.
 *   2. **The modern Apple face** — PingFang (macOS 10.11+/iOS 9+), Hiragino
 *      Sans, Apple SD Gothic Neo. Present on every current Mac and iPhone.
 *   3. **The modern Microsoft face** — Microsoft JhengHei / YaHei, Yu Gothic,
 *      Malgun Gothic. Present on every current Windows install.
 *   4. **A legacy fallback** — Heiti (pre-10.11 macOS and old iOS), Hiragino
 *      Kaku Gothic ProN, Meiryo, Nanum Gothic. Cheap insurance.
 *   5. `sans-serif`.
 *
 * Do not concatenate two of these into one stack. Han unification means one
 * codepoint is drawn differently by region — 骨, 直 and 令 are the textbook
 * cases — and a Simplified or Japanese font will happily render a Traditional
 * document in its own shapes. Whichever font comes first wins for the entire
 * document, so a merged stack silently gives one of your audiences the wrong
 * glyph forms. Pick the stack for the language of the page.
 *
 * @type {Readonly<Record<'zhTW'|'zhCN'|'ja'|'ko', string>>}
 */
export const CJK_FONT_STACKS = Object.freeze({
  /** Traditional Chinese — Taiwan, Hong Kong, Macau. */
  zhTW: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', 'Heiti TC', sans-serif",
  /** Simplified Chinese — mainland China, Singapore. */
  zhCN: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Heiti SC', sans-serif",
  /** Japanese. */
  ja: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif",
  /** Korean. */
  ko: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Nanum Gothic', sans-serif",
});

/** BCP 47-ish tags and loose aliases mapped onto a `CJK_FONT_STACKS` key. */
const FONT_STACK_ALIASES = Object.freeze({
  zhtw: 'zhTW',
  zhhant: 'zhTW',
  zhhanttw: 'zhTW',
  zhhk: 'zhTW',
  zhmo: 'zhTW',
  zhhanthk: 'zhTW',
  tw: 'zhTW',
  hant: 'zhTW',
  zhcn: 'zhCN',
  zhhans: 'zhCN',
  zhhanscn: 'zhCN',
  zhsg: 'zhCN',
  zh: 'zhCN',
  cn: 'zhCN',
  hans: 'zhCN',
  ja: 'ja',
  jajp: 'ja',
  jp: 'ja',
  jpn: 'ja',
  ko: 'ko',
  kokr: 'ko',
  kr: 'ko',
  kor: 'ko',
});

/**
 * Look up a font stack by language tag.
 *
 * Bare `zh` resolves to Simplified Chinese, matching the CLDR default for the
 * undifferentiated tag. If you mean Traditional, say `zh-TW` or `zh-Hant` —
 * this is exactly the ambiguity that ships wrong glyph shapes, so it is worth
 * being explicit in your own code.
 *
 * @param {string} lang A tag like `'zh-TW'`, `'zh-Hant'`, `'ja'`, `'ko-KR'`,
 *   or a `CJK_FONT_STACKS` key.
 * @returns {string} A CSS `font-family` value.
 * @throws {TypeError} When the tag is not a CJK language this module knows.
 *
 * @example
 * await htmlToPDF(markup, { fontFamily: fontStackFor(document.documentElement.lang) });
 */
export function fontStackFor(lang) {
  const key = FONT_STACK_ALIASES[normalizeName(lang)];
  if (!key) {
    throw new TypeError(
      `No CJK font stack for "${lang}". Expected a Chinese, Japanese or Korean ` +
        `language tag (e.g. zh-TW, zh-CN, ja, ko), or one of: ` +
        `${Object.keys(CJK_FONT_STACKS).join(', ')}.`
    );
  }
  return CJK_FONT_STACKS[key];
}

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
