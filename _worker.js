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
 *   crm:client:<id>  -> { id, email, name, problem, problemComment, createdAt, updatedAt, fromBrief,
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
 *
 * It also powers /dashboard: the agency-owner dashboard (active Avito-promotion projects,
 * staff cards with weekly 1–5 ratings, sales plan/fact, agency task list). Gated client-side
 * by a shared password (same pattern as /serp-analysis) and additionally by an
 * "x-dashboard-password" header the API itself checks — not a real auth boundary, just one
 * step past the SERP page's, since salaries live here too.
 *
 * KV keys (binding "AGENCY_DASHBOARD_KV"):
 *   seeded                        -> "1" once the starter projects/employees have been written
 *   project:<id>                  -> { id, name, service, responsibleId, status, review,
 *                                        ratings: { result, communication, quality }, // 0-5, 0 = not rated
 *                                        createdAt, updatedAt }
 *   analytics:<projectId>:<YYYY-MM> -> { budget, views, contacts, conversionPct, cpl, diagnostics,
 *                                          salesCount, cac, notes, updatedAt }
 *   employee:<id>                 -> { id, name, position, salary, createdAt, updatedAt }
 *   rating:<employeeId>:<weekStart> -> { weekStart, discipline, communication, skills, updatedAt } // 1-5 each
 *   sales:<YYYY-MM>                -> { primary: { planCount, factCount, planRevenue, factRevenue },
 *                                         repeat: { planCount, factCount, planRevenue, factRevenue },
 *                                         leads, updatedAt }
 *   registrationBase               -> { total, updatedAt }  (cumulative count, never resets monthly)
 *   task:<id>                      -> { id, text, status, owner, due, createdAt, updatedAt }
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
  // cantor.agency is a separate static host (nginx, not this worker — see API_BASE in
  // serp-analysis/avito-export/utm-create/dashboard), so these pages' API calls are always
  // cross-origin in production, not just during testing. x-dashboard-password is the
  // dashboard's own auth header (see checkDashboardAuth).
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-dashboard-password',
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

function parseChatIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
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

// Low-level send via the Telegram Bot API. The bot token is passed in directly —
// each landing page's lead source has its own bot secret (see LEAD_TELEGRAM_CONFIG
// and the note in wrangler.jsonc for why the token itself is never stored there).
async function sendViaTelegram(token, chatId, text) {
  if (!token || !chatId) return null;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// Per lead-source Telegram config: which secret holds that source's bot token,
// which (non-secret) var holds its comma-separated recipient chat ids, and
// whether this source should also get the Resend email notification.
// Add an entry here for each new landing page that gets its own Telegram bot.
const LEAD_TELEGRAM_CONFIG = {
  'tatiana-karlova': { tokenEnv: 'TELEGRAM_BOT_TOKEN_KARLOVA', chatIdsEnv: 'TELEGRAM_CHAT_IDS_KARLOVA', sendEmail: false },
};

async function sendTelegramNotification(env, subject, cleanFields, config) {
  const token = env[config.tokenEnv];
  const chatIds = parseChatIds(env[config.chatIdsEnv]);
  if (!token || chatIds.length === 0) return null;

  const lines = [`<b>${escapeHtml(subject)}</b>`, ...Object.entries(cleanFields).map(
    ([label, value]) => `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`
  )];
  const text = lines.join('\n');

  const results = await Promise.all(chatIds.map((chatId) => sendViaTelegram(token, chatId, text)));
  return { ok: results.some((r) => r && r.ok), results };
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

// ── Leads: forward landing-page form submissions by email and/or Telegram ──
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

  const subject = `Новая заявка — ${source}`;
  const telegramConfig = LEAD_TELEGRAM_CONFIG[source];

  let telegramResult = null;
  if (telegramConfig) {
    try {
      telegramResult = await sendTelegramNotification(env, subject, cleanFields, telegramConfig);
    } catch (err) {
      console.error('lead_telegram_failed', String(err && err.message));
    }
  }

  if (telegramConfig && telegramConfig.sendEmail === false) {
    return json({ ok: true, telegram: telegramResult });
  }

  try {
    const emailResult = await sendEmailNotification(env, subject, cleanFields);
    await trackEmailUsage(env, emailResult && emailResult.ok);
    return json({ ok: true, email: emailResult, telegram: telegramResult });
  } catch (err) {
    return json({ error: 'email_failed', message: String(err && err.message), telegram: telegramResult }, 502);
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
    problemComment: '',
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
// Emails a staffer has explicitly deleted from the CRM are tombstoned in "crm:deleted:<email>"
// so this resync never resurrects them.
async function syncCrmFromBriefClients(env) {
  const kv = env.MBA_MYBRAND_KV;
  const [crmKeys, briefKeys, deletedKeys] = await Promise.all([
    kv.list({ prefix: 'crm:client:' }),
    kv.list({ prefix: 'client:' }),
    kv.list({ prefix: 'crm:deleted:' }),
  ]);
  const [crmRecords, briefRecords] = await Promise.all([
    Promise.all(crmKeys.keys.map((k) => kv.get(k.name, 'json'))),
    Promise.all(briefKeys.keys.map((k) => kv.get(k.name, 'json'))),
  ]);
  const clients = crmRecords.filter(Boolean);
  const existingEmails = new Set(clients.map((c) => normalizeEmail(c.email)));
  const deletedEmails = new Set(deletedKeys.keys.map((k) => k.name.slice('crm:deleted:'.length)));

  const schema = await getSchema(env);
  const nameQid = schema.blocks[0] && schema.blocks[0].questions[0] ? schema.blocks[0].questions[0].id : null;

  const puts = [];
  for (const b of briefRecords.filter(Boolean)) {
    const email = normalizeEmail(b.email);
    if (!email || !isValidEmail(email) || existingEmails.has(email) || deletedEmails.has(email)) continue;
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
    await kv.delete(`crm:deleted:${email}`);
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
      problemComment: typeof body.problemComment === 'string' ? body.problemComment : (existing.problemComment || ''),
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
    const email = normalizeEmail(existing.email);
    if (email) await kv.put(`crm:deleted:${email}`, '1');
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

// Lets the account form leave "User ID" blank: exchange the credentials for a token
// (uncached — this account doesn't have a KV entry yet) and read the numeric id off
// /core/v1/accounts/self, the same id Avito otherwise only surfaces inside the developer
// portal's app settings.
async function avitoLookupUserId(clientId, clientSecret) {
  const res = await fetch(`${AVITO_API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`auth_failed_${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('auth_no_token_in_response');
  const self = await fetchAvitoSelf(data.access_token);
  if (self == null || self.id == null) throw new Error('self_has_no_id');
  return String(self.id);
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

async function fetchAllAvitoItems(token) {
  // Not /core/v1/accounts/{user_id}/items — that path doesn't exist on Avito's gateway
  // (confirmed against real traffic: it 404s with "no Route matched with those values").
  // The account is implied by the token itself. status=all also isn't a valid value here
  // (confirmed against real traffic: 400 "unknown status") and Avito's exact enum for this
  // param isn't documented anywhere reachable — omit it and take the default (active listings).
  const items = [];
  const perPage = 100;
  for (let page = 1; page <= 50; page += 1) {
    const data = await avitoJson(token, `/core/v1/items?page=${page}&per_page=${perPage}`);
    const batch = data.resources || data.items || [];
    items.push(...batch);
    if (batch.length < perPage) break;
  }
  return items;
}

// /stats/v1/accounts/{id}/items always answers with one entry per day per item
// (confirmed against real traffic — periodGrouping has no "total"/aggregate mode, and the
// endpoint's `fields` enum is only [views contacts favorites uniqViews uniqContacts
// uniqFavorites], so ad spend isn't available through this endpoint at all, whatever the
// request asks for): { result: { items: [ { itemId, stats: [ { date, uniqViews,
// uniqContacts, uniqFavorites }, ... ] } ] } }. Callers sum the daily rows themselves —
// see sumAvitoStatDays / sumAvitoStatDaysInRange.
async function fetchAvitoDailyStats(token, userId, itemIds, dateFrom, dateTo, errors) {
  const dailyByItem = {};
  for (let i = 0; i < itemIds.length; i += AVITO_STATS_ITEMS_BATCH) {
    const batch = itemIds.slice(i, i + AVITO_STATS_ITEMS_BATCH);
    const data = await avitoJson(token, `/stats/v1/accounts/${userId}/items`, {
      method: 'POST',
      body: JSON.stringify({ dateFrom, dateTo, itemIds: batch }),
    });
    const rows = (data.result && data.result.items) || [];
    if (!rows.length && errors) {
      errors.push(`Статистика: сервер ответил без ожидаемых полей (items). Сырой ответ: ${JSON.stringify(data).slice(0, 500)}`);
    }
    for (const row of rows) {
      const id = row.itemId ?? row.id;
      if (id != null) dailyByItem[id] = row.stats || [];
    }
  }
  return dailyByItem;
}

function sumAvitoStatDays(days) {
  return (days || []).reduce((acc, d) => {
    acc.views += d.uniqViews || 0;
    acc.contacts += d.uniqContacts || 0;
    acc.favorites += d.uniqFavorites || 0;
    return acc;
  }, { views: 0, contacts: 0, favorites: 0 });
}

function sumAvitoStatDaysInRange(days, fromStr, toStr) {
  return sumAvitoStatDays((days || []).filter((d) => d.date >= fromStr && d.date <= toStr));
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

async function fetchAvitoSelf(token) {
  return avitoJson(token, '/core/v1/accounts/self');
}

async function fetchAvitoBalance(token, userId) {
  // {"bonus":0,"real":0.04} — real ⩽0 is common (Avito lets the balance run slightly
  // negative before blocking promotion), not a bug in the fetch.
  return avitoJson(token, `/core/v1/accounts/${userId}/balance/`);
}

async function fetchAvitoRating(token, userId) {
  return avitoJson(token, `/ratings/v1/info?user_id=${userId}`);
}

async function fetchAvitoReviews(token, limit = 50) {
  const data = await avitoJson(token, `/ratings/v1/reviews?offset=0&limit=${limit}`);
  return { total: data.total || 0, reviews: data.reviews || [] };
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
    items = await fetchAllAvitoItems(token);
  } catch (e) {
    errors.push(`Объявления: ${e.message}`);
  }
  const itemById = {};
  items.forEach((it) => { itemById[it.id] = it; });

  let dailyByItem = {};
  try {
    dailyByItem = await fetchAvitoDailyStats(token, userId, items.map((it) => it.id).filter(Boolean), dateFrom, dateTo, errors);
  } catch (e) {
    errors.push(`Статистика: ${e.message}`);
  }

  const stats = items.map((it) => {
    const s = sumAvitoStatDays(dailyByItem[it.id]);
    return {
      item_id: it.id,
      title: it.title || '',
      status: it.status || '',
      category: (it.category && it.category.name) || it.category || '',
      address: it.address || (it.location && it.location.title) || '',
      url: it.url || '',
      views: s.views,
      uniqViews: s.views,
      contacts: s.contacts,
      uniqContacts: s.contacts,
      favorites: s.favorites,
      // Ad spend isn't exposed by this (or any known) Avito partner API endpoint — only
      // visible in the seller's own cabinet — so this column is left blank rather than guessed.
      spend: '',
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
      if (String(e.message).includes('avito_402')) {
        // Account-wide restriction (no paid Messenger API subscription on this cabinet) —
        // every remaining chat will fail the same way, so stop hammering the API and
        // surface one clear message instead of one line per chat.
        errors.push('Сообщения недоступны: на этом кабинете Avito не подключена платная подписка на API мессенджера (нужно оформить в личном кабинете Avito).');
        break;
      }
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

function avitoYmd(d) { return d.toISOString().slice(0, 10); }
function avitoAddDays(ymdStr, delta) {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return avitoYmd(d);
}
function avitoMonthStart(ymdStr) { return `${ymdStr.slice(0, 7)}-01`; }

async function runAvitoOverview(env, account, dateFrom, dateTo) {
  const errors = [];
  const token = await avitoGetToken(env, account);
  const userId = account.userId;

  const [selfRes, balanceRes, ratingRes, reviewsRes] = await Promise.allSettled([
    fetchAvitoSelf(token),
    fetchAvitoBalance(token, userId),
    fetchAvitoRating(token, userId),
    fetchAvitoReviews(token, 20),
  ]);
  if (selfRes.status === 'rejected') errors.push(`Профиль: ${selfRes.reason.message}`);
  if (balanceRes.status === 'rejected') errors.push(`Баланс: ${balanceRes.reason.message}`);
  if (ratingRes.status === 'rejected') errors.push(`Рейтинг: ${ratingRes.reason.message}`);
  if (reviewsRes.status === 'rejected') errors.push(`Отзывы: ${reviewsRes.reason.message}`);

  let items = [];
  try {
    items = await fetchAllAvitoItems(token);
  } catch (e) {
    errors.push(`Объявления: ${e.message}`);
  }

  // "Вчера" / "с начала месяца" are fixed to the calendar, independent of the dateFrom/dateTo
  // the caller picked for the listings table — widen the fetch to cover both so one call
  // (per item-batch) serves the whole overview instead of two.
  const today = avitoYmd(new Date());
  const yesterday = avitoAddDays(today, -1);
  const monthStart = avitoMonthStart(today);
  const rangeFrom = dateFrom < monthStart ? dateFrom : monthStart;
  const rangeTo = dateTo > today ? dateTo : today;

  let dailyByItem = {};
  try {
    dailyByItem = await fetchAvitoDailyStats(token, userId, items.map((it) => it.id).filter(Boolean), rangeFrom, rangeTo, errors);
  } catch (e) {
    errors.push(`Статистика: ${e.message}`);
  }

  const items_out = items.map((it) => {
    const s = sumAvitoStatDaysInRange(dailyByItem[it.id], dateFrom, dateTo);
    return {
      item_id: it.id,
      title: it.title || '',
      status: it.status || '',
      price: it.price ?? '',
      category: (it.category && it.category.name) || it.category || '',
      address: it.address || (it.location && it.location.title) || '',
      url: it.url || '',
      views: s.views,
      contacts: s.contacts,
      favorites: s.favorites,
    };
  });

  const allDays = Object.values(dailyByItem).flat();
  const yesterdayTotals = sumAvitoStatDaysInRange(allDays, yesterday, yesterday);
  const monthToDateTotals = sumAvitoStatDaysInRange(allDays, monthStart, today);

  let chatsTotal = 0;
  try {
    chatsTotal = (await fetchAllAvitoChats(token, userId)).length;
  } catch (e) {
    errors.push(`Чаты: ${e.message}`);
  }

  return {
    meta: { accountId: account.id, accountName: account.name, userId, dateFrom, dateTo, generatedAt: new Date().toISOString() },
    self: selfRes.status === 'fulfilled' ? selfRes.value : null,
    balance: balanceRes.status === 'fulfilled' ? balanceRes.value : null,
    rating: ratingRes.status === 'fulfilled' ? ratingRes.value : null,
    reviews: reviewsRes.status === 'fulfilled' ? reviewsRes.value : { total: 0, reviews: [] },
    // Ad spend / "Аванс" (advance) aren't exposed by any documented Avito partner API
    // endpoint — they only exist in the seller's own web cabinet — so they're not included
    // here; views/contacts/favorites below are real, summed from daily stats.
    daily: {
      yesterday: { date: yesterday, ...yesterdayTotals },
      monthToDate: { from: monthStart, to: today, ...monthToDateTotals },
    },
    items: items_out,
    counts: { items: items_out.length, chatsTotal },
    errors,
  };
}

async function runAvitoChatList(env, account, limit, offset) {
  const token = await avitoGetToken(env, account);
  const userId = account.userId;
  const data = await avitoJson(token, `/messenger/${AVITO_CHATS_VERSION}/accounts/${userId}/chats?chat_types=u2i&limit=${limit}&offset=${offset}`);
  const chats = (data.chats || []).map((c) => ({
    chat_id: c.id,
    item_id: (c.context && c.context.value && c.context.value.id) || '',
    item_title: (c.context && c.context.value && c.context.value.title) || '',
    updated: c.updated ? new Date(Number(c.updated) * 1000).toISOString() : '',
    last_message_text: c.last_message ? avitoMessageText(c.last_message) : '',
    last_message_author_is_manager: c.last_message ? String(c.last_message.author_id) === String(userId) : null,
  }));
  return { chats, hasMore: Boolean(data.meta && data.meta.has_more) };
}

async function runAvitoChatMessages(env, account, chatId) {
  const token = await avitoGetToken(env, account);
  const userId = account.userId;
  const msgs = await fetchAllAvitoMessages(token, userId, chatId);

  const voiceQueue = [];
  const out = msgs.map((m) => {
    const ts = Number(m.created) * 1000;
    const row = {
      message_id: m.id,
      datetime: new Date(ts).toISOString(),
      author: String(m.author_id) === String(userId) ? 'manager' : 'client',
      type: m.type,
      text: avitoMessageText(m),
    };
    if (m.type === 'voice') {
      const voiceId = m.content && m.content.voice && m.content.voice.voice_id;
      if (voiceId) voiceQueue.push(voiceId);
    }
    return row;
  });

  if (voiceQueue.length) {
    try {
      const links = await fetchAvitoVoiceLinks(token, userId, voiceQueue);
      out.forEach((row, i) => {
        const voiceId = msgs[i].content && msgs[i].content.voice && msgs[i].content.voice.voice_id;
        if (voiceId && links[voiceId]) row.text = `[голосовое сообщение] ${links[voiceId]}`;
      });
    } catch {
      // voice links are a nice-to-have; missing ones just keep the placeholder text
    }
  }

  return { messages: out };
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
    let userId = (body && String(body.userId || '').trim()) || '';
    if (!name || !clientId || !clientSecret) return json({ error: 'missing_fields' }, 400);

    if (!userId) {
      try {
        userId = await avitoLookupUserId(clientId, clientSecret);
      } catch (e) {
        return json({ error: 'user_id_lookup_failed', message: String(e && e.message) }, 502);
      }
    }

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

  if (pathname === '/api/avito/overview' && request.method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    if (!accountId || !dateFrom || !dateTo) return json({ error: 'missing_fields' }, 400);
    const account = await kv.get(`account:${accountId}`, 'json');
    if (!account) return json({ error: 'not_found' }, 404);
    try {
      return json(await runAvitoOverview(env, account, dateFrom, dateTo));
    } catch (e) {
      return json({ error: 'overview_failed', message: String(e && e.message) }, 502);
    }
  }

  if (pathname === '/api/avito/chats' && request.method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    if (!accountId) return json({ error: 'missing_account_id' }, 400);
    const account = await kv.get(`account:${accountId}`, 'json');
    if (!account) return json({ error: 'not_found' }, 404);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
    const offset = Number(url.searchParams.get('offset')) || 0;
    try {
      return json(await runAvitoChatList(env, account, limit, offset));
    } catch (e) {
      return json({ error: 'chats_failed', message: String(e && e.message) }, 502);
    }
  }

  if (pathname === '/api/avito/messages' && request.method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    const chatId = url.searchParams.get('chatId');
    if (!accountId || !chatId) return json({ error: 'missing_fields' }, 400);
    const account = await kv.get(`account:${accountId}`, 'json');
    if (!account) return json({ error: 'not_found' }, 404);
    try {
      return json(await runAvitoChatMessages(env, account, chatId));
    } catch (e) {
      return json({ error: 'messages_failed', message: String(e && e.message) }, 502);
    }
  }

  return json({ error: 'not_found' }, 404);
}

// ── /dashboard: agency-owner dashboard ──

const DASHBOARD_PASSWORD = '12345678';
const SALE_PRICES = { primary: 50000, repeat: 25000 };

const DEFAULT_EMPLOYEES = [
  { id: 'olga-shpakovskaya', name: 'Ольга Шпаковская', position: 'Клиентский менеджер', salary: 25000 },
  { id: 'sofia-romanovna', name: 'София Романовна', position: 'Ассистент', salary: 25000 },
  { id: 'ainur-sadretdinov', name: 'Айнур Садретдинов', position: 'Специалист по Авито', salary: 25000 },
  { id: 'evgeny-isaev', name: 'Евгений Исаев', position: 'Специалист по Авито', salary: 30000 },
];

const DEFAULT_PROJECTS = [
  'irina-armbrister::Ирина Армбристер',
  'larisa-romashova::Лариса Ромашова',
  'elena-dobrynina::Елена Добрынина',
  'alexey-shevchuk::Алексей Шевчук',
  'valentin-volkov::Валентин Волков',
  'ivan-karientidi::Иван Кариентиди',
  'olga-ageshina::Ольга Агешина',
  'svetlana-soboleva::Светлана Соболева',
  'olga-simagina::Ольга Симагина',
  'oksana-alekseeva::Оксана Алексеева',
].map((entry) => {
  const [id, name] = entry.split('::');
  return { id, name, service: 'Продвижение на Авито', responsibleId: null, status: 'active', review: '', ratings: { result: 0, communication: 0, quality: 0 } };
});

// From the daily Avito ad-account reports (месячные итоги на 31.08 и на 02.09).
const DEFAULT_ANALYTICS = [
  { projectId: 'irina-armbrister', month: '2026-08', budget: 25430, views: 174, contacts: 12, conversionPct: 7, cpl: 2119, diagnostics: 1, salesCount: 0, cac: null },
  { projectId: 'larisa-romashova', month: '2026-08', budget: 19994, views: 310, contacts: 21, conversionPct: 7, cpl: 952, diagnostics: 7, salesCount: 1, cac: 19994 },
  { projectId: 'elena-dobrynina', month: '2026-08', budget: 46047, views: 704, contacts: 41, conversionPct: 6, cpl: 1123, diagnostics: 12, salesCount: 9, cac: 5116 },
  { projectId: 'alexey-shevchuk', month: '2026-08', budget: 13507, views: 162, contacts: 9, conversionPct: 6, cpl: 1501, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'valentin-volkov', month: '2026-08', budget: 29373, views: 268, contacts: 16, conversionPct: 6, cpl: 1836, diagnostics: 2, salesCount: 2, cac: 14686 },
  { projectId: 'ivan-karientidi', month: '2026-08', budget: 13947, views: 150, contacts: 5, conversionPct: 3, cpl: 2789, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'olga-ageshina', month: '2026-08', budget: 14504, views: 114, contacts: 5, conversionPct: 4, cpl: 2901, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'svetlana-soboleva', month: '2026-08', budget: 86456, views: 709, contacts: 58, conversionPct: 8, cpl: 1491, diagnostics: 10, salesCount: 3, cac: 28819 },
  { projectId: 'irina-armbrister', month: '2026-09', budget: 2341, views: 29, contacts: 0, conversionPct: 0, cpl: 0, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'larisa-romashova', month: '2026-09', budget: 2085, views: 31, contacts: 3, conversionPct: 10, cpl: 695, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'elena-dobrynina', month: '2026-09', budget: 2092, views: 38, contacts: 1, conversionPct: 3, cpl: 2092, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'alexey-shevchuk', month: '2026-09', budget: 990, views: 16, contacts: 1, conversionPct: 6, cpl: 990, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'valentin-volkov', month: '2026-09', budget: 2000, views: 21, contacts: 1, conversionPct: 5, cpl: 2000, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'ivan-karientidi', month: '2026-09', budget: 5039, views: 39, contacts: 4, conversionPct: 10, cpl: 1260, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'olga-ageshina', month: '2026-09', budget: 3349, views: 18, contacts: 1, conversionPct: 6, cpl: 3349, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'svetlana-soboleva', month: '2026-09', budget: 8195, views: 73, contacts: 3, conversionPct: 4, cpl: 2732, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'olga-simagina', month: '2026-09', budget: 2050, views: 23, contacts: 1, conversionPct: 4, cpl: 2050, diagnostics: 0, salesCount: 0, cac: null },
  { projectId: 'oksana-alekseeva', month: '2026-09', budget: 1604, views: 28, contacts: 1, conversionPct: 4, cpl: 1604, diagnostics: 0, salesCount: 0, cac: null },
];

// Additional clients discovered in the daily Avito CSV export that weren't in the
// original DEFAULT_PROJECTS placeholder list above (added when daily-metrics tracking
// was introduced) — seeded once via ensureDailyMetricsSeed, independent of `seeded`.
const NEW_PROJECTS_FOR_DAILY_METRICS = [
  { id: 'galina-simagina', name: 'Галина Симагина' },
  { id: 'aydar-ziyazov', name: 'Айдар Зиязов' },
  { id: 'anna-kramorenko', name: 'Анна Краморенко' },
].map((p) => ({ ...p, service: 'Продвижение на Авито', responsibleId: null, status: 'active', review: '', ratings: { result: 0, communication: 0, quality: 0 } }));

// Per-day metrics parsed from the agency's daily Avito ad-account CSV export
// (16.06.2026 - 08.09.2026). Tuple = [projectId, date, budget, views, contacts, diagnostics, sales].
// Zero-value days are omitted.
const DEFAULT_DAILY_METRICS = [
['irina-armbrister','2026-06-22',31,1,0,0,0],
['irina-armbrister','2026-06-30',130,2,0,0,0],
['irina-armbrister','2026-07-01',116,3,1,0,0],
['irina-armbrister','2026-07-02',129,2,1,0,0],
['irina-armbrister','2026-07-03',170,2,0,0,0],
['irina-armbrister','2026-07-04',404,5,0,0,0],
['irina-armbrister','2026-07-05',518,8,1,0,0],
['irina-armbrister','2026-07-06',438,5,0,0,0],
['irina-armbrister','2026-07-07',356,4,1,0,0],
['irina-armbrister','2026-07-08',416,4,0,0,0],
['irina-armbrister','2026-07-09',105,1,0,0,0],
['irina-armbrister','2026-07-10',462,5,0,0,0],
['irina-armbrister','2026-07-11',452,5,0,0,0],
['irina-armbrister','2026-07-12',208,2,0,0,0],
['irina-armbrister','2026-07-14',29,2,0,0,0],
['irina-armbrister','2026-07-15',249,3,0,0,0],
['irina-armbrister','2026-07-19',181,2,0,0,0],
['irina-armbrister','2026-07-20',113,1,1,0,0],
['irina-armbrister','2026-07-24',796,8,2,0,0],
['irina-armbrister','2026-07-25',1128,7,0,0,0],
['irina-armbrister','2026-07-26',1471,14,0,0,0],
['irina-armbrister','2026-07-27',1490,8,2,0,0],
['irina-armbrister','2026-07-28',1591,11,1,0,0],
['irina-armbrister','2026-07-29',708,5,1,0,0],
['irina-armbrister','2026-07-30',1073,6,0,0,0],
['irina-armbrister','2026-07-31',1086,10,1,0,0],
['irina-armbrister','2026-08-01',718,5,0,0,0],
['irina-armbrister','2026-08-02',1011,6,0,0,0],
['irina-armbrister','2026-08-03',1163,9,1,0,0],
['irina-armbrister','2026-08-04',1125,8,1,0,0],
['irina-armbrister','2026-08-05',1113,5,1,0,0],
['irina-armbrister','2026-08-06',1000,4,0,0,0],
['irina-armbrister','2026-08-07',1105,5,0,0,0],
['irina-armbrister','2026-08-08',1185,5,0,0,0],
['irina-armbrister','2026-08-09',935,4,0,0,0],
['irina-armbrister','2026-08-10',1000,4,1,0,0],
['irina-armbrister','2026-08-11',1107,6,0,0,0],
['irina-armbrister','2026-08-12',1185,5,0,0,0],
['irina-armbrister','2026-08-13',1135,5,0,0,0],
['irina-armbrister','2026-08-14',562,6,1,0,0],
['irina-armbrister','2026-08-15',772,5,0,0,0],
['irina-armbrister','2026-08-16',494,4,0,0,0],
['irina-armbrister','2026-08-17',752,5,0,0,0],
['irina-armbrister','2026-08-18',730,6,2,0,0],
['irina-armbrister','2026-08-19',483,5,0,0,0],
['irina-armbrister','2026-08-20',632,6,0,0,0],
['irina-armbrister','2026-08-21',754,7,1,0,0],
['irina-armbrister','2026-08-22',937,9,1,0,0],
['irina-armbrister','2026-08-23',613,6,2,1,0],
['irina-armbrister','2026-08-24',914,9,0,0,0],
['irina-armbrister','2026-08-25',803,6,0,0,0],
['irina-armbrister','2026-08-26',792,9,0,0,0],
['irina-armbrister','2026-08-27',695,6,0,0,0],
['irina-armbrister','2026-08-28',736,6,1,0,0],
['irina-armbrister','2026-08-29',125,2,0,0,0],
['irina-armbrister','2026-08-30',854,6,0,0,0],
['irina-armbrister','2026-08-31',0,0,0,2,0],
['irina-armbrister','2026-09-01',1124,16,0,0,0],
['irina-armbrister','2026-09-02',1217,13,0,0,0],
['irina-armbrister','2026-09-03',1262,11,1,0,0],
['irina-armbrister','2026-09-04',1256,10,1,0,0],
['irina-armbrister','2026-09-05',723,5,0,0,0],
['irina-armbrister','2026-09-06',870,6,1,0,0],
['irina-armbrister','2026-09-07',1101,8,0,0,0],
['irina-armbrister','2026-09-08',959,9,2,0,0],
['larisa-romashova','2026-06-16',1288,25,1,4,2],
['larisa-romashova','2026-06-17',842,18,2,0,0],
['larisa-romashova','2026-06-18',971,19,0,0,0],
['larisa-romashova','2026-06-19',951,15,1,0,0],
['larisa-romashova','2026-06-20',921,18,0,0,0],
['larisa-romashova','2026-06-21',898,15,1,0,0],
['larisa-romashova','2026-06-22',1174,22,1,0,0],
['larisa-romashova','2026-06-23',1063,17,1,1,0],
['larisa-romashova','2026-06-24',929,17,1,1,1],
['larisa-romashova','2026-06-25',683,11,1,0,0],
['larisa-romashova','2026-06-26',613,14,0,0,0],
['larisa-romashova','2026-06-27',971,16,1,1,0],
['larisa-romashova','2026-06-28',1267,23,2,1,0],
['larisa-romashova','2026-06-29',898,18,1,1,0],
['larisa-romashova','2026-06-30',994,16,1,1,1],
['larisa-romashova','2026-07-01',657,12,0,0,0],
['larisa-romashova','2026-07-02',334,6,1,1,0],
['larisa-romashova','2026-07-03',76,1,0,0,0],
['larisa-romashova','2026-07-05',349,6,1,1,0],
['larisa-romashova','2026-07-06',592,11,0,0,0],
['larisa-romashova','2026-07-07',1411,23,2,0,0],
['larisa-romashova','2026-07-08',885,16,1,0,0],
['larisa-romashova','2026-07-09',971,19,3,0,0],
['larisa-romashova','2026-07-10',589,10,1,0,0],
['larisa-romashova','2026-07-11',741,11,0,0,0],
['larisa-romashova','2026-07-12',997,26,0,0,0],
['larisa-romashova','2026-07-13',898,17,0,0,1],
['larisa-romashova','2026-07-14',968,17,1,0,0],
['larisa-romashova','2026-07-15',497,11,2,0,0],
['larisa-romashova','2026-07-16',601,11,1,0,0],
['larisa-romashova','2026-07-17',727,13,1,0,0],
['larisa-romashova','2026-07-18',845,16,2,0,0],
['larisa-romashova','2026-07-19',928,16,1,0,0],
['larisa-romashova','2026-07-27',964,17,0,0,0],
['larisa-romashova','2026-07-28',997,18,1,0,0],
['larisa-romashova','2026-07-29',992,17,1,0,0],
['larisa-romashova','2026-07-30',935,14,2,2,1],
['larisa-romashova','2026-07-31',1000,17,1,0,0],
['larisa-romashova','2026-08-01',863,13,0,0,0],
['larisa-romashova','2026-08-02',288,5,0,0,0],
['larisa-romashova','2026-08-03',961,15,1,0,0],
['larisa-romashova','2026-08-04',997,16,1,0,0],
['larisa-romashova','2026-08-05',988,15,2,0,0],
['larisa-romashova','2026-08-06',988,15,0,0,0],
['larisa-romashova','2026-08-13',554,8,1,0,0],
['larisa-romashova','2026-08-14',958,14,3,0,0],
['larisa-romashova','2026-08-15',975,18,0,0,0],
['larisa-romashova','2026-08-16',960,17,0,0,0],
['larisa-romashova','2026-08-17',988,14,0,0,0],
['larisa-romashova','2026-08-18',567,8,1,0,0],
['larisa-romashova','2026-08-19',282,5,1,0,0],
['larisa-romashova','2026-08-20',966,14,2,0,0],
['larisa-romashova','2026-08-21',957,14,1,0,0],
['larisa-romashova','2026-08-22',626,10,1,0,0],
['larisa-romashova','2026-08-23',815,13,1,7,1],
['larisa-romashova','2026-08-24',893,14,1,0,0],
['larisa-romashova','2026-08-25',971,16,0,0,0],
['larisa-romashova','2026-08-26',708,12,0,0,0],
['larisa-romashova','2026-08-27',648,10,2,0,0],
['larisa-romashova','2026-08-28',290,4,0,0,0],
['larisa-romashova','2026-08-29',846,12,1,0,0],
['larisa-romashova','2026-08-30',916,12,2,0,0],
['larisa-romashova','2026-08-31',989,16,0,0,0],
['larisa-romashova','2026-09-01',998,15,1,0,0],
['larisa-romashova','2026-09-02',1087,16,2,0,0],
['larisa-romashova','2026-09-03',1096,17,1,0,0],
['larisa-romashova','2026-09-04',1091,16,2,0,0],
['larisa-romashova','2026-09-05',1049,16,2,0,0],
['larisa-romashova','2026-09-06',285,4,0,0,0],
['larisa-romashova','2026-09-07',1065,16,2,1,0],
['larisa-romashova','2026-09-08',838,10,1,0,0],
['elena-dobrynina','2026-06-30',515,14,1,0,0],
['elena-dobrynina','2026-07-01',471,14,0,0,0],
['elena-dobrynina','2026-07-02',734,20,2,0,0],
['elena-dobrynina','2026-07-03',504,15,1,0,0],
['elena-dobrynina','2026-07-04',414,12,3,0,0],
['elena-dobrynina','2026-07-05',765,21,2,0,0],
['elena-dobrynina','2026-07-06',1022,29,3,0,0],
['elena-dobrynina','2026-07-07',302,10,1,0,0],
['elena-dobrynina','2026-07-08',420,14,1,0,0],
['elena-dobrynina','2026-07-09',331,11,0,0,0],
['elena-dobrynina','2026-07-10',562,9,2,0,0],
['elena-dobrynina','2026-07-11',562,12,1,0,0],
['elena-dobrynina','2026-07-15',982,19,2,0,0],
['elena-dobrynina','2026-07-16',435,11,1,0,0],
['elena-dobrynina','2026-07-17',451,8,0,0,0],
['elena-dobrynina','2026-07-18',749,14,0,0,0],
['elena-dobrynina','2026-07-19',460,8,0,0,0],
['elena-dobrynina','2026-07-20',824,17,3,0,0],
['elena-dobrynina','2026-07-21',1027,19,2,0,0],
['elena-dobrynina','2026-07-22',864,16,1,0,0],
['elena-dobrynina','2026-07-23',775,14,1,0,0],
['elena-dobrynina','2026-07-24',1735,31,3,0,0],
['elena-dobrynina','2026-07-25',725,12,0,0,0],
['elena-dobrynina','2026-07-26',1171,20,1,0,0],
['elena-dobrynina','2026-07-27',786,15,2,0,0],
['elena-dobrynina','2026-07-28',723,18,3,0,0],
['elena-dobrynina','2026-07-29',976,20,2,0,0],
['elena-dobrynina','2026-07-30',1154,19,4,9,0],
['elena-dobrynina','2026-07-31',1788,33,1,0,0],
['elena-dobrynina','2026-08-01',970,23,1,0,0],
['elena-dobrynina','2026-08-02',905,15,1,0,0],
['elena-dobrynina','2026-08-03',1293,29,0,0,0],
['elena-dobrynina','2026-08-04',1234,24,3,0,0],
['elena-dobrynina','2026-08-05',1181,27,1,0,0],
['elena-dobrynina','2026-08-06',764,19,1,0,0],
['elena-dobrynina','2026-08-07',853,21,2,0,0],
['elena-dobrynina','2026-08-08',2120,29,1,0,0],
['elena-dobrynina','2026-08-09',1941,32,3,0,0],
['elena-dobrynina','2026-08-10',1758,29,1,0,0],
['elena-dobrynina','2026-08-11',2228,32,2,0,0],
['elena-dobrynina','2026-08-12',1959,24,2,0,0],
['elena-dobrynina','2026-08-13',2385,28,1,0,0],
['elena-dobrynina','2026-08-14',1355,23,1,0,0],
['elena-dobrynina','2026-08-15',1743,20,2,0,0],
['elena-dobrynina','2026-08-16',1661,24,0,0,0],
['elena-dobrynina','2026-08-17',1628,19,3,0,0],
['elena-dobrynina','2026-08-18',2018,23,0,0,0],
['elena-dobrynina','2026-08-19',2368,23,1,0,0],
['elena-dobrynina','2026-08-20',2368,26,1,0,0],
['elena-dobrynina','2026-08-21',1941,29,2,0,0],
['elena-dobrynina','2026-08-22',893,13,1,0,0],
['elena-dobrynina','2026-08-23',1018,19,1,12,9],
['elena-dobrynina','2026-08-24',657,14,0,0,0],
['elena-dobrynina','2026-08-25',1750,29,0,0,0],
['elena-dobrynina','2026-08-26',2050,27,3,0,0],
['elena-dobrynina','2026-08-27',1208,18,4,2,1],
['elena-dobrynina','2026-08-28',688,9,0,0,1],
['elena-dobrynina','2026-08-29',769,14,0,0,0],
['elena-dobrynina','2026-08-30',1301,21,2,0,0],
['elena-dobrynina','2026-08-31',1040,21,1,0,0],
['elena-dobrynina','2026-09-01',1607,29,1,0,0],
['elena-dobrynina','2026-09-02',485,9,0,0,0],
['elena-dobrynina','2026-09-03',1435,22,1,0,0],
['elena-dobrynina','2026-09-04',1653,33,4,0,0],
['elena-dobrynina','2026-09-05',147,1,0,0,0],
['elena-dobrynina','2026-09-06',711,11,0,0,0],
['elena-dobrynina','2026-09-07',666,11,0,1,0],
['elena-dobrynina','2026-09-08',829,16,0,0,0],
['alexey-shevchuk','2026-06-16',28,1,0,0,0],
['alexey-shevchuk','2026-06-17',92,2,1,0,0],
['alexey-shevchuk','2026-06-19',64,3,0,0,0],
['alexey-shevchuk','2026-06-20',123,1,0,0,0],
['alexey-shevchuk','2026-06-21',357,4,1,0,0],
['alexey-shevchuk','2026-06-22',711,8,0,0,0],
['alexey-shevchuk','2026-06-23',70,3,0,0,0],
['alexey-shevchuk','2026-06-24',372,7,0,0,0],
['alexey-shevchuk','2026-06-25',287,4,0,0,0],
['alexey-shevchuk','2026-06-26',298,8,1,0,0],
['alexey-shevchuk','2026-06-27',251,7,2,0,0],
['alexey-shevchuk','2026-06-28',272,6,0,0,0],
['alexey-shevchuk','2026-06-29',253,11,0,0,0],
['alexey-shevchuk','2026-06-30',322,8,1,1,0],
['alexey-shevchuk','2026-07-01',157,4,0,0,0],
['alexey-shevchuk','2026-07-02',296,6,0,0,0],
['alexey-shevchuk','2026-07-03',199,5,0,0,0],
['alexey-shevchuk','2026-07-04',251,6,0,0,0],
['alexey-shevchuk','2026-07-05',61,1,0,0,0],
['alexey-shevchuk','2026-07-06',274,7,0,0,0],
['alexey-shevchuk','2026-07-07',55,1,0,0,0],
['alexey-shevchuk','2026-07-08',98,2,0,0,0],
['alexey-shevchuk','2026-07-09',101,0,0,0,0],
['alexey-shevchuk','2026-07-10',277,6,1,0,0],
['alexey-shevchuk','2026-07-11',158,3,0,0,0],
['alexey-shevchuk','2026-07-12',400,6,0,0,0],
['alexey-shevchuk','2026-07-13',247,4,1,0,0],
['alexey-shevchuk','2026-07-14',290,6,0,0,0],
['alexey-shevchuk','2026-07-15',1915,27,0,0,0],
['alexey-shevchuk','2026-07-16',761,11,2,0,0],
['alexey-shevchuk','2026-07-17',1087,15,3,0,0],
['alexey-shevchuk','2026-07-18',841,12,0,0,0],
['alexey-shevchuk','2026-07-19',812,11,0,0,0],
['alexey-shevchuk','2026-07-20',1300,16,2,0,0],
['alexey-shevchuk','2026-07-21',840,10,0,0,0],
['alexey-shevchuk','2026-07-22',1054,13,0,0,0],
['alexey-shevchuk','2026-07-23',464,2,0,1,1],
['alexey-shevchuk','2026-07-24',475,6,0,0,0],
['alexey-shevchuk','2026-07-31',97,1,0,0,0],
['alexey-shevchuk','2026-08-01',228,3,0,0,0],
['alexey-shevchuk','2026-08-02',856,10,0,0,0],
['alexey-shevchuk','2026-08-03',876,10,1,0,0],
['alexey-shevchuk','2026-08-04',1114,13,0,0,0],
['alexey-shevchuk','2026-08-05',832,10,0,0,0],
['alexey-shevchuk','2026-08-06',759,9,2,0,0],
['alexey-shevchuk','2026-08-07',575,7,0,0,0],
['alexey-shevchuk','2026-08-08',799,9,1,0,0],
['alexey-shevchuk','2026-08-09',358,4,0,0,0],
['alexey-shevchuk','2026-08-10',1472,17,1,0,0],
['alexey-shevchuk','2026-08-11',274,3,0,0,0],
['alexey-shevchuk','2026-08-19',431,5,0,0,0],
['alexey-shevchuk','2026-08-20',875,9,0,0,0],
['alexey-shevchuk','2026-08-21',307,3,1,0,0],
['alexey-shevchuk','2026-08-22',124,2,0,0,0],
['alexey-shevchuk','2026-08-23',184,2,0,0,0],
['alexey-shevchuk','2026-08-24',537,8,0,0,0],
['alexey-shevchuk','2026-08-25',445,5,0,0,0],
['alexey-shevchuk','2026-08-26',483,6,1,0,0],
['alexey-shevchuk','2026-08-27',324,4,1,0,0],
['alexey-shevchuk','2026-08-28',682,8,0,0,0],
['alexey-shevchuk','2026-08-29',318,4,0,0,0],
['alexey-shevchuk','2026-08-30',495,6,1,1,0],
['alexey-shevchuk','2026-08-31',159,5,0,0,0],
['alexey-shevchuk','2026-09-01',364,9,0,0,0],
['alexey-shevchuk','2026-09-02',626,7,1,0,0],
['alexey-shevchuk','2026-09-03',1088,15,1,0,0],
['alexey-shevchuk','2026-09-04',980,12,2,0,0],
['alexey-shevchuk','2026-09-05',854,10,0,0,0],
['alexey-shevchuk','2026-09-06',1001,13,0,0,0],
['alexey-shevchuk','2026-09-07',786,9,0,1,0],
['alexey-shevchuk','2026-09-08',406,5,0,0,0],
['valentin-volkov','2026-07-13',5000,0,0,0,0],
['valentin-volkov','2026-07-15',0,10,1,0,0],
['valentin-volkov','2026-07-20',0,12,0,0,0],
['valentin-volkov','2026-07-27',868,10,0,0,0],
['valentin-volkov','2026-07-28',1718,20,0,0,0],
['valentin-volkov','2026-07-29',238,3,0,0,0],
['valentin-volkov','2026-07-30',254,3,0,0,0],
['valentin-volkov','2026-07-31',360,4,0,0,0],
['valentin-volkov','2026-08-01',90,1,0,0,0],
['valentin-volkov','2026-08-02',270,3,1,0,0],
['valentin-volkov','2026-08-03',180,2,0,0,0],
['valentin-volkov','2026-08-04',164,2,0,0,0],
['valentin-volkov','2026-08-05',772,8,0,0,0],
['valentin-volkov','2026-08-06',310,3,0,0,0],
['valentin-volkov','2026-08-07',962,9,2,0,0],
['valentin-volkov','2026-08-08',1101,11,0,0,0],
['valentin-volkov','2026-08-09',625,6,0,0,0],
['valentin-volkov','2026-08-10',1941,20,1,0,0],
['valentin-volkov','2026-08-11',1791,19,1,0,0],
['valentin-volkov','2026-08-12',1285,12,0,0,0],
['valentin-volkov','2026-08-13',2472,20,1,0,0],
['valentin-volkov','2026-08-14',2315,20,0,0,0],
['valentin-volkov','2026-08-15',1841,15,0,0,0],
['valentin-volkov','2026-08-16',886,7,1,0,0],
['valentin-volkov','2026-08-17',644,6,0,0,0],
['valentin-volkov','2026-08-18',656,6,0,0,0],
['valentin-volkov','2026-08-19',869,8,0,0,0],
['valentin-volkov','2026-08-20',734,7,1,0,0],
['valentin-volkov','2026-08-21',939,8,2,0,0],
['valentin-volkov','2026-08-22',903,8,0,0,0],
['valentin-volkov','2026-08-23',640,6,1,2,2],
['valentin-volkov','2026-08-24',930,8,0,0,0],
['valentin-volkov','2026-08-25',972,9,0,0,0],
['valentin-volkov','2026-08-26',976,9,0,0,0],
['valentin-volkov','2026-08-27',939,8,0,0,0],
['valentin-volkov','2026-08-28',766,7,0,0,0],
['valentin-volkov','2026-08-29',549,4,1,0,0],
['valentin-volkov','2026-08-30',933,8,0,0,0],
['valentin-volkov','2026-08-31',918,8,4,0,0],
['valentin-volkov','2026-09-01',987,12,0,0,0],
['valentin-volkov','2026-09-02',1013,9,1,0,0],
['valentin-volkov','2026-09-03',1024,8,0,0,0],
['valentin-volkov','2026-09-04',1050,9,0,0,0],
['valentin-volkov','2026-09-05',1060,9,2,0,0],
['valentin-volkov','2026-09-06',1088,10,1,0,0],
['valentin-volkov','2026-09-07',1087,10,0,0,0],
['valentin-volkov','2026-09-08',1088,9,0,0,0],
['ivan-karientidi','2026-06-30',100,0,0,0,0],
['ivan-karientidi','2026-07-01',118,1,0,0,0],
['ivan-karientidi','2026-07-02',100,0,0,0,0],
['ivan-karientidi','2026-07-03',100,0,0,0,0],
['ivan-karientidi','2026-07-04',100,0,0,0,0],
['ivan-karientidi','2026-07-05',118,1,0,0,0],
['ivan-karientidi','2026-07-06',100,0,0,0,0],
['ivan-karientidi','2026-07-07',124,1,0,0,0],
['ivan-karientidi','2026-07-08',145,1,0,0,0],
['ivan-karientidi','2026-07-09',233,2,0,0,0],
['ivan-karientidi','2026-07-10',100,0,0,0,0],
['ivan-karientidi','2026-07-11',100,0,0,0,0],
['ivan-karientidi','2026-07-12',100,0,0,0,0],
['ivan-karientidi','2026-07-13',316,3,0,0,0],
['ivan-karientidi','2026-07-14',291,3,0,0,0],
['ivan-karientidi','2026-07-15',1038,9,0,0,0],
['ivan-karientidi','2026-07-16',938,8,0,0,0],
['ivan-karientidi','2026-07-17',1057,6,0,0,0],
['ivan-karientidi','2026-07-18',1062,6,0,0,0],
['ivan-karientidi','2026-07-19',952,6,0,0,0],
['ivan-karientidi','2026-07-20',554,3,0,0,0],
['ivan-karientidi','2026-07-21',277,1,0,0,0],
['ivan-karientidi','2026-07-22',987,5,0,0,0],
['ivan-karientidi','2026-07-23',1003,6,0,0,0],
['ivan-karientidi','2026-07-24',1030,7,0,0,0],
['ivan-karientidi','2026-07-25',1077,8,0,0,0],
['ivan-karientidi','2026-07-26',220,1,0,0,0],
['ivan-karientidi','2026-07-27',1008,7,0,0,0],
['ivan-karientidi','2026-07-28',491,3,0,0,0],
['ivan-karientidi','2026-07-29',475,3,0,0,0],
['ivan-karientidi','2026-07-30',483,3,0,0,0],
['ivan-karientidi','2026-07-31',398,3,0,0,0],
['ivan-karientidi','2026-08-01',135,1,0,0,0],
['ivan-karientidi','2026-08-11',592,20,0,0,0],
['ivan-karientidi','2026-08-12',490,12,0,0,0],
['ivan-karientidi','2026-08-13',223,5,0,0,0],
['ivan-karientidi','2026-08-14',169,1,0,0,0],
['ivan-karientidi','2026-08-15',365,4,1,0,0],
['ivan-karientidi','2026-08-16',433,4,0,0,0],
['ivan-karientidi','2026-08-17',868,9,1,0,0],
['ivan-karientidi','2026-08-18',365,4,1,0,0],
['ivan-karientidi','2026-08-19',996,8,0,0,0],
['ivan-karientidi','2026-08-20',989,9,0,0,0],
['ivan-karientidi','2026-08-21',631,8,0,0,0],
['ivan-karientidi','2026-08-22',223,1,0,0,0],
['ivan-karientidi','2026-08-23',649,6,0,0,0],
['ivan-karientidi','2026-08-24',2236,19,2,0,0],
['ivan-karientidi','2026-08-25',310,3,0,0,0],
['ivan-karientidi','2026-08-26',1042,9,0,0,0],
['ivan-karientidi','2026-08-27',965,8,0,0,0],
['ivan-karientidi','2026-08-28',787,7,0,0,0],
['ivan-karientidi','2026-08-29',353,3,0,0,0],
['ivan-karientidi','2026-08-30',934,8,0,0,0],
['ivan-karientidi','2026-08-31',192,1,0,0,0],
['ivan-karientidi','2026-09-01',962,8,0,0,0],
['ivan-karientidi','2026-09-02',4077,31,4,0,0],
['ivan-karientidi','2026-09-03',3596,23,0,1,1],
['ivan-karientidi','2026-09-04',2767,18,1,0,0],
['ivan-karientidi','2026-09-05',2475,19,0,0,0],
['ivan-karientidi','2026-09-06',2118,16,0,0,0],
['ivan-karientidi','2026-09-07',3082,22,0,0,0],
['ivan-karientidi','2026-09-08',3545,26,0,0,0],
['olga-ageshina','2026-07-24',317,4,0,0,0],
['olga-ageshina','2026-07-25',75,1,0,0,0],
['olga-ageshina','2026-07-26',76,1,0,0,0],
['olga-ageshina','2026-07-27',166,2,0,0,0],
['olga-ageshina','2026-07-31',171,1,0,0,0],
['olga-ageshina','2026-08-01',628,4,0,0,0],
['olga-ageshina','2026-08-02',171,1,0,0,0],
['olga-ageshina','2026-08-03',171,1,0,0,0],
['olga-ageshina','2026-08-04',643,7,0,0,0],
['olga-ageshina','2026-08-05',575,8,1,0,0],
['olga-ageshina','2026-08-06',545,5,0,0,0],
['olga-ageshina','2026-08-07',117,2,0,0,0],
['olga-ageshina','2026-08-08',403,4,0,0,0],
['olga-ageshina','2026-08-09',95,1,0,0,0],
['olga-ageshina','2026-08-10',355,3,0,0,0],
['olga-ageshina','2026-08-11',722,6,1,0,0],
['olga-ageshina','2026-08-13',239,3,1,0,0],
['olga-ageshina','2026-08-14',279,2,0,0,0],
['olga-ageshina','2026-08-15',551,5,0,0,0],
['olga-ageshina','2026-08-16',92,1,0,0,0],
['olga-ageshina','2026-08-17',520,4,0,0,0],
['olga-ageshina','2026-08-18',516,4,0,0,0],
['olga-ageshina','2026-08-19',169,1,0,0,0],
['olga-ageshina','2026-08-20',230,2,0,0,0],
['olga-ageshina','2026-08-22',411,4,0,0,0],
['olga-ageshina','2026-08-23',187,2,0,0,0],
['olga-ageshina','2026-08-24',116,2,0,0,0],
['olga-ageshina','2026-08-25',231,3,1,0,0],
['olga-ageshina','2026-08-26',207,2,0,0,0],
['olga-ageshina','2026-08-27',598,4,0,0,0],
['olga-ageshina','2026-08-28',675,5,1,0,0],
['olga-ageshina','2026-08-29',1800,10,0,0,0],
['olga-ageshina','2026-08-30',2695,15,0,0,0],
['olga-ageshina','2026-08-31',563,3,0,0,0],
['olga-ageshina','2026-09-01',1313,8,0,0,0],
['olga-ageshina','2026-09-02',2036,10,1,0,0],
['olga-ageshina','2026-09-03',568,3,1,0,0],
['olga-ageshina','2026-09-04',592,5,1,0,0],
['olga-ageshina','2026-09-05',455,3,0,0,0],
['olga-ageshina','2026-09-06',593,3,0,0,0],
['olga-ageshina','2026-09-07',517,3,1,1,0],
['olga-ageshina','2026-09-08',838,8,0,0,0],
['svetlana-soboleva','2026-07-30',2189,12,1,0,0],
['svetlana-soboleva','2026-07-31',2237,15,0,0,0],
['svetlana-soboleva','2026-08-01',2333,17,1,0,0],
['svetlana-soboleva','2026-08-02',2380,15,2,0,0],
['svetlana-soboleva','2026-08-03',2616,19,2,0,0],
['svetlana-soboleva','2026-08-04',2357,19,3,0,0],
['svetlana-soboleva','2026-08-05',2235,15,0,0,0],
['svetlana-soboleva','2026-08-06',2375,21,4,0,0],
['svetlana-soboleva','2026-08-07',2250,19,3,0,0],
['svetlana-soboleva','2026-08-08',2078,16,2,0,0],
['svetlana-soboleva','2026-08-09',1977,13,0,0,0],
['svetlana-soboleva','2026-08-10',4533,20,0,0,0],
['svetlana-soboleva','2026-08-11',2290,19,2,0,0],
['svetlana-soboleva','2026-08-12',2056,12,3,0,0],
['svetlana-soboleva','2026-08-13',3178,24,2,0,0],
['svetlana-soboleva','2026-08-14',2650,24,3,0,0],
['svetlana-soboleva','2026-08-15',2650,24,0,0,0],
['svetlana-soboleva','2026-08-16',2350,18,2,0,0],
['svetlana-soboleva','2026-08-17',2161,15,2,0,0],
['svetlana-soboleva','2026-08-18',3047,31,1,0,0],
['svetlana-soboleva','2026-08-19',3134,32,4,0,0],
['svetlana-soboleva','2026-08-20',3047,23,2,0,0],
['svetlana-soboleva','2026-08-21',3657,41,7,0,0],
['svetlana-soboleva','2026-08-22',3123,26,2,0,0],
['svetlana-soboleva','2026-08-23',2998,26,0,10,3],
['svetlana-soboleva','2026-08-24',2619,20,0,0,0],
['svetlana-soboleva','2026-08-25',3690,32,4,0,0],
['svetlana-soboleva','2026-08-26',2984,28,3,0,0],
['svetlana-soboleva','2026-08-27',3141,29,0,0,0],
['svetlana-soboleva','2026-08-28',2704,21,0,0,0],
['svetlana-soboleva','2026-08-29',2734,25,2,0,0],
['svetlana-soboleva','2026-08-30',3313,30,0,0,0],
['svetlana-soboleva','2026-08-31',3796,35,2,1,0],
['svetlana-soboleva','2026-09-01',4286,40,1,0,0],
['svetlana-soboleva','2026-09-02',3909,33,2,0,0],
['svetlana-soboleva','2026-09-03',4131,41,6,0,0],
['svetlana-soboleva','2026-09-04',5652,48,3,0,0],
['svetlana-soboleva','2026-09-05',2491,19,3,0,0],
['svetlana-soboleva','2026-09-06',3867,38,6,0,0],
['svetlana-soboleva','2026-09-07',4189,35,7,2,0],
['svetlana-soboleva','2026-09-08',4777,46,7,0,0],
['galina-simagina','2026-08-31',393,3,0,1,1],
['galina-simagina','2026-09-01',686,6,0,0,0],
['galina-simagina','2026-09-02',1364,17,1,0,0],
['galina-simagina','2026-09-03',1163,15,0,0,0],
['galina-simagina','2026-09-04',662,20,2,0,0],
['galina-simagina','2026-09-05',1178,20,2,0,0],
['galina-simagina','2026-09-06',1177,17,1,0,0],
['galina-simagina','2026-09-07',1415,30,1,1,0],
['galina-simagina','2026-09-08',1068,47,0,0,0],
['oksana-alekseeva','2026-08-31',313,3,0,0,0],
['oksana-alekseeva','2026-09-01',798,13,1,0,0],
['oksana-alekseeva','2026-09-02',806,15,0,0,0],
['oksana-alekseeva','2026-09-03',810,12,1,1,0],
['oksana-alekseeva','2026-09-04',784,12,0,0,0],
['oksana-alekseeva','2026-09-05',737,10,0,0,0],
['oksana-alekseeva','2026-09-06',791,11,2,1,0],
['oksana-alekseeva','2026-09-07',810,11,0,1,1],
['oksana-alekseeva','2026-09-08',906,11,1,0,0],
['aydar-ziyazov','2026-06-16',169,6,0,0,0],
['aydar-ziyazov','2026-06-17',49,2,0,0,0],
['aydar-ziyazov','2026-06-18',192,9,0,0,0],
['aydar-ziyazov','2026-06-19',170,7,0,0,0],
['aydar-ziyazov','2026-06-20',231,8,1,0,0],
['aydar-ziyazov','2026-06-21',163,6,0,0,0],
['aydar-ziyazov','2026-06-22',240,9,2,0,0],
['aydar-ziyazov','2026-06-23',333,8,0,0,0],
['aydar-ziyazov','2026-06-24',338,10,0,0,0],
['aydar-ziyazov','2026-06-25',206,6,0,0,0],
['aydar-ziyazov','2026-06-26',442,12,0,0,0],
['aydar-ziyazov','2026-06-27',431,12,0,0,0],
['aydar-ziyazov','2026-06-28',1090,14,0,0,0],
['aydar-ziyazov','2026-06-29',510,11,0,0,0],
['aydar-ziyazov','2026-06-30',642,15,1,0,0],
['aydar-ziyazov','2026-07-01',470,11,1,0,0],
['aydar-ziyazov','2026-07-02',374,9,0,0,0],
['aydar-ziyazov','2026-07-03',342,7,0,0,0],
['aydar-ziyazov','2026-07-04',263,6,0,0,0],
['aydar-ziyazov','2026-07-05',329,7,1,0,0],
['aydar-ziyazov','2026-07-06',367,9,0,0,0],
['aydar-ziyazov','2026-07-07',569,12,0,0,0],
['aydar-ziyazov','2026-07-08',240,5,0,0,0],
['aydar-ziyazov','2026-07-09',82,2,0,0,0],
['aydar-ziyazov','2026-07-10',347,5,0,0,0],
['aydar-ziyazov','2026-07-11',346,4,1,0,0],
['aydar-ziyazov','2026-07-12',750,11,0,0,0],
['aydar-ziyazov','2026-07-13',598,10,0,0,0],
['aydar-ziyazov','2026-07-14',453,7,0,0,0],
['aydar-ziyazov','2026-07-15',581,10,1,0,0],
['aydar-ziyazov','2026-07-16',0,0,1,0,0],
['anna-kramorenko','2026-06-17',32,2,0,0,0],
['anna-kramorenko','2026-06-18',32,2,1,0,0],
['anna-kramorenko','2026-06-19',0,1,0,0,0],
['anna-kramorenko','2026-06-26',11,1,0,0,0],
['anna-kramorenko','2026-06-27',11,1,0,0,0],
['anna-kramorenko','2026-06-29',970,12,1,0,0],
['anna-kramorenko','2026-06-30',888,8,1,0,0],
['anna-kramorenko','2026-07-01',942,12,0,0,0],
['anna-kramorenko','2026-07-03',119,2,0,0,0],
['anna-kramorenko','2026-07-04',148,2,0,0,0],
['anna-kramorenko','2026-07-05',195,3,0,0,0],
['anna-kramorenko','2026-07-06',79,1,0,0,0],
['anna-kramorenko','2026-07-07',79,1,0,0,0],
['anna-kramorenko','2026-07-08',76,1,0,0,0],
['anna-kramorenko','2026-07-09',45,1,0,0,0],
['anna-kramorenko','2026-07-10',220,3,0,0,0],
['anna-kramorenko','2026-07-11',97,2,0,0,0],
['anna-kramorenko','2026-07-12',136,2,0,0,0],
['anna-kramorenko','2026-07-13',84,1,0,0,0],
['anna-kramorenko','2026-07-14',76,1,0,0,0],
['anna-kramorenko','2026-07-15',284,3,0,0,0],
['anna-kramorenko','2026-07-16',122,1,0,0,0],
['anna-kramorenko','2026-07-17',76,1,0,0,0],
['anna-kramorenko','2026-07-18',198,2,0,0,0]
];

function emptySalesMonth() {
  return {
    primary: { planCount: 0, factCount: 0, planRevenue: 0, factRevenue: 0 },
    repeat: { planCount: 0, factCount: 0, planRevenue: 0, factRevenue: 0 },
    leads: 0,
  };
}

async function ensureDashboardSeed(kv) {
  const seeded = await kv.get('seeded');
  if (seeded) return;

  const now = new Date().toISOString();
  await Promise.all([
    ...DEFAULT_EMPLOYEES.map((e) => kv.put(`employee:${e.id}`, JSON.stringify({ ...e, createdAt: now, updatedAt: now }))),
    ...DEFAULT_PROJECTS.map((p) => kv.put(`project:${p.id}`, JSON.stringify({ ...p, createdAt: now, updatedAt: now }))),
    ...DEFAULT_ANALYTICS.map((a) => kv.put(`analytics:${a.projectId}:${a.month}`, JSON.stringify({ ...a, updatedAt: now }))),
    kv.put('sales:2026-08', JSON.stringify({ ...emptySalesMonth(), month: '2026-08', updatedAt: now })),
    kv.put('sales:2026-09', JSON.stringify({ ...emptySalesMonth(), month: '2026-09', updatedAt: now })),
    kv.put('registrationBase', JSON.stringify({ total: 0, updatedAt: now })),
  ]);
  await kv.put('seeded', '1');
}

async function listByPrefix(kv, prefix) {
  const records = [];
  let cursor;
  for (;;) {
    const list = await kv.list({ prefix, cursor });
    const chunk = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    records.push(...chunk.filter(Boolean));
    if (list.list_complete || !list.cursor) break;
    cursor = list.cursor;
  }
  return records;
}

// One-time seed for the daily-metrics feature: adds the clients found in the agency's
// historical CSV export that weren't already tracked, plus their per-day numbers.
// Guarded independently of `seeded` since it ships after the dashboard already went live.
async function ensureDailyMetricsSeed(kv) {
  const seeded = await kv.get('dailyMetricsSeeded');
  if (seeded) return;

  const now = new Date().toISOString();
  const existingIds = new Set((await listByPrefix(kv, 'project:')).map((p) => p.id));
  const writes = [
    ...NEW_PROJECTS_FOR_DAILY_METRICS.filter((p) => !existingIds.has(p.id)).map((p) => () =>
      kv.put(`project:${p.id}`, JSON.stringify({ ...p, createdAt: now, updatedAt: now }))
    ),
    ...DEFAULT_DAILY_METRICS.map(([projectId, date, budget, views, contacts, diagnostics, sales]) => () =>
      kv.put(`dailyMetrics:${projectId}:${date}`, JSON.stringify({ projectId, date, budget, views, contacts, diagnostics, sales, updatedAt: now }))
    ),
  ];

  const BATCH = 50;
  for (let i = 0; i < writes.length; i += BATCH) {
    await Promise.all(writes.slice(i, i + BATCH).map((fn) => fn()));
  }
  await kv.put('dailyMetricsSeeded', '1');
}

// project-rating used to store one KV record per (project, week) holding all three
// roles together, updated via read-merge-write. That still lost data under
// Cloudflare KV's eventual consistency: two saves to different roles close together
// can each read a not-yet-propagated (stale) copy of the record from a different
// edge location, so the second write's "merge" silently drops the first save. Split
// into one independent KV key per (project, week, role) so a save is a pure write
// with no read first — nothing to race. One-time migration of any old combined
// records into the new per-role shape, guarded independently of other seed flags.
async function ensureProjectRatingsMigration(kv) {
  const migrated = await kv.get('ratingsMigratedV2');
  if (migrated) return;

  const list = await kv.list({ prefix: 'projectRating:' });
  const oldKeys = list.keys.filter((k) => k.name.split(':').length === 3); // new keys have a 4th :role segment
  const now = new Date().toISOString();
  const writes = [];
  for (const k of oldKeys) {
    const rec = await kv.get(k.name, 'json');
    if (!rec) continue;
    ['client', 'manager', 'specialist'].forEach((role) => {
      const r = rec[role];
      if (!r) return;
      writes.push(() => kv.put(`projectRating:${rec.projectId}:${rec.weekStart}:${role}`, JSON.stringify({
        projectId: rec.projectId,
        weekStart: rec.weekStart,
        role,
        score: Number(r.score) || 0,
        comment: String(r.comment || ''),
        updatedAt: rec.updatedAt || now,
      })));
    });
    writes.push(() => kv.delete(k.name));
  }

  const BATCH = 50;
  for (let i = 0; i < writes.length; i += BATCH) {
    await Promise.all(writes.slice(i, i + BATCH).map((fn) => fn()));
  }
  await kv.put('ratingsMigratedV2', '1');
}

function checkDashboardAuth(request) {
  return request.headers.get('x-dashboard-password') === DASHBOARD_PASSWORD;
}

async function handleDashboardApi(request, env, url) {
  const { pathname } = url;
  const kv = env.AGENCY_DASHBOARD_KV;

  if (!checkDashboardAuth(request)) return json({ error: 'unauthorized' }, 401);

  if (!kv) {
    // AGENCY_DASHBOARD_KV isn't bound in wrangler.jsonc yet (see the comment there) —
    // fail clearly instead of throwing on the first kv.* call below.
    return json({ error: 'kv_not_configured', message: 'AGENCY_DASHBOARD_KV namespace is not set up yet — see wrangler.jsonc' }, 500);
  }

  await ensureDashboardSeed(kv);
  await ensureDailyMetricsSeed(kv);
  await ensureProjectRatingsMigration(kv);

  // ── Bootstrap: everything the dashboard needs in one call ──
  if (pathname === '/api/dashboard/bootstrap' && request.method === 'GET') {
    const [projects, employees, analytics, projectRatings, dailyMetrics] = await Promise.all([
      listByPrefix(kv, 'project:'),
      listByPrefix(kv, 'employee:'),
      listByPrefix(kv, 'analytics:'),
      listByPrefix(kv, 'projectRating:'),
      listByPrefix(kv, 'dailyMetrics:'),
    ]);
    return json({
      projects: projects.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      employees: employees.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      analytics,
      projectRatings,
      dailyMetrics,
      salePrices: SALE_PRICES,
    });
  }

  // ── Projects ──
  if (pathname === '/api/dashboard/project' && request.method === 'POST') {
    const body = await readJson(request);
    const name = body && String(body.name || '').trim();
    if (!name) return json({ error: 'missing_name' }, 400);

    const id = (body && body.id) || crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const existing = (await kv.get(`project:${id}`, 'json')) || {};
    const now = new Date().toISOString();
    const ROW_COLORS = new Set(['', 'green', 'yellow', 'red', 'gray']);
    const project = {
      id,
      name,
      service: (body && body.service) || existing.service || 'Продвижение на Авито',
      responsibleId: body && 'responsibleId' in body ? body.responsibleId || null : existing.responsibleId ?? null,
      status: body && 'status' in body ? String(body.status || '') : existing.status || '',
      stage: body && 'stage' in body ? String(body.stage || '') : existing.stage || '',
      currentWork: body && 'currentWork' in body ? String(body.currentWork || '') : existing.currentWork || '',
      review: body && 'review' in body ? String(body.review || '') : existing.review || '',
      rowColor: body && 'rowColor' in body && ROW_COLORS.has(body.rowColor) ? body.rowColor : existing.rowColor || '',
      ratings: {
        result: Number((body && body.ratings && body.ratings.result) ?? existing.ratings?.result ?? 0),
        communication: Number((body && body.ratings && body.ratings.communication) ?? existing.ratings?.communication ?? 0),
        quality: Number((body && body.ratings && body.ratings.quality) ?? existing.ratings?.quality ?? 0),
      },
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    await kv.put(`project:${id}`, JSON.stringify(project));
    return json({ project });
  }

  if (pathname === '/api/dashboard/project' && request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'missing_id' }, 400);
    await kv.delete(`project:${id}`);
    const [analyticsList, ratingsList, dailyMetricsList] = await Promise.all([
      kv.list({ prefix: `analytics:${id}:` }),
      kv.list({ prefix: `projectRating:${id}:` }),
      kv.list({ prefix: `dailyMetrics:${id}:` }),
    ]);
    await Promise.all([...analyticsList.keys, ...ratingsList.keys, ...dailyMetricsList.keys].map((k) => kv.delete(k.name)));
    return json({ ok: true });
  }

  // ── Analytics (per project, per month) ──
  if (pathname === '/api/dashboard/analytics' && request.method === 'POST') {
    const body = await readJson(request);
    const projectId = body && String(body.projectId || '').trim();
    const month = body && String(body.month || '').trim();
    if (!projectId || !/^\d{4}-\d{2}$/.test(month)) return json({ error: 'missing_project_or_month' }, 400);

    const now = new Date().toISOString();
    const record = {
      projectId,
      month,
      budget: Number(body.budget) || 0,
      views: Number(body.views) || 0,
      contacts: Number(body.contacts) || 0,
      conversionPct: Number(body.conversionPct) || 0,
      cpl: Number(body.cpl) || 0,
      diagnostics: Number(body.diagnostics) || 0,
      salesCount: Number(body.salesCount) || 0,
      cac: body.cac === '' || body.cac == null ? null : Number(body.cac),
      notes: String(body.notes || ''),
      updatedAt: now,
    };
    await kv.put(`analytics:${projectId}:${month}`, JSON.stringify(record));
    return json({ analytics: record });
  }

  // ── Daily metrics (per project, per day) ──
  if (pathname === '/api/dashboard/daily-metric' && request.method === 'POST') {
    const body = await readJson(request);
    const projectId = body && String(body.projectId || '').trim();
    const date = body && String(body.date || '').trim();
    if (!projectId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'missing_project_or_date' }, 400);

    const nonNegInt = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };
    // Merge onto whatever is already stored — a POST that only means to change one
    // field (e.g. one column edited on a shared row) must not blindly zero the rest
    // out from a client's stale snapshot of the others.
    const existing = (await kv.get(`dailyMetrics:${projectId}:${date}`, 'json')) || {};
    const now = new Date().toISOString();
    const record = {
      projectId,
      date,
      budget: 'budget' in body ? nonNegInt(body.budget) : existing.budget || 0,
      views: 'views' in body ? nonNegInt(body.views) : existing.views || 0,
      contacts: 'contacts' in body ? nonNegInt(body.contacts) : existing.contacts || 0,
      diagnostics: 'diagnostics' in body ? nonNegInt(body.diagnostics) : existing.diagnostics || 0,
      sales: 'sales' in body ? nonNegInt(body.sales) : existing.sales || 0,
      updatedAt: now,
    };
    await kv.put(`dailyMetrics:${projectId}:${date}`, JSON.stringify(record));
    return json({ dailyMetric: record });
  }

  // ── Weekly project ratings (client / manager / specialist, 1-10 + comment) ──
  // One KV key per (project, week, role) — a pure write, no read-modify-write.
  // Client/manager/specialist are three different people, typically on three
  // different devices; a read-first merge is not safe here because Cloudflare KV
  // is only eventually consistent across edge locations — a save to one role can
  // read a not-yet-propagated copy of another role's very recent save and merge
  // over it, silently dropping it. A pure per-role write has nothing to race.
  if (pathname === '/api/dashboard/project-rating' && request.method === 'POST') {
    const body = await readJson(request);
    const projectId = body && String(body.projectId || '').trim();
    const weekStart = body && String(body.weekStart || '').trim();
    const role = body && String(body.role || '').trim();
    if (!projectId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json({ error: 'missing_project_or_week' }, 400);
    if (!['client', 'manager', 'specialist'].includes(role)) return json({ error: 'invalid_role' }, 400);

    const score = Number(body.score);
    const record = {
      projectId,
      weekStart,
      role,
      score: Number.isInteger(score) && score >= 1 && score <= 10 ? score : 0,
      comment: String(body.comment || '').slice(0, 2000),
      updatedAt: new Date().toISOString(),
    };
    await kv.put(`projectRating:${projectId}:${weekStart}:${role}`, JSON.stringify(record));
    return json({ projectRating: record });
  }

  // ── Employees ──
  if (pathname === '/api/dashboard/employee' && request.method === 'POST') {
    const body = await readJson(request);
    const name = body && String(body.name || '').trim();
    if (!name) return json({ error: 'missing_name' }, 400);

    const id = (body && body.id) || crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const existing = (await kv.get(`employee:${id}`, 'json')) || {};
    const now = new Date().toISOString();
    const employee = {
      id,
      name,
      position: (body && body.position) ?? existing.position ?? '',
      salary: body && 'salary' in body ? Number(body.salary) || 0 : existing.salary || 0,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    await kv.put(`employee:${id}`, JSON.stringify(employee));
    return json({ employee });
  }

  if (pathname === '/api/dashboard/employee' && request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'missing_id' }, 400);
    await kv.delete(`employee:${id}`);
    const list = await kv.list({ prefix: `rating:${id}:` });
    await Promise.all(list.keys.map((k) => kv.delete(k.name)));
    return json({ ok: true });
  }

  // ── Weekly employee ratings ──
  if (pathname === '/api/dashboard/rating' && request.method === 'POST') {
    const body = await readJson(request);
    const employeeId = body && String(body.employeeId || '').trim();
    const weekStart = body && String(body.weekStart || '').trim();
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json({ error: 'missing_employee_or_week' }, 400);

    // A criterion the client sends as 1-5 is a real rating; anything else (0,
    // missing) means "not rated yet this week" and stays 0 — the client autosaves
    // one criterion per star click, so the other two are still legitimately unset.
    const pick = (v) => { const n = Number(v); return n >= 1 && n <= 5 ? n : 0; };
    const now = new Date().toISOString();
    const rating = {
      employeeId,
      weekStart,
      discipline: pick(body.discipline),
      communication: pick(body.communication),
      skills: pick(body.skills),
      updatedAt: now,
    };
    await kv.put(`rating:${employeeId}:${weekStart}`, JSON.stringify(rating));
    return json({ rating });
  }

  // ── Sales plan/fact (per month) ──
  if (pathname === '/api/dashboard/sales' && request.method === 'POST') {
    const body = await readJson(request);
    const month = body && String(body.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'missing_month' }, 400);

    const side = (s) => ({
      planCount: Number(s && s.planCount) || 0,
      factCount: Number(s && s.factCount) || 0,
      planRevenue: Number(s && s.planRevenue) || 0,
      factRevenue: Number(s && s.factRevenue) || 0,
    });
    const now = new Date().toISOString();
    const record = {
      month,
      primary: side(body.primary),
      repeat: side(body.repeat),
      leads: Number(body.leads) || 0,
      updatedAt: now,
    };
    await kv.put(`sales:${month}`, JSON.stringify(record));
    return json({ sales: record, month });
  }

  // ── Cumulative registration base ──
  if (pathname === '/api/dashboard/registration-base' && request.method === 'POST') {
    const body = await readJson(request);
    const total = Number(body && body.total) || 0;
    const record = { total, updatedAt: new Date().toISOString() };
    await kv.put('registrationBase', JSON.stringify(record));
    return json({ registrationBase: record });
  }

  // ── Agency tasks ──
  if (pathname === '/api/dashboard/task' && request.method === 'POST') {
    const body = await readJson(request);
    const text = body && String(body.text || '').trim();
    if (!text) return json({ error: 'missing_text' }, 400);

    const id = (body && body.id) || crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const existing = (await kv.get(`task:${id}`, 'json')) || {};
    const now = new Date().toISOString();
    const task = {
      id,
      text,
      status: (body && body.status) || existing.status || 'open',
      owner: body && 'owner' in body ? body.owner || null : existing.owner ?? null,
      due: body && 'due' in body ? body.due || null : existing.due ?? null,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    await kv.put(`task:${id}`, JSON.stringify(task));
    return json({ task });
  }

  if (pathname === '/api/dashboard/task' && request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'missing_id' }, 400);
    await kv.delete(`task:${id}`);
    return json({ ok: true });
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

  if (pathname.startsWith('/api/dashboard/')) {
    return handleDashboardApi(request, env, url);
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

    // /mba-mybrand itself is served from mba-mybrand/index.html — the directory also
    // holds per-client podcast materials pages (mba-mybrand/<slug>-podcastN). Handles
    // both with and without the trailing slash since production (cantor.agency, served
    // by plain nginx, not this Worker) 301s the bare path to the slash form itself.
    if (url.pathname === '/mba-mybrand' || url.pathname === '/mba-mybrand/') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/mba-mybrand/index.html';
      return env.ASSETS.fetch(new Request(assetUrl, request));
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
