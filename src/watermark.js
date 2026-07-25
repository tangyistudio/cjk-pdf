/**
 * Optional watermark overlay.
 *
 * The whole trick is that the watermark only has to exist for the duration of
 * the html2canvas capture. Inject a DOM node, take the snapshot, remove the
 * node. Nothing is composited server side, nothing is stored, and the live page
 * is byte-for-byte unchanged afterwards.
 */

const MARKER = 'data-cjk-pdf-watermark';

/**
 * @typedef {object} WatermarkOptions
 * @property {string} text Main watermark text.
 * @property {string} [subtext] Secondary text, e.g. an export id or timestamp.
 * @property {'footer' | 'diagonal' | 'corner'} [mode='footer']
 * @property {string} [color='rgba(0,0,0,0.45)']
 * @property {number|string} [fontSize=12] Number is treated as px.
 * @property {string} [fontFamily] CSS font stack.
 * @property {number} [opacity=1]
 * @property {number} [angle=-30] Rotation for `diagonal` mode, in degrees.
 * @property {number} [gap=180] Tile spacing for `diagonal` mode, in px.
 * @property {number} [zIndex=2147483000]
 */

/**
 * Inject a watermark overlay into `element`.
 *
 * @param {Element} element Capture target. Must be able to host an absolutely
 *   positioned child; if it is `position: static` this function temporarily
 *   promotes it to `relative` and restores the original value on removal.
 * @param {WatermarkOptions} options
 * @returns {() => void} Removal function. Always call it, ideally in a
 *   `finally` block, so a failed capture does not leave the overlay behind.
 */
export function addWatermark(element, options = {}) {
  if (!element || typeof element.appendChild !== 'function') {
    throw new TypeError('element must be a DOM Element.');
  }

  const {
    text = '',
    subtext = '',
    mode = 'footer',
    color = 'rgba(0, 0, 0, 0.45)',
    fontSize = 12,
    fontFamily = 'inherit',
    opacity = 1,
    angle = -30,
    gap = 180,
    zIndex = 2147483000,
  } = options;

  if (!text && !subtext) {
    return () => {};
  }

  const doc = element.ownerDocument || globalThis.document;
  const overlay = doc.createElement('div');
  overlay.setAttribute(MARKER, mode);

  const size = typeof fontSize === 'number' ? `${fontSize}px` : fontSize;

  Object.assign(overlay.style, {
    position: 'absolute',
    // Longhand rather than `inset`, so older html2canvas style parsers see it.
    left: '0',
    top: '0',
    right: '0',
    bottom: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
    color,
    opacity: String(opacity),
    fontFamily,
    fontSize: size,
    lineHeight: '1.4',
    zIndex: String(zIndex),
  });

  if (mode === 'diagonal') {
    buildDiagonal(doc, overlay, { text, subtext, angle, gap });
  } else if (mode === 'corner') {
    buildCorner(doc, overlay, { text, subtext });
  } else {
    buildFooter(doc, overlay, { text, subtext });
  }

  // An absolutely positioned overlay needs a positioned ancestor, otherwise it
  // escapes to the nearest one (often <body>) and lands in the wrong place.
  const previousPosition = element.style.position;
  const computed = doc.defaultView?.getComputedStyle(element)?.position;
  if (!previousPosition && (!computed || computed === 'static')) {
    element.style.position = 'relative';
  }

  element.appendChild(overlay);

  let removed = false;
  return function removeWatermark() {
    if (removed) return;
    removed = true;
    try {
      overlay.remove();
    } catch {
      /* already detached */
    }
    element.style.position = previousPosition;
  };
}

/** Remove any watermark overlays left behind by an aborted capture. */
export function clearWatermarks(root = globalThis.document) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  const nodes = root.querySelectorAll(`[${MARKER}]`);
  nodes.forEach((node) => node.remove());
  return nodes.length;
}

function buildFooter(doc, overlay, { text, subtext }) {
  const bar = doc.createElement('div');
  Object.assign(bar.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    letterSpacing: '0.05em',
  });
  bar.appendChild(span(doc, text));
  if (subtext) {
    const right = span(doc, subtext);
    right.style.opacity = '0.7';
    bar.appendChild(right);
  }
  overlay.appendChild(bar);
}

function buildCorner(doc, overlay, { text, subtext }) {
  const box = doc.createElement('div');
  Object.assign(box.style, {
    position: 'absolute',
    right: '14px',
    bottom: '12px',
    textAlign: 'right',
    letterSpacing: '0.05em',
  });
  box.appendChild(span(doc, text));
  if (subtext) {
    const line = doc.createElement('div');
    line.textContent = subtext;
    line.style.opacity = '0.7';
    box.appendChild(line);
  }
  overlay.appendChild(box);
}

function buildDiagonal(doc, overlay, { text, subtext, angle, gap }) {
  const label = subtext ? `${text}  ${subtext}` : text;
  const field = doc.createElement('div');
  Object.assign(field.style, {
    position: 'absolute',
    // Oversize the tiled field so rotation never exposes a bare corner.
    left: '-50%',
    top: '-50%',
    width: '200%',
    height: '200%',
    display: 'flex',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    transform: `rotate(${angle}deg)`,
    transformOrigin: 'center center',
    whiteSpace: 'nowrap',
  });

  // 40 tiles covers a doubled A4 field at the default gap without being
  // expensive to rasterise.
  for (let i = 0; i < 40; i += 1) {
    const tile = span(doc, label);
    Object.assign(tile.style, {
      width: `${gap}px`,
      padding: `${Math.round(gap / 3)}px 0`,
      textAlign: 'center',
    });
    field.appendChild(tile);
  }

  overlay.appendChild(field);
}

function span(doc, text) {
  const node = doc.createElement('span');
  node.textContent = text;
  return node;
}
