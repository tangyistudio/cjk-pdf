# cjk-pdf

**Your PDF says `□□□□` instead of `你好世界`.**

```js
doc.text('你好世界', 10, 10); // renders: □□□□
```

jsPDF's built-in fonts are Latin-1. Every CJK codepoint you hand `.text()` falls off the end of the encoding and comes back as a tofu box. Same for Japanese kana, Korean hangul, curly CJK punctuation and emoji.

`cjk-pdf` fixes it without shipping a font.

---

## Why the obvious fix hurts

The documented answer is `doc.addFont()` with a CJK TTF converted to jsPDF's base64 format. It works, and it costs you:

| Font | Coverage | Size added to your bundle |
| --- | --- | --- |
| Noto Sans TC (full) | Traditional Chinese | ~9 MB |
| Noto Sans SC (full) | Simplified Chinese | ~10 MB |
| Noto Sans JP (full) | Japanese | ~5 MB |
| Source Han Sans (full) | CJK combined | ~15 MB+ |

Base64 inflates that by another third. Subsetting helps, but only if you know every glyph in advance — which you don't, the moment a user types their own name.

## The approach

Let the browser do the typesetting. It already has the fonts, the shaping engine, the line breaker and the emoji.

1. Render the target HTML to a `<canvas>` with **html2canvas**.
2. Drop that canvas into the PDF with **jsPDF**'s `addImage()`.
3. Slice tall canvases across pages.

**The honest trade-off:** the output is a raster image, so the text is not selectable, searchable or reflowable, and file size scales with page count. If you need selectable CJK text, you must embed a font — there is no third option. For invoices, reports, certificates, statements and storybooks, this is the pragmatic answer, and it is what most production apps actually ship.

## Install

```sh
npm install cjk-pdf jspdf html2canvas
```

`jspdf` and `html2canvas` are peer dependencies — bring your own versions. Browser only; there is no Node/SSR renderer.

## Quickstart

```js
import { elementToPDF } from 'cjk-pdf';

await elementToPDF(document.querySelector('#invoice'), {
  filename: '發票.pdf',
  pageSize: 'a4',
  margin: 10,
});
```

That is the whole thing. Cross-origin images are inlined, the canvas is rasterised at 2x, and tall content flows onto extra pages.

## Font stacks

The browser picks the glyphs, so an export is only as good as the fonts on the machine doing the rendering. `sans-serif` alone is not a CJK font stack — you get whatever that system calls its default, which is often a Latin face plus a fallback that draws Traditional Chinese in Simplified glyph shapes, or tofu again from a different cause.

Four stacks ship as named constants so you do not have to rediscover them:

```js
import { CJK_FONT_STACKS, fontStackFor } from 'cjk-pdf';

CJK_FONT_STACKS.zhTW;
// "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', 'Heiti TC', sans-serif"

fontStackFor('zh-Hant'); // the same string, looked up from a language tag
```

| Key | Language | Stack |
| --- | --- | --- |
| `zhTW` | Traditional Chinese (TW / HK / MO) | `'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', 'Heiti TC', sans-serif` |
| `zhCN` | Simplified Chinese (CN / SG) | `'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Heiti SC', sans-serif` |
| `ja` | Japanese | `'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif` |
| `ko` | Korean | `'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Nanum Gothic', sans-serif` |

`fontStackFor()` accepts `zh-TW`, `zh-Hant`, `zh-HK`, `zh-CN`, `zh-Hans`, `ja`, `ja-JP`, `ko`, `ko-KR` and the bare keys above. A bare `zh` resolves to Simplified, following CLDR; if you mean Traditional, say so.

### Why the order matters

Every stack is built the same way. Each entry is there to cover a platform the previous one misses, so removing one silently drops a population:

| Position | `zhTW` example | Covers |
| --- | --- | --- |
| 1. Webfont | `Noto Sans TC` | Everything — *if* you loaded it. Identical output on every machine. Costs nothing when you did not: the name matches no installed font and the browser moves on. |
| 2. Modern Apple face | `PingFang TC` | macOS 10.11+, iOS 9+ |
| 3. Modern Microsoft face | `Microsoft JhengHei` | Windows Vista and later |
| 4. Legacy fallback | `Heiti TC` | macOS 10.10 and earlier, old iOS |
| 5. Generic | `sans-serif` | Last resort |

