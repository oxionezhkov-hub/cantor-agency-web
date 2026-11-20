const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clients = [
  'oksana-alekseeva', 'oksana-babushkina', 'elena-burmakova', 'olga-gubkina',
  'maria-dudorova', 'elena-limperis', 'ivan-hlebnikov', 'ivan-karientidi',
  'anastasia-konykhova', 'irina-korenskaya', 'larisa-romashova', 'gulnara-lyutova',
  'marina-mitkaleva', 'stanislav-morozov', 'nikolay-poleshchuk', 'inga-ryumina',
  'svetlana-soboleva', 'rabdan-tikhov', 'olga-ustenko', 'maxim-fadeev',
  'dilya-shaykhislamova', 'alexey-shevchuk', 'alexandra-shchukina',
];

for (const client of clients) {
  test(`${client}: complete page, local assets, navigation and named episodes`, () => {
    const html = fs.readFileSync(path.join(root, 'client', client), 'utf8');
    assert.match(html, /<html lang="ru">/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, /href="client-polish\.css\?v=[^"]+"/);
    assert.doesNotMatch(html, /class="progress"/);
    assert.doesNotMatch(html, /<figure class="[^"]*h-photo[^\"]*">\s*<\/figure>/);
    assert.doesNotMatch(html, /<strong>Подкаст \d<\/strong>|Видео скоро|появятся здесь совсем скоро/);

    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(ids.has(target), `${client}: missing anchor #${target}`);
    }
    for (const [tag] of html.matchAll(/<img\b[^>]*\bsrc="images\/[^\"]+"[^>]*>/g)) {
      const src = tag.match(/\bsrc="([^"]+)"/)[1];
      assert.ok(fs.existsSync(path.join(root, 'client', src)), `${client}: missing ${src}`);
      assert.match(tag, /\bwidth="\d+"/);
      assert.match(tag, /\bheight="\d+"/);
    }
    const videos = [...html.matchAll(/\bdata-title="([^"]+)"/g)].map(m => m[1]);
    const captions = [...html.matchAll(/<h3 class="podcast-title">([^<]+)<\/h3>/g)].map(m => m[1]);
    assert.deepEqual(videos, captions, `${client}: episode captions must match player titles`);
    for (const title of videos) assert.doesNotMatch(title, /^Подкаст \d+$/);
    for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => new vm.Script(script, { filename: client }));
    }
  });
}

test('restored Burmakova page uses her source material and contact destination', () => {
  const html = fs.readFileSync(path.join(root, 'client/elena-burmakova'), 'utf8');
  assert.match(html, /Елена Бурмакова/);
  assert.match(html, /https:\/\/elennl\.ru/);
  assert.match(html, /https:\/\/t\.me\/elena_burmakova/);
  assert.doesNotMatch(html, /Оксана|Алексеева|oksana-alekseeva/);
});
