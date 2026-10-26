# Repository notes for Claude

## PR monitoring: no timer-based polling

When watching a PR in this repo (via `subscribe_pr_activity` or similar), do
**not** schedule a recurring `send_later`/check-in wakeup "just in case" to
re-check CI or mergeability. The PR subscription already delivers CI
failures, new comments, reviews, and check-suite completions as events —
that is the mechanism for staying informed, not a timer.

- Rely on the webhook/event subscription to wake the session when something
  actually happens (CI result, comment, review, merge-conflict transition).
- Do not create a `send_later` reminder to "check back in an hour" after
  confirming a PR is green/mergeable/draft with nothing pending — that just
  burns tokens re-fetching state that hasn't changed.
- If you must schedule a follow-up (e.g. because the harness note asks for
  one), only do it when there is a concrete, unresolved blocker you are
  actively waiting on — not as a routine heartbeat.
- When the user says they're stepping away and will check back later,
  don't compensate by scheduling checks on their behalf; just leave the
  PR subscribed and let events (or the user, on return) drive the next step.

## Live data: read it through the worker's API

When the user asks for analysis of clients, Avito cabinets, chats or mailings, don't say there is no
access: the production worker answers HTTP requests and its API has everything the dashboard and
the tracker show. Base URL: `https://mainweb.oxion-ezhkov.workers.dev` (from this container, plain
`curl` works).

Passwords — never write them into the repo, a commit or a PR; ask the user for them in the session:
- `/api/dashboard/*` — header `x-dashboard-password: <dashboard password>`.
- `/api/avito/*` — header `x-dashboard-password: <AVITO_API_PASSWORD>` (the worker secret; until it
  is set, the dashboard password). Without it the answer is 401.

Read-only by default: use GET (and the read-only POST below); never call endpoints that add, change
or delete data (`POST/PUT/DELETE /api/avito/accounts`, `POST /api/dashboard/daily-metric`, …) unless
the user explicitly asks for that change.

Dashboard (projects = the agency's clients):
- `GET /api/dashboard/bootstrap` — `projects` (id, name, avitoAccountId, …), `dailyMetrics`
  (projectId, date, budget, views, contacts, diagnostics, sales — the Analytics table), `analytics`
  (monthly), `tasks`, `employees`.
- `GET /api/dashboard/avito-yesterday?projectId=<id>&date=YYYY-MM-DD` — one cabinet's day straight
  from Avito (views, contacts, spend, advance, errors[]).
- `GET /api/dashboard/avito-pull?date=YYYY-MM-DD` — the «Подтянуть» pull for a day, per client.
- `GET /api/dashboard/avito-links` — which Avito cabinet belongs to which client.
- `GET /api/dashboard/reflection?week=YYYY-MM-DD` — the weekly «Рефлексия» (week starts on a
  Wednesday; default — the current one): each employee's score 1–10 and comment per client, plus history.
- `GET /api/dashboard/chat-log` — Telegram chats the control bot logs (work-chat topics, client
  chats): `sources` with chatId, threadId, label, projectId. With `?projectId=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD`
  (or `?chatId=…&threadId=…`) — also `messages` (t, at, source, from, team, text), oldest first; MSK
  days, last 30 days by default, at most 120. Use it for what was agreed with a teacher: mailings and
  their budgets, personal targets, recommendations, launch dates.

Avito cabinets (ids from `/api/avito/accounts`, the same as `project.avitoAccountId`):
- `GET /api/avito/accounts` — cabinets: id, name, userId (secrets never come back).
- `GET /api/avito/overview?accountId=<id>&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` — listings with
  views / contacts / favorites for the period, rating.
- `GET /api/avito/chats?accountId=<id>&limit=100&offset=0` — chats, newest first (`updated`,
  `item_title`, last message).
- `GET /api/avito/messages?accountId=<id>&chatId=<chat_id>` — a chat's messages, oldest first;
  `author` is `manager` (the cabinet, i.e. our client) or `client` (a parent / student writing in).
- `GET /api/avito/autoload?accountId=<id>` — the last autoload report.

Reading Avito chats: the mailing (an «предложение», e.g. a free consultation) shows up as system
messages «Пользователь ознакомился с вашим предложением…» (opened) and «Покупателя заинтересовало
ваше предложение» (interested) — they contain non-breaking spaces, match with `\s`. How many offers
were sent in total is not in the API. Requests to Avito go through the Yandex Cloud function
(`yc-dashboard-api-proxy`), so a cabinet can be slow (tens of seconds) — fetch messages a few chats
at a time, not dozens in parallel.
