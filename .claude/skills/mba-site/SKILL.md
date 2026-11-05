---
name: mba-site
description: Личный сайт участника МБА «Личный бренд» в одном из трёх шаблонов Анны Алёшиной (дизайн А/Б/В) — по согласованной структуре, правкам клиента, его картинкам и подкастам с Vimeo. Используй, когда просят собрать / обновить шаблонный сайт для клиента МБА.
argument-hint: "<slug> [<slug> ...]"
---

# Скилл: шаблонный сайт клиента МБА

Сборка: `python3 .claude/skills/mba-site/build.py <slug>` (или `--all`).
Наполнение — `.claude/skills/mba-site/content/<slug>.json`, результат — `client/<slug>`
(страница без расширения, адрес `cantor.agency/client/<slug>`) и `client/images/<slug>/`.

## Дизайны

Выбор клиента — в CRM, задача `siteFormat` («Дизайн 1/А · Тильда»). 1 = А = `client/anna-aleshina1`
(«Бланк»), 2 = Б = `anna-aleshina2` («Аудитория»), 3 = В = `anna-aleshina3` («Кабинет»).
Из шаблона берутся `<head>`/стили и скрипт, разметка собирается в `build.py`; недостающие
компоненты (карточки, шаги, галереи, подкасты) — классы `x-*` в `XCSS_COMMON`/`XCSS`.
Клиенты с Тильдой получают тот же HTML — переносит менеджер.

## Правила

- `<title>` — только «Имя Фамилия». Формы связи нет: блок «Связаться» — ссылки
  (Telegram, WhatsApp, телефон, почта) из брифа или из ответов клиента.
- Тексты — из согласованной структуры (`site-structure/data/<slug>.json`) с правками клиента
  (ветка клиента в чате «Клиенты MBA», скриншоты черновика, голосовые). Вопросы «Нужно от вас»
  и служебные «purpose» на сайт не попадают.
- Подкасты — Vimeo id из `mba-mybrand/<slug>-podcastN`, постер — oEmbed-превью.
- Картинки выбирает менеджер в галерее-артефакте (слоты: hero, about, contact, logo, projects,
  results, diplomas, reviews, books); исходники в `content.images` — имена файлов в
  `src/<slug>/` (в `.gitignore`, не публикуются). Пустой слот — блок без картинки.
- Реквизиты в подвале — ИП/ИНН/ОГРНИП; домашний адрес и банковские реквизиты не публикуем.

## Формат content/<slug>.json

`slug, name, first, last, design (1|2|3), hero{lead, stats[], badge?}, about{lead, text, after,
timeline[], quote}, sections[{id, title, nav?, slots?, blocks[]}], reviews{title, lead, links},
books{items[]}, media{links[]}, podcasts[{vimeo, title}], contact{title, lead, items[]},
footer{text, req[], links[]}, images{slot: [{src, cap}]}, css?`.
Блоки секций — как в структуре: `h3` (с `link`, `logo`), `text`, `stats`, `cards`, `steps`,
`list`, `quote`, `links`, `lead`.

Проверка: скопировать `client/<slug>` в `.html` рядом с `client/images`, открыть на 1280 и 390 px —
без горизонтального скролла, ошибок и битых картинок.