The other stacks fill the same slots: `PingFang SC` / `Hiragino Sans` / `Apple SD Gothic Neo` at position 2, `Microsoft YaHei` / `Yu Gothic` / `Malgun Gothic` at position 3.

**Do not concatenate two of these.** Han unification means one codepoint is drawn differently by region — 骨, 直 and 令 are the textbook cases — and a Simplified or Japanese font will cheerfully render a Traditional document in its own shapes. Whichever font comes first wins for the entire document, so a merged stack quietly hands one of your audiences the wrong glyph forms. Choose the stack for the language of the page.

### Applying one

`htmlToPDF` builds its own layout root, so it takes the stack directly:

```js
await htmlToPDF(markup, { fontFamily: CJK_FONT_STACKS.zhTW });
```

`elementToPDF` / `elementsToPDF` capture an element that already lives in your page — the stack belongs in that page's CSS, and the option does nothing there.

If you use the webfont, wait for it before exporting or the capture races the font swap:

```js
await document.fonts.ready;
```

## API

```js
import { elementToPDF, elementsToPDF, htmlToPDF } from 'cjk-pdf';

// One element.
await elementToPDF(el, options);

// Several elements, one page each (plus overflow pages in slice mode).
await elementsToPDF([cover, page1, page2], options);

// An HTML string, mounted offscreen for you. Pass an array for multiple pages.
await htmlToPDF('<h1 style="font-size:48px">你好，世界</h1>', options);
```

All three return:

```js
{
  doc,            // the jsPDF instance, for further edits
  filename,       // sanitised, always ends in .pdf
  pageCount,
  saved,          // true when output: 'save' triggered a download
  blob,           // when output: 'blob'
  dataUrl,        // when output: 'dataurl'
  arrayBuffer,    // when output: 'arraybuffer'
  imageFailures,  // images that could not be inlined; the export still ran
}
```

### `htmlToPDF` takes *raw* HTML — escape what you interpolate

That string is parsed as markup and mounted in your live document, so every value you drop into a template literal is markup too:

```js
import { htmlToPDF, escapeHtml } from 'cjk-pdf';

// Wrong. With name = 'Ann & Bob <partner>' the layout breaks at `<partner`,
// and a value like `<img src=x onerror=alert(1)>` executes on your page.
await htmlToPDF(`<p>${name}</p>`);

// Right.
await htmlToPDF(`<p>${escapeHtml(name)}</p>`);
```

`escapeHtml()` replaces `&`, `<`, `>`, `"` and `'`, so the result is safe in text content and inside a quoted attribute value alike. `null` and `undefined` come back as an empty string rather than the words "null" and "undefined" — printing `undefined` into a document someone signs is worse than printing nothing.

Escape at interpolation time, never in bulk afterwards: escaping an already-assembled string destroys your own tags.

This is not paranoia about a PDF. `htmlToPDF` mounts the markup in the real document to lay it out, so unescaped user input runs there before it is ever rasterised.

### Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `filename` | `string` | `'document.pdf'` | Illegal filename characters are stripped. |
| `output` | `'save' \| 'blob' \| 'dataurl' \| 'arraybuffer' \| 'doc'` | `'save'` | `'save'` triggers a browser download. |
| `pageSize` | `'a3' \| 'a4' \| 'a5' \| 'a6' \| 'letter' \| 'legal' \| 'tabloid' \| {width,height}` | `'a4'` | Custom sizes are in millimetres. |
| `orientation` | `'portrait' \| 'landscape'` | `'portrait'` | |
| `margin` | `number` | `0` | Uniform page margin, in mm. |
| `scale` | `number \| 'screen' \| 'print' \| 'high'` | `'print'` | 1x / 2x / 3x device pixels. |
| `dpi` | `number` | `96` | **`htmlToPDF` only.** Sets the CSS pixel width of the offscreen container. Ignored by `elementToPDF`/`elementsToPDF` — see below. |
| `mode` | `'slice' \| 'fit'` | `'slice'` | `slice` flows tall content across pages; `fit` shrinks each element onto one page. |
| `background` | `string \| null` | `'#ffffff'` | `null` gives a transparent canvas (PNG only). |
| `imageFormat` | `'JPEG' \| 'PNG'` | `'JPEG'` | JPEG is 5-10x smaller for photographic pages. |
| `imageQuality` | `number` | `0.92` | JPEG only, 0-1. |
| `inlineImages` | `boolean \| object` | `true` | See gotcha #1. Pass an object to configure, `false` to skip. |
| `settleMs` | `number` | `50` | Wait after the last DOM change before measuring, on top of two animation frames. See gotcha #5. |
| `fontFamily` | `string` | — | **`htmlToPDF` only.** CSS stack for the offscreen container. Use `CJK_FONT_STACKS`. |
| `watermark` | `object \| null` | `null` | `{ text, subtext, mode, color, fontSize, opacity, angle, gap }`. |
| `onProgress` | `function` | — | `({ phase, current, total }) => void`. |
| `jsPDF` / `html2canvas` | `function` | auto | Pass explicitly if auto-detection cannot find them. |
| `html2canvasOptions` | `object` | `{}` | Escape hatch, merged last. |

