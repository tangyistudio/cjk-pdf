/**
 * html2canvas invocation and offscreen container lifecycle.
 *
 * Two details in here are load bearing:
 *
 * 1. The offscreen container is positioned off screen, *not* hidden with
 *    `display: none`. A `display: none` subtree has no layout boxes, so
 *    html2canvas measures everything as 0x0 and you get a blank page. Moving
 *    the element to `left: -100000px` keeps it fully laid out while remaining
 *    invisible. `visibility: hidden` and `opacity: 0` also lay out, but they
 *    are not a way to hide things from the export: `neutralizeClone` below
 *    resets both when they are set inline, so the content is drawn. Use the
 *    `data-cjk-pdf-ignore` attribute for that instead.
 *
 * 2. The container is sized in CSS pixels at 96 DPI (A4 = 794 x 1123), so one
 *    CSS pixel maps to one PDF millimetre through a single constant factor.
 */

import { CSS_DPI, mmToPx } from './presets.js';

const CONTAINER_MARKER = 'data-cjk-pdf-container';

/** Attribute that marks an element to be hidden during capture. */
export const IGNORE_ATTRIBUTE = 'data-cjk-pdf-ignore';

/**
 * Resolve the html2canvas function from an explicit option, a global (CDN
 * `<script>` tag), or a bare-specifier import (bundler / node_modules).
 *
 * @param {Function|{default: Function}} [provided]
 * @returns {Promise<Function>}
 */
export async function resolveHtml2Canvas(provided) {
  const fn = unwrap(provided) || unwrap(globalThis.html2canvas);
  if (fn) return fn;

  try {
    const mod = await import(/* @vite-ignore */ 'html2canvas');
    const resolved = unwrap(mod);
    if (resolved) return resolved;
  } catch {
    /* fall through to the friendly error below */
  }

  throw new Error(
    'html2canvas not found. Install it (`npm i html2canvas`), load it from a ' +
      '<script> tag, or pass it explicitly: { html2canvas }.'
  );
}

/**
 * Create an offscreen, fully laid out container for rendering HTML.
 *
 * @param {object} [options]
 * @param {number} [options.width] Container width in CSS px. Takes precedence
 *   over `widthMm`.
 * @param {number} [options.widthMm] Container width in millimetres.
 * @param {number} [options.minHeight] Minimum height in CSS px.
 * @param {number} [options.dpi=96] DPI used for the mm -> px conversion.
 * @param {string} [options.background='#ffffff']
 * @param {string} [options.fontFamily] CSS font stack. Pick one that actually
 *   contains the glyphs you need; the browser, not the PDF, does the shaping.
 * @param {Document} [options.document]
 * @returns {HTMLElement} A detachable element already appended to `<body>`.
 */
