'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'promo-platform');
const original = fs.readFileSync(file, 'utf8');
const css = fs.readFileSync(path.join(root, 'promo-platform.css'), 'utf8').trim();
const js = fs.readFileSync(path.join(root, 'promo-platform-ui.js'), 'utf8').trim();

// The server caches .css/.js for 45 days. Keeping this page's presentation and
// behaviour in the HTML prevents new markup from running with old cached assets.
if (/<\/style/i.test(css) || /<\/script/i.test(js)) {
  throw new Error('An embedded source contains a closing HTML tag');
}
let page = original;
for (const [tag, id, source] of [
  ['style', 'platform-styles', css],
  ['script', 'platform-ui', js],
]) {
  const pattern = new RegExp(`<${tag} id="${id}">[\\s\\S]*?<\\/${tag}>`, 'g');
  if ([...page.matchAll(pattern)].length !== 1) throw new Error(`Expected one ${id} block`);
  page = page.replace(pattern, () => `<${tag} id="${id}">\n${source}\n</${tag}>`);
}
const build = crypto.createHash('sha256').update(css).update('\0').update(js).digest('hex').slice(0, 16);
page = page.replace(/\sdata-platform-build="[^"]*"/, '');
page = page.replace('<html lang="ru"', `<html lang="ru" data-platform-build="${build}"`);
if (process.argv.includes('--check')) {
  if (page !== original) {
    console.error('Landing sources changed. Run node scripts/build-promo-platform.cjs.');
    process.exitCode = 1;
  } else console.log(`Landing is current: ${build}`);
} else {
  fs.writeFileSync(file, page);
  console.log(`Built self-contained landing: ${build}`);
}