#### Why `dpi` only applies to `htmlToPDF`

`htmlToPDF` has to invent a layout width: it mounts your markup in an offscreen container, and `dpi` decides how many CSS pixels the printable page width becomes (210 mm at 96 DPI = 794 px). Raise it and your HTML lays out into a wider box, so relative units, media queries and wrapping all change.

`elementToPDF`/`elementsToPDF` are handed an element that already has a layout. The captured canvas is scaled to the printable page width in millimetres regardless of how many pixels it turned out to be, so there is nothing left for `dpi` to decide. Passing it is harmless but has no effect.

Raster resolution is `scale`, not `dpi`, in every case.

### Watermark

Injected into the DOM immediately before capture and removed immediately after, in a `finally` block. Nothing touches a server, and the live page is unchanged afterwards.

```js
await elementToPDF(el, {
  watermark: {
    text: 'CONFIDENTIAL 機密',
    subtext: 'exported 2026-07-26',
    mode: 'diagonal', // 'footer' (default) | 'diagonal' | 'corner'
    opacity: 0.18,
  },
});
```

It is a visual mark, not DRM. Anyone can crop it off.

### Excluding elements

Add `data-cjk-pdf-ignore` to anything that should not appear in the PDF — export buttons, tooltips, sticky headers:

```html
<div class="toolbar" data-cjk-pdf-ignore>…</div>
```

### Submodules

The internals are importable on their own, and the math ones are dependency-free:

```js
import { planPages, estimatePageCount } from 'cjk-pdf/paginate';
import { resolvePageSize, mmToPx, CJK_FONT_STACKS } from 'cjk-pdf/presets';
import { escapeHtml } from 'cjk-pdf/html';
import { urlToDataURL, inlineImages } from 'cjk-pdf/images';
import { addWatermark } from 'cjk-pdf/watermark';
import { renderToCanvas, createOffscreenContainer } from 'cjk-pdf/canvas';
```

---

## Gotchas

The parts that will cost you an afternoon if you build this yourself.

### 1. Cross-origin images taint the canvas

Symptom:

```
SecurityError: Failed to execute 'toDataURL' on 'HTMLCanvasElement':
Tainted canvases may not be exported.
```

Any pixel drawn from another origin without permissive CORS headers poisons the whole canvas. `useCORS: true` only helps when the remote server actually sends `Access-Control-Allow-Origin` — CDNs and S3 buckets frequently do not, and a signed URL that works in an `<img>` tag will still taint you.

`cjk-pdf` sidesteps it: every cross-origin `<img>` is fetched, read as a blob, encoded as a `data:` URL and swapped in before rendering. Data URLs are same-origin by definition. Originals are restored afterwards.

Per-image failure tolerance is deliberate — one dead image should not lose you a 40-page document, so failures land in `result.imageFailures` instead of throwing. Check it if a picture comes out blank.

If the remote host blocks `fetch` outright, proxy it yourself:

```js
inlineImages: {
  fetchOptions: { headers: { Authorization: token } },
  timeout: 30000,
  mimeType: 'image/jpeg', // re-encode to shrink huge PNGs
}
```

