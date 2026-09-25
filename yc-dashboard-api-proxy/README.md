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
