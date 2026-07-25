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

### Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `filename` | `string` | `'document.pdf'` | Illegal filename characters are stripped. |
| `output` | `'save' \| 'blob' \| 'dataurl' \| 'arraybuffer' \| 'doc'` | `'save'` | `'save'` triggers a browser download. |
| `pageSize` | `'a3' \| 'a4' \| 'a5' \| 'a6' \| 'letter' \| 'legal' \| 'tabloid' \| {width,height}` | `'a4'` | Custom sizes are in millimetres. |
| `orientation` | `'portrait' \| 'landscape'` | `'portrait'` | |
| `margin` | `number` | `0` | Uniform page margin, in mm. |
| `scale` | `number \| 'screen' \| 'print' \| 'high'` | `'print'` | 1x / 2x / 3x device pixels. |
| `dpi` | `number` | `96` | Used for mm ↔ CSS px conversion. |
| `mode` | `'slice' \| 'fit'` | `'slice'` | `slice` flows tall content across pages; `fit` shrinks each element onto one page. |
| `background` | `string \| null` | `'#ffffff'` | `null` gives a transparent canvas (PNG only). |
| `imageFormat` | `'JPEG' \| 'PNG'` | `'JPEG'` | JPEG is 5-10x smaller for photographic pages. |
| `imageQuality` | `number` | `0.92` | JPEG only, 0-1. |
| `inlineImages` | `boolean \| object` | `true` | See gotcha #1. Pass an object to configure, `false` to skip. |
| `watermark` | `object \| null` | `null` | `{ text, subtext, mode, color, fontSize, opacity, angle, gap }`. |
| `onProgress` | `function` | — | `({ phase, current, total }) => void`. |
| `jsPDF` / `html2canvas` | `function` | auto | Pass explicitly if auto-detection cannot find them. |
| `html2canvasOptions` | `object` | `{}` | Escape hatch, merged last. |

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
import { resolvePageSize, mmToPx } from 'cjk-pdf/presets';
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

It lays out completely, and it is invisible. `visibility: hidden` and `opacity: 0` do lay out, but html2canvas faithfully reproduces the invisibility and you get a blank page again. `createOffscreenContainer()` does this correctly.

Related: give the browser a frame to actually paint freshly injected DOM before measuring it. `htmlToPDF` awaits two animation frames plus a short timeout; if you drive `renderToCanvas` yourself, `await settle()` first.

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

### 4. Fonts must exist on the rendering machine

The browser does the shaping, so it picks from the fonts *that browser* has. A Traditional Chinese page rendered on a machine without a TC font falls back to whatever is available, and you can get Simplified glyph shapes or, in the worst case, tofu again — just from a different cause.

Load a webfont and wait for it before exporting:

```js
await document.fonts.ready;
await elementToPDF(el, { filename: 'report.pdf' });
```

### 5. Other sharp edges

- **Web fonts must be same-origin or CORS-enabled.** html2canvas re-reads stylesheets in a cloned document; a cross-origin `@font-face` that the page renders fine may be dropped in the capture.
- **CSS transforms, filters and `mix-blend-mode` are approximations.** html2canvas reimplements the rendering; it is not a screenshot API. Complex effects may differ.
- **Iframes, `<video>`, WebGL and shadow DOM** are partly or wholly unsupported.
- **Position `sticky` elements** are captured wherever they currently sit. Scroll to top, or mark them `data-cjk-pdf-ignore`.
- **Animations mid-flight** would be frozen half-drawn; `cjk-pdf` disables transitions and animations inside the cloned document before capture.

---

## Browser support

Any browser with `<canvas>`, `fetch`, `FileReader` and ES modules: Chrome/Edge 63+, Firefox 67+, Safari 11.1+. Works in Chrome, Edge, Firefox and Safari, including iOS Safari (mind the canvas-area cap noted above).

Browser only. There is no server-side renderer — the entire premise is that a browser is doing the text layout. For headless PDF generation, drive a real browser (Puppeteer/Playwright `page.pdf()`) instead.

## Development

```sh
npm test                      # pure math tests, no browser needed
npx serve .                   # then open /examples/basic.html
```

The pagination and preset modules have no DOM dependency and are tested with the built-in Node test runner.

## License

MIT © 2026 Tangyi Studio

---

Built by [Tangyi Studio](https://github.com/TangyiStudio)
