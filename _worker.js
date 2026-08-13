/**
 * mainweb — serves the whole site as static assets (see wrangler.jsonc "assets.directory": ".")
 * and additionally runs this script first for /api/* (assets.run_worker_first) to power
 * the /mba-mybrand brief page's backend: questionnaire schema and client answers in KV.
 * It also powers /utm-create: creating trackable UTM redirect links and serving the
 * /r/<slug> redirector that logs click stats.
 *
 * KV keys (binding "MBA_MYBRAND_KV"):
 *   schema                -> { blocks: [...] }
 *   client:<email-lower>  -> { email, createdAt, updatedAt, currentBlock, answers, notes, shareId }
 *   share:<shareId>       -> "<email-lower>"
 *   email_usage:day:<YYYY-MM-DD>    -> count of lead emails sent via Resend that day
 *   email_usage:month:<YYYY-MM>     -> count of lead emails sent via Resend that month
 *   email_usage_warned:day:<...>    -> "1" once a 90%-of-limit warning has been sent for that day
 *   email_usage_warned:month:<...>  -> "1" once a 90%-of-limit warning has been sent for that month
 *
 * KV keys (binding "UTM_LINKS_KV"):
 *   link:<slug>              -> { slug, targetUrl, utm, createdAt, ourLink, shortUrl, clicks }
 *   click:<slug>:<ts>:<rand> -> { ts, query, referrer, userAgent, device, country, city }
 *
 * It also powers /serp-analysis: an internal tool for the "поисковая выдача" analysis
 * (part of the MBA/личный бренд package) — staff fill in 4 tables (Yandex/Google ×
 * "ФИО"/"ФИО + онлайн-школа" queries) plus a recommendations checklist and an overall
 * score, then share a read-only link with the client. Admin views are gated client-side
 * by a shared password, cached in the browser (not a real auth boundary).
 *
 * KV keys (binding "SERP_ANALYSIS_KV"):
 *   template               -> shared editable template: table titles, column labels,
 *                              status options (label + hex color) and base recommendations
 *                              copied into every new analysis
 *   analysis:<id>          -> { id, createdAt, updatedAt, clientName, analysisTitle, intro,
 *                                score, tables: { yandexName, googleName, yandexSchool,
 *                                googleSchool: [rows] }, recommendations: [{id,text,checked}],
 *                                shareId }
 *   share:<shareId>        -> "<analysisId>"
 *
 * It also powers the CRM tab of the /mba-mybrand admin panel: a client list with a fixed
 * onboarding checklist (brief, SERP analysis, 3 podcasts each with 5 subtasks, website) and
 * a "problem client" flag. Clients can be added manually, and every "client:<email>" brief
 * record is also auto-pulled in (deduped by normalized email) so the two lists stay in sync
 * without staff re-entering people by hand. Uses the same MBA_MYBRAND_KV namespace as the
 * brief tool, under its own key prefix:
 *
 * KV keys (binding "MBA_MYBRAND_KV", CRM prefix):
 *   crm:client:<id>  -> { id, email, name, problem, createdAt, updatedAt, fromBrief,
 *                          tasks: { brief:{done,comment}, serp:{done,comment},
 *                                   podcast1:{date,script,recording,editing,texts: {done,comment}},
 *                                   podcast2:{...}, podcast3:{...}, site:{done,comment} } }
 *
 * It also powers /avito-export: a button-triggered export of Avito Messenger dialogs and
 * per-listing stats (impressions/views/contacts/spend), for pasting into quality-of-communication
 * analysis. Supports any number of Avito "кабинеты" (accounts), each with its own OAuth
 * client_credentials pair, so staff can pick a cabinet + date range and export on demand —
 * no cron, no bot. Endpoint/scope names for Avito's stats API were not directly verifiable
 * against developers.avito.ru while writing this — see AVITO_* version constants near
 * runAvitoExport() if Avito has since renamed a path.
 *
 * KV keys (binding "AVITO_KV"):
 *   account:<id>            -> { id, name, clientId, clientSecret, userId, createdAt, updatedAt, lastExportAt }
 *   token:<accountId>       -> { accessToken, expiresAt }  (cached OAuth token, refreshed on expiry)
 *   runlog:<accountId>:<ts> -> { id, accountId, dateFrom, dateTo, startedAt, finishedAt, status, counts, errors }
 */

const SCHEMA_KEY = 'schema';

const DEFAULT_SCHEMA = {
  blocks: [
    {
      id: 'company',
      title: 'О компании',
      description: 'Расскажите, чем вы занимаетесь.',
      questions: [
        { id: 'company_name', type: 'short', label: 'Название компании / бренда', example: 'MyBrand', required: true },
        { id: 'company_field', type: 'short', label: 'Сфера деятельности', example: 'Онлайн-школа английского языка', required: true },
        { id: 'company_about', type: 'long', label: 'Кратко о компании и её истории', example: 'Работаем с 2019 года, более 3000 выпускников...', required: false },
      ],
    },
    {
      id: 'audience',
      title: 'Аудитория и рынок',
      description: 'Кто ваши клиенты и с кем вы конкурируете.',
      questions: [
        { id: 'audience_who', type: 'long', label: 'Кто ваша целевая аудитория', example: 'Женщины 25-40 лет, готовятся к переезду...', required: true },
        { id: 'competitors', type: 'long', label: 'Кто ваши основные конкуренты', example: 'Skyeng, Puzzle English', required: false },
        {
          id: 'market_time',
          type: 'single',
          label: 'Как долго вы на рынке',
          options: ['Меньше года', '1–3 года', '3–5 лет', 'Больше 5 лет'],
          required: false,
        },
      ],
    },
    {
      id: 'goals',
      title: 'Цели проекта',
      description: 'Что должен решить новый бренд.',
      questions: [
        {
          id: 'need',
          type: 'multi',
          label: 'Что нужно',
          options: ['Логотип', 'Фирменный стиль', 'Нейминг', 'Позиционирование', 'Сайт', 'Другое'],
          required: true,
        },
        { id: 'goal_task', type: 'long', label: 'Какую задачу должен решить новый бренд', example: 'Выделиться среди конкурентов, повысить доверие...', required: true },
      ],
    },
    {
      id: 'style',
      title: 'Стиль и референсы',
      description: 'Что нравится, а чего хочется избежать.',
      questions: [
        { id: 'style_likes', type: 'long', label: 'Какие бренды вам нравятся и почему', example: '', required: false },
        { id: 'style_avoid', type: 'long', label: 'Чего категорически хочется избежать', example: '', required: false },
      ],
    },
    {
      id: 'contacts',
      title: 'Контакты и сроки',
      description: 'Как и когда с вами связаться.',
      questions: [
        { id: 'contact_name', type: 'short', label: 'Имя контактного лица', example: '', required: true },
        { id: 'contact_channel', type: 'short', label: 'Телефон или Telegram', example: '@username', required: true },
        {
          id: 'deadline',
          type: 'single',
          label: 'Желаемый срок',
          options: ['До 2 недель', '2–4 недели', '1–2 месяца', 'Не срочно'],
          required: false,
        },
      ],
    },
  ],
};

