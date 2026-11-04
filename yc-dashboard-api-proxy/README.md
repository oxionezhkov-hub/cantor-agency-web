# Дашборд → Cloudflare через Yandex Cloud (прокладка API)

Зачем: без VPN адрес воркера `mainweb.oxion-ezhkov.workers.dev` у многих
провайдеров тормозит или не открывается, поэтому дашборд на `cantor.agency`
часто не может загрузить данные. Адрес `functions.yandexcloud.net`
открывается из РФ без проблем. Функция принимает запрос дашборда и пересылает
его в воркер со своего сервера, а ответ отдаёт как есть.

Как дашборд выбирает адрес:
- открыт на `cantor.agency` → ходит через эту функцию (если адрес вписан в
  `API_PROXY_URL`), а если функция не ответила — напрямую в воркер;
- открыт на `mainweb.oxion-ezhkov.workers.dev/dashboard` (удобно с VPN, когда
  `cantor.agency` не открывается) → ходит в воркер напрямую, функция не нужна.

Функция пропускает только пути `/api/dashboard/*`, пароль дашборда просто
передаёт дальше — проверяет его сам воркер.

Ещё она отдаёт GET `/feed/<клиент>/…` — фото к XML-фидам автозагрузки Авито
(вкладка «Автозагрузка» на `cantor.agency/avito-bids`): Авито плохо достаёт
`workers.dev`, поэтому в `wrangler.jsonc` задана переменная `FEEDS_PROXY_URL` =
адрес функции, и ссылки на фото в XML имеют вид `<адрес функции>?p=/feed/…/img/…`.
Ответ функции ограничен ~3,5 МБ — для фото хватает, а XML больших клиентов
(5+ МБ) так не пройдёт. Поэтому сам XML, как у BananLab, кладётся в
Yandex Object Storage:

1. Консоль Yandex Cloud → **Object Storage → Создать бакет**, например
   `cantor-feeds`: «Доступ на чтение объектов» — **Публичный**, остальное по умолчанию.
2. **Сервисные аккаунты → Создать**, роль `storage.uploader` (или `storage.editor`) →
   в аккаунте **Создать новый ключ → Статический ключ доступа**. Покажут
   идентификатор ключа и секрет (секрет — только один раз).
3. Cloudflare → mainweb → Settings → Variables and Secrets: `FEEDS_S3_KEY_ID` и
   `FEEDS_S3_SECRET` — секретами («Encrypt»), а имя бакета — переменной
   `FEEDS_S3_BUCKET` в `wrangler.jsonc` (или пришлите его мне).

После этого каждая сборка XML выкладывается в
`https://storage.yandexcloud.net/<бакет>/feeds/<клиент>/avito.xml`, и эта ссылка
становится ссылкой для Авито (кнопка «Подключить на Авито»).

Через эту же функцию работает и платформа стажёров `cantor.agency/academy`:
её API лежит под `/api/dashboard/academy/*` именно для того, чтобы отдельную
функцию не разворачивать (вход стажёров там свой, без пароля дашборда).

Так же работает и трекер задач команды `cantor.agency/avito-tasks`: его API —
`/api/dashboard/avito-tasks/*`, вход по личным пригласительным ссылкам.

## Запросы воркера к API Авито

С 19.10.2026 api.avito.ru почти не отвечает серверам Cloudflare (таймауты, ошибка 522), а из
России работает как обычно. Поэтому воркер ходит в Авито через эту же функцию:
`?p=/avito-api/<путь Авито>` — функция пересылает запрос на `https://api.avito.ru<путь>` с
заголовками `Authorization`, `Content-Type`, `X-Source` и отдаёт ответ как есть. Другие адреса,
кроме api.avito.ru, через неё не открыть.

Данные кабинетов воркер запрашивает путём `?p=/avito-call/<путь Авито>` с заголовками
`x-avito-client-id` и `x-avito-client-secret`: функция сама получает токен кабинета и в том же
вызове делает запрос. Токен, полученный одним вызовом функции, Авито в другом вызове не принимает
(«403 Not authorized» — у вызовов разные исходящие адреса), поэтому всё делается за один вызов.

Чтобы функцией не мог пользоваться кто угодно, задайте ей переменную окружения `PROXY_KEY`
(любая длинная случайная строка), а воркеру — тот же ключ секретом `AVITO_PROXY_KEY`
(Cloudflare → mainweb → Settings → Variables and Secrets, «Encrypt»). Без `PROXY_KEY` функция
пускает к Авито без ключа.

Воркер по умолчанию ходит через эту функцию (`AVITO_PROXY_DEFAULT` в `_worker.js`). Пока у функции
старая версия без `/avito-api/`, воркер сам ходит в Авито напрямую. Другой адрес функции — в
переменной воркера `AVITO_PROXY_URL`, `off` — всегда напрямую.

## Обновить существующую функцию

Консоль Yandex Cloud → **Cloud Functions** → функция с адресом
`https://functions.yandexcloud.net/d4eiu56ijlg0jn5o9rch` → **Редактор** → заменить содержимое
`index.js` на файл из этой папки → **Сохранить изменения** (создаётся новая версия; таймаут
оставить 30 с). Адрес функции не меняется — ничего больше перенастраивать не нужно.

## Развернуть

В консоли: **Cloud Functions → Создать функцию → Node.js 18**, вставить
`index.js` и `package.json` (зависимостей нет), точка входа `index.handler`,
**таймаут 30 с**, память 128 МБ, включить **«Публичная функция»**.

Или через CLI:

```bash
cd yc-dashboard-api-proxy
yc serverless function create --name=dashboard-api-proxy
yc serverless function version create \
  --function-name=dashboard-api-proxy \
  --runtime=nodejs18 \
  --entrypoint=index.handler \
  --memory=128m \
  --execution-timeout=30s \
  --source-path=.
yc serverless function allow-unauthenticated-invoke --name=dashboard-api-proxy
```

Переменные окружения не нужны (`TARGET_ORIGIN` можно задать, только если
адрес воркера поменяется).

## Подключить

HTTP-адрес функции (`https://functions.yandexcloud.net/xxxxxxxxxxxxxxxxxxxx`)
впишите в константу `API_PROXY_URL` в начале `<script>` файла `dashboard`
(или пришлите мне).

## Проверка

```bash
curl -s -o /dev/null -w '%{http_code}\n' '<адрес функции>?p=%2Fapi%2Fdashboard%2Fbootstrap'
# → 401 (нет пароля) — значит, функция достучалась до воркера
```
