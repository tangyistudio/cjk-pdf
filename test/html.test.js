import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../src/html.js';

test('the five significant characters are replaced', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('a tag cannot survive interpolation', () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(escapeHtml('</p><script>'), '&lt;/p&gt;&lt;script&gt;');
});

test('ampersands are not double-escaped', () => {
  // The classic bug: replace `<` first and `&` last, and `&lt;` becomes
  // `&amp;lt;`. Each source character must be visited exactly once.
  assert.equal(escapeHtml('a < b & c'), 'a &lt; b &amp; c');
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
});

test('an escaped value cannot break out of a quoted attribute', () => {
  const value = '" onload="alert(1)';
  const html = `<div title="${escapeHtml(value)}">`;
  assert.ok(!html.includes('onload="'), html);

  const single = "' onload='alert(1)";
  const singleHtml = `<div title='${escapeHtml(single)}'>`;
  assert.ok(!singleHtml.includes("onload='"), singleHtml);
});

test('no angle bracket survives in the output', () => {
  assert.ok(!/[<>]/.test(escapeHtml('<b>&</b>')));
});

test('null and undefined become an empty string, not their names', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
});

test('other primitives are stringified', () => {
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
  assert.equal(escapeHtml(NaN), 'NaN');
  assert.equal(escapeHtml(12.5), '12.5');
});

test('CJK text, punctuation and emoji pass through untouched', () => {
  const source = '你好，世界「引號」・日本語のテキスト・한국어 🎉';
  assert.equal(escapeHtml(source), source);
});

test('text with no significant characters is returned unchanged', () => {
  const source = 'plain text 123 - _ / \\ %';
  assert.equal(escapeHtml(source), source);
});
