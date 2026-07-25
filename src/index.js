/**
 * cjk-pdf — CJK-safe PDF export for the browser.
 *
 * jsPDF's built-in fonts are Latin-1 only, so `doc.text('中文')` renders tofu
 * boxes. Embedding a CJK font fixes the glyphs but adds 5-15 MB to your bundle.
 *
 * This library takes the other route: let the browser do what it is already
 * good at. Render your HTML to a canvas with html2canvas — native text shaping,
 * real system fonts, emoji, ruby, vertical writing, all of it — then drop that
 * canvas into the PDF with `addImage`. No font embedding, no server.
 *
 * Trade-off, stated plainly: the output is a raster image, so the text is not
 * selectable or searchable. If you need selectable CJK text, you must embed a
 * font. For invoices, reports, certificates and storybooks, this is the
 * pragmatic answer.
 *
 * @module cjk-pdf
 */

import {
  createOffscreenContainer,
  destroyContainer,
  renderToCanvas,
  resolveHtml2Canvas,
  sliceCanvas,
  settle,
  IGNORE_ATTRIBUTE,
} from './canvas.js';
import { inlineImages, waitForImages } from './images.js';
import { planPages } from './paginate.js';
import { resolvePageSize, resolveScale, mmToPx } from './presets.js';
import { addWatermark } from './watermark.js';

export {
  createOffscreenContainer,
  destroyContainer,
  renderToCanvas,
  sliceCanvas,
  clearOrphanContainers,
  resolveHtml2Canvas,
  settle,
  IGNORE_ATTRIBUTE,
} from './canvas.js';
export { escapeHtml } from './html.js';
export { inlineImages, urlToDataURL, blobToDataURL, waitForImages, isCrossOrigin } from './images.js';
export { planPages, planFit, estimatePageCount } from './paginate.js';
export {
  PAGE_SIZES,
  ORIENTATIONS,
  SCALE_PRESETS,
  CJK_FONT_STACKS,
  CSS_DPI,
  MM_PER_INCH,
  fontStackFor,
  resolvePageSize,
  resolveScale,
  mmToPx,
  pxToMm,
  scaleForDpi,
} from './presets.js';
export { addWatermark, clearWatermarks } from './watermark.js';

/**
 * @typedef {object} ExportOptions
 * @property {string} [filename='document.pdf'] Saved file name.
 * @property {'save'|'blob'|'dataurl'|'arraybuffer'|'doc'} [output='save']
 *   What to do with the finished document. `'save'` triggers a download.
 * @property {string|{width:number,height:number}} [pageSize='a4'] Preset name
 *   or explicit millimetre dimensions.
 * @property {'portrait'|'landscape'} [orientation='portrait']
 * @property {number} [margin=0] Uniform page margin in mm.
 * @property {number|'screen'|'print'|'high'} [scale='print'] Raster quality.
 *   `'print'` (2x) is the default; memory cost grows with the square.
 * @property {number} [dpi=96] DPI used when converting mm to CSS pixels.
 *   `htmlToPDF` only — it sizes the offscreen container your markup lays out
 *   in. `elementToPDF`/`elementsToPDF` receive an element that already has a
 *   layout and scale the capture by millimetres, so `dpi` has no effect there.
 *   Raster resolution is controlled by `scale` in all cases.
 * @property {'slice'|'fit'} [mode='slice'] `'slice'` flows tall content across
 *   pages; `'fit'` shrinks each element onto a single page.
 * @property {string|null} [background='#ffffff'] Canvas background colour.
 * @property {'JPEG'|'PNG'} [imageFormat='JPEG'] JPEG keeps files small; PNG is
 *   lossless and supports transparency.
 * @property {number} [imageQuality=0.92] JPEG quality, 0-1.
 * @property {boolean|object} [inlineImages=true] Convert cross-origin images to
 *   data URLs before capture. Pass an options object to configure it, or
 *   `false` to skip.
 * @property {number} [settleMs=50] How long to wait after the last DOM change
 *   before measuring, on top of two animation frames. Raise it (300-500) when
 *   capturing an element that is already on the page and may still be
 *   laying out — webfont swaps, lazy images, freshly expanded sections.
 * @property {import('./watermark.js').WatermarkOptions|null} [watermark=null]
 * @property {(progress: {phase: string, current: number, total: number}) => void} [onProgress]
 * @property {Function} [jsPDF] Explicit jsPDF constructor.
 * @property {Function} [html2canvas] Explicit html2canvas function.
 * @property {object} [html2canvasOptions] Passed through to html2canvas.
 */

