'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'promo-platform'), 'utf8');

test('new landing cannot load stale CSS or JavaScript from the 45-day asset cache', () => {
  assert.doesNotMatch(page, /<script\b[^>]*\bsrc=/i);
  const stylesheets = [...page.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)];
  assert.equal(stylesheets.length, 1);
  assert.match(stylesheets[0][0], /href="\/fonts\/fonts\.css"/);
  const style = page.match(/<style id="platform-styles">([\s\S]*?)<\/style>/);
  const script = page.match(/<script id="platform-ui">([\s\S]*?)<\/script>/);
  assert.ok(style && script, 'presentation and behaviour travel with the HTML');
  assert.match(style[1], /\.site-header\s*\{/);
  assert.match(style[1], /\.ai-core\s*\{/);
  assert.match(style[1], /\.engine-card\s*\{/);
  assert.match(script[1], /header\.inert/);
});

test('embedded assets match the reviewed sources', () => {
  const css = fs.readFileSync(path.join(root, 'promo-platform.css'), 'utf8').trim();
  const js = fs.readFileSync(path.join(root, 'promo-platform-ui.js'), 'utf8').trim();
  assert.equal(page.match(/<style id="platform-styles">([\s\S]*?)<\/style>/)[1].trim(), css);
  assert.equal(page.match(/<script id="platform-ui">([\s\S]*?)<\/script>/)[1].trim(), js);
});

test('all shipped inline scripts parse', () => {
  const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 2);
  for (const [, code] of scripts) assert.doesNotThrow(() => new vm.Script(code));
});

test('only contact fields and consent are mandatory; funnel stays on the page', () => {
  const required = [...page.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)]
    .map(m => m[0]).filter(tag => /\brequired\b/.test(tag))
    .map(tag => tag.match(/name="([^"]+)"/)[1]).sort();
  assert.deepEqual(required, ['consent', 'name', 'telegram', 'testing']);
  for (const [, href] of page.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
    assert.ok(href.startsWith('#') || href === '/politika', href);
  }
});

test('pointer focus moving into an option must not close its picker', () => {
  const ui = fs.readFileSync(path.join(root, 'promo-platform-ui.js'), 'utf8');
  // Exercise the actual registered callback in the native focus transition:
  // activeElement can still be body while relatedTarget already names the option.
  const callback = ui.match(/wrap\.addEventListener\('focusout', ([\s\S]*?\n    \})\);/);
  assert.ok(callback, 'picker has a focusout handler');
  const option = {};
  let closed = 0;
  const handler = vm.runInNewContext(`(${callback[1]})`, {
    wrap: { contains: node => node === option },
    close: () => { closed++; },
    document: { activeElement: {} },
    queueMicrotask: action => action(),
  });
  handler({ relatedTarget: option });
  assert.equal(closed, 0, 'keep the option available for pointerup/click');
  handler({ relatedTarget: {} });
  assert.equal(closed, 1, 'close when focus moves to a different field');
  handler({ relatedTarget: null });
  assert.equal(closed, 2, 'close when focus leaves the document');
});
