/**
 * Cross-origin image inlining.
 *
 * This is the second biggest reason HTML-to-PDF exports fail. html2canvas
 * paints images onto a `<canvas>`; the moment a pixel from another origin lands
 * on that canvas without permissive CORS headers, the canvas is "tainted" and
 * `toDataURL()` throws a `SecurityError`. Setting `useCORS: true` only helps
 * when the remote server actually sends `Access-Control-Allow-Origin`.
 *
 * The reliable fix is to stop letting the canvas touch remote URLs at all:
 * fetch each image yourself, read it as a blob, encode it as a `data:` URL, and
 * swap the `src` before rendering. Data URLs are same-origin by definition.
 *
 * Every image is handled independently: one 404 should not lose you the
 * document, so failures are collected and reported instead of thrown.
 */

const SKIP_PROTOCOL = /^(data|blob):/i;

/**
 * @typedef {object} InlineResult
 * @property {number} total    Candidate images found.
 * @property {number} inlined  Images successfully converted.
 * @property {Array<{ url: string, error: string }>} failed
 * @property {() => void} restore Put the original `src` values back.
 */

/**
 * Fetch a URL and return it as a `data:` URL.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeout=15000] Abort after this many ms.
 * @param {RequestInit} [options.fetchOptions] Passed through to `fetch`.
 * @param {string} [options.mimeType] Re-encode through a canvas, e.g.
 *   `'image/jpeg'` to shrink large PNG screenshots.
 * @param {number} [options.quality=0.92] Quality for lossy re-encoding.
 * @returns {Promise<string>}
 */
export async function urlToDataURL(url, options = {}) {
  const { timeout = 15000, fetchOptions = {}, mimeType = null, quality = 0.92 } = options;

  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('url must be a non-empty string.');
  }
  if (SKIP_PROTOCOL.test(url)) return url;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;

  let blob;
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache',
      ...fetchOptions,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    blob = await response.blob();
  } finally {
    if (timer) clearTimeout(timer);
  }

  const dataUrl = await blobToDataURL(blob);
  if (!mimeType) return dataUrl;
  return reencodeDataURL(dataUrl, mimeType, quality);
}

/** Read a Blob as a `data:` URL. */
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Replace cross-origin `<img>` sources inside `root` with data URLs.
 *
 * Call this *before* html2canvas, and call the returned `restore()` after, so
 * the live page keeps its original (cacheable) URLs.
 *
 * @param {Element} root
 * @param {object} [options]
 * @param {boolean} [options.all=false] Inline same-origin images too.
 * @param {boolean} [options.backgrounds=true] Also inline inline-style
 *   `background-image: url(...)` values.
 * @param {number} [options.concurrency=4] Parallel fetches.
 * @param {(failure: { url: string, error: Error }) => void} [options.onError]
 * @returns {Promise<InlineResult>}
 */
export async function inlineImages(root, options = {}) {
  const {
    all = false,
    backgrounds = true,
    concurrency = 4,
    onError = null,
    ...urlOptions
  } = options;

  if (!root || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('root must be a DOM Element.');
  }

  /** @type {Array<{ url: string, apply: (dataUrl: string) => void, undo: () => void }>} */
  const targets = [];

  for (const img of root.querySelectorAll('img[src]')) {
    const url = img.getAttribute('src');
    if (!url || SKIP_PROTOCOL.test(url)) continue;
    if (!all && !isCrossOrigin(url)) continue;
    targets.push({
      url: absolute(url),
      apply: (dataUrl) => {
        img.setAttribute('src', dataUrl);
        img.removeAttribute('srcset');
      },
      undo: () => img.setAttribute('src', url),
    });
  }

  if (backgrounds) {
    const withBackground = [root, ...root.querySelectorAll('[style*="background"]')];
    for (const node of withBackground) {
      if (!node.style || !node.style.backgroundImage) continue;
      const original = node.style.backgroundImage;
      const url = extractCssUrl(original);
      if (!url || SKIP_PROTOCOL.test(url)) continue;
      if (!all && !isCrossOrigin(url)) continue;
      targets.push({
        url: absolute(url),
        apply: (dataUrl) => {
          node.style.backgroundImage = `url("${dataUrl}")`;
        },
        undo: () => {
          node.style.backgroundImage = original;
        },
      });
    }
  }

  const failed = [];
  const undos = [];
  let inlined = 0;

  await mapLimit(targets, concurrency, async (target) => {
    try {
      const dataUrl = await urlToDataURL(target.url, urlOptions);
      target.apply(dataUrl);
      undos.push(target.undo);
      inlined += 1;
    } catch (error) {
      // Per-image tolerance: record it, keep the original src, carry on. The
      // page still renders — that one image may just come out blank.
      failed.push({ url: target.url, error: error?.message || String(error) });
      if (onError) onError({ url: target.url, error });
    }
  });

  return {
    total: targets.length,
    inlined,
    failed,
    restore: () => {
      for (const undo of undos) {
        try {
          undo();
        } catch {
          /* node may already be detached */
        }
      }
      undos.length = 0;
    },
  };
}

/**
 * Wait until every `<img>` under `root` has finished loading (or failed).
 * html2canvas has its own `imageTimeout`, but resolving this first avoids
 * half-painted images on slow connections.
 */
export function waitForImages(root, timeout = 15000) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return Promise.resolve();
  }
  const pending = [...root.querySelectorAll('img')]
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        })
    );

  if (pending.length === 0) return Promise.resolve();

  return Promise.race([
    Promise.all(pending),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]).then(() => undefined);
}

/** True when the URL resolves to an origin other than the current document. */
export function isCrossOrigin(url) {
  try {
    const base = globalThis.location?.href;
    const resolved = new URL(url, base);
    return Boolean(base) && resolved.origin !== new URL(base).origin;
  } catch {
    return false;
  }
}

function absolute(url) {
  try {
    return new URL(url, globalThis.location?.href).href;
  } catch {
    return url;
  }
}

function extractCssUrl(value) {
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(value);
  return match ? match[2] : null;
}

function reencodeDataURL(dataUrl, mimeType, quality) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (mimeType === 'image/jpeg') {
          // JPEG has no alpha channel; transparent pixels would go black.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(image, 0, 0);
        resolve(canvas.toDataURL(mimeType, quality));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('Failed to decode fetched image.'));
    image.src = dataUrl;
  });
}

async function mapLimit(items, limit, worker) {
  const size = Math.max(1, Math.min(limit, items.length || 1));
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}