/**
 * @typedef {object} ExportResult
 * @property {object} doc The jsPDF document instance.
 * @property {string} filename
 * @property {number} pageCount
 * @property {boolean} saved
 * @property {Blob} [blob]
 * @property {string} [dataUrl]
 * @property {ArrayBuffer} [arrayBuffer]
 * @property {Array<{url: string, error: string}>} imageFailures Images that
 *   could not be inlined. The export still succeeded.
 */

const DEFAULTS = {
  filename: 'document.pdf',
  output: 'save',
  pageSize: 'a4',
  orientation: 'portrait',
  margin: 0,
  scale: 'print',
  dpi: 96,
  mode: 'slice',
  background: '#ffffff',
  imageFormat: 'JPEG',
  imageQuality: 0.92,
  inlineImages: true,
  settleMs: 50,
  watermark: null,
  onProgress: null,
};

/**
 * Export a single DOM element to PDF.
 *
 * @param {Element} element
 * @param {ExportOptions} [options]
 * @returns {Promise<ExportResult>}
 *
 * @example
 * await elementToPDF(document.querySelector('#invoice'), {
 *   filename: '發票.pdf',
 * });
 */
export function elementToPDF(element, options = {}) {
  if (!element || typeof element.querySelectorAll !== 'function') {
    throw new TypeError('elementToPDF expects a DOM Element.');
  }
  return elementsToPDF([element], options);
}

/**
 * Export several elements into one PDF. Each element starts on a new page; an
 * element taller than one page flows onto further pages in `slice` mode.
 *
 * @param {Element[]} elements
 * @param {ExportOptions} [options]
 * @returns {Promise<ExportResult>}
 */
export async function elementsToPDF(elements, options = {}) {
  const list = Array.from(elements || []);
  if (list.length === 0) {
    throw new TypeError('elementsToPDF expects at least one DOM Element.');
  }

  const opts = { ...DEFAULTS, ...options };
  // Millimetres only from here on: the element already has a layout, and the
  // canvas is fitted to the page in mm. `page.widthPx`/`heightPx` are
  // deliberately unused, which is why `dpi` is a no-op on this path.
  const page = resolvePageSize(opts.pageSize, opts.orientation);
  const scale = resolveScale(opts.scale);
  const report = makeReporter(opts.onProgress, list.length);

  const [JsPDF, html2canvas] = await Promise.all([
    resolveJsPDF(opts.jsPDF),
    resolveHtml2Canvas(opts.html2canvas),
  ]);

  const doc = new JsPDF({
    orientation: page.orientation,
    unit: 'mm',
    format: [page.width, page.height],
    compress: true,
  });

  const imageFailures = [];
  let pageCount = 0;

  for (let index = 0; index < list.length; index += 1) {
    const element = list[index];
    report('capture', index);

    const cleanups = [];
    let canvas;
    try {
      if (opts.inlineImages !== false) {
        const inlineOptions = typeof opts.inlineImages === 'object' ? opts.inlineImages : {};
        const result = await inlineImages(element, inlineOptions);
        imageFailures.push(...result.failed);
        cleanups.push(result.restore);
      }

      await waitForImages(element);

      if (opts.watermark) {
        cleanups.push(addWatermark(element, opts.watermark));
      }

      await settle(opts.settleMs);

      canvas = await renderToCanvas(element, {
        html2canvas,
        scale,
        backgroundColor: opts.background,
        html2canvasOptions: opts.html2canvasOptions,
      });
    } finally {
      // Undo watermark and src swaps even if the capture threw, so the live
      // page is never left in the export-only state.
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch {
          /* best effort */
        }
      }
    }

    report('paginate', index);
    pageCount += addCanvasToDoc(doc, canvas, { page, opts, isFirst: index === 0 });
  }

  report('finalize', list.length);
  return finish(doc, opts, pageCount, imageFailures);
}

/**
 * Export an HTML string (or an array of strings, one per page) to PDF.
 *
 * The markup is mounted in an offscreen container sized to the printable page
 * width in CSS pixels, so a plain `<div>` with no width naturally fills the
 * page. Style it however you like — the browser does the layout.
 *
 * **This takes raw HTML and mounts it in your live document.** Anything you
 * interpolate is parsed as markup: a stray `<` breaks the layout, and a
 * `<img onerror=...>` in a value that came from a user runs script on your
 * page. Wrap every interpolated value in {@link escapeHtml}.
 *
 * @param {string|string[]} html
 * @param {ExportOptions & { fontFamily?: string }} [options]
 *   `fontFamily` sets the CSS font stack on the offscreen container — this path
 *   only, since it is the only one that builds its own layout root. Use
 *   `CJK_FONT_STACKS` / `fontStackFor()` rather than inventing one.
 * @returns {Promise<ExportResult>}
 *
 * @example
 * import { htmlToPDF, escapeHtml, CJK_FONT_STACKS } from 'cjk-pdf';
 *
 * await htmlToPDF(`<h1 style="font-size:48px">${escapeHtml(title)}</h1>`, {
 *   filename: 'hello.pdf',
 *   fontFamily: CJK_FONT_STACKS.zhTW,
 * });
 */
