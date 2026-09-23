# Локальные шрифты

Unbounded (400–900) и Geologica (300–700) — вариативные woff2 с Google Fonts
(подмножества cyrillic, latin, latin-ext; ₽ входит в latin-ext).

Лежат на нашем домене, чтобы страница не ждала fonts.googleapis.com /
fonts.gstatic.com (из РФ бывают медленными) и шрифт появлялся сразу.

Как подключить на странице вместо Google Fonts:

```html
<link rel="preload" href="/fonts/geologica-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geologica-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/unbounded-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/unbounded-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
```

(или вставить содержимое `fonts.css` прямо в `<style>` страницы — так сделано в `avito-anketa`).
Лицензия шрифтов — SIL Open Font License, копирование разрешено.