function corsHeaders() {
  // Same-origin in production (served by this same worker), kept permissive
  // so the page also works if it's ever fetched from another host during testing.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function emptyClient(email) {
  const now = new Date().toISOString();
  return {
    email,
    createdAt: now,
    updatedAt: now,
    currentBlock: 0,
    answers: {},
    notes: '',
    shareId: null,
  };
}

async function getSchema(env) {
  const stored = await env.MBA_MYBRAND_KV.get(SCHEMA_KEY, 'json');
  return stored || DEFAULT_SCHEMA;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const UTM_FIELDS = ['source', 'medium', 'campaign', 'term', 'content'];

function isValidHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildTargetUrl(targetUrl, utm) {
  const u = new URL(targetUrl);
  for (const field of UTM_FIELDS) {
    const value = utm[field];
    if (value) u.searchParams.set(`utm_${field}`, value);
  }
  return u.toString();
}

async function generateSlug(kv) {
  for (let i = 0; i < 5; i++) {
    const slug = crypto.randomUUID().replace(/-/g, '').slice(0, 7);
    const existing = await kv.get(`link:${slug}`);
    if (!existing) return slug;
  }
  throw new Error('slug_generation_failed');
}

async function shortenViaClck(longUrl) {
  try {
    const res = await fetch(`https://clck.ru/--?url=${encodeURIComponent(longUrl)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return isValidHttpUrl(text) ? text : null;
  } catch {
    return null;
  }
}

function detectDevice(userAgent) {
  const ua = String(userAgent || '');
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

async function handleUtmApi(request, env, url) {
  const { pathname } = url;
  const kv = env.UTM_LINKS_KV;

  // ── Create a tracked UTM link ──
  if (pathname === '/api/utm/create' && request.method === 'POST') {
    const body = await readJson(request);
    const targetUrl = String((body && body.targetUrl) || '').trim();
    if (!isValidHttpUrl(targetUrl)) return json({ error: 'invalid_target_url' }, 400);

    const utm = {};
    for (const field of UTM_FIELDS) {
      const value = body && body[field];
      if (typeof value === 'string' && value.trim()) utm[field] = value.trim();
    }

    const slug = await generateSlug(kv);
    const ourLink = `${url.origin}/r/${slug}`;
    const shortUrl = await shortenViaClck(ourLink);

    const record = {
      slug,
      targetUrl,
      utm,
      createdAt: new Date().toISOString(),
      ourLink,
      shortUrl,
      clicks: 0,
    };
    await kv.put(`link:${slug}`, JSON.stringify(record));
    return json({ link: record });
  }

  // ── List all tracked links ──
  if (pathname === '/api/utm/list' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'link:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const links = records.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return json({ links });
  }

  // ── Per-link click stats ──
  if (pathname === '/api/utm/stats' && request.method === 'GET') {
    const slug = url.searchParams.get('slug');
    if (!slug) return json({ error: 'missing_slug' }, 400);

    const link = await kv.get(`link:${slug}`, 'json');
    if (!link) return json({ error: 'not_found' }, 404);

    const list = await kv.list({ prefix: `click:${slug}:`, limit: 500 });
    const clicks = (await Promise.all(list.keys.map((k) => kv.get(k.name, 'json'))))
      .filter(Boolean)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return json({ link, clicks });
  }

  // ── Delete a tracked link ──
  if (pathname === '/api/utm/delete' && request.method === 'POST') {
    const body = await readJson(request);
    const slug = body && body.slug;
    if (!slug) return json({ error: 'missing_slug' }, 400);

    await kv.delete(`link:${slug}`);
    const list = await kv.list({ prefix: `click:${slug}:` });
    await Promise.all(list.keys.map((k) => kv.delete(k.name)));
    return json({ ok: true });
  }

  return json({ error: 'not_found' }, 404);
}

async function handleRedirect(request, env, url, slug) {
  const kv = env.UTM_LINKS_KV;
  const link = await kv.get(`link:${slug}`, 'json');
  if (!link) return new Response('Link not found', { status: 404 });

  const ts = Date.now();
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 6);
  const click = {
    ts,
    query: Object.fromEntries(url.searchParams.entries()),
    referrer: request.headers.get('Referer') || null,
    userAgent: request.headers.get('User-Agent') || null,
    device: detectDevice(request.headers.get('User-Agent')),
    country: (request.cf && request.cf.country) || null,
    city: (request.cf && request.cf.city) || null,
  };

  await kv.put(`click:${slug}:${ts}:${rand}`, JSON.stringify(click));
  await kv.put(`link:${slug}`, JSON.stringify({ ...link, clicks: (link.clicks || 0) + 1 }));

  return Response.redirect(buildTargetUrl(link.targetUrl, link.utm), 302);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseEmailList(value) {
  return String(value || '')
    .split(',')
    .map((addr) => addr.trim())
    .filter(Boolean);
}

// Low-level send via Resend (cantor.agency is verified as a sending domain there).
// Used because cantor.agency's DNS is on reg.ru, not Cloudflare, so Cloudflare Email
// Routing (which needs a Cloudflare-managed zone) isn't an option for this domain.
async function sendViaResend(env, { to, subject, html, text }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !to || to.length === 0) return null;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: 'Заявки с сайта <leads@cantor.agency>', to, subject, html, text }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function sendEmailNotification(env, subject, cleanFields) {
  const to = parseEmailList(env.ADMIN_EMAIL);
  if (to.length === 0) return null;

  const rows = Object.entries(cleanFields)
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#667;white-space:nowrap;"><b>${escapeHtml(label)}</b></td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`)
    .join('');
  const html = `<table cellspacing="0" cellpadding="0">${rows}</table>`;
  const text = Object.entries(cleanFields).map(([label, value]) => `${label}: ${value}`).join('\n');

  return sendViaResend(env, { to, subject, html, text });
}

// Resend's free-tier caps (see resend.com/pricing — adjust here if the plan changes).
const RESEND_LIMITS = { day: 100, month: 3000 };
const USAGE_WARN_RATIO = 0.9;
const USAGE_LABELS = { day: 'сутки', month: 'месяц' };

// Track how many lead emails go out per day/month in KV, and fire a one-time
// warning email (to OPS_ALERT_EMAIL only, not the lead recipients) the first
// time either counter crosses 90% of Resend's free-tier limit.
async function trackEmailUsage(env, wasSent) {
  const kv = env.MBA_MYBRAND_KV;
  if (!wasSent || !kv) return;

  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);

  await Promise.all([
    bumpUsageAndWarn(env, kv, 'day', dayKey, RESEND_LIMITS.day),
    bumpUsageAndWarn(env, kv, 'month', monthKey, RESEND_LIMITS.month),
  ]);
}

async function bumpUsageAndWarn(env, kv, period, periodKey, limit) {
  const ttl = period === 'day' ? 60 * 60 * 24 * 3 : 60 * 60 * 24 * 45;
  const countKey = `email_usage:${period}:${periodKey}`;
  const count = (parseInt(await kv.get(countKey), 10) || 0) + 1;
  await kv.put(countKey, String(count), { expirationTtl: ttl });

  if (count < Math.ceil(limit * USAGE_WARN_RATIO)) return;

  const warnedKey = `email_usage_warned:${period}:${periodKey}`;
  if (await kv.get(warnedKey)) return;
  await kv.put(warnedKey, '1', { expirationTtl: ttl });

  const to = parseEmailList(env.OPS_ALERT_EMAIL);
  if (to.length === 0) return;
  const label = USAGE_LABELS[period];
  try {
    await sendViaResend(env, {
      to,
      subject: `⚠️ Resend: использовано ${count}/${limit} писем за ${label}`,
      text: `Отправлено ${count} из ${limit} писем через Resend за текущ${period === 'day' ? 'ие сутки' : 'ий месяц'} — это ${Math.round((count / limit) * 100)}% лимита бесплатного тарифа. Проверьте дашборд Resend, иначе новые заявки перестанут доставляться на почту.`,
      html: `<p>Отправлено <b>${count}</b> из <b>${limit}</b> писем через Resend за текущ${period === 'day' ? 'ие сутки' : 'ий месяц'} — это <b>${Math.round((count / limit) * 100)}%</b> лимита бесплатного тарифа.</p><p>Проверьте дашборд Resend, иначе новые заявки перестанут доставляться на почту.</p>`,
    });
  } catch (err) {
    console.error('usage_warning_failed', String(err && err.message));
  }
}

// ── Leads: forward landing-page form submissions by email ──
async function handleLeadNotify(request, env) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);

  const source = String(body.source || 'website').trim();
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};

  const cleanFields = {};
  for (const [label, value] of Object.entries(fields)) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    cleanFields[label] = clean;
  }

  try {
    const emailResult = await sendEmailNotification(env, `Новая заявка — ${source}`, cleanFields);
    await trackEmailUsage(env, emailResult && emailResult.ok);
    return json({ ok: true, email: emailResult });
  } catch (err) {
    return json({ error: 'email_failed', message: String(err && err.message) }, 502);
  }
}