export async function htmlToPDF(html, options = {}) {
  const chunks = Array.isArray(html) ? html : [html];
  if (chunks.length === 0 || chunks.some((chunk) => typeof chunk !== 'string')) {
    throw new TypeError('htmlToPDF expects an HTML string or an array of HTML strings.');
  }

  const opts = { ...DEFAULTS, ...options };
  const page = resolvePageSize(opts.pageSize, opts.orientation, opts.dpi);
  const contentWidthPx = Math.round(mmToPx(page.width - opts.margin * 2, opts.dpi));
  const contentHeightPx = Math.round(mmToPx(page.height - opts.margin * 2, opts.dpi));

  const container = createOffscreenContainer({
    width: contentWidthPx,
    minHeight: opts.mode === 'fit' ? contentHeightPx : undefined,
    background: opts.background || '#ffffff',
    fontFamily: opts.fontFamily,
  });

  try {
    const pages = [];
    for (const chunk of chunks) {
      const holder = container.ownerDocument.createElement('div');
      holder.style.width = '100%';
      if (opts.mode === 'fit') holder.style.minHeight = `${contentHeightPx}px`;
      holder.innerHTML = chunk;
      container.appendChild(holder);
      pages.push(holder);
    }
    await settle(opts.settleMs);
    return await elementsToPDF(pages, opts);
  } finally {
    destroyContainer(container);
  }
}

/** Draw one canvas into the document, adding pages as needed. */
function addCanvasToDoc(doc, canvas, { page, opts, isFirst }) {
  const plan = planPages({
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    pageWidth: page.width,
    pageHeight: page.height,
    margin: opts.margin,
    mode: opts.mode,
  });

  const format = opts.imageFormat === 'PNG' ? 'PNG' : 'JPEG';
  const mimeType = format === 'PNG' ? 'image/png' : 'image/jpeg';
  const slices = sliceCanvas(canvas, plan, {
    background: format === 'PNG' ? opts.background : opts.background || '#ffffff',
  });

  plan.pages.forEach((placement, index) => {
    if (!isFirst || index > 0) doc.addPage([page.width, page.height], page.orientation);
    const data = slices[index].toDataURL(mimeType, opts.imageQuality);
    doc.addImage(data, format, placement.x, placement.y, placement.width, placement.height, undefined, 'FAST');
  });

  return plan.pageCount;
}

function finish(doc, opts, pageCount, imageFailures) {
  const filename = ensurePdfExtension(opts.filename || DEFAULTS.filename);
  /** @type {ExportResult} */
  const result = { doc, filename, pageCount, saved: false, imageFailures };

  switch (opts.output) {
    case 'blob':
      result.blob = doc.output('blob');
      break;
    case 'dataurl':
      result.dataUrl = doc.output('datauristring');
      break;
    case 'arraybuffer':
      result.arrayBuffer = doc.output('arraybuffer');
      break;
    case 'doc':
      break;
    case 'save':
    default:
      doc.save(filename);
      result.saved = true;
      break;
  }

  return result;
}

/**
 * Resolve the jsPDF constructor from an option, a global (CDN builds expose
 * `window.jspdf.jsPDF`), or a bare-specifier import.
 */
export async function resolveJsPDF(provided) {
  if (typeof provided === 'function') return provided;
  if (provided && typeof provided.jsPDF === 'function') return provided.jsPDF;

  const global = globalThis;
  if (global.jspdf && typeof global.jspdf.jsPDF === 'function') return global.jspdf.jsPDF;
  if (typeof global.jsPDF === 'function') return global.jsPDF;

  try {
    const mod = await import(/* @vite-ignore */ 'jspdf');
    if (typeof mod.jsPDF === 'function') return mod.jsPDF;
    if (typeof mod.default === 'function') return mod.default;
  } catch {
    /* fall through to the friendly error below */
  }

  throw new Error(
    'jsPDF not found. Install it (`npm i jspdf`), load it from a <script> tag, ' +
      'or pass it explicitly: { jsPDF }.'
  );
}

/** Strip characters that are illegal in file names on common platforms. */
export function sanitizeFilename(name, fallback = 'document') {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function ensurePdfExtension(name) {
  const safe = sanitizeFilename(name);
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

function makeReporter(onProgress, total) {
  if (typeof onProgress !== 'function') return () => {};
  return (phase, current) => {
    try {
      onProgress({ phase, current, total });
    } catch {
      /* a throwing progress callback must not abort the export */
    }
  };
}