And never use `allowTaint: true`. It lets the render succeed and then explodes at `toDataURL`, one step later, where the error makes no sense.

### 2. `display: none` renders a blank page

Offscreen containers are the standard way to build a print layout that the user never sees. The instinct is `display: none`. That produces a blank PDF, every time.

An element with `display: none` generates no layout boxes at all, so html2canvas measures it as 0×0. Same for a `<template>`, and same for any ancestor being hidden.

Position it offscreen instead:

```css
position: fixed;
left: -100000px;
top: 0;
width: 794px; /* A4 at 96 DPI */
```

It lays out completely, and it is invisible. `createOffscreenContainer()` does this correctly.

`visibility: hidden` and `opacity: 0` do lay out, so they avoid the 0×0 problem — but what ends up in the PDF depends on *how* you applied them:

| How it was hidden | What you get |
| --- | --- |
| Inline `style="opacity:0"` / `style="visibility:hidden"` | **Rendered visibly.** `cjk-pdf` resets it in the clone. |
| A class or stylesheet rule | Blank — html2canvas faithfully reproduces the invisibility. |

The reset is deliberate: content mid-fade-in (`opacity: 0` with a transition that has not finished) would otherwise be captured half-drawn, and that is by far the more common case. But it has a real side effect — **anything you hid with an inline `opacity: 0` or `visibility: hidden` on purpose will be painted into the PDF.** Draft banners, collapsed panels, "reveal on click" answers and spoiler text all reappear.

To keep something out of the export, do one of these instead:

```html
<!-- Best: explicit, and it survives any future change to the reset rules. -->
<div data-cjk-pdf-ignore style="opacity:0">…</div>

<!-- Or hide it from a stylesheet rather than an inline style. -->
<div class="is-hidden">…</div>   <!-- .is-hidden { visibility: hidden } -->
```

`data-cjk-pdf-ignore` is applied as `display: none` in the clone, and the reset never touches `display`, so it always wins. The reset itself walks every element in the cloned document, so hiding a *parent* with an inline style does not protect its children either.

Related: give the browser a frame to actually paint freshly injected DOM before measuring it. `htmlToPDF` awaits two animation frames plus a short timeout (`settleMs`, default 50); if you drive `renderToCanvas` yourself, `await settle()` first. Gotcha #5 covers when 50 ms is not enough.

### 3. `scale` versus memory

`scale` multiplies both canvas dimensions, so memory grows with the **square**:

| `scale` | Effective DPI | A4 canvas | Approx. RAM per page |
| --- | --- | --- | --- |
| `1` (`'screen'`) | 96 | 794 × 1123 | ~3.5 MB |
| `2` (`'print'`) | 192 | 1588 × 2246 | ~14 MB |
| `3` (`'high'`) | 288 | 2382 × 3369 | ~32 MB |
| `4` | 384 | 3176 × 4492 | ~57 MB |

Browsers also cap canvas area — Safari on iOS around 16.7 M pixels, most desktop browsers around 268 M. Blow past it and `toDataURL` silently returns a blank image rather than throwing. That is why `scale: 2` is the default: past 2x the gain is barely visible in print and the failure modes get ugly.

For long documents, render **one element per page** with `elementsToPDF` rather than one enormous canvas. Ten 2x A4 canvases are fine; one 2x canvas that is ten pages tall may not be.

*The canvas-area caps and the per-page memory figures above are the industry-known values published by the browser vendors and the html2canvas community, not measurements taken by this project. Treat them as orders of magnitude; the exact cap moves with the device and the browser version.*

### 4. Fonts must exist on the rendering machine

The browser does the shaping, so it picks from the fonts *that browser* has. A Traditional Chinese page rendered on a machine without a TC font falls back to whatever is available, and you can get Simplified glyph shapes or, in the worst case, tofu again — just from a different cause.