export function createOffscreenContainer(options = {}) {
  const {
    width,
    widthMm,
    minHeight,
    dpi = CSS_DPI,
    background = '#ffffff',
    fontFamily,
    document: doc = globalThis.document,
  } = options;

  if (!doc || !doc.body) {
    throw new Error('createOffscreenContainer requires a DOM document with a <body>.');
  }

  const pxWidth = width ?? (widthMm ? Math.round(mmToPx(widthMm, dpi)) : 794);

  const container = doc.createElement('div');
  container.setAttribute(CONTAINER_MARKER, '1');
  Object.assign(container.style, {
    // Off screen, but still laid out. `display: none` would break measurement.
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${pxWidth}px`,
    minHeight: minHeight ? `${minHeight}px` : '0',
    margin: '0',
    padding: '0',
    background,
    // Isolate from the host page's cascade as much as one property can.
    boxSizing: 'border-box',
    zIndex: '-1',
    pointerEvents: 'none',
  });
  if (fontFamily) container.style.fontFamily = fontFamily;

  doc.body.appendChild(container);
  return container;
}

/** Remove a container created by {@link createOffscreenContainer}. */
export function destroyContainer(container) {
  if (container && typeof container.remove === 'function') {
    try {
      container.remove();
    } catch {
      /* already detached */
    }
  }
}

/** Remove any offscreen containers left behind by an aborted export. */
export function clearOrphanContainers(doc = globalThis.document) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return 0;
  const nodes = doc.querySelectorAll(`[${CONTAINER_MARKER}]`);
  nodes.forEach((node) => node.remove());
  return nodes.length;
}

/**
 * Rasterise a DOM element.
 *
 * @param {Element} element
 * @param {object} [options]
 * @param {Function} [options.html2canvas] Explicit html2canvas function.
 * @param {number} [options.scale=2] Device pixel multiplier.
 * @param {string} [options.backgroundColor='#ffffff'] Use `null` for a
 *   transparent canvas (only meaningful with PNG output).
 * @param {number} [options.imageTimeout=15000]
 * @param {boolean} [options.allowTaint=false]
 * @param {boolean} [options.useCORS=true]
 * @param {object} [options.html2canvasOptions] Merged last, escape hatch for
 *   anything this wrapper does not expose.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderToCanvas(element, options = {}) {
  if (!element || typeof element.querySelectorAll !== 'function') {
    throw new TypeError('renderToCanvas expects a DOM Element.');
  }

  const {
    scale = 2,
    backgroundColor = '#ffffff',
    imageTimeout = 15000,
    allowTaint = false,
    useCORS = true,
    html2canvasOptions = {},
  } = options;

  const html2canvas = await resolveHtml2Canvas(options.html2canvas);

  return html2canvas(element, {
    scale,
    backgroundColor,
    imageTimeout,
    allowTaint,
    useCORS,
    logging: false,
    // The SVG foreignObject renderer is faster but drops fonts and filters in
    // several browsers. The canvas renderer is the predictable one.
    foreignObjectRendering: false,
    removeContainer: true,
    // Deliberately no windowWidth/windowHeight/scrollX/scrollY defaults:
    // overriding them changes which media queries match in the clone. If tall
    // in-page content comes out clipped, pass
    // `html2canvasOptions: { windowHeight: el.scrollHeight }` yourself.
    onclone: (clonedDoc, clonedEl) => {
      neutralizeClone(clonedDoc);
      if (typeof html2canvasOptions.onclone === 'function') {
        html2canvasOptions.onclone(clonedDoc, clonedEl);
      }
    },
    ...omit(html2canvasOptions, ['onclone']),
  });
}

/**
 * Cut a tall canvas into one canvas per page, following a plan produced by
 * `planPages`.
 *
 * Slicing beats the common "draw the whole image at a negative y offset on
 * every page" trick: that embeds the full-size image once per page, so a
 * 10-page export carries ten copies of the same bitmap.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import('./paginate.js').PagePlan} plan
 * @param {object} [options]
 * @param {string} [options.background='#ffffff'] Filled behind each slice.
 *   Required for JPEG output, which has no alpha channel.
 * @returns {HTMLCanvasElement[]}
 */
export function sliceCanvas(canvas, plan, options = {}) {
  const { background = '#ffffff', document: doc = globalThis.document } = options;

  const coversWholeCanvas =
    plan.pages.length === 1 &&
    Math.round(plan.pages[0].sourceY) === 0 &&
    Math.round(plan.pages[0].sourceHeight) >= canvas.height;

  if (coversWholeCanvas) return [canvas];

  return plan.pages.map((page) => {
    const sourceY = Math.round(page.sourceY);
    const height = Math.max(1, Math.min(Math.round(page.sourceHeight), canvas.height - sourceY));

    const slice = doc.createElement('canvas');
    slice.width = canvas.width;
    slice.height = height;

    const ctx = slice.getContext('2d');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, slice.width, slice.height);
    }
    ctx.drawImage(canvas, 0, sourceY, canvas.width, height, 0, 0, canvas.width, height);
    return slice;
  });
}

/**
 * Give the browser a chance to lay out and paint freshly injected DOM before
 * html2canvas measures it. Two animation frames plus a short timeout is the
 * cheapest thing that is reliable across engines.
 */
export function settle(delay = 50) {
  const frames = new Promise((resolve) => {
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') {
      raf(() => raf(() => setTimeout(resolve, delay)));
    } else {
      setTimeout(resolve, delay);
    }
  });

  // Background and hidden tabs throttle or fully suspend requestAnimationFrame,
  // so never let the frame path be the only thing that can resolve.
  const fallback = new Promise((resolve) => setTimeout(resolve, delay + 200));

  return Promise.race([frames, fallback]).then(() => undefined);
}

/**
 * Freeze animations and reveal transient states inside the cloned document
 * html2canvas renders. Without this, anything mid-transition (a fade-in that
 * has not finished, a collapsed accordion) is captured half-drawn.
 */
function neutralizeClone(clonedDoc) {
  clonedDoc.querySelectorAll(`[${IGNORE_ATTRIBUTE}]`).forEach((node) => {
    if (node.style) node.style.display = 'none';
  });

  clonedDoc.querySelectorAll('*').forEach((node) => {
    if (!node.style) return;
    node.style.transition = 'none';
    node.style.animation = 'none';
    if (node.style.opacity === '0') node.style.opacity = '1';
    if (node.style.visibility === 'hidden') node.style.visibility = 'visible';
  });
}

function unwrap(candidate) {
  if (typeof candidate === 'function') return candidate;
  if (candidate && typeof candidate.default === 'function') return candidate.default;
  return null;
}

function omit(source, keys) {
  const result = {};
  for (const key of Object.keys(source || {})) {
    if (!keys.includes(key)) result[key] = source[key];
  }
  return result;
}
