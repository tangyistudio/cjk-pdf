/**
 * HTML string helpers.
 *
 * Pure: no DOM, no side effects, no dependencies.
 *
 * `htmlToPDF()` takes raw markup, which means the moment you interpolate a
 * value you did not write yourself — a customer name, a comment, a filename, a
 * line of narration — you are building HTML by string concatenation. An
 * unescaped `<` does not just corrupt the layout; in a page that also renders
 * that markup live, it is the whole XSS problem. Escape every interpolated
 * value.
 */

/**
 * Characters that must not survive into markup as themselves.
 *
 * `&` is in here for a reason people rediscover the hard way: escape it last
 * with sequential `String.replace` calls and you double-escape your own output
 * (`<` becomes `&lt;` becomes `&amp;lt;`). The single-pass regex below cannot
 * make that mistake, because each source character is visited exactly once.
 */
const ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

const ESCAPE_PATTERN = /[&<>"']/g;

/**
 * Escape a value for interpolation into HTML.
 *
 * Quotes are escaped too, so the result is safe inside a single- or
 * double-quoted attribute value as well as in text content.
 *
 * `null` and `undefined` become an empty string rather than the words "null"
 * and "undefined" — templates interpolate missing fields constantly, and
 * printing `undefined` into a PDF someone signs is worse than printing nothing.
 *
 * @param {unknown} value
 * @returns {string}
 *
 * @example
 * const html = `<p>${escapeHtml(comment)}</p>`;
 * // comment = '5 < 10 & "quoted"'
 * // => '<p>5 &lt; 10 &amp; &quot;quoted&quot;</p>'
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(ESCAPE_PATTERN, (char) => ESCAPES[char]);
}
