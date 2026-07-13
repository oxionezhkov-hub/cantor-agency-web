# mba-mybrand — worker

Backend for the `/mba-mybrand` brief page: stores the questionnaire schema
and every client's answers in a Cloudflare KV namespace, and serves a small
JSON API that the static page calls with `fetch`.

The KV namespace (`MBA_MYBRAND_KV`, id `d6de16be80b74e07a8d2ebe1e0aae5cc`)
already exists in the Cloudflare account and is wired up in `wrangler.toml`.

## Deploy

```bash
cd workers/mba-mybrand
npx wrangler login      # once, if you haven't already
npx wrangler deploy
```

Wrangler will print the deployed URL, e.g.:

```
https://mba-mybrand.<your-subdomain>.workers.dev
```

Open `/mba-mybrand` in this repo and set `API_BASE` at the top of the
`<script>` block to that URL (look for the `CHANGE ME AFTER DEPLOY` comment).
Redeploy the static site so the change goes live.

## CORS

The worker only allows requests from `https://cantor.agency` and
`https://www.cantor.agency` (see `ALLOWED_ORIGINS` in `worker.js`). Add any
other origin you need to test from (e.g. a staging domain) to that list
before deploying.

## Local development

```bash
cd workers/mba-mybrand
npx wrangler dev
```

This runs the worker locally with a simulated KV store (no Cloudflare
account access needed) at `http://localhost:8787`. Point `API_BASE` at that
URL temporarily while testing.

## API

| Method | Path                        | Who    | Purpose                              |
|--------|-----------------------------|--------|---------------------------------------|
| GET    | `/api/schema`               | public | Current blocks/questions              |
| PUT    | `/api/admin/schema`         | admin  | Replace blocks/questions              |
| POST   | `/api/client`                | client | Get-or-create a client by email       |
| POST   | `/api/client/save`           | client | Autosave answers + current block      |
| GET    | `/api/admin/clients`         | admin  | Full list of clients + answers        |
| PUT    | `/api/admin/client`          | admin  | Edit a client's answers/notes         |
| POST   | `/api/admin/client/share`    | admin  | Create/rotate a public share link     |
| POST   | `/api/admin/client/unshare`  | admin  | Revoke a public share link            |
| GET    | `/api/share?id=...`         | public | Read-only view of a shared client     |

There is no server-side admin password — the `/mba-mybrand` page only shows
the admin UI when "admin" is typed in the email field, per the agency's
choice. The `/api/admin/*` endpoints themselves are not secret; don't link
to the worker URL publicly.