Use one of the stacks from [Font stacks](#font-stacks) rather than trusting `sans-serif`, and if you load a webfont, wait for it before exporting:

```js
await document.fonts.ready;
await elementToPDF(el, { filename: 'report.pdf' });
```

### 5. Capturing an element that is already on the page

An offscreen container is a clean room. An element sitting in your live layout is not, and two things bite.

**Scroll position.** html2canvas resolves `position: fixed` and `position: sticky` elements against the current viewport, so a sticky header captured while the user is halfway down the page lands in the middle of your PDF. Scroll to the top first — and then actually wait, because the scroll is asynchronous and may be smooth-animated:

```js
window.scrollTo(0, 0);
await new Promise((r) => setTimeout(r, 400)); // let the scroll finish
await elementToPDF(el, { settleMs: 400 });    // let the relayout finish
```

400 ms is the value that survived production for both. `settleMs` (default `50`, applied on top of two animation frames) covers the layout settling after the last DOM change; raise it when a webfont swap, a lazy image or a freshly expanded section may still be in flight. It is a fixed delay, not a readiness check, so prefer `await document.fonts.ready` and `waitForImages()` where a real signal exists and keep `settleMs` as the backstop.

**Clipping.** If the element is taller than the viewport, the capture can come out cut off at the fold. The fix is to tell html2canvas both how big the element really is and where the page is scrolled to:

```js
await elementToPDF(el, {
  html2canvasOptions: {
    width: el.scrollWidth,
    height: el.scrollHeight,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
    scrollX: 0,
    scrollY: -window.scrollY,
  },
});
```

`cjk-pdf` does **not** set these by default, on purpose: overriding `windowWidth`/`windowHeight` changes which media queries match in the cloned document, so a responsive page can silently capture at its tablet breakpoint. Opt in when you hit the clipping, not before. `htmlToPDF` never needs any of it — its container is offscreen at the top of the document, so `window.scrollY` is irrelevant.

### 6. Other sharp edges

- **Web fonts must be same-origin or CORS-enabled.** html2canvas re-reads stylesheets in a cloned document; a cross-origin `@font-face` that the page renders fine may be dropped in the capture.
- **CSS transforms, filters and `mix-blend-mode` are approximations.** html2canvas reimplements the rendering; it is not a screenshot API. Complex effects may differ.
- **Iframes, `<video>`, WebGL and shadow DOM** are partly or wholly unsupported.
- **Position `sticky` and `fixed` elements** are captured wherever they currently sit — see gotcha #5. Scroll to top and wait, or mark them `data-cjk-pdf-ignore`.
- **Animations mid-flight** would be frozen half-drawn; `cjk-pdf` disables transitions and animations inside the cloned document before capture.

---

## Browser support

| Browser | Minimum |
| --- | --- |
| Chrome / Edge | 80 |
| Firefox | 74 |
| Safari (macOS / iOS) | 13.1 |

These are **hard minimums, not a graceful-degradation floor.** The source ships untranspiled and uses ES2020 syntax — optional chaining (`?.`), nullish coalescing (`??`) and `globalThis`. An older engine throws a `SyntaxError` while *parsing* the module, before a single line runs, so the whole package fails to load rather than losing a feature. If you must support older browsers, run `cjk-pdf` through your own bundler's transpile step (Babel/esbuild/swc with a lower target) — the runtime APIs it needs (`<canvas>`, `fetch`, `FileReader`, `Promise`) go back much further than the syntax does.

Works in Chrome, Edge, Firefox and Safari, including iOS Safari (mind the canvas-area cap noted above).

Browser only. There is no server-side renderer — the entire premise is that a browser is doing the text layout. For headless PDF generation, drive a real browser (Puppeteer/Playwright `page.pdf()`) instead.

## Development

The published npm package ships `src/`, `README.md` and `LICENSE` only. **Tests and `examples/` are not in the tarball** — clone the repository to get them:

```sh
git clone https://github.com/tangyistudio/cjk-pdf.git
cd cjk-pdf

npm test        # pure math tests, no browser and no dependencies needed
npm run example # serves the repo root; open /examples/basic.html
```

The example page loads `jspdf` and `html2canvas` from a CDN, so nothing needs installing — but it must be served over HTTP. Opening it as a `file://` URL fails, because it imports `../src/index.js` as an ES module.

The pagination and preset modules have no DOM dependency and are tested with the built-in Node test runner. Everything that touches `document` is browser-only and is exercised through the example page.

## License

MIT © 2026 Tangyi Studio

---

Built by [Tangyi Studio](https://github.com/tangyistudio)
