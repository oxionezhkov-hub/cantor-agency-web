# Заявки со свет­ланы-идрисовой в Google Таблицу

Эта функция принимает POST-запрос с формы `client/svetlana-idrisova`
(«Записаться на пробное занятие») и добавляет строку в Google Таблицу.
Код уже готов — здесь описано, что нужно настроить вручную в Google Cloud
и Yandex Cloud, потому что это требует доступа к вашим аккаунтам.

## 1. Google Sheets: сервисный аккаунт

1. Откройте https://console.cloud.google.com/ (можно в существующем проекте
   или создайте новый).
2. **APIs & Services → Library** → найдите **Google Sheets API** → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
   Имя — например `svetlana-idrisova-form`. Роль не обязательна (доступ
   даётся отдельно, на саму таблицу).
4. Откройте созданный сервисный аккаунт → вкладка **Keys → Add Key →
   Create new key → JSON**. Скачается файл вида
   `project-name-xxxxx.json` — он понадобится на шаге 3.
5. Создайте Google Таблицу (или используйте существующую) для заявок.
   Добавьте в неё лист с названием **«Заявки»** и, по желанию, шапку в
   первой строке:
   `Дата | Имя ученика | Фамилия ученика | Класс | Формат | Цель | Родитель | Телефон | Email | Согласие на рекламу`
6. Скопируйте **ID таблицы** — это часть ссылки между `/d/` и `/edit`:
   `https://docs.google.com/spreadsheets/d/ЭТОТ_ID/edit`
7. Откройте таблицу → **Настройки доступа (Share)** → добавьте email
   сервисного аккаунта (поле `client_email` из скачанного JSON, вида
   `svetlana-idrisova-form@project-name.iam.gserviceaccount.com`) с правами
   **Редактор**.

## 2. Разверните функцию в Yandex Cloud

Понадобится [Yandex Cloud CLI](https://yandex.cloud/ru/docs/cli/quickstart)
(`yc`), уже авторизованный на ваш аккаунт.

```bash
cd yc-svetlana-idrisova-form
npm install --omit=dev   # подтягивает jsonwebtoken в node_modules

yc serverless function create --name=svetlana-idrisova-form

yc serverless function version create \
  --function-name=svetlana-idrisova-form \
  --runtime=nodejs18 \
  --entrypoint=index.handler \
  --memory=128m \
  --execution-timeout=10s \
  --source-path=. \
  --environment GOOGLE_SERVICE_ACCOUNT_EMAIL="<client_email из JSON>" \
  --environment GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="<private_key из JSON, с \n вместо переносов строк>" \
  --environment GOOGLE_SHEET_ID="<ID таблицы с шага 1.6>"

# Разрешить вызовы без авторизации (форма на сайте зовёт функцию напрямую из браузера):
yc serverless function allow-unauthenticated-invoke --name=svetlana-idrisova-form
```

Про `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: в JSON-файле значение выглядит как
`"-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"` —
скопируйте это значение **как есть**, вместе с символами `\n` (не настоящими
переносами строк) — функция сама заменит их на переносы.

После деплоя команда выведет **HTTP-адрес функции**, либо посмотрите его в
консоли: **Cloud Functions → svetlana-idrisova-form → Обзор → HTTP-адрес**
(вида `https://functions.yandexcloud.net/xxxxxxxxxxxxxxxxxxxx`).

## 3. Подключите адрес к сайту

Пришлите мне этот HTTP-адрес (или сами замените в
`client/svetlana-idrisova` константу `API_BASE` рядом с функцией
`submitForm()` — сейчас там стоит комментарий-заглушка) — и заявки с формы
начнут падать строками в вашу таблицу.

## Обновление функции

После любых правок в `index.js`:

```bash
yc serverless function version create \
  --function-name=svetlana-idrisova-form \
  --runtime=nodejs18 \
  --entrypoint=index.handler \
  --memory=128m \
  --execution-timeout=10s \
  --source-path=. \
  --environment GOOGLE_SERVICE_ACCOUNT_EMAIL="..." \
  --environment GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="..." \
  --environment GOOGLE_SHEET_ID="..."
```

(переменные окружения нужно указывать заново при каждой новой версии).