const SERP_TEMPLATE_KEY = 'template';

// Fixed set of 4 tables: Yandex/Google × "ФИО" / "ФИО + онлайн-школа" queries.
// Only the titles are editable via the template — the set of tables itself is not
// user-extensible (keeps the analysis record shape predictable).
const SERP_TABLE_IDS = ['yandexName', 'googleName', 'yandexSchool', 'googleSchool'];

const DEFAULT_SERP_TEMPLATE = {
  tables: [
    { id: 'yandexName', title: 'Яндекс — ФИО' },
    { id: 'googleName', title: 'Google — ФИО' },
    { id: 'yandexSchool', title: 'Яндекс — ФИО + онлайн-школа' },
    { id: 'googleSchool', title: 'Google — ФИО + онлайн-школа' },
  ],
  recsTitle: 'Рекомендации по работе с поисковой выдачей',
  columnLabels: { url: 'Ссылка', name: 'Название', description: 'Описание', status: 'Статус' },
  statusOptions: [
    { label: 'Оставить', color: '#1e8449' },
    { label: 'Можно улучшить', color: '#9a6f00' },
    { label: 'Вытеснять', color: '#c0392b' },
    { label: 'Не про клиента', color: '#6b6b6b' },
  ],
  baseRecommendations: [
    'Создать сайт о себе как о предпринимателе — с проектами, достижениями и материалами.',
    'Выложить 3 интервью в YouTube и VK — для партнеров, сотрудников и учеников.',
    'Зарегистрироваться или актуализировать информацию в личном Telegram-канале, личном ВК и Instagram.',
    'Выложить 5-10 постов в каждую личную соц сеть.',
    'Выложить по 3 статьи от своего имени на ресурсы, такие как Дзен и VC.ru.',
  ],
};

function newSerpRow() {
  return { id: crypto.randomUUID().replace(/-/g, '').slice(0, 8), url: '', name: '', description: '', status: '' };
}

function newSerpRecommendation(text) {
  return { id: crypto.randomUUID().replace(/-/g, '').slice(0, 8), text: text || '', checked: false };
}

function newSerpTables() {
  const tables = {};
  for (const id of SERP_TABLE_IDS) tables[id] = [newSerpRow(), newSerpRow(), newSerpRow()];
  return tables;
}

function clampScore(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
}

async function getSerpTemplate(env) {
  const stored = await env.SERP_ANALYSIS_KV.get(SERP_TEMPLATE_KEY, 'json');
  return stored || DEFAULT_SERP_TEMPLATE;
}

