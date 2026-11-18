'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const expected = fs.readFileSync(path.resolve(__dirname, '../promo-platform'));
const url = process.argv[2] || 'https://cantor.agency/promo-platform';
(async () => {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Landing HTTP ${response.status}`);
  if (!/text\/html/.test(response.headers.get('content-type'))) throw new Error('Landing is not HTML');
  const actual = Buffer.from(await response.arrayBuffer());
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  if (hash(actual) !== hash(expected)) throw new Error('Production HTML differs from the checked build');
  console.log(`Production matches the complete checked landing: ${hash(actual).slice(0, 16)}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