async function handleSerpApi(request, env, url) {
  const { pathname } = url;
  const kv = env.SERP_ANALYSIS_KV;

  // ── Template: read ──
  if (pathname === '/api/serp/template' && request.method === 'GET') {
    return json(await getSerpTemplate(env));
  }

  // ── Template: write ──
  if (pathname === '/api/serp/template' && request.method === 'PUT') {
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_template' }, 400);
    await kv.put(SERP_TEMPLATE_KEY, JSON.stringify(body));
    return json({ ok: true });
  }

  // ── Analyses: list (light fields for the dashboard) ──
  if (pathname === '/api/serp/analyses' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'analysis:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const analyses = records
      .filter(Boolean)
      .map(({ id, createdAt, updatedAt, clientName, analysisTitle, shareId }) => ({ id, createdAt, updatedAt, clientName, analysisTitle, shareId }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return json({ analyses });
  }

  // ── Analyses: create ──
  if (pathname === '/api/serp/analyses' && request.method === 'POST') {
    const body = await readJson(request);
    const template = await getSerpTemplate(env);
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 10),
      createdAt: now,
      updatedAt: now,
      clientName: (body && String(body.clientName || '').trim()) || '',
      analysisTitle: '',
      intro: '',
      score: 0,
      schoolTablesEnabled: true,
      tables: newSerpTables(),
      recommendations: (template.baseRecommendations || []).map(newSerpRecommendation),
      shareId: crypto.randomUUID().replace(/-/g, ''),
    };
    await kv.put(`analysis:${record.id}`, JSON.stringify(record));
    await kv.put(`share:${record.shareId}`, record.id);
    return json({ analysis: record });
  }

  // ── Analysis: read one (edit view) ──
  if (pathname === '/api/serp/analysis' && request.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'missing_id' }, 400);
    const analysis = await kv.get(`analysis:${id}`, 'json');
    if (!analysis) return json({ error: 'not_found' }, 404);
    return json({ analysis, template: await getSerpTemplate(env) });
  }

  // ── Analysis: update ──
  if (pathname === '/api/serp/analysis' && request.method === 'PUT') {
    const body = await readJson(request);
    const id = body && body.id;
    if (!id) return json({ error: 'missing_id' }, 400);
    const key = `analysis:${id}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    const updated = {
      ...existing,
      clientName: typeof body.clientName === 'string' ? body.clientName : existing.clientName,
      analysisTitle: typeof body.analysisTitle === 'string' ? body.analysisTitle : existing.analysisTitle,
      intro: typeof body.intro === 'string' ? body.intro : existing.intro,
      score: body.score !== undefined ? clampScore(body.score, existing.score || 0) : existing.score,
      schoolTablesEnabled: typeof body.schoolTablesEnabled === 'boolean' ? body.schoolTablesEnabled : (existing.schoolTablesEnabled !== false),
      tables: body.tables && typeof body.tables === 'object' ? body.tables : existing.tables,
      recommendations: Array.isArray(body.recommendations) ? body.recommendations : existing.recommendations,
      updatedAt: new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(updated));
    return json({ ok: true, analysis: updated });
  }

  // ── Analysis: delete ──
  if (pathname === '/api/serp/analysis' && request.method === 'DELETE') {
    const body = await readJson(request);
    const id = body && body.id;
    if (!id) return json({ error: 'missing_id' }, 400);
    const key = `analysis:${id}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);
    if (existing.shareId) await kv.delete(`share:${existing.shareId}`);
    await kv.delete(key);
    return json({ ok: true });
  }

  // ── Analysis: rotate the public share link ──
  if (pathname === '/api/serp/analysis/share' && request.method === 'POST') {
    const body = await readJson(request);
    const id = body && body.id;
    if (!id) return json({ error: 'missing_id' }, 400);
    const key = `analysis:${id}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);
    if (existing.shareId) await kv.delete(`share:${existing.shareId}`);
    const shareId = crypto.randomUUID().replace(/-/g, '');
    await kv.put(`share:${shareId}`, id);
    const updated = { ...existing, shareId };
    await kv.put(key, JSON.stringify(updated));
    return json({ ok: true, shareId });
  }

  // ── Public: read a shared analysis (client-facing view) ──
  if (pathname === '/api/serp/share' && request.method === 'GET') {
    const shareId = url.searchParams.get('id');
    if (!shareId) return json({ error: 'missing_id' }, 400);
    const id = await kv.get(`share:${shareId}`);
    if (!id) return json({ error: 'not_found' }, 404);
    const analysis = await kv.get(`analysis:${id}`, 'json');
    if (!analysis) return json({ error: 'not_found' }, 404);
    return json({ analysis, template: await getSerpTemplate(env) });
  }

  return json({ error: 'not_found' }, 404);
}

const CRM_PODCAST_SUBTASKS = [
  { id: 'date', label: 'Назначена дата' },
  { id: 'script', label: 'Подготовлен сценарий' },
  { id: 'recording', label: 'Сделана запись' },
  { id: 'editing', label: 'Сделан монтаж' },
  { id: 'texts', label: 'Сделаны тексты' },
];

const CRM_CHECKLIST = [
  { id: 'brief', label: 'Собран бриф', type: 'single' },
  { id: 'serp', label: 'Сделан анализ поисковой выдачи', type: 'single' },
  { id: 'podcast1', label: 'Записан подкаст 1', type: 'group', subtasks: CRM_PODCAST_SUBTASKS },
  { id: 'podcast2', label: 'Записан подкаст 2', type: 'group', subtasks: CRM_PODCAST_SUBTASKS },
  { id: 'podcast3', label: 'Записан подкаст 3', type: 'group', subtasks: CRM_PODCAST_SUBTASKS },
  { id: 'site', label: 'Создан сайт', type: 'single' },
];

function emptyCrmTaskItem() {
  return { done: false, comment: '' };
}

function emptyCrmTasks() {
  const tasks = {};
  for (const item of CRM_CHECKLIST) {
    if (item.type === 'group') {
      tasks[item.id] = {};
      for (const sub of item.subtasks) tasks[item.id][sub.id] = emptyCrmTaskItem();
    } else {
      tasks[item.id] = emptyCrmTaskItem();
    }
  }
  return tasks;
}

function sanitizeCrmTaskItem(value, fallback) {
  if (!value || typeof value !== 'object') return fallback;
  return {
    done: typeof value.done === 'boolean' ? value.done : fallback.done,
    comment: typeof value.comment === 'string' ? value.comment : fallback.comment,
  };
}

function sanitizeCrmTasks(tasks) {
  const fallback = emptyCrmTasks();
  const clean = {};
  for (const item of CRM_CHECKLIST) {
    const incoming = tasks && typeof tasks === 'object' ? tasks[item.id] : null;
    if (item.type === 'group') {
      clean[item.id] = {};
      for (const sub of item.subtasks) {
        clean[item.id][sub.id] = sanitizeCrmTaskItem(incoming && incoming[sub.id], fallback[item.id][sub.id]);
      }
    } else {
      clean[item.id] = sanitizeCrmTaskItem(incoming, fallback[item.id]);
    }
  }
  return clean;
}

function newCrmClient(email, name) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 10),
    email,
    name: name || '',
    problem: false,
    createdAt: now,
    updatedAt: now,
    tasks: emptyCrmTasks(),
    fromBrief: false,
  };
}

// Brief clients (the "client:<email>" records from the /mba-mybrand questionnaire) are
// pulled into the CRM automatically so staff don't have to re-enter them by hand. Runs on
// every CRM list load; matches by normalized email so it never creates duplicates, and only
// ever adds missing ones — it never touches or removes CRM records that already exist.
async function syncCrmFromBriefClients(env) {
  const kv = env.MBA_MYBRAND_KV;
  const [crmKeys, briefKeys] = await Promise.all([
    kv.list({ prefix: 'crm:client:' }),
    kv.list({ prefix: 'client:' }),
  ]);
  const [crmRecords, briefRecords] = await Promise.all([
    Promise.all(crmKeys.keys.map((k) => kv.get(k.name, 'json'))),
    Promise.all(briefKeys.keys.map((k) => kv.get(k.name, 'json'))),
  ]);
  const clients = crmRecords.filter(Boolean);
  const existingEmails = new Set(clients.map((c) => normalizeEmail(c.email)));

  const schema = await getSchema(env);
  const nameQid = schema.blocks[0] && schema.blocks[0].questions[0] ? schema.blocks[0].questions[0].id : null;

  const puts = [];
  for (const b of briefRecords.filter(Boolean)) {
    const email = normalizeEmail(b.email);
    if (!email || !isValidEmail(email) || existingEmails.has(email)) continue;
    const name = (nameQid && b.answers && b.answers[nameQid]) ? String(b.answers[nameQid]).trim() : '';
    const record = { ...newCrmClient(email, name), fromBrief: true };
    existingEmails.add(email);
    clients.push(record);
    puts.push(kv.put(`crm:client:${record.id}`, JSON.stringify(record)));
  }
  if (puts.length) await Promise.all(puts);
  return clients;
}

async function handleCrmApi(request, env, url) {
  const { pathname } = url;
  const kv = env.MBA_MYBRAND_KV;

  // ── Clients: list (with checklist structure), auto-pulling in new brief clients ──
  if (pathname === '/api/crm/clients' && request.method === 'GET') {
    const clients = (await syncCrmFromBriefClients(env)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return json({ clients, checklist: CRM_CHECKLIST });
  }

  // ── Clients: create manually (deduped by email against existing CRM records) ──
  if (pathname === '/api/crm/clients' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body && body.email);
    if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);
    const name = (body && String(body.name || '').trim()) || '';

    const list = await kv.list({ prefix: 'crm:client:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const existing = records.find((c) => c && normalizeEmail(c.email) === email);
    if (existing) return json({ error: 'already_exists', client: existing }, 409);

    const record = newCrmClient(email, name);
    await kv.put(`crm:client:${record.id}`, JSON.stringify(record));
    return json({ client: record });
  }

  // ── Client: update (name/email/problem flag/checklist) ──
  if (pathname === '/api/crm/client' && request.method === 'PUT') {
    const body = await readJson(request);
    const id = body && body.id;
    if (!id) return json({ error: 'missing_id' }, 400);
    const key = `crm:client:${id}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    const nextEmail = typeof body.email === 'string' && body.email.trim() ? normalizeEmail(body.email) : existing.email;
    if (!isValidEmail(nextEmail)) return json({ error: 'invalid_email' }, 400);

    const updated = {
      ...existing,
      name: typeof body.name === 'string' ? body.name : existing.name,
      email: nextEmail,
      problem: typeof body.problem === 'boolean' ? body.problem : existing.problem,
      tasks: body.tasks && typeof body.tasks === 'object' ? sanitizeCrmTasks(body.tasks) : existing.tasks,
      updatedAt: new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(updated));
    return json({ ok: true, client: updated });
  }

  // ── Client: delete ──
  if (pathname === '/api/crm/client' && request.method === 'DELETE') {
    const body = await readJson(request);
    const id = body && body.id;
    if (!id) return json({ error: 'missing_id' }, 400);
    const key = `crm:client:${id}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);
    await kv.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'not_found' }, 404);
}

/* ════════════════════════════ Avito export ════════════════════════════ */

const AVITO_API_BASE = 'https://api.avito.ru';
// Avito has renamed Messenger API path versions before without redirects — if exports
// start failing with avito_404, check developers.avito.ru → "Messenger API" and adjust here.
const AVITO_CHATS_VERSION = 'v2';
const AVITO_MESSAGES_VERSION = 'v3';
const AVITO_VOICE_VERSION = 'v1';
const AVITO_STATS_ITEMS_BATCH = 200; // Avito's documented per-request cap for stats/items

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskAvitoAccount(account) {
  const { clientSecret, ...rest } = account;
  return { ...rest, hasSecret: Boolean(clientSecret) };
}

async function avitoGetToken(env, account) {
  const kv = env.AVITO_KV;
  const tokenKey = `token:${account.id}`;
  const cached = await kv.get(tokenKey, 'json');
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.accessToken;

  const res = await fetch(`${AVITO_API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: account.clientId,
      client_secret: account.clientSecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`auth_failed_${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('auth_no_token_in_response');
  const expiresAt = now + Number(data.expires_in || 86400) * 1000;
  await kv.put(tokenKey, JSON.stringify({ accessToken: data.access_token, expiresAt }));
  return data.access_token;
}

async function avitoRequest(token, path, options = {}, attempt = 0) {
  const res = await fetch(`${AVITO_API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await sleep(500 * 2 ** attempt);
    return avitoRequest(token, path, options, attempt + 1);
  }
  return res;
}

async function avitoJson(token, path, options) {
  const res = await avitoRequest(token, path, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`avito_${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  const remaining = res.headers.get('X-RateLimit-Remaining');
  if (remaining !== null && Number(remaining) <= 2) await sleep(400);
  return res.json();
}

async function fetchAllAvitoItems(token, userId) {
  const items = [];
  const perPage = 100;
  for (let page = 1; page <= 50; page += 1) {
    const data = await avitoJson(token, `/core/v1/accounts/${userId}/items?status=all&page=${page}&per_page=${perPage}`);
    const batch = data.resources || data.items || [];
    items.push(...batch);
    if (batch.length < perPage) break;
  }
  return items;
}

async function fetchAvitoStats(token, userId, itemIds, dateFrom, dateTo) {
  const statsById = {};
  for (let i = 0; i < itemIds.length; i += AVITO_STATS_ITEMS_BATCH) {
    const batch = itemIds.slice(i, i + AVITO_STATS_ITEMS_BATCH);
    const data = await avitoJson(token, `/core/v1/accounts/${userId}/stats/items`, {
      method: 'POST',
      body: JSON.stringify({ dateFrom, dateTo, itemIds: batch, periodGrouping: 'day' }),
    });
    const rows = (data.result && data.result.items) || data.items || [];
    for (const row of rows) {
      const id = row.itemId ?? row.id;
      if (id != null) statsById[id] = row;
    }
  }
  return statsById;
}

async function fetchAllAvitoChats(token, userId) {
  const chats = [];
  const limit = 100;
  for (let offset = 0; offset <= 1000; offset += limit) {
    const data = await avitoJson(token, `/messenger/${AVITO_CHATS_VERSION}/accounts/${userId}/chats?chat_types=u2i&limit=${limit}&offset=${offset}`);
    const batch = data.chats || [];
    chats.push(...batch);
    if (batch.length < limit) break;
  }
  return chats;
}

async function fetchAllAvitoMessages(token, userId, chatId) {
  const messages = [];
  const limit = 100;
  for (let offset = 0; offset <= 1000; offset += limit) {
    const data = await avitoJson(token, `/messenger/${AVITO_MESSAGES_VERSION}/accounts/${userId}/chats/${chatId}/messages?limit=${limit}&offset=${offset}`);
    const batch = Array.isArray(data) ? data : data.messages || [];
    messages.push(...batch);
    if (batch.length < limit) break;
  }
  return messages.reverse(); // Avito returns newest → oldest; flip to a readable timeline
}

async function fetchAvitoVoiceLinks(token, userId, voiceIds) {
  if (!voiceIds.length) return {};
  const data = await avitoJson(token, `/messenger/${AVITO_VOICE_VERSION}/accounts/${userId}/getVoiceFiles`, {
    method: 'POST',
    body: JSON.stringify({ voice_ids: voiceIds }),
  });
  return (data && (data.voices_urls || data.urls)) || data || {};
}

function avitoMessageText(m) {
  const content = m.content || {};
  switch (m.type) {
    case 'text':
      return content.text || '';
    case 'system':
      return content.text || JSON.stringify(content);
    case 'call':
      return `Звонок${content.call ? ` (${content.call.status || ''}, ${content.call.duration || 0} сек)` : ''}`;
    case 'image':
      return '[изображение]';
    case 'link':
      return (content.link && content.link.url) || '[ссылка]';
    case 'location':
      return '[геолокация]';
    case 'item':
      return '[карточка объявления]';
    case 'voice':
      return '[голосовое сообщение]';
    default:
      return JSON.stringify(content);
  }
}

async function runAvitoExport(env, account, dateFrom, dateTo) {
  const errors = [];
  const token = await avitoGetToken(env, account);
  const userId = account.userId;

  let items = [];
  try {
    items = await fetchAllAvitoItems(token, userId);
  } catch (e) {
    errors.push(`Объявления: ${e.message}`);
  }
  const itemById = {};
  items.forEach((it) => { itemById[it.id] = it; });

  let statsById = {};
  try {
    statsById = await fetchAvitoStats(token, userId, items.map((it) => it.id).filter(Boolean), dateFrom, dateTo);
  } catch (e) {
    errors.push(`Статистика: ${e.message}`);
  }

  const stats = items.map((it) => {
    const s = statsById[it.id] || {};
    return {
      item_id: it.id,
      title: it.title || '',
      status: it.status || '',
      category: (it.category && it.category.name) || it.category || '',
      address: it.address || (it.location && it.location.title) || '',
      url: it.url || '',
      views: s.views ?? s.uniqViews ?? '',
      uniqViews: s.uniqViews ?? '',
      contacts: s.contacts ?? s.uniqContacts ?? '',
      uniqContacts: s.uniqContacts ?? '',
      favorites: s.favorites ?? s.uniqFavorites ?? '',
      spend: s.spend ?? s.expenses ?? '',
      dateFrom,
      dateTo,
    };
  });

  let allChats = [];
  try {
    allChats = await fetchAllAvitoChats(token, userId);
  } catch (e) {
    errors.push(`Чаты: ${e.message}`);
  }

  const fromTs = new Date(dateFrom).getTime();
  const toTs = new Date(`${dateTo}T23:59:59`).getTime();
  const chats = allChats.filter((c) => {
    const lastMsgTs = c.last_message && c.last_message.created ? Number(c.last_message.created) * 1000 : null;
    const updatedTs = c.updated ? Number(c.updated) * 1000 : null;
    const ts = lastMsgTs ?? updatedTs;
    return ts == null || (ts >= fromTs && ts <= toTs);
  });

  const chatSummaries = [];
  const messages = [];
  const voiceQueue = [];

  for (const chat of chats) {
    let msgs = [];
    try {
      msgs = await fetchAllAvitoMessages(token, userId, chat.id);
    } catch (e) {
      errors.push(`Чат ${chat.id}: ${e.message}`);
      continue;
    }

    const relatedItemId = chat.context && chat.context.value && chat.context.value.id;
    const relatedItem = relatedItemId ? itemById[relatedItemId] : null;

    let firstAt = null;
    let lastAt = null;
    let firstAuthor = '';
    let clientCount = 0;
    let managerCount = 0;
    let hasCall = false;
    let lastSpeakerRole = null;
    let lastSpeakerTs = null;
    const managerResponseTimes = [];

    msgs.forEach((m) => {
      const ts = Number(m.created) * 1000;
      const role = String(m.author_id) === String(userId) ? 'manager' : 'client';
      if (firstAt == null) { firstAt = ts; firstAuthor = role; }
      lastAt = ts;
      if (role === 'client') clientCount += 1; else managerCount += 1;
      if (m.type === 'call') hasCall = true;

      let responseTimeSec = '';
      if (lastSpeakerRole && lastSpeakerRole !== role) {
        responseTimeSec = Math.round((ts - lastSpeakerTs) / 1000);
        if (role === 'manager') managerResponseTimes.push(responseTimeSec);
      }
      lastSpeakerRole = role;
      lastSpeakerTs = ts;

      if (m.type === 'voice') {
        const voiceId = m.content && m.content.voice && m.content.voice.voice_id;
        if (voiceId) voiceQueue.push({ chatId: chat.id, messageId: m.id, voiceId });
      }

      messages.push({
        chat_id: chat.id,
        message_id: m.id,
        datetime: new Date(ts).toISOString(),
        author: role,
        type: m.type,
        text: avitoMessageText(m),
        response_time_sec: responseTimeSec,
      });
    });

    chatSummaries.push({
      chat_id: chat.id,
      item_id: relatedItemId || '',
      item_title: relatedItem ? relatedItem.title : '',
      item_address: relatedItem ? relatedItem.address || (relatedItem.location && relatedItem.location.title) || '' : '',
      first_message_at: firstAt ? new Date(firstAt).toISOString() : '',
      last_message_at: lastAt ? new Date(lastAt).toISOString() : '',
      first_author: firstAuthor,
      messages_total: msgs.length,
      messages_client: clientCount,
      messages_manager: managerCount,
      avg_manager_response_sec: managerResponseTimes.length
        ? Math.round(managerResponseTimes.reduce((a, b) => a + b, 0) / managerResponseTimes.length)
        : '',
      has_call: hasCall ? 'да' : 'нет',
      final_status: managerCount === 0 ? 'нет ответа менеджера' : lastSpeakerRole === 'manager' ? 'клиент не ответил' : 'ждёт ответа менеджера',
    });
  }

  // Voice links expire ~1h after being issued, so this is only useful right after export —
  // there's no ASR wired up here (would need a separate transcription service/credentials).
  if (voiceQueue.length) {
    try {
      const byChat = {};
      voiceQueue.forEach((v) => { (byChat[v.chatId] ||= []).push(v.voiceId); });
      for (const [chatId, voiceIds] of Object.entries(byChat)) {
        const links = await fetchAvitoVoiceLinks(token, userId, voiceIds);
        voiceQueue
          .filter((v) => v.chatId === chatId)
          .forEach((v) => {
            const url = links[v.voiceId];
            if (!url) return;
            const row = messages.find((r) => r.chat_id === chatId && r.message_id === v.messageId);
            if (row) row.text = `[голосовое сообщение] ${url}`;
          });
      }
    } catch (e) {
      errors.push(`Ссылки на голосовые: ${e.message}`);
    }
  }

  return {
    meta: { accountId: account.id, accountName: account.name, userId, dateFrom, dateTo, generatedAt: new Date().toISOString() },
    stats,
    chats: chatSummaries,
    messages,
    counts: { items: items.length, chatsTotal: allChats.length, chatsInRange: chats.length, messages: messages.length },
    errors,
  };
}

async function handleAvitoApi(request, env, url) {
  const { pathname } = url;
  const kv = env.AVITO_KV;

  if (pathname === '/api/avito/accounts' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'account:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const accounts = records.filter(Boolean).map(maskAvitoAccount).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return json({ accounts });
  }

  if (pathname === '/api/avito/accounts' && request.method === 'POST') {
    const body = await readJson(request);
    const name = (body && String(body.name || '').trim()) || '';
    const clientId = (body && String(body.clientId || '').trim()) || '';
    const clientSecret = (body && String(body.clientSecret || '').trim()) || '';
    const userId = (body && String(body.userId || '').trim()) || '';
    if (!name || !clientId || !clientSecret || !userId) return json({ error: 'missing_fields' }, 400);

    const now = new Date().toISOString();
    const account = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      name, clientId, clientSecret, userId,
      createdAt: now, updatedAt: now, lastExportAt: null,
    };
    await kv.put(`account:${account.id}`, JSON.stringify(account));
    return json({ account: maskAvitoAccount(account) });
  }

  if (pathname === '/api/avito/accounts' && request.method === 'PUT') {
    const body = await readJson(request);
    const id = body && body.id;
    if (!id) return json({ error: 'missing_id' }, 400);
    const key = `account:${id}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    const rotatingSecret = typeof body.clientSecret === 'string' && body.clientSecret.trim();
    const updated = {
      ...existing,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
      clientId: typeof body.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : existing.clientId,
      userId: typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : existing.userId,
      clientSecret: rotatingSecret ? body.clientSecret.trim() : existing.clientSecret,
      updatedAt: new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(updated));
    if (rotatingSecret) await kv.delete(`token:${id}`);
    return json({ account: maskAvitoAccount(updated) });
  }

  if (pathname === '/api/avito/accounts' && request.method === 'DELETE') {
    const body = await readJson(request);
    const id = body && body.id;
    if (!id) return json({ error: 'missing_id' }, 400);
    await kv.delete(`account:${id}`);
    await kv.delete(`token:${id}`);
    const runs = await kv.list({ prefix: `runlog:${id}:` });
    await Promise.all(runs.keys.map((k) => kv.delete(k.name)));
    return json({ ok: true });
  }

  if (pathname === '/api/avito/export' && request.method === 'POST') {
    const body = await readJson(request);
    const id = body && body.accountId;
    const dateFrom = body && body.dateFrom;
    const dateTo = body && body.dateTo;
    if (!id || !dateFrom || !dateTo) return json({ error: 'missing_fields' }, 400);
    const account = await kv.get(`account:${id}`, 'json');
    if (!account) return json({ error: 'not_found' }, 404);

    const startedAt = new Date().toISOString();
    const runId = String(Date.now());
    try {
      const result = await runAvitoExport(env, account, dateFrom, dateTo);
      await kv.put(`runlog:${id}:${runId}`, JSON.stringify({
        id: runId, accountId: id, dateFrom, dateTo, startedAt, finishedAt: new Date().toISOString(),
        status: result.errors.length ? 'partial' : 'ok', counts: result.counts, errors: result.errors,
      }));
      await kv.put(`account:${id}`, JSON.stringify({ ...account, lastExportAt: new Date().toISOString() }));
      return json(result);
    } catch (e) {
      await kv.put(`runlog:${id}:${runId}`, JSON.stringify({
        id: runId, accountId: id, dateFrom, dateTo, startedAt, finishedAt: new Date().toISOString(),
        status: 'failed', counts: null, errors: [String(e && e.message)],
      }));
      return json({ error: 'export_failed', message: String(e && e.message) }, 502);
    }
  }

  if (pathname === '/api/avito/runs' && request.method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    if (!accountId) return json({ error: 'missing_account_id' }, 400);
    const list = await kv.list({ prefix: `runlog:${accountId}:` });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const runs = records.filter(Boolean).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 20);
    return json({ runs });
  }

  return json({ error: 'not_found' }, 404);
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const kv = env.MBA_MYBRAND_KV;

  if (pathname.startsWith('/api/serp/')) {
    return handleSerpApi(request, env, url);
  }

  if (pathname.startsWith('/api/crm/')) {
    return handleCrmApi(request, env, url);
  }

  if (pathname.startsWith('/api/avito/')) {
    return handleAvitoApi(request, env, url);
  }

  // ── Leads: notify by email ──
  if (pathname === '/api/leads/notify' && request.method === 'POST') {
    return handleLeadNotify(request, env);
  }

  // ── Public schema (read) ──
  if (pathname === '/api/schema' && request.method === 'GET') {
    return json(await getSchema(env));
  }

  // ── Admin: schema (write) ──
  if (pathname === '/api/admin/schema' && request.method === 'PUT') {
    const body = await readJson(request);
    if (!body || !Array.isArray(body.blocks)) {
      return json({ error: 'invalid_schema' }, 400);
    }
    await kv.put(SCHEMA_KEY, JSON.stringify(body));
    return json({ ok: true });
  }

  // ── Client: get-or-create ──
  if (pathname === '/api/client' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body && body.email);
    if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);

    const key = `client:${email}`;
    let client = await kv.get(key, 'json');
    if (!client) {
      client = emptyClient(email);
      await kv.put(key, JSON.stringify(client));
    }
    return json({ client, schema: await getSchema(env) });
  }

  // ── Client: autosave ──
  if (pathname === '/api/client/save' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body && body.email);
    if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);

    const key = `client:${email}`;
    const existing = (await kv.get(key, 'json')) || emptyClient(email);
    const updated = {
      ...existing,
      answers: body.answers && typeof body.answers === 'object' ? body.answers : existing.answers,
      currentBlock: Number.isInteger(body.currentBlock) ? body.currentBlock : existing.currentBlock,
      updatedAt: new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(updated));
    return json({ ok: true, updatedAt: updated.updatedAt });
  }

  // ── Admin: list all clients (full records) ──
  if (pathname === '/api/admin/clients' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'client:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const clients = records.filter(Boolean).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return json({ clients });
  }

  // ── Admin: update one client's answers/notes ──
  if (pathname === '/api/admin/client' && request.method === 'PUT') {
    const body = await readJson(request);
    const email = normalizeEmail(body && body.email);
    if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);

    const key = `client:${email}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    const updated = {
      ...existing,
      answers: body.answers && typeof body.answers === 'object' ? body.answers : existing.answers,
      notes: typeof body.notes === 'string' ? body.notes : existing.notes,
      updatedAt: new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(updated));
    return json({ ok: true, client: updated });
  }

  // ── Admin: create or rotate a public share link for a client ──
  if (pathname === '/api/admin/client/share' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body && body.email);
    if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);

    const key = `client:${email}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    if (existing.shareId) {
      await kv.delete(`share:${existing.shareId}`);
    }
    const shareId = crypto.randomUUID().replace(/-/g, '');
    await kv.put(`share:${shareId}`, email);
    const updated = { ...existing, shareId };
    await kv.put(key, JSON.stringify(updated));
    return json({ ok: true, shareId });
  }

  // ── Admin: revoke a client's share link ──
  if (pathname === '/api/admin/client/unshare' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body && body.email);
    if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);

    const key = `client:${email}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    if (existing.shareId) await kv.delete(`share:${existing.shareId}`);
    const updated = { ...existing, shareId: null };
    await kv.put(key, JSON.stringify(updated));
    return json({ ok: true });
  }

  // ── Admin: delete a client entirely ──
  if (pathname === '/api/admin/client' && request.method === 'DELETE') {
    const body = await readJson(request);
    const email = normalizeEmail(body && body.email);
    if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);

    const key = `client:${email}`;
    const existing = await kv.get(key, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    if (existing.shareId) await kv.delete(`share:${existing.shareId}`);
    await kv.delete(key);
    return json({ ok: true });
  }

  // ── Public: read a shared client's answers ──
  if (pathname === '/api/share' && request.method === 'GET') {
    const shareId = url.searchParams.get('id');
    if (!shareId) return json({ error: 'missing_id' }, 400);

    const email = await kv.get(`share:${shareId}`);
    if (!email) return json({ error: 'not_found' }, 404);

    const client = await kv.get(`client:${email}`, 'json');
    if (!client) return json({ error: 'not_found' }, 404);

    return json({ client, schema: await getSchema(env) });
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const redirectMatch = url.pathname.match(/^\/r\/([A-Za-z0-9_-]+)$/);
    if (redirectMatch) {
      try {
        return await handleRedirect(request, env, url, redirectMatch[1]);
      } catch (err) {
        return new Response(`Server error: ${String(err && err.message)}`, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/utm/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      try {
        return await handleUtmApi(request, env, url);
      } catch (err) {
        return json({ error: 'server_error', message: String(err && err.message) }, 500);
      }
    }

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      return await handleApi(request, env, url);
    } catch (err) {
      return json({ error: 'server_error', message: String(err && err.message) }, 500);
    }
  },
};
