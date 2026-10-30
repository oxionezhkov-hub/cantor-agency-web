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
 *                                   podcast2:{...}, podcast3:{...}, siteFormat:{done,comment},
 *                                   siteStructure:{done,comment},
 *                                   site:{done,comment} } }
 *   siteFormat.comment: chosen design (1, 2 or 3) and Tilda or HTML.
 *   siteStructure.comment holds the client's /site-structure/?client=<slug> link (see site-structure/).
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
 * It also powers /sales-crm: a one-screen, spreadsheet-style CRM for Avito sales leads —
 * every client is a table row (name, Telegram handle with a jump-to-dialog button, priority
 * color, dialog-stage status, free-text comment) edited inline, no client-detail page. Every
 * cell edit is timestamped and diffed into a history log (never rendered in the table, only
 * pulled by the "download full history" export). Rows with a stale updatedAt are highlighted
 * client-side so leads don't go cold unnoticed. Shares the AVITO_KV namespace since it's the
 * same Avito sales-leads domain, under its own key prefix:
 *
 * KV keys (binding "AVITO_KV", sales-crm prefix):
 *   salescrm:client:<id>              -> { id, name, telegram, priority, status, group, comment, nextActionDate, nextAction,
 *                                          tgChatId, lastMessage, source, createdAt, updatedAt, aiUpdatedAt }
 *                                          (group: one of РЕПБИЗ / ВЕБИНАР / НОВЫЕ — lead source;
 *                                           nextActionDate: "YYYY-MM-DD" or "" — next follow-up date, checked by the control bot cron;
 *                                           nextAction: free-text next step ("задача");
 *                                           tgChatId / lastMessage { text, at, direction, type }: the owner's personal Telegram
 *                                           chat with this lead, synced from the MyBrand worker — see handleSalesCrmTgSync;
 *                                           source: "telegram-ai" when the row was created by that sync)
 *   salescrm:history:<id>:<ts>:<rand> -> { clientId, clientName, ts, action, field, oldValue, newValue, source? }
 *   salescrm:tgchat:<chatId>          -> clientId (Telegram chat → CRM row index)
 *   salescrm:tgdismissed:<chatId>     -> "1" (row linked to this chat was deleted — never auto-create it again)
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
 *   project:<id>.avitoAccountId    -> AVITO_KV "account:<id>" whose cabinet feeds the
 *                                     "⚡ Авито: вчера" popup (bulk-linked via "🔑 Кабинеты Авито")
 *   reportJob:<id>                 -> { id, token, status, dateFrom, dateTo, report, observations,
 *                                        sessionUrl, error, createdAt, updatedAt } (14-day TTL) —
 *                                     one "📄 Ежедневный отчёт" request; Workers AI writes its
 *                                     observations (see "Workers AI jobs")
 *   reportLastTo                   -> "YYYY-MM-DD", end date of the last requested report
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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
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
  { id: 'siteFormat', label: 'Выбран формат сайта', type: 'single' },
  { id: 'siteStructure', label: 'Согласована структура сайта', type: 'single' },
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
// When Avito's API hangs (it did on 19–21.10) a request without a limit holds its caller until the
// runtime kills it — and a background Avito pull with it, before it saved anything.
const AVITO_FETCH_TIMEOUT_MS = 15000;
// Since 19.10.2026 api.avito.ru barely answers Cloudflare's servers (timeouts, 522 — Cloudflare's own
// "couldn't reach the origin"), while from Russia it works as before. So every Avito call goes
// through the yc-dashboard-api-proxy function in Yandex Cloud (?p=/avito-api/<path>, see its
// README): AVITO_PROXY_URL var (default: that function; "off" — straight to Avito), AVITO_PROXY_KEY
// secret = the function's PROXY_KEY when one is set there. A function version that doesn't know
// /avito-api/ yet answers bad_path — then this isolate goes straight to Avito for 10 minutes.
const AVITO_PROXY_DEFAULT = 'https://functions.yandexcloud.net/d4eiu56ijlg0jn5o9rch';
const AVITO_PROXY_TIMEOUT_MS = 30000;
let AVITO_PROXY = { url: AVITO_PROXY_DEFAULT, key: null };
let AVITO_PROXY_OFF_UNTIL = 0;
function avitoProxySetup(env) {
  const url = env && env.AVITO_PROXY_URL;
  AVITO_PROXY = { url: url === 'off' ? null : url || AVITO_PROXY_DEFAULT, key: (env && env.AVITO_PROXY_KEY) || null };
}
async function avitoFetch(path, init = {}) {
  if (AVITO_PROXY.url && Date.now() > AVITO_PROXY_OFF_UNTIL) {
    try {
      const res = await fetch(`${AVITO_PROXY.url}?p=${encodeURIComponent(`/avito-api${path}`)}`, {
        method: init.method || 'GET',
        headers: { ...(init.headers || {}), ...(AVITO_PROXY.key ? { 'x-proxy-key': AVITO_PROXY.key } : {}) },
        body: init.body,
        signal: AbortSignal.timeout(AVITO_PROXY_TIMEOUT_MS),
      });
      if (res.status !== 400) return res;
      const data = await res.clone().json().catch(() => null);
      if (!data || data.error !== 'bad_path') return res;
      console.error('avito proxy: the function has no /avito-api/ yet — going straight to Avito');
    } catch (e) {
      console.error('avito proxy failed, going straight to Avito', e && e.message);
    }
    AVITO_PROXY_OFF_UNTIL = Date.now() + 10 * 60 * 1000;
  }
  return fetch(`${AVITO_API_BASE}${path}`, { ...init, signal: AbortSignal.timeout(AVITO_FETCH_TIMEOUT_MS) });
}
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

// A cached token Avito no longer accepts (403 «Not authorized» — e.g. one taken before the switch to the
// Yandex Cloud proxy, or replaced by a token request that timed out on our side but went through at
// Avito) is swapped for a fresh one once: avitoRequest asks for it and keeps using it for that token.
const AVITO_TOKEN_OWNER = new Map(); // token -> { env, account }
const AVITO_TOKEN_SWAP = new Map(); // stale token -> fresh token
async function avitoGetToken(env, account, fresh = false) {
  const kv = env.AVITO_KV;
  const tokenKey = `token:${account.id}`;
  const cached = fresh ? null : await kv.get(tokenKey, 'json');
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    AVITO_TOKEN_OWNER.set(cached.accessToken, { env, account });
    return AVITO_TOKEN_SWAP.get(cached.accessToken) || cached.accessToken;
  }

  const res = await avitoFetch('/token', {
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
  AVITO_TOKEN_OWNER.set(data.access_token, { env, account });
  return data.access_token;
}

// Lets the account form leave "User ID" blank: exchange the credentials for a token
// (uncached — this account doesn't have a KV entry yet) and read the numeric id off
// /core/v1/accounts/self, the same id Avito otherwise only surfaces inside the developer
// portal's app settings.
async function avitoLookupUserId(clientId, clientSecret) {
  const res = await avitoFetch('/token', {
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

// A cabinet's call made whole inside the Yandex Cloud function (?p=/avito-call/…): it takes the token
// and makes the request in the same invocation. A token taken by one invocation is refused («Not
// authorized») in another — the function's calls leave from different addresses — so /avito-api/
// with our own token doesn't work for cabinet data. null: the function can't do it (an older version,
// unreachable) — the caller goes the other way.
async function avitoCallViaProxy(account, path, options) {
  try {
    const res = await fetch(`${AVITO_PROXY.url}?p=${encodeURIComponent(`/avito-call${path}`)}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        'x-avito-client-id': account.clientId,
        'x-avito-client-secret': account.clientSecret,
        ...(AVITO_PROXY.key ? { 'x-proxy-key': AVITO_PROXY.key } : {}),
      },
      body: options.body,
      signal: AbortSignal.timeout(AVITO_PROXY_TIMEOUT_MS),
    });
    if (res.status === 400) {
      const data = await res.clone().json().catch(() => null);
      if (data && (data.error === 'bad_path' || data.error === 'no_credentials')) throw new Error(`proxy: ${data.error}`);
    }
    return res;
  } catch (e) {
    console.error('avito-call via proxy failed, going straight to Avito', e && e.message);
    AVITO_PROXY_OFF_UNTIL = Date.now() + 10 * 60 * 1000;
    return null;
  }
}

async function avitoRequest(token, path, options = {}, attempt = 0, refreshed = false) {
  token = AVITO_TOKEN_SWAP.get(token) || token;
  const owner = AVITO_TOKEN_OWNER.get(token);
  let res = null;
  if (owner && AVITO_PROXY.url && Date.now() > AVITO_PROXY_OFF_UNTIL) {
    res = await avitoCallViaProxy(owner.account, path, options);
    if (res && (res.status === 401 || res.status === 403) && /not authorized|bad bearer/i.test(await res.clone().text().catch(() => ''))) {
      // Avito refuses even the function's own fresh token: back to going straight, as before the proxy.
      console.error('avito: not authorized even via the proxy — going straight to Avito for 10 minutes');
      AVITO_PROXY_OFF_UNTIL = Date.now() + 10 * 60 * 1000;
      res = null;
    }
  }
  if (!res) {
    res = await avitoFetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  }
  if ((res.status === 401 || res.status === 403) && !refreshed && AVITO_TOKEN_OWNER.has(token)) {
    const text = await res.clone().text().catch(() => '');
    if (res.status === 401 || /not authorized|bad bearer|token/i.test(text)) {
      const { env, account } = AVITO_TOKEN_OWNER.get(token);
      const freshToken = await avitoGetToken(env, account, true);
      AVITO_TOKEN_SWAP.set(token, freshToken);
      return avitoRequest(freshToken, path, options, attempt, true);
    }
  }
  // The proxy's own «Avito didn't answer» (it already waited 25 s) isn't worth three more tries.
  if ((res.status === 429 || res.status >= 500) && attempt < 3 && !res.headers.get('X-Avito-Proxy-Error')) {
    await sleep(500 * 2 ** attempt);
    return avitoRequest(token, path, options, attempt + 1, refreshed);
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

// ── Autoload reports ──
// Avito keeps one report per autoload run. /autoload/v3 (falling back to v2) gives the report
// itself; /autoload/v2/reports/{id}/items pages through every listing of that run with its
// Avito id/url, section (success / error / problem …) and the messages explaining a failure.
async function fetchAvitoAutoloadReport(env, account, reportId) {
  const token = await avitoGetToken(env, account);
  const tried = [];
  const get = async (path) => {
    const res = await avitoRequest(token, path);
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
    tried.push(`${path} → ${res.status}${res.ok ? '' : ` ${text.slice(0, 160)}`}`);
    return { ok: res.ok, data };
  };
  let report = null;
  for (const v of ['v3', 'v2']) {
    const r = await get(reportId ? `/autoload/${v}/reports/${encodeURIComponent(reportId)}` : `/autoload/${v}/reports/last_completed_report`);
    if (r.ok && r.data) { report = r.data; break; }
  }
  if (!report) throw new Error(`autoload report unavailable: ${tried.join(' | ')}`);
  const id = report.report_id || report.id;
  const items = [];
  for (let page = 0; id && page < 60; page += 1) {
    const r = await get(`/autoload/v2/reports/${encodeURIComponent(id)}/items?per_page=200&page=${page}`);
    if (!r.ok || !r.data) break;
    const batch = r.data.items || r.data.result || [];
    items.push(...batch.map(normalizeAutoloadItem));
    const pages = r.data.meta && Number(r.data.meta.pages);
    if (!batch.length || (pages && page + 1 >= pages)) break;
  }
  const bySection = {};
  items.forEach((it) => { bySection[it.section || '—'] = (bySection[it.section || '—'] || 0) + 1; });
  return {
    summary: {
      reportId: id || null,
      status: report.status || null,
      startedAt: report.started_at || report.startedAt || null,
      finishedAt: report.finished_at || report.finishedAt || null,
      sectionStats: report.section_stats || report.sectionStats || null,
      items: items.length,
      problems: items.filter((it) => it.problem).length,
      bySection,
    },
    items,
    report,
    tried,
  };
}

function normalizeAutoloadItem(it) {
  const clean = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const messages = (it.messages || it.errors || []).map((m) => (typeof m === 'string' ? { type: '', code: '', text: clean(m) } : {
    type: m.type || m.level || '',
    code: m.code != null ? String(m.code) : '',
    text: clean([m.title, m.description || m.message || m.text].filter(Boolean).join(': ')),
  }));
  const section = it.section && typeof it.section === 'object' ? it.section : { slug: it.section || '', title: it.section || '' };
  return {
    adId: it.ad_id != null ? String(it.ad_id) : (it.id != null ? String(it.id) : ''),
    avitoId: it.avito_id != null ? String(it.avito_id) : '',
    url: it.url || '',
    section: section.title || section.slug || '',
    sectionSlug: section.slug || '',
    problem: !/^success/.test(section.slug || ''),
    avitoStatus: it.avito_status || it.status || '',
    title: it.title || '',
    applied: it.applied_vas || it.fee_info || null,
    messages,
  };
}

function autoloadCsv(rows) {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const head = ['ID в файле', 'ID на Авито', 'Раздел отчёта', 'Статус на Авито', 'Тип', 'Код', 'Сообщение', 'Ссылка'];
  const lines = [head.map(esc).join(';')];
  rows.forEach((it) => {
    const msgs = it.messages.length ? it.messages : [{ type: '', code: '', text: '' }];
    msgs.forEach((m) => lines.push([it.adId, it.avitoId, it.section, it.avitoStatus, m.type, m.code, m.text, it.url].map(esc).join(';')));
  });
  return lines.join('\r\n');
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

  // Autoload (автовыгрузка) report: GET /api/avito/autoload?accountId=…[&reportId=…][&format=csv|raw]
  // — the last completed report by default, with every listing's status and error messages.
  if (pathname === '/api/avito/autoload' && request.method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    if (!accountId) return json({ error: 'missing_fields' }, 400);
    const account = await kv.get(`account:${accountId}`, 'json');
    if (!account) return json({ error: 'not_found' }, 404);
    try {
      const result = await fetchAvitoAutoloadReport(env, account, url.searchParams.get('reportId'));
      const format = url.searchParams.get('format');
      if (format === 'raw') return json(result);
      if (format === 'csv') {
        const onlyProblems = url.searchParams.get('all') !== '1';
        const rows = result.items.filter((it) => !onlyProblems || it.problem);
        const name = `autoload_${(account.name || accountId).replace(/[^\wа-яё-]+/gi, '_')}_${result.summary.reportId || 'last'}.csv`;
        return new Response(`\ufeff${autoloadCsv(rows)}`, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
            ...corsHeaders(),
          },
        });
      }
      return json({ summary: result.summary, items: result.items });
    } catch (e) {
      return json({ error: 'autoload_failed', message: String(e && e.message) }, 502);
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

// ── /sales-crm: single-screen table CRM for Avito sales leads ──
// Every client sits on one row; editing a cell writes the client record and appends one
// history entry per changed field (never shown in the table itself — pulled only by the
// "full history" export button for later analysis).

const SALES_CRM_STATUSES = [
  'Первое сообщение', 'Вопросы', 'Формат', 'Оффер', 'Игнор', 'Отложенный спрос', 'Отказ', 'Продажа',
];
const SALES_CRM_PRIORITIES = ['green', 'yellow', 'orange', 'red'];
// РЕПБИЗ / ВЕБИНАР are the two lead sources bulk-imported from existing sheets; НОВЫЕ is the
// default for anything added by hand going forward (there were no НОВЫЕ leads at import time).
const SALES_CRM_GROUPS = ['РЕПБИЗ', 'ВЕБИНАР', 'НОВЫЕ'];
const SALES_CRM_FIELDS = ['name', 'telegram', 'priority', 'status', 'group', 'comment', 'nextActionDate', 'nextAction', 'tgChatId'];
const SALES_CRM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SALES_CRM_CHAT_ID_RE = /^-?\d{1,20}$/;
// Fields the MyBrand Telegram sync (see /api/salescrm/tg/sync) may change on its own after
// its AI reads the dialog. A lead already marked "Продажа" is never moved by it.
const SALES_CRM_AI_FIELDS = ['status', 'nextActionDate', 'nextAction'];

function salesCrmNormalizeTg(value) {
  return String(value || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').toLowerCase();
}

// "salescrm:tgchat:<chatId>" -> clientId: which CRM row a Telegram chat belongs to, so a sync
// doesn't have to scan every client. "salescrm:tgdismissed:<chatId>": a row linked to that chat
// was deleted by hand — the sync must never auto-create it again (it still re-links if the
// owner later adds the person back with their username).
async function salesCrmSetChatLink(kv, client, prevChatId) {
  if (prevChatId && prevChatId !== client.tgChatId) await kv.delete(`salescrm:tgchat:${prevChatId}`);
  if (client.tgChatId) {
    await kv.put(`salescrm:tgchat:${client.tgChatId}`, client.id);
    await kv.delete(`salescrm:tgdismissed:${client.tgChatId}`);
  }
}

async function salesCrmHistoryAppend(kv, clientId, clientName, entries) {
  const now = new Date().toISOString();
  await Promise.all(entries.map((entry) => {
    const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const record = { clientId, clientName, ts: now, ...entry };
    return kv.put(`salescrm:history:${clientId}:${now}:${rand}`, JSON.stringify(record));
  }));
}

async function handleSalesCrmApi(request, env, url) {
  const { pathname } = url;
  const kv = env.AVITO_KV;

  if (pathname === '/api/salescrm/clients' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'salescrm:client:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const clients = records.filter(Boolean).sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
    return json({ clients });
  }

  if (pathname === '/api/salescrm/clients' && request.method === 'POST') {
    const body = await readJson(request);
    const name = (body && String(body.name || '').trim()) || '';
    if (!name) return json({ error: 'missing_name' }, 400);

    const now = new Date().toISOString();
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const client = {
      id,
      name,
      telegram: (body && String(body.telegram || '').trim()) || '',
      priority: SALES_CRM_PRIORITIES.includes(body && body.priority) ? body.priority : 'yellow',
      status: SALES_CRM_STATUSES.includes(body && body.status) ? body.status : 'Первое сообщение',
      group: SALES_CRM_GROUPS.includes(body && body.group) ? body.group : 'НОВЫЕ',
      comment: (body && String(body.comment || '')) || '',
      nextActionDate: SALES_CRM_DATE_RE.test(body && body.nextActionDate) ? body.nextActionDate : '',
      createdAt: now,
      updatedAt: now,
    };
    await kv.put(`salescrm:client:${id}`, JSON.stringify(client));
    await salesCrmHistoryAppend(kv, id, client.name, [{ action: 'create', field: null, oldValue: null, newValue: null }]);
    return json({ client });
  }

  const clientMatch = pathname.match(/^\/api\/salescrm\/clients\/([A-Za-z0-9]+)$/);
  if (clientMatch && request.method === 'PATCH') {
    const id = clientMatch[1];
    const existing = await kv.get(`salescrm:client:${id}`, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);

    const body = await readJson(request);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);

    const now = new Date().toISOString();
    const updated = { ...existing };
    const historyEntries = [];

    for (const field of SALES_CRM_FIELDS) {
      if (!(field in body)) continue;
      let value = body[field];
      if (field === 'priority' && !SALES_CRM_PRIORITIES.includes(value)) continue;
      if (field === 'status' && !SALES_CRM_STATUSES.includes(value)) continue;
      if (field === 'group' && !SALES_CRM_GROUPS.includes(value)) continue;
      if (field === 'name' || field === 'telegram') value = String(value || '').trim();
      if (field === 'comment') value = String(value || '');
      if (field === 'nextAction') value = String(value || '').trim().slice(0, 300);
      if (field === 'nextActionDate') {
        value = String(value || '').trim();
        if (value && !SALES_CRM_DATE_RE.test(value)) continue;
      }
      if (field === 'tgChatId') {
        value = String(value || '').trim();
        if (value && !SALES_CRM_CHAT_ID_RE.test(value)) continue;
      }
      if (value === (existing[field] ?? '')) continue;
      historyEntries.push({ action: 'update', field, oldValue: existing[field] ?? null, newValue: value });
      updated[field] = value;
    }

    if (!historyEntries.length) return json({ client: existing });

    if ('tgChatId' in body && updated.tgChatId !== (existing.tgChatId || '')) {
      if (!updated.tgChatId) updated.lastMessage = null;
      await salesCrmSetChatLink(kv, updated, existing.tgChatId);
    }
    updated.updatedAt = now;
    await kv.put(`salescrm:client:${id}`, JSON.stringify(updated));
    await salesCrmHistoryAppend(kv, id, updated.name, historyEntries);
    return json({ client: updated });
  }

  if (clientMatch && request.method === 'DELETE') {
    const id = clientMatch[1];
    const existing = await kv.get(`salescrm:client:${id}`, 'json');
    if (!existing) return json({ error: 'not_found' }, 404);
    await kv.delete(`salescrm:client:${id}`);
    if (existing.tgChatId) {
      await kv.delete(`salescrm:tgchat:${existing.tgChatId}`);
      await kv.put(`salescrm:tgdismissed:${existing.tgChatId}`, '1');
    }
    await salesCrmHistoryAppend(kv, id, existing.name, [{ action: 'delete', field: null, oldValue: null, newValue: null }]);
    return json({ ok: true });
  }

  if (pathname === '/api/salescrm/tg/sync' && request.method === 'POST') {
    return handleSalesCrmTgSync(request, env, kv);
  }

  if (pathname === '/api/salescrm/history' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'salescrm:history:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const history = records.filter(Boolean).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return json({ history });
  }

  return json({ error: 'not_found' }, 404);
}

// ── /sales-crm ⇄ MyBrand Telegram inbox ──
// The owner talks to clients from their personal Telegram; the MyBrand worker (repo
// mybrand-smm, "tasktracker") receives those chats through its Telegram Business bot and calls
// this endpoint server-to-server: on every message (to refresh the row's "last message"), and a
// few minutes after a dialog goes quiet with what its AI read from it (new status / next step /
// next-action date), or — for a chat not yet in the CRM whose topic is Avito / the agency /
// launching promotion — to create the row. Guarded by the SALESCRM_SYNC_SECRET secret (set it in
// the Cloudflare dashboard, and the same value as CRM_SYNC_SECRET on the MyBrand worker); unset
// means the endpoint is off.
//
// Body: { chat: { id, username, name }, lastMessage?: { text, at, direction, type },
//         update?: { status?, nextActionDate?, nextAction? }, create?: bool, reason?: string }
// Reply: { client | null, dismissed?: true }
async function handleSalesCrmTgSync(request, env, kv) {
  if (!env.SALESCRM_SYNC_SECRET || request.headers.get('x-sync-secret') !== env.SALESCRM_SYNC_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }
  const body = await readJson(request);
  const chat = body && body.chat;
  const chatId = chat && String(chat.id || '');
  if (!SALES_CRM_CHAT_ID_RE.test(chatId)) return json({ error: 'invalid_chat' }, 400);
  const username = salesCrmNormalizeTg(chat.username);

  // 1. Already linked to this chat.
  let client = null;
  const linkedId = await kv.get(`salescrm:tgchat:${chatId}`);
  if (linkedId) {
    client = await kv.get(`salescrm:client:${linkedId}`, 'json');
    if (!client) await kv.delete(`salescrm:tgchat:${chatId}`);
  }

  // 2. A row whose Telegram field is this person's username (added by hand, never linked yet).
  let dirty = false;
  const historyEntries = [];
  if (!client && username) {
    const list = await kv.list({ prefix: 'salescrm:client:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    client = records.find((c) => c && !c.tgChatId && salesCrmNormalizeTg(c.telegram) === username) || null;
    if (client) {
      historyEntries.push({ action: 'update', field: 'tgChatId', oldValue: null, newValue: chatId, source: 'telegram' });
      client.tgChatId = chatId;
      await salesCrmSetChatLink(kv, client, null);
      dirty = true;
    }
  }

  // 3. New lead found by the AI.
  const now = new Date().toISOString();
  if (!client) {
    if (await kv.get(`salescrm:tgdismissed:${chatId}`)) return json({ client: null, dismissed: true });
    if (!body.create) return json({ client: null });
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    client = {
      id,
      name: String(chat.name || '').trim().slice(0, 120) || (username ? '@' + username : 'Telegram ' + chatId),
      telegram: username,
      priority: 'yellow',
      status: 'Первое сообщение',
      group: 'НОВЫЕ',
      comment: body.reason ? `🤖 Добавлен из Telegram: ${String(body.reason).slice(0, 300)}` : '🤖 Добавлен из Telegram',
      nextActionDate: '',
      nextAction: '',
      tgChatId: chatId,
      source: 'telegram-ai',
      createdAt: now,
      updatedAt: now,
    };
    await salesCrmSetChatLink(kv, client, null);
    await salesCrmHistoryAppend(kv, id, client.name, [{ action: 'create', field: null, oldValue: null, newValue: null, source: 'telegram-ai' }]);
    dirty = true;
  }

  // Last message: shown in the row; never bumps updatedAt (that's "last edited by a person/AI").
  const lm = body.lastMessage;
  if (lm && typeof lm === 'object' && Number(lm.at) >= Number((client.lastMessage && client.lastMessage.at) || 0)) {
    client.lastMessage = {
      text: String(lm.text || '').slice(0, 400),
      at: Number(lm.at) || Date.now(),
      direction: lm.direction === 'out' ? 'out' : 'in',
      type: String(lm.type || 'text').slice(0, 20),
    };
    dirty = true;
  }

  const update = body.update;
  if (update && typeof update === 'object' && client.status !== 'Продажа') {
    for (const field of SALES_CRM_AI_FIELDS) {
      if (!(field in update)) continue;
      let value = update[field];
      if (field === 'status' && !SALES_CRM_STATUSES.includes(value)) continue;
      if (field === 'nextActionDate') {
        value = String(value || '').trim();
        if (value && !SALES_CRM_DATE_RE.test(value)) continue;
      }
      if (field === 'nextAction') value = String(value || '').trim().slice(0, 300);
      if (value === (client[field] ?? '')) continue;
      historyEntries.push({ action: 'update', field, oldValue: client[field] ?? null, newValue: value, source: 'telegram-ai' });
      client[field] = value;
    }
    if (historyEntries.some((h) => h.source === 'telegram-ai')) {
      client.updatedAt = now;
      client.aiUpdatedAt = now;
    }
  }

  if (dirty || historyEntries.length) {
    await kv.put(`salescrm:client:${client.id}`, JSON.stringify(client));
    if (historyEntries.length) await salesCrmHistoryAppend(kv, client.id, client.name, historyEntries);
  }
  return json({ client });
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

// One-time: clients the owner marked as no longer active (2026-09-25). Afterwards the
// flag is edited per project in the Projects tab.
const INITIAL_INACTIVE_CLIENTS = ['aydar-ziyazov', 'anna-kramorenko', 'valentin-volkov'];
async function ensureInactiveClientsSeed(kv) {
  if (await kv.get('inactiveSeedV1')) return;
  const now = new Date().toISOString();
  for (const id of INITIAL_INACTIVE_CLIENTS) {
    const p = await kv.get(`project:${id}`, 'json');
    if (p && !p.inactive) await kv.put(`project:${id}`, JSON.stringify({ ...p, inactive: true, updatedAt: now }));
  }
  await kv.put('inactiveSeedV1', '1');
}

// One-time: grey became the only "inactive" switch (the checkbox is gone) — clients already
// flagged inactive turn grey, and clients already coloured grey become inactive.
async function ensureGrayInactiveMigration(kv) {
  if (await kv.get('grayInactiveV1')) return;
  const now = new Date().toISOString();
  for (const p of await listByPrefix(kv, 'project:')) {
    if (p.inactive && p.rowColor !== 'gray') await kv.put(`project:${p.id}`, JSON.stringify({ ...p, rowColor: 'gray', updatedAt: now }));
    else if (!p.inactive && p.rowColor === 'gray') await kv.put(`project:${p.id}`, JSON.stringify({ ...p, inactive: true, updatedAt: now }));
  }
  await kv.put('grayInactiveV1', '1');
}

async function handleDashboardApi(request, env, url, ctx) {
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
  await ensureInactiveClientsSeed(kv);
  await ensureGrayInactiveMigration(kv);

  // ── Bootstrap: everything the dashboard needs in one call ──
  if (pathname === '/api/dashboard/bootstrap' && request.method === 'GET') {
    const [projects, employees, analytics, projectRatings, dailyMetrics, tasks] = await Promise.all([
      listByPrefix(kv, 'project:'),
      listByPrefix(kv, 'employee:'),
      listByPrefix(kv, 'analytics:'),
      listByPrefix(kv, 'projectRating:'),
      listByPrefix(kv, 'dailyMetrics:'),
      listByPrefix(kv, 'task:'),
    ]);
    return json({
      projects: projects.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      employees: employees.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      analytics,
      projectRatings,
      dailyMetrics,
      tasks,
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
    const rowColor = body && 'rowColor' in body && ROW_COLORS.has(body.rowColor) ? body.rowColor : existing.rowColor || '';
    const project = {
      id,
      name,
      service: (body && body.service) || existing.service || 'Продвижение на Авито',
      responsibleId: body && 'responsibleId' in body ? body.responsibleId || null : existing.responsibleId ?? null,
      status: body && 'status' in body ? String(body.status || '') : existing.status || '',
      stage: body && 'stage' in body ? String(body.stage || '') : existing.stage || '',
      currentWork: body && 'currentWork' in body ? String(body.currentWork || '') : existing.currentWork || '',
      review: body && 'review' in body ? String(body.review || '') : existing.review || '',
      rowColor,
      avitoAccountId: existing.avitoAccountId || null,
      // Links on the client's card in Avito Tasks (edited there; the Avito pull fills avitoProfileUrl).
      profileUrl: existing.profileUrl || null,
      briefUrl: existing.briefUrl || null,
      staffUrl: existing.staffUrl || null, // ссылка Авито «доступ для сотрудников» — вход команды в кабинет клиента
      avitoProfileUrl: existing.avitoProfileUrl || null,
      // Linked, but kept out of «Подтянуть» for now (the tracker's «Кабинеты Авито» checkbox).
      ...(existing.avitoPullOff ? { avitoPullOff: true } : {}),
      // Inactive clients sink to the bottom of the Projects/Analytics lists and are left out of
      // the daily report and the Avito pull — history stays, nothing is deleted. The dashboard
      // marks a client inactive by colouring it grey, so a colour change sets the flag.
      inactive: body && 'rowColor' in body ? rowColor === 'gray'
        : body && 'inactive' in body ? Boolean(body.inactive) : Boolean(existing.inactive),
      ratings: {
        result: Number((body && body.ratings && body.ratings.result) ?? existing.ratings?.result ?? 0),
        communication: Number((body && body.ratings && body.ratings.communication) ?? existing.ratings?.communication ?? 0),
        quality: Number((body && body.ratings && body.ratings.quality) ?? existing.ratings?.quality ?? 0),
      },
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    await kv.put(`project:${id}`, JSON.stringify(project));
    await atTouch(kv, ['#projects']);
    // A client added by hand: its work-chat topic / client chat and their tasks get linked to it.
    if (!existing.id) {
      const relink = botRelinkClients(env).catch((err) => console.error('relink failed', err && err.stack));
      if (ctx && ctx.waitUntil) ctx.waitUntil(relink); else await relink;
    }
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
    await atTouch(kv, ['#projects']);
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
      ...existing, // bot-created tasks carry extra fields (projectId, link, …) that must survive edits
      id,
      text,
      status: (body && body.status) || existing.status || 'open',
      owner: body && 'owner' in body ? body.owner || null : existing.owner ?? null,
      due: body && 'due' in body ? body.due || null : existing.due ?? null,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    await kv.put(`task:${id}`, JSON.stringify(task));
    await atTouch(kv, [id]);
    return json({ task });
  }

  if (pathname === '/api/dashboard/task' && request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'missing_id' }, 400);
    await kv.delete(`task:${id}`);
    await atTouch(kv, [id]);
    return json({ ok: true });
  }


  // ── Chat log (read-only): what the control bot logged in the work-chat topics and client chats ──
  // GET /api/dashboard/chat-log                         -> { sources: [{ chatId, threadId, label, kind, projectId }] }
  // GET /api/dashboard/chat-log?projectId=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
  //     (or &chatId=<id>&threadId=<id> for one source)  -> { sources, messages: [{ t, at, source, from, team, text, reply }] }
  // Days are MSK; default — the last 30 days, at most 120 days per request.
  if (pathname === '/api/dashboard/chat-log' && request.method === 'GET') {
    const sources = await chatLogSources(kv);
    const projectId = url.searchParams.get('projectId');
    const chatId = url.searchParams.get('chatId');
    const threadId = url.searchParams.get('threadId') || '0';
    const picked = projectId ? sources.filter((s) => s.projectId === projectId)
      : chatId ? sources.filter((s) => String(s.chatId) === chatId && String(s.threadId) === threadId) : null;
    if (!picked) return json({ sources });
    const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? Date.parse(`${s}T00:00:00+03:00`) : NaN);
    const toMs = Number.isFinite(day(url.searchParams.get('to'))) ? day(url.searchParams.get('to')) + 24 * 3600000 - 1 : Date.now();
    let fromMs = Number.isFinite(day(url.searchParams.get('from'))) ? day(url.searchParams.get('from')) : toMs - 30 * 24 * 3600000;
    fromMs = Math.max(fromMs, toMs - 120 * 24 * 3600000);
    const lists = await Promise.all(picked.map((s) => botReadLogs(kv, s.chatId, s.threadId, fromMs, toMs)));
    const messages = [];
    lists.forEach((list, i) => {
      for (const e of list) messages.push({ t: e.t, at: new Date(e.t).toISOString(), source: picked[i].label, from: e.from, team: e.team, text: e.text, reply: e.reply || null });
    });
    messages.sort((a, b) => a.t - b.t);
    return json({ sources: picked, messages });
  }

  // ── Reflection (read-only): the weekly «Рефлексия» — each employee's 1–10 score and comment per client ──
  // GET /api/dashboard/reflection                    -> { current, results, history } for the current week
  // GET /api/dashboard/reflection?week=YYYY-MM-DD    -> the same for the week starting on that Wednesday
  if (pathname === '/api/dashboard/reflection' && request.method === 'GET') {
    const current = reflWeek(Date.now());
    const asked = url.searchParams.get('week');
    const week = /^\d{4}-\d{2}-\d{2}$/.test(asked || '') && asked <= current ? asked : current;
    const team = await atGetTeam(env);
    const [results, history] = await Promise.all([atReflectionResults(env, team, week), atReflectionHistory(env)]);
    return json({ current, results, history });
  }

  // ── Avito cabinets linked to projects (for the "Авито: вчера" popup) ──
  if (pathname === '/api/dashboard/avito-links' && request.method === 'GET') {
    return json(await dashboardAvitoLinks(env, kv));
  }

  if (pathname === '/api/dashboard/avito-link' && request.method === 'POST') {
    const body = await readJson(request);
    const projectId = body && String(body.projectId || '').trim();
    const project = projectId && (await kv.get(`project:${projectId}`, 'json'));
    if (!project) return json({ error: 'not_found' }, 404);
    const accountId = body.accountId ? String(body.accountId) : null;
    if (accountId && !(await env.AVITO_KV.get(`account:${accountId}`))) return json({ error: 'account_not_found' }, 404);
    // Another cabinet → its profile link is looked up again on the next Avito pull.
    const avitoProfileUrl = accountId === project.avitoAccountId ? project.avitoProfileUrl || null : null;
    await kv.put(`project:${projectId}`, JSON.stringify({ ...project, avitoAccountId: accountId, avitoProfileUrl, updatedAt: new Date().toISOString() }));
    return json(await dashboardAvitoLinks(env, kv));
  }

  if (pathname === '/api/dashboard/avito-import' && request.method === 'POST') {
    const body = await readJson(request);
    const text = body && String(body.text || '');
    if (!text.trim()) return json({ error: 'empty' }, 400);
    const results = await importAvitoCredentials(env, kv, text);
    return json({ results, ...(await dashboardAvitoLinks(env, kv)) });
  }

  // Background "Авито за вчера": the pull runs server-side (waitUntil + the cron picks up
  // whatever didn't fit), so the page can be closed and reopened to the finished result.
  if (pathname === '/api/dashboard/avito-pull' && request.method === 'GET') {
    const date = url.searchParams.get('date') || mskYesterday();
    const pull = await kv.get(`avitoPull:${date}`, 'json');
    // The open «Подтянуть» window polls this: each poll moves an idle pull on another ~25 s instead
    // of leaving it to the cron (every 10 min) — with Avito slow, one pass gets only a few cabinets.
    if (avitoPullIdle(pull) && ctx) ctx.waitUntil(processAvitoPull(env, date));
    return json({ pull });
  }

  if (pathname === '/api/dashboard/avito-pull' && request.method === 'POST') {
    const body = await readJson(request);
    const date = (body && body.date) || mskYesterday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'bad_date' }, 400);
    const pull = await startAvitoPull(env, date, Boolean(body && body.force));
    // A repeat click on a running pull doesn't start a second parallel pass (Avito allows 1 stats
    // call/min per cabinet): processAvitoPull holds a lease while a pass is on it.
    if ((pull.created || avitoPullIdle(pull)) && pull.pending.length && ctx) ctx.waitUntil(processAvitoPull(env, date));
    delete pull.created;
    return json({ pull });
  }

  if (pathname === '/api/dashboard/avito-yesterday' && request.method === 'GET') {
    const projectId = url.searchParams.get('projectId');
    const project = projectId && (await kv.get(`project:${projectId}`, 'json'));
    if (!project) return json({ error: 'not_found' }, 404);
    const date = url.searchParams.get('date') || mskYesterday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'bad_date' }, 400);
    if (!project.avitoAccountId) return json({ projectId, date, linked: false });
    const account = await env.AVITO_KV.get(`account:${project.avitoAccountId}`, 'json');
    if (!account) return json({ projectId, date, linked: false });
    try {
      return json({ projectId, date, linked: true, ...(await fetchAvitoDaySummary(env, account, date)) });
    } catch (e) {
      return json({ projectId, date, linked: true, errors: [String(e && e.message)] });
    }
  }

  // ── Daily report: «Текущие наблюдения» written by Workers AI (see "Workers AI jobs") ──
  if (pathname === '/api/dashboard/report-job' && request.method === 'POST') {
    const body = await readJson(request);
    const dateTo = (body && body.dateTo) || mskYesterday();
    const dateFrom = (body && body.dateFrom) || dateTo;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) {
      return json({ error: 'bad_dates', message: 'Неверный период' }, 400);
    }
    const report = await buildDailyReportData(kv, dateFrom, dateTo);
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      token: crypto.randomUUID().replace(/-/g, ''),
      status: 'queued',
      dateFrom,
      dateTo,
      report,
      observations: null,
      sessionUrl: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await putReportJob(kv, job);
    await kv.put('reportLastTo', dateTo);
    if (!env.AI) {
      job.status = 'not_configured';
      job.error = 'ИИ не подключён (нет привязки Workers AI в настройках воркера) — можно скачать отчёт с автоматическими наблюдениями.';
      await putReportJob(kv, job);
      await reportPostToChat(env, job);
    } else {
      await waiEnqueue(kv, 'report', job.id);
      await waiKick(env, ctx, 'report', job.id);
    }
    return json({ job: publicReportJob(job) });
  }

  if (pathname === '/api/dashboard/report-job' && request.method === 'GET') {
    const job = await kv.get(`reportJob:${url.searchParams.get('id')}`, 'json');
    if (!job) return json({ error: 'not_found' }, 404);
    if (WAI_ACTIVE.has(job.status)) await waiKick(env, ctx, 'report', job.id);
    return json({ job: publicReportJob(job) });
  }

  // Recent report requests (reportJob records live 14 days) — the "Готовые отчёты" list in
  // the export modal, so a finished file can be re-downloaded after a page reload.
  if (pathname === '/api/dashboard/report-jobs' && request.method === 'GET') {
    const jobs = (await listByPrefix(kv, 'reportJob:'))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 10);
    for (const j of jobs.filter((x) => WAI_ACTIVE.has(x.status)).slice(0, 2)) await waiKick(env, ctx, 'report', j.id);
    return json({ jobs: jobs.map(publicReportJob) });
  }

  if (pathname === '/api/dashboard/report-last' && request.method === 'GET') {
    return json({ lastTo: await kv.get('reportLastTo'), yesterday: mskYesterday() });
  }

  if (pathname === '/api/dashboard/report-job/file' && request.method === 'GET') {
    const job = await kv.get(`reportJob:${url.searchParams.get('id')}`, 'json');
    if (!job) return json({ error: 'not_found' }, 404);
    // Without the AI's observations (not configured / still running / failed) the
    // file falls back to the rule-based draft sentence computed for every client.
    const bytes = buildDailyReportDocx(job.report, job.observations || {});
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="report.docx"; filename*=UTF-8''${encodeURIComponent(reportFileName(job))}`,
        ...corsHeaders(),
      },
    });
  }

  return json({ error: 'not_found' }, 404);
}

/* ═══════════════ Dashboard: Avito auto-pull + daily report ═══════════════ */

// The agency works on Moscow time — "вчера" must not roll over at 03:00 MSK (UTC midnight).
function mskToday() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function mskYesterday() {
  return avitoAddDays(mskToday(), -1);
}

function normalizePersonName(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Matches a free-typed client name ("Шевчук", "Алексей Шевчук", "шевчук алексей") to a
// dashboard project: exact normalized match first, then "every word of the typed name
// appears in the project name" (so a lone surname works), and only if that's unambiguous.
function matchProjectByName(projects, rawName) {
  const name = normalizePersonName(rawName);
  if (!name) return null;
  const exact = projects.filter((p) => normalizePersonName(p.name) === name);
  if (exact.length === 1) return exact[0];
  const words = name.split(' ');
  const partial = projects.filter((p) => {
    const pWords = normalizePersonName(p.name).split(' ');
    return words.every((w) => pWords.includes(w));
  });
  return partial.length === 1 ? partial[0] : null;
}

async function dashboardAvitoLinks(env, kv) {
  const [projects, accountRecords] = await Promise.all([listByPrefix(kv, 'project:'), listByPrefix(env.AVITO_KV, 'account:')]);
  const accounts = accountRecords.map(maskAvitoAccount).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, clientId: a.clientId, userId: a.userId })),
    links: projects.map((p) => ({
      projectId: p.id,
      accountId: p.avitoAccountId && byId[p.avitoAccountId] ? p.avitoAccountId : null,
    })),
  };
}

// Parses a pasted block of credentials — one client per line, in whatever shape the
// agency's notes/spreadsheet happen to be in:
//   "Алексей Шевчук<TAB>client_id<TAB>client_secret[<TAB>user_id]"   (copied from a sheet)
//   "Шевчук; client_id; client_secret"                               (; , | separated)
//   "Шевчук client_id client_secret 123456789"                       (just spaces)
// Credential-looking tokens (long, no spaces) are picked out wherever they sit; a pure
// digit token is the Avito user id; everything else on the line is the client name.
function parseAvitoCredentialLines(text) {
  const rows = [];
  String(text).split(/\r?\n/).forEach((line, idx) => {
    const raw = line.trim();
    if (!raw) return;
    if (/client[_ ]?id|клиент\s*id/i.test(raw) && /secret/i.test(raw)) return; // header row
    const tokens = raw.split(/[\t;,|]+|\s+/).map((t) => t.trim()).filter(Boolean);
    const nameParts = [];
    const creds = [];
    let userId = '';
    tokens.forEach((t) => {
      if (/^\d{5,}$/.test(t)) userId = t;
      else if (t.length >= 16 && /^[A-Za-z0-9_\-.]+$/.test(t)) creds.push(t);
      else nameParts.push(t);
    });
    rows.push({ line: idx + 1, raw, name: nameParts.join(' '), clientId: creds[0] || '', clientSecret: creds[1] || '', userId });
  });
  return rows;
}

async function importAvitoCredentials(env, kv, text) {
  const avitoKv = env.AVITO_KV;
  const projects = await listByPrefix(kv, 'project:');
  const accounts = await listByPrefix(avitoKv, 'account:');
  const results = [];

  for (const row of parseAvitoCredentialLines(text)) {
    const base = { line: row.line, name: row.name };
    if (!row.clientId || !row.clientSecret) {
      results.push({ ...base, ok: false, message: 'Не нашёл client_id и client_secret в строке' });
      continue;
    }
    const project = matchProjectByName(projects, row.name);
    if (!project) {
      results.push({ ...base, ok: false, message: `Клиент «${row.name || '?'}» не найден среди проектов дашборда` });
      continue;
    }

    let userId = row.userId;
    if (!userId) {
      try {
        userId = await avitoLookupUserId(row.clientId, row.clientSecret);
      } catch (e) {
        results.push({ ...base, project: project.name, ok: false, message: `Авито не принял ключи: ${String(e && e.message).slice(0, 120)}` });
        continue;
      }
    }

    // Reuse the cabinet if these credentials (or this project's cabinet) were already
    // added — e.g. via /avito-export — instead of creating a duplicate account record.
    const now = new Date().toISOString();
    let account = accounts.find((a) => a.clientId === row.clientId) || accounts.find((a) => a.id === project.avitoAccountId);
    if (account) {
      const secretChanged = account.clientSecret !== row.clientSecret;
      account = { ...account, clientId: row.clientId, clientSecret: row.clientSecret, userId, updatedAt: now };
      await avitoKv.put(`account:${account.id}`, JSON.stringify(account));
      if (secretChanged) await avitoKv.delete(`token:${account.id}`);
    } else {
      account = {
        id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
        name: project.name, clientId: row.clientId, clientSecret: row.clientSecret, userId,
        createdAt: now, updatedAt: now, lastExportAt: null,
      };
      await avitoKv.put(`account:${account.id}`, JSON.stringify(account));
      accounts.push(account);
    }
    if (project.avitoAccountId !== account.id) project.avitoProfileUrl = null;
    project.avitoAccountId = account.id;
    await kv.put(`project:${project.id}`, JSON.stringify({ ...project, updatedAt: now }));
    results.push({ ...base, project: project.name, ok: true, message: `Подключено (user id ${userId})` });
  }
  return results;
}

// Walks any JSON shape collecting numeric metric values by name — Avito's v2 stats and CPA
// balance responses aren't documented anywhere reachable from here, so rather than hard-code
// one nesting we accept both { slug: 'views', value: 12 } entries and plain { views: 12 } keys.
function collectAvitoNumbers(node, wanted, acc = {}) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectAvitoNumbers(n, wanted, acc));
  } else if (node && typeof node === 'object') {
    const slug = node.slug || node.name || node.metric;
    if (typeof slug === 'string' && wanted.includes(slug) && typeof node.value === 'number') {
      acc[slug] = (acc[slug] || 0) + node.value;
    }
    Object.entries(node).forEach(([k, v]) => {
      if (wanted.includes(k) && typeof v === 'number') acc[k] = (acc[k] || 0) + v;
      else if (v && typeof v === 'object') collectAvitoNumbers(v, wanted, acc);
    });
  }
  return acc;
}

// One cabinet, one day: views, contacts, spend and the cabinet's current advance/balance.
// Every piece degrades independently (errors[] explains what's missing) so one Avito
// endpoint being unavailable on a cabinet doesn't blank out the rest of the row — but a missing
// number stays missing (null), never a guess.
// Flat daily tariff every client cabinet pays (agency's own numbers: the table's daily budget
// is exactly stats v2 allSpending + 100 руб for every client).
const AVITO_DAILY_TARIFF_RUB = 100;

async function fetchAvitoDaySummary(env, account, date) {
  const errors = [];
  const sources = {};
  const token = await avitoGetToken(env, account);
  const userId = account.userId;
  const out = { views: null, contacts: null, spend: null, advance: null, wallet: null };

  // 1) Avito stats v2 — the only documented place that reports spend per period.
  try {
    const data = await avitoJson(token, `/stats/v2/accounts/${userId}/items`, {
      method: 'POST',
      body: JSON.stringify({ dateFrom: date, dateTo: date, grouping: 'totals', metrics: ['views', 'contacts', 'allSpending'], limit: 1000, offset: 0 }),
    });
    const n = collectAvitoNumbers(data, ['views', 'contacts', 'allSpending']);
    if (n.views != null) { out.views = n.views; sources.views = 'stats_v2'; }
    if (n.contacts != null) { out.contacts = n.contacts; sources.contacts = 'stats_v2'; }
    // allSpending comes back in kopecks (checked against real cabinets: 80400 for a day the
    // table has as 904 руб). It covers listing placement/promotion only — the flat daily
    // tariff fee isn't part of any stats v2 spending metric, so it's added on top.
    if (n.allSpending != null) { out.spend = Math.round(n.allSpending / 100) + AVITO_DAILY_TARIFF_RUB; sources.spend = 'stats_v2'; }
  } catch (e) {
    errors.push(`Статистика v2: ${String(e.message).slice(0, 160)}`);
  }

  // 2) Views/contacts fallback: the per-listing v1 stats /avito-export already uses.
  if (out.views == null || out.contacts == null) {
    try {
      const items = await fetchAllAvitoItems(token);
      const daily = await fetchAvitoDailyStats(token, userId, items.map((it) => it.id).filter(Boolean), date, date, errors);
      const s = sumAvitoStatDaysInRange(Object.values(daily).flat(), date, date);
      if (out.views == null) { out.views = s.views; sources.views = 'stats_v1'; }
      if (out.contacts == null) { out.contacts = s.contacts; sources.contacts = 'stats_v1'; }
    } catch (e) {
      errors.push(`Статистика v1: ${String(e.message).slice(0, 160)}`);
    }
  }

  // 3) No spend fallback on purpose. The wallet's operations history used to stand in here, but it
  // can't tell spend from money moved inside the cabinet: on a day stats v2 was down it put
  // transfers to the advance (10 000, 1 000) and empty days (0) into the budget. No stats v2 spend
  // means no budget — the row shows the error and «Внести в таблицу» leaves that day's budget alone.
  if (out.spend == null && !errors.some((e) => e.startsWith('Статистика v2'))) {
    errors.push('Статистика v2: Авито не вернул расход за день');
  }

  // 4) Advance ("аванс") — lives in the CPA balance; amounts there are in kopecks.
  for (const version of ['v3', 'v2']) {
    try {
      const data = await avitoJson(token, `/cpa/${version}/balanceInfo`, { method: 'POST', body: '{}', headers: { 'X-Source': 'cantor-dashboard' } });
      const n = collectAvitoNumbers(data, ['advance', 'balance']);
      const kopecks = n.advance ?? n.balance;
      if (kopecks != null) { out.advance = Math.round(kopecks / 100); sources.advance = `cpa_${version}_${n.advance != null ? 'advance' : 'balance'}`; break; }
    } catch (e) {
      if (version === 'v2') errors.push(`Аванс (CPA): ${String(e.message).slice(0, 160)}`);
    }
  }

  // 5) Plain wallet balance — shown when the cabinet has no CPA advance.
  try {
    const bal = await fetchAvitoBalance(token, userId);
    out.wallet = Math.round(Number(bal.real || 0) + Number(bal.bonus || 0));
  } catch (e) {
    errors.push(`Кошелёк: ${String(e.message).slice(0, 160)}`);
  }

  return { ...out, sources, errors, accountName: account.name };
}

// The cabinet's money right now: the CPA advance («аванс», kopecks in Avito's answer) and the wallet
// («кошелёк» — real + bonus). For the «Обновить с Авито» button on the tracker's Clients tab.
async function fetchAvitoMoney(env, account) {
  const out = { advance: null, wallet: null, errors: [] };
  const token = await avitoGetToken(env, account);
  for (const version of ['v3', 'v2']) {
    try {
      const data = await avitoJson(token, `/cpa/${version}/balanceInfo`, { method: 'POST', body: '{}', headers: { 'X-Source': 'cantor-dashboard' } });
      const n = collectAvitoNumbers(data, ['advance', 'balance']);
      const kopecks = n.advance ?? n.balance;
      if (kopecks != null) { out.advance = Math.round(kopecks / 100); break; }
    } catch (e) {
      if (version === 'v2') out.errors.push(`Аванс: ${String(e.message).slice(0, 120)}`);
    }
  }
  try {
    const bal = await fetchAvitoBalance(token, account.userId);
    out.wallet = Math.round(Number(bal.real || 0) + Number(bal.bonus || 0));
  } catch (e) {
    out.errors.push(`Кошелёк: ${String(e.message).slice(0, 120)}`);
  }
  return out;
}
// Every linked active client's money, fetched now (4 cabinets at a time), kept in at:avitoMoney.
async function atRefreshAvitoMoney(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const projects = (await listByPrefix(kv, 'project:')).filter((p) => p.avitoAccountId && !p.inactive);
  const rows = {};
  const queue = [...projects];
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      const account = await env.AVITO_KV.get(`account:${p.avitoAccountId}`, 'json');
      if (!account) { rows[p.id] = { advance: null, wallet: null, error: 'кабинет не найден' }; continue; }
      try {
        const m = await fetchAvitoMoney(env, account);
        rows[p.id] = { advance: m.advance, wallet: m.wallet, error: m.advance == null && m.wallet == null ? m.errors[0] || 'нет данных' : null };
      } catch (e) {
        rows[p.id] = { advance: null, wallet: null, error: String(e && e.message).slice(0, 160) };
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const rec = { at: new Date().toISOString(), rows };
  await kv.put('at:avitoMoney', JSON.stringify(rec));
  return rec;
}

/* ── Background Avito pull (one KV record per day, results for every linked cabinet) ── */

const AVITO_PULL_TTL = 7 * 24 * 3600;
const AVITO_PULL_BUDGET_MS = 25000; // stay inside waitUntil's ~30s; the cron finishes the rest
const AVITO_PULL_CONCURRENCY = 4; // different cabinets — Avito's 1/min stats limit is per cabinet
const AVITO_PULL_MAX_TRIES = 3; // runs a cabinet may be cut off in before it's marked as an error
const AVITO_PULL_AUTOSTART_HOUR_MSK = 7; // cron prepares yesterday's numbers every morning

async function startAvitoPull(env, date, force) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const existing = await kv.get(`avitoPull:${date}`, 'json');
  const fresh = existing && Date.now() - Date.parse(existing.startedAt) < 10 * 60 * 1000;
  if (existing && (!force || (existing.status === 'running' && fresh))) return existing;
  const projects = await listByPrefix(kv, 'project:');
  // «Загрузить заново» re-asks Avito only for the cabinets that came back incomplete: with Avito
  // failing for some cabinets, reloading all of them would throw away the ones that did load.
  const kept = {};
  if (existing && existing.results) {
    Object.entries(existing.results).forEach(([id, r]) => {
      if (r && r.linked && r.views != null && r.contacts != null && r.spend != null) kept[id] = r;
    });
  }
  const pull = {
    date,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    // project.avitoPullOff: the cabinet is linked (API keys in), but its numbers aren't pulled yet.
    pending: projects.filter((p) => p.avitoAccountId && !p.inactive && !p.avitoPullOff && !kept[p.id]).map((p) => p.id),
    results: kept,
  };
  if (!pull.pending.length) { pull.status = 'done'; pull.finishedAt = pull.startedAt; }
  await kv.put(`avitoPull:${date}`, JSON.stringify(pull), { expirationTtl: AVITO_PULL_TTL });
  return { ...pull, created: true };
}

// A running pull nobody is working on right now (no pass holds its lease).
function avitoPullIdle(pull) {
  return Boolean(pull && pull.status === 'running' && pull.pending && pull.pending.length && !(pull.leaseUntil > Date.now()));
}

async function processAvitoPull(env, date, budgetMs = AVITO_PULL_BUDGET_MS) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const pull = await kv.get(`avitoPull:${date}`, 'json');
  if (!avitoPullIdle(pull)) return;
  const deadline = Date.now() + budgetMs;
  // Released at the end of the pass; a pass the runtime kills lets it lapse (+20 s for the
  // cabinets still in flight when the budget runs out).
  pull.leaseUntil = deadline + 20000;
  const queue = [...pull.pending];
  let profilesFound = false;
  // Progress is saved after every cabinet, and the cabinets this run starts with are counted first:
  // one that keeps getting the run killed (Avito hanging) ends up as an error instead of holding the
  // whole pull in «загружается…» forever.
  const save = () => kv.put(`avitoPull:${date}`, JSON.stringify(pull), { expirationTtl: AVITO_PULL_TTL });
  pull.tries = pull.tries || {};
  queue.slice(0, AVITO_PULL_CONCURRENCY).forEach((id) => { pull.tries[id] = (pull.tries[id] || 0) + 1; });
  await save();
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const projectId = queue.shift();
      const project = await kv.get(`project:${projectId}`, 'json');
      const account = project && project.avitoAccountId && (await env.AVITO_KV.get(`account:${project.avitoAccountId}`, 'json'));
      let result;
      if (!account) result = { linked: false };
      else if ((pull.tries[projectId] || 0) > AVITO_PULL_MAX_TRIES) result = { linked: true, errors: ['Авито не ответил за несколько попыток — нажмите «Загрузить заново» позже'] };
      else {
        try { result = { linked: true, ...(await fetchAvitoDaySummary(env, account, date)) }; }
        catch (e) { result = { linked: true, errors: [String(e && e.message)] }; }
        // The cabinet's public Avito profile, for the client card in Avito Tasks — read once.
        if (!project.avitoProfileUrl) {
          try {
            const self = await fetchAvitoSelf(await avitoGetToken(env, account));
            if (self && isValidHttpUrl(self.profile_url)) {
              const fresh = (await kv.get(`project:${projectId}`, 'json')) || project;
              await kv.put(`project:${projectId}`, JSON.stringify({ ...fresh, avitoProfileUrl: String(self.profile_url).slice(0, 500) }));
              profilesFound = true;
            }
          } catch (e) { /* no profile link this time; tried again on the next pull */ }
        }
      }
      pull.results[projectId] = result;
      pull.pending = pull.pending.filter((id) => id !== projectId);
      if (!pull.pending.length) { pull.status = 'done'; pull.finishedAt = new Date().toISOString(); }
      await save();
    }
  };
  await Promise.all(Array.from({ length: AVITO_PULL_CONCURRENCY }, worker));
  pull.leaseUntil = 0;
  await save();
  if (profilesFound) await atTouch(kv, ['#projects']);
}

async function avitoPullCron(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!kv) return;
  const date = mskYesterday();
  const pull = await kv.get(`avitoPull:${date}`, 'json');
  const hourMsk = new Date(Date.now() + 3 * 3600 * 1000).getUTCHours();
  if (!pull && hourMsk >= AVITO_PULL_AUTOSTART_HOUR_MSK) await startAvitoPull(env, date, false);
  // Finish any day's pull that didn't fit in its request's waitUntil — yesterday's or one
  // the owner started for an earlier date from the panel (pull records expire after 7 days).
  const { keys } = await kv.list({ prefix: 'avitoPull:' });
  // The cron has minutes, not waitUntil's ~30 s: up to 4 min per pull, 10 min in all.
  const started = Date.now();
  for (const k of keys) {
    const left = 10 * 60 * 1000 - (Date.now() - started);
    if (left < 60 * 1000) break;
    await processAvitoPull(env, k.name.slice('avitoPull:'.length), Math.min(4 * 60 * 1000, left - 30 * 1000));
  }
}

/* ── Daily report data (same rules as the manual "ежедневный отчёт" methodology) ── */

// Report-excluded (no activity since mid-July) — also pinned last in the Analytics table.
const REPORT_WOUND_DOWN = new Set(['aydar-ziyazov', 'anna-kramorenko']);
// Their campaigns started on the 31st, so their month is counted from the 31st of the
// previous month instead of the 1st.
const REPORT_EARLY_MONTH_START = new Set(['galina-simagina', 'olga-simagina', 'oksana-alekseeva']);
const MONTHS_RU_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function reportMonthStart(projectId, dateTo) {
  const first = avitoMonthStart(dateTo);
  if (!REPORT_EARLY_MONTH_START.has(projectId)) return first;
  const prevLast = avitoAddDays(first, -1);
  return prevLast.endsWith('-31') ? prevLast : first;
}

function reportPeriodLabel(dateFrom, dateTo) {
  const [, m1, d1] = dateFrom.split('-').map(Number);
  const [, m2, d2] = dateTo.split('-').map(Number);
  if (dateFrom === dateTo) return `Вчера, ${String(d2).padStart(2, '0')}.${String(m2).padStart(2, '0')}`;
  if (m1 === m2) return `За ${d1}–${d2} ${MONTHS_RU_GENITIVE[m2 - 1]}`;
  return `За ${d1} ${MONTHS_RU_GENITIVE[m1 - 1]} – ${d2} ${MONTHS_RU_GENITIVE[m2 - 1]}`;
}

function sumDaily(rows, from, to) {
  return rows
    .filter((r) => r.date >= from && r.date <= to)
    .reduce((acc, r) => {
      acc.budget += r.budget || 0; acc.views += r.views || 0; acc.contacts += r.contacts || 0;
      acc.diagnostics += r.diagnostics || 0; acc.sales += r.sales || 0;
      return acc;
    }, { budget: 0, views: 0, contacts: 0, diagnostics: 0, sales: 0 });
}

function fmtRuInt(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function fmtRuPct(n) {
  return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

// Rule-based "Текущие наблюдения" — Workers AI rewrites it in natural wording, and this
// is also what the file falls back to if the AI isn't configured or hasn't answered.
function draftObservation(month, last3) {
  const parts = [];
  if (month.contacts > 0 && month.views > 0) {
    const conv = (month.contacts / month.views) * 100;
    let convLabel = 'в целевом диапазоне';
    if (conv > 12) convLabel = 'выше целевого диапазона';
    else if (conv < 8) convLabel = 'ниже целевой';
    else if (conv < 10) convLabel = 'чуть ниже целевой';
    parts.push(`Конверсия ${fmtRuPct(conv)}% — ${convLabel} (10–12%)`);
    const cpl = month.budget / month.contacts;
    let cplLabel = 'в пределах целевого диапазона';
    if (cpl > 1500) cplLabel = 'выше целевого диапазона';
    else if (cpl < 1000) cplLabel = 'ниже целевого';
    parts.push(`CPL ${fmtRuInt(cpl)} руб — ${cplLabel} (1000–1500 руб)`);
  } else {
    parts.push('Контактов за месяц пока нет, конверсия и CPL не считаются');
  }
  const v = last3.map((d) => d.views);
  let trend = 'колеблются';
  if (v.every((x) => x === v[0])) trend = 'стабильны';
  else if (v[0] < v[1] && v[1] < v[2]) trend = 'растут';
  else if (v[0] > v[1] && v[1] > v[2]) trend = 'снижаются';
  parts.push(`просмотры за последние 3 дня: ${v.join(', ')} — ${trend}`);
  return `${parts.join('; ')}.`;
}

async function buildDailyReportData(kv, dateFrom, dateTo) {
  const [projects, daily] = await Promise.all([listByPrefix(kv, 'project:'), listByPrefix(kv, 'dailyMetrics:')]);
  const ordered = projects
    .filter((p) => !REPORT_WOUND_DOWN.has(p.id) && !p.inactive)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const clients = [];
  const warnings = [];
  for (const p of ordered) {
    const rows = daily.filter((r) => r.projectId === p.id);
    const monthFrom = reportMonthStart(p.id, dateTo);
    const month = sumDaily(rows, monthFrom, dateTo);
    if (!(month.budget > 0)) continue; // methodology: only clients with spend this month

    const period = sumDaily(rows, dateFrom, dateTo);
    const last3 = [-2, -1, 0].map((delta) => {
      const d = avitoAddDays(dateTo, delta);
      return { date: d, views: sumDaily(rows, d, d).views };
    });
    const lastDay = rows.find((r) => r.date === dateTo);
    if (!lastDay || !lastDay.budget) {
      warnings.push(`${p.name}: за ${dateTo.split('-').reverse().join('.')} бюджет пустой — возможно, данные ещё не внесены`);
    }
    const conversionPct = month.views > 0 ? Math.round((month.contacts / month.views) * 1000) / 10 : null;
    const cpl = month.contacts > 0 ? Math.round(month.budget / month.contacts) : null;
    const cac = month.sales > 0 ? Math.round(month.budget / month.sales) : null;
    clients.push({
      projectId: p.id,
      name: p.name,
      monthFrom,
      period: { budget: period.budget, views: period.views, contacts: period.contacts },
      month: { ...month, conversionPct, cpl, cac },
      last3,
      draftObservation: draftObservation(month, last3),
    });
  }
  return { dateFrom, dateTo, periodLabel: reportPeriodLabel(dateFrom, dateTo), clients, warnings };
}

/* ── Minimal .docx writer (stored zip, no dependencies) ── */

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  files.forEach(({ name, data }) => {
    const nameBytes = enc.encode(name);
    const body = typeof data === 'string' ? enc.encode(data) : data;
    const crc = crc32(body);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint16(8, 0, true); // stored
    header.setUint32(14, crc, true);
    header.setUint32(18, body.length, true);
    header.setUint32(22, body.length, true);
    header.setUint16(26, nameBytes.length, true);
    local.push(new Uint8Array(header.buffer), nameBytes, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, body.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  });
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let pos = 0;
  parts.forEach((b) => { out.set(b, pos); pos += b.length; });
  return out;
}

function xmlEscape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Paragraph of runs: each run is a string or { text, bold, size, br } (br = line break before).
function docxParagraph(runs, { style, pageBreakBefore } = {}) {
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${pageBreakBefore ? '<w:pageBreakBefore/>' : ''}`;
  const body = runs.map((r) => {
    const run = typeof r === 'string' ? { text: r } : r;
    const rPr = `${run.bold ? '<w:b/>' : ''}${run.size ? `<w:sz w:val="${run.size}"/>` : ''}`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${run.br ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
  }).join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`;
}

function buildDailyReportDocx(report, observations) {
  const n = fmtRuInt;
  const paras = [];
  report.clients.forEach((c, i) => {
    const m = c.month;
    const obs = String((observations && observations[c.projectId]) || c.draftObservation).trim();
    let contactsLine = `Контактов: ${n(m.contacts)}`;
    const extras = [];
    if (m.conversionPct != null) extras.push(`конверсия ${fmtRuPct(m.conversionPct)}%`);
    if (m.cpl != null) extras.push(`CPL ${n(m.cpl)} руб`);
    if (extras.length) contactsLine += ` (${extras.join(', ')})`;

    paras.push(docxParagraph([c.name], { style: 'Heading1', pageBreakBefore: i > 0 }));
    paras.push(docxParagraph([{ text: 'ЕЖЕДНЕВНЫЙ ОТЧЕТ', bold: true, size: 28 }]));
    paras.push(docxParagraph([{ text: report.periodLabel, bold: true }]));
    paras.push(docxParagraph([`Бюджет: ${n(c.period.budget)} руб`]));
    paras.push(docxParagraph([`Просмотров: ${n(c.period.views)}`]));
    paras.push(docxParagraph([`Контактов: ${n(c.period.contacts)}`]));
    paras.push(docxParagraph([{ text: 'Текущие наблюдения:', bold: true }, { text: obs, br: true }]));
    paras.push(docxParagraph([{ text: 'Суммарно за месяц', bold: true }]));
    paras.push(docxParagraph([`Бюджет: ${n(m.budget)} руб`]));
    paras.push(docxParagraph([`Просмотров: ${n(m.views)}`]));
    paras.push(docxParagraph([contactsLine]));
    paras.push(docxParagraph([`Диагностик: ${n(m.diagnostics)}`]));
    paras.push(docxParagraph([`Продаж: ${n(m.sales)}${m.cac != null ? ` (CAC ${n(m.cac)} руб)` : ''}`]));
  });
  if (!report.clients.length) paras.push(docxParagraph(['Нет клиентов с бюджетом за этот месяц.']));

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style></w:styles>`;
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
  ]);
}

function reportFileName(job) {
  const d = (s) => s.split('-').reverse().slice(0, 2).join('.');
  // ASCII on purpose: some browsers silently drop a Cyrillic <a download> name.
  return job.dateFrom === job.dateTo ? `Otchet_${d(job.dateTo)}.docx` : `Otchet_${d(job.dateFrom)}-${d(job.dateTo)}.docx`;
}

/* ── Report jobs ── */

const REPORT_JOB_TTL = 14 * 24 * 3600;

async function putReportJob(kv, job) {
  job.updatedAt = new Date().toISOString();
  await kv.put(`reportJob:${job.id}`, JSON.stringify(job), { expirationTtl: REPORT_JOB_TTL });
}

function publicReportJob(job) {
  const { token, report, observations, wai, ...rest } = job;
  return {
    ...rest,
    periodLabel: report.periodLabel,
    clientsCount: report.clients.length,
    warnings: report.warnings,
    hasObservations: Boolean(observations),
    fileName: reportFileName(job),
  };
}

// A finished report goes to the work chat by itself — its main topic (General), as a .docx, with the
// client manager tagged to check it and send it on to the clients. Once per report.
async function reportPostToChat(env, job) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (job.postedAt || !env.CONTROL_BOT_TOKEN) return;
  try {
    const work = (await listByPrefix(kv, 'bot:chat:')).find((c) => c.kind === 'work');
    if (!work) throw new Error('рабочий чат не найден — добавьте бота в рабочий чат');
    const team = await atGetTeam(env);
    const tags = team.users.filter((u) => u.active && u.role === 'manager').map((u) => (u.tgUsername
      ? `@${escapeHtml(u.tgUsername)}`
      : u.tgId ? `<a href="tg://user?id=${encodeURIComponent(u.tgId)}">${escapeHtml(atFirstName(u.name))}</a>` : escapeHtml(u.name)));
    const caption = [
      `📄 <b>Отчёт по клиентам Авито</b> — ${escapeHtml(job.report.periodLabel)}`,
      `Клиентов: ${job.report.clients.length}${job.observations ? '' : ' · наблюдения автоматические (ИИ не ответил)'}`,
      tags.length ? `${tags.join(', ')}, проверьте и отправьте клиентам.` : '',
    ].filter(Boolean).join('\n');
    const res = await botSendDocument(env, work.id, reportFileName(job), buildDailyReportDocx(job.report, job.observations), caption, {
      parseMode: 'HTML', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    if (!res || !res.ok) throw new Error((res && res.description) || 'Telegram не принял файл');
    job.postedAt = new Date().toISOString();
    job.postError = null;
  } catch (e) {
    job.postError = String(e && e.message).slice(0, 200);
  }
  await putReportJob(kv, job);
}

// ── Control bot (Telegram): keeps agency tasks and deadlines from getting lost ──
//
// A Telegram bot (token in the CONTROL_BOT_TOKEN secret, never in wrangler.jsonc) that sits
// silently in the agency's work chat (a forum supergroup: one topic per client) and, later, in
// the client chats. It never writes into groups: everything goes to the owner's private chat
// (CONTROL_BOT_OWNER_IDS). Every message is logged to KV and queued; the cron trigger feeds the
// queue to Workers AI (free tier), which turns messages into tasks (who, what, by when, done,
// reported to the client). Tasks are stored as the dashboard's own `task:<id>` records, so they
// show up on /dashboard. When the free AI allocation runs out the bot tells the owner (🔴),
// keeps logging, and works through the backlog once the limit resets (🟢).
//
// KV keys (binding "AGENCY_DASHBOARD_KV", "bot:" prefix):
//   bot:setup                              -> BOT_SETUP_VERSION once webhook/profile/commands are set
//   bot:chat:<chatId>                      -> { id, title, isForum, kind: 'work'|'client', projectId, addedAt }
//   bot:topic:<chatId>:<threadId>          -> { name, projectId }
//   bot:member:<userId>                    -> { id, name, seenAt }  (people who write in the work chat = team)
//   bot:log:<chatId>:<threadId>:<YYYY-MM-DD> -> [{ id, t, from, fromId, text, reply, reactions? }]  (MSK day,
//                                              180-day TTL; reactions: [{ by, team, e, t }] put on the message)
//   bot:hist:<chatId>:<threadId>           -> [{ id, t, from, team, text, reply, imported }]  history from before
//                                              the bot joined (Telegram export, /api/tgbot/import), 180-day TTL
//   bot:dirty:<chatId>:<threadId>          -> "1" while a topic/chat has messages the AI hasn't seen
//   bot:cursor:<chatId>:<threadId>         -> last message id the AI has processed there
//   bot:attempts:<chatId>:<threadId>       -> failed AI attempts on the current batch
//   bot:ai                                 -> { limited, since, processedWhileLimited }
//   bot:pending:<chatId>                   -> { since, msgId, text }  (client message not answered yet)
//   bot:report:<chatId>:<YYYY-MM-DD>       -> "1" once today's report to that client was seen
//   bot:once:<key>                         -> "1" dedupe for notifications (TTL)
//   task:<id> (shared with the dashboard)  -> { id, text, status, owner, due, projectId, source: 'bot',
//                                              origin, chatId, threadId, msgId, link, author,
//                                              doneAt, informedAt, notified, createdAt, updatedAt }

const BOT_SETUP_VERSION = '5'; // 2: callback buttons + employees' private chats (Avito Tasks); 3: /activity in the owner's menu; 4: reactions; 5: /errors (autoload report)
const BOT_WORKER_ORIGIN = 'https://mainweb.oxion-ezhkov.workers.dev';
const BOT_AI_MODEL_DEFAULT = '@cf/qwen/qwen3-30b-a3b-fp8';
const BOT_LOG_TTL = 60 * 60 * 24 * 180;
const BOT_MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const BOT_WORK_START_H = 10;
const BOT_WORK_END_H = 18;
const BOT_NO_DUE_AFTER_WMIN = 120;      // task without a deadline after 2 working hours
const BOT_CLIENT_REPLY_WMIN = 30;       // client message unanswered for 30 working minutes
const BOT_CLIENT_REPLY_STALE_MS = 24 * 3600000; // …but a message unanswered for over a day pings nobody
const BOT_HANDOFF_WMIN = 120;           // client's request not passed on to the work chat in 2 working hours
const BOT_NOT_INFORMED_WMIN = 120;      // done but not reported to the client in 2 working hours
const BOT_SLA_LOOKBACK_MS = 3 * 24 * 3600000; // the 2-hour checks only look at the last 3 days' tasks
const BOT_AI_BATCH_GROUPS = 6;          // topics per cron run
const BOT_AI_BATCH_MESSAGES = 60;       // messages per topic per AI call
const BOT_AI_MAX_ATTEMPTS = 5;

// Topic ids of the existing work chat «Авито», from its export (thread id = id of the
// "created topic" service message). Used until the bot sees a topic's name itself.
const BOT_SEED_TOPICS = {
  2: 'Ольга Агешина', 17: 'Оксана Алексеева', 21: 'Светлана Соболева', 23: 'Валентин Волков',
  25: 'Лариса Ромашова', 27: 'Алексей Шевчук', 31: 'Галина Симагина', 55: 'Иван Кариентиди',
  57: 'Елена Добрынина', 61: 'Ирина Армбристер', 842: 'Эдвайзеры', 1192: 'Наталина Сасс',
};

const BOT_STRANGER_REPLY = 'Здравствуйте! Это служебный бот команды Cantor Agency — он помогает не терять ваши запросы. '
  + 'По любым вопросам пишите вашему менеджеру в рабочий чат, мы ответим в рабочее время (будни 10:00–18:00 МСК).';

const BOT_OWNER_COMMANDS = [
  { command: 'summary', description: 'Сводка: просрочено, без срока, не сообщили клиенту' },
  { command: 'my', description: 'Мои задачи (Avito Tasks)' },
  { command: 'access', description: 'Ссылки доступа в Avito Tasks' },
  { command: 'activity', description: 'Кто когда работал сегодня' },
  { command: 'tasks', description: 'Открытые задачи по клиентам' },
  { command: 'overdue', description: 'Просроченные задачи' },
  { command: 'metrics', description: 'Проверка метрик из дашборда' },
  { command: 'errors', description: 'Файл ошибок автозагрузки Авито: /errors Добрынина' },
  { command: 'topics', description: 'Чаты и топики → клиенты' },
  { command: 'ai', description: 'Статус ИИ и очереди' },
  { command: 'help', description: 'Что умеет бот' },
];

// ── time helpers (all business logic is in Moscow time, UTC+3, no DST) ──
function botMsk(ms) {
  const d = new Date(ms + BOT_MSK_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    dow: d.getUTCDay(), // 0 = Sunday
  };
}
function botMskStartOfDay(ms) {
  const d = new Date(ms + BOT_MSK_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - BOT_MSK_OFFSET_MS;
}
function botIsWorkday(ms) {
  const { dow } = botMsk(ms);
  return dow >= 1 && dow <= 5;
}
// Working minutes (weekdays 10:00–18:00 MSK) between two instants.
function botWorkingMinutes(fromMs, toMs) {
  if (!(toMs > fromMs)) return 0;
  let total = 0;
  let day = botMskStartOfDay(fromMs);
  while (day < toMs) {
    if (botIsWorkday(day + 12 * 3600000)) {
      const ws = day + BOT_WORK_START_H * 3600000;
      const we = day + BOT_WORK_END_H * 3600000;
      const s = Math.max(ws, fromMs);
      const e = Math.min(we, toMs);
      if (e > s) total += (e - s) / 60000;
    }
    day += 24 * 3600000;
  }
  return Math.round(total);
}
function botFmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms + BOT_MSK_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}.${mo} ${hh}:${mi}`;
}
// "YYYY-MM-DD HH:MM" (MSK, as the AI returns it) -> epoch ms, or null.
function botParseMskDateTime(value) {
  const m = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] != null ? +m[4] : BOT_WORK_END_H, m[5] != null ? +m[5] : 0) - BOT_MSK_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}
function botDueMs(task) {
  if (!task || !task.due) return null;
  const ms = Date.parse(task.due);
  return Number.isFinite(ms) ? ms : null;
}
function botIsoMsk(ms) {
  return new Date(ms + BOT_MSK_OFFSET_MS).toISOString().slice(0, 19) + '+03:00';
}

// ── Telegram API ──
async function botApi(env, method, body) {
  const token = env.CONTROL_BOT_TOKEN;
  if (!token) return { ok: false, description: 'CONTROL_BOT_TOKEN is not set' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(10000),
    });
    return (await res.json().catch(() => null)) || { ok: false, description: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, description: String(err && err.message) };
  }
}
function botOwnerIds(env) {
  return parseChatIds(env.CONTROL_BOT_OWNER_IDS);
}
function botIsOwner(env, userId) {
  return botOwnerIds(env).includes(String(userId));
}
// Long texts are split on line breaks to stay under Telegram's 4096-char limit.
// Telegram rejects messages over 4096 chars, so long texts go out in several messages,
// split on line breaks (every line is self-contained HTML).
async function botSend(env, chatId, text, extra = {}) {
  extra = await atPersonalizeExtra(env, chatId, extra);
  const chunks = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if ((cur + '\n' + line).length > 3800 && cur) { chunks.push(cur); cur = line; } else { cur = cur ? cur + '\n' + line : line; }
  }
  if (cur) chunks.push(cur);
  for (const chunk of chunks) {
    const res = await botApi(env, 'sendMessage', { chat_id: chatId, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    if (!res || !res.ok) console.error('control bot sendMessage failed', res && res.description);
  }
}
async function botNotifyOwner(env, text, extra = {}) {
  for (const id of botOwnerIds(env)) await botSend(env, id, text, extra);
}
async function botOnce(kv, key, ttlSeconds) {
  const k = `bot:once:${key}`;
  if (await kv.get(k)) return false;
  await kv.put(k, '1', { expirationTtl: Math.max(60, ttlSeconds || 60 * 60 * 24 * 30) });
  return true;
}
function botMessageLink(chatId, threadId, msgId) {
  const s = String(chatId);
  if (!s.startsWith('-100') || !msgId) return null;
  const internal = s.slice(4);
  return threadId && String(threadId) !== '0'
    ? `https://t.me/c/${internal}/${threadId}/${msgId}`
    : `https://t.me/c/${internal}/${msgId}`;
}
async function botWebhookSecret(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cantor-control-bot:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

// Webhook, bot profile and command menu. Runs from the cron whenever BOT_SETUP_VERSION changes,
// so the owner only has to add the token secret — or by hand via /api/tgbot/setup.
async function botSetup(env) {
  const token = env.CONTROL_BOT_TOKEN;
  if (!token) return { ok: false, error: 'CONTROL_BOT_TOKEN is not set' };
  const results = {};
  results.webhook = await botApi(env, 'setWebhook', {
    url: `${BOT_WORKER_ORIGIN}/api/tgbot/webhook`,
    secret_token: await botWebhookSecret(token),
    // message_reaction only reaches the bot in groups where it is an administrator.
    allowed_updates: ['message', 'edited_message', 'my_chat_member', 'callback_query', 'message_reaction'],
    max_connections: 1, // one update at a time, so the per-day log read-modify-write never races
  });
  results.name = await botApi(env, 'setMyName', { name: 'Cantor Agency · помощник' });
  results.description = await botApi(env, 'setMyDescription', {
    description: 'Рабочий помощник команды Cantor Agency. Следит, чтобы ваши запросы не терялись. '
      + 'По всем вопросам пишите вашему менеджеру в рабочий чат.',
  });
  results.shortDescription = await botApi(env, 'setMyShortDescription', {
    short_description: 'Рабочий помощник Cantor Agency: следит, чтобы запросы не терялись.',
  });
  // No command menu for anyone (clients in groups, strangers) — only in the owners' private chats.
  results.clearDefault = await botApi(env, 'deleteMyCommands', {});
  results.clearGroups = await botApi(env, 'setMyCommands', { commands: [], scope: { type: 'all_group_chats' } });
  results.owner = [];
  for (const id of botOwnerIds(env)) {
    results.owner.push(await botApi(env, 'setMyCommands', { commands: BOT_OWNER_COMMANDS, scope: { type: 'chat', chat_id: Number(id) } }));
  }
  const ok = !!(results.webhook && results.webhook.ok);
  if (ok) await env.AGENCY_DASHBOARD_KV.put('bot:setup', BOT_SETUP_VERSION);
  return { ok, results };
}

// ── projects / topics / chats ──
function botNorm(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// A topic/chat title maps to the dashboard project whose full name (first + last) it contains;
// failing that, to the only project whose surname stem appears in it ("Агешина / Cantor",
// "Чат с Агешиной").
function botMatchProject(title, projects) {
  const t = ` ${botNorm(title)} `;
  let best = null;
  for (const p of projects) {
    const words = botNorm(p.name).split(' ').filter((w) => w.length > 1);
    if (!words.length) continue;
    if (words.every((w) => t.includes(` ${w} `))) {
      if (!best || words.length > botNorm(best.name).split(' ').length) best = p;
    }
  }
  if (best) return best;
  const bySurname = projects.filter((p) => {
    const words = botNorm(p.name).split(' ');
    const surname = words[words.length - 1] || '';
    return surname.length > 3 && t.includes(` ${surname.slice(0, surname.length - 1)}`);
  });
  if (bySurname.length === 1) return bySurname[0];
  // A one-letter typo in the surname («Кисилева» / «Киселева») is the same client, not a new one —
  // as long as exactly one client fits.
  const titleWords = t.trim().split(' ').filter((w) => w.length >= 6);
  const typo = projects.filter((p) => {
    const words = botNorm(p.name).split(' ');
    const surname = words[words.length - 1] || '';
    return surname.length >= 6 && titleWords.some((w) => botEditDistance1(w, surname));
  });
  return typo.length === 1 ? typo[0] : null;
}
// True when a and b differ by exactly one letter replaced, added or removed.
function botEditDistance1(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
async function botProjects(kv) {
  return listByPrefix(kv, 'project:');
}
async function botGetChat(kv, chat) {
  const key = `bot:chat:${chat.id}`;
  let rec = await kv.get(key, 'json');
  const isForum = !!chat.is_forum;
  const title = chat.title || '';
  if (!rec || rec.title !== title || rec.isForum !== isForum) {
    const projects = await botProjects(kv);
    const project = isForum ? null : botMatchProject(title, projects);
    rec = {
      ...(rec || {}),
      id: chat.id,
      title,
      isForum,
      kind: isForum ? 'work' : 'client',
      projectId: rec && rec.projectLocked ? rec.projectId : project ? project.id : (rec && rec.projectId) || null,
      addedAt: (rec && rec.addedAt) || new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(rec));
  }
  return rec;
}
async function botGetTopic(kv, chatRec, threadId) {
  if (!chatRec.isForum) return { name: chatRec.title, projectId: chatRec.projectId };
  const key = `bot:topic:${chatRec.id}:${threadId}`;
  let rec = await kv.get(key, 'json');
  if (!rec) {
    const seeded = chatRec.title === 'Авито' ? BOT_SEED_TOPICS[threadId] : null;
    const name = String(threadId) === '0' ? 'Общий' : seeded || `Топик ${threadId}`;
    rec = await botSetTopicName(kv, chatRec.id, threadId, name);
  }
  return rec;
}
// With env (a real topic event, not a placeholder name): a topic named like a person that matches
// no dashboard client is a new client — it is added to the dashboard (and so to Avito Tasks) and
// the owner is told. /notclient undoes it for topics that aren't clients.
async function botSetTopicName(kv, chatId, threadId, name, env) {
  const key = `bot:topic:${chatId}:${threadId}`;
  const prev = (await kv.get(key, 'json')) || {};
  let project = prev.projectLocked ? null : botMatchProject(name, await botProjects(kv));
  if (!project && !prev.projectLocked && env && botLooksLikeClientName(name)) {
    project = await botCreateClient(env, name, `${chatId}:${threadId}`);
  }
  const rec = { name, projectId: prev.projectLocked ? prev.projectId : project ? project.id : null, projectLocked: !!prev.projectLocked };
  await kv.put(key, JSON.stringify(rec));
  return rec;
}

// ── clients: new work-chat topics become dashboard clients by themselves ──
const BOT_NOT_CLIENT_TOPICS = new Set(['общий', 'эдвайзеры', 'флуд', 'новости', 'важное', 'вопросы', 'оффтоп', 'задачи', 'отчеты', 'отчёты', 'команда', 'стажеры', 'стажёры']);
// "Елена Окунева", "Окунева Елена", "Наталина Сасс": two or three capitalised Cyrillic words.
function botLooksLikeClientName(name) {
  const words = String(name || '').trim().split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (words.some((w) => BOT_NOT_CLIENT_TOPICS.has(w.toLowerCase()))) return false;
  return words.every((w) => /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ]?[а-яё]+)?$/.test(w));
}
// Topics are sometimes "Фамилия Имя"; the dashboard uses "Имя Фамилия". Swapped only when the
// second word is a known first name ("Окунева Елена"), so "Наталина Сасс" stays as it is.
const BOT_FIRST_NAMES = new Set(('александр алексей анатолий андрей антон аркадий артём артем богдан борис вадим валентин валерий василий виктор виталий владимир владислав вячеслав геннадий георгий глеб григорий давид даниил денис дмитрий евгений егор иван игорь илья кирилл константин лев леонид максим марк матвей михаил никита николай олег павел пётр петр роман руслан сергей станислав степан тимур фёдор федор юрий ярослав айдар ринат рустам '
  + 'александра алина алиса алла альбина анастасия ангелина анна антонина арина валентина валерия вера вероника виктория галина гульнара дарья диана дина евгения екатерина елена елизавета жанна зарина злата зоя инна ирина карина кира кристина ксения лариса лилия любовь людмила маргарита марина мария милана надежда наталия наталья наталина нелли нина оксана олеся ольга полина раиса регина светлана софия софья таисия тамара татьяна ульяна эльвира эльмира юлия яна').split(' '));
function botClientDisplayName(name) {
  const words = String(name).trim().split(/\s+/);
  if (words.length === 2 && BOT_FIRST_NAMES.has(words[1].toLowerCase()) && !BOT_FIRST_NAMES.has(words[0].toLowerCase())) return `${words[1]} ${words[0]}`;
  return words.join(' ');
}
const BOT_TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function botSlug(name) {
  return String(name).toLowerCase().split('').map((c) => (c in BOT_TRANSLIT ? BOT_TRANSLIT[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `client-${Date.now().toString(36)}`;
}
// Same record shape as the dashboard's POST /api/dashboard/project.
async function botCreateClient(env, rawName, fromTopic, quiet) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const name = botClientDisplayName(rawName);
  const existing = botMatchProject(name, await botProjects(kv));
  if (existing) return existing;
  let id = botSlug(name);
  while (await kv.get(`project:${id}`)) id = `${botSlug(name)}-${Math.random().toString(36).slice(2, 5)}`;
  const now = new Date().toISOString();
  const project = {
    id, name, service: 'Продвижение на Авито', responsibleId: null, status: 'active', stage: '', currentWork: '', review: '',
    rowColor: '', avitoAccountId: null, inactive: false, ratings: { result: 0, communication: 0, quality: 0 },
    autoFromTopic: fromTopic || null, createdAt: now, updatedAt: now,
  };
  await kv.put(`project:${id}`, JSON.stringify(project));
  await atTouch(kv, ['#projects']);
  if (!quiet) {
    await botNotifyOwner(env, `🆕 <b>Новый клиент: ${escapeHtml(name)}</b>\nВ рабочем чате появился топик «${escapeHtml(rawName)}» — добавил клиента в дашборд и Avito Tasks, задачи из топика привязываются к нему.`
      + `\nЕсли это не клиент: /notclient ${escapeHtml(fromTopic || '')}`);
  }
  return project;
}
// Topics without a client get matched again (e.g. after a client was added in the dashboard), and
// bot tasks from those topics get the client. With create, person-named topics become clients.
async function botRelinkClients(env, { create } = {}) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const created = [];
  const linked = {}; // "chatId:threadId" -> projectId
  for (const chat of (await listByPrefix(kv, 'bot:chat:')).filter((c) => c.isForum)) {
    for (const k of (await kv.list({ prefix: `bot:topic:${chat.id}:` })).keys) {
      const rec = await kv.get(k.name, 'json');
      const thread = k.name.split(':').pop();
      if (!rec) continue;
      if (!rec.projectId && !rec.projectLocked) {
        let project = botMatchProject(rec.name, await botProjects(kv));
        if (!project && create && botLooksLikeClientName(rec.name)) {
          project = await botCreateClient(env, rec.name, `${chat.id}:${thread}`, true);
          created.push(project.name);
        }
        if (project) {
          rec.projectId = project.id;
          await kv.put(k.name, JSON.stringify(rec));
        }
      }
      if (rec.projectId) linked[`${chat.id}:${thread}`] = rec.projectId;
    }
  }
  for (const chat of (await listByPrefix(kv, 'bot:chat:')).filter((c) => !c.isForum)) {
    if (!chat.projectId && !chat.projectLocked) {
      const project = botMatchProject(chat.title, await botProjects(kv));
      if (project) {
        chat.projectId = project.id;
        await kv.put(`bot:chat:${chat.id}`, JSON.stringify(chat));
      }
    }
    if (chat.projectId) linked[`${chat.id}:0`] = chat.projectId;
  }
  const touched = [];
  for (const t of await botAllTasks(kv)) {
    const pid = !t.projectId && t.chatId != null && linked[`${t.chatId}:${t.threadId || 0}`];
    if (!pid) continue;
    t.projectId = pid;
    await kv.put(`task:${t.id}`, JSON.stringify(t));
    touched.push(t.id);
  }
  if (touched.length) await atTouch(kv, touched);
  return { created, tasks: touched.length };
}
// ── A client created twice (a typo in a chat title) → one client ──
// Moves everything of `fromId` to `toId` — tasks, work-chat topics and client chats (locked to it), who
// leads it («Клиенты → Настройки»), the client board note, mailings, reflection answers, daily and monthly
// metrics, the Avito cabinet and the finance dashboard's client — then reactivates `toId` and deletes
// `fromId`. What `toId` already has wins.
async function atMergeProjects(env, fromId, toId) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const [from, to] = await Promise.all([kv.get(`project:${fromId}`, 'json'), kv.get(`project:${toId}`, 'json')]);
  if (!from || !to) return { skipped: true };
  const done = { tasks: 0, links: 0 };
  const touched = [];
  for (const t of await listByPrefix(kv, 'task:')) {
    if (t.projectId !== fromId) continue;
    t.projectId = toId;
    await kv.put(`task:${t.id}`, JSON.stringify(t));
    if (AT_MEM && AT_MEM.tasks && AT_MEM.tasks.has(t.id)) AT_MEM.tasks.set(t.id, t);
    touched.push(t.id);
  }
  done.tasks = touched.length;
  for (const prefix of ['bot:topic:', 'bot:chat:']) {
    for (const k of (await kv.list({ prefix })).keys) {
      const rec = await kv.get(k.name, 'json');
      if (!rec || rec.projectId !== fromId) continue;
      await kv.put(k.name, JSON.stringify({ ...rec, projectId: toId, projectLocked: true }));
      done.links += 1;
    }
  }
  const owners = await kv.get('at:owners', 'json');
  if (owners && owners[fromId]) {
    if (!owners[toId]) owners[toId] = owners[fromId];
    delete owners[fromId];
    await kv.put('at:owners', JSON.stringify(owners));
  }
  const board = await kv.get('at:clients', 'json');
  if (board && board[fromId]) {
    if (!board[toId] || String(board[fromId].lastUpdateAt || '') > String(board[toId].lastUpdateAt || '')) board[toId] = { ...board[toId], ...board[fromId] };
    delete board[fromId];
    await kv.put('at:clients', JSON.stringify(board));
  }
  for (const k of (await kv.list({ prefix: 'mail:' })).keys) {
    const rec = await kv.get(k.name, 'json');
    if (!rec || !(rec.items || []).some((x) => x.projectId === fromId)) continue;
    rec.items = rec.items.map((x) => (x.projectId === fromId ? { ...x, projectId: toId } : x));
    await kv.put(k.name, JSON.stringify(rec));
  }
  for (const k of (await kv.list({ prefix: 'refl:' })).keys) {
    const rec = await kv.get(k.name, 'json');
    if (!rec || !rec.answers || !rec.answers[fromId]) continue;
    if (!rec.answers[toId]) rec.answers[toId] = rec.answers[fromId];
    delete rec.answers[fromId];
    await kv.put(k.name, JSON.stringify(rec), { expirationTtl: REFL_TTL });
  }
  for (const prefix of ['dailyMetrics', 'analytics']) {
    for (const k of (await kv.list({ prefix: `${prefix}:${fromId}:` })).keys) {
      const dest = `${prefix}:${toId}:${k.name.slice(`${prefix}:${fromId}:`.length)}`;
      if (!(await kv.get(dest))) {
        const rec = await kv.get(k.name, 'json');
        if (rec) await kv.put(dest, JSON.stringify({ ...rec, projectId: toId }));
      }
      await kv.delete(k.name);
    }
  }
  const fin = await kv.get('fin:data', 'json');
  if (fin && Array.isArray(fin.clients) && fin.clients.some((c) => c.pid === fromId)) {
    const keep = fin.clients.find((c) => c.pid === toId);
    fin.clients = fin.clients.filter((c) => {
      if (c.pid !== fromId) return true;
      if (!keep) { c.pid = toId; return true; }
      keep.alias = [...new Set([...(keep.alias || []), fromId, ...(c.alias || [])])];
      if (c.pays && Object.keys(c.pays).length) keep.pays = { ...c.pays, ...(keep.pays || {}) };
      return false;
    });
    fin.rev = Number(fin.rev || 0) + 1;
    fin.savedAt = new Date().toISOString();
    await kv.put('fin:data', JSON.stringify(fin));
  }
  const now = new Date().toISOString();
  await kv.put(`project:${toId}`, JSON.stringify({
    ...to, inactive: false, rowColor: to.rowColor === 'gray' ? '' : to.rowColor || '',
    avitoAccountId: to.avitoAccountId || from.avitoAccountId || null,
    profileUrl: to.profileUrl || from.profileUrl || null, briefUrl: to.briefUrl || from.briefUrl || null, staffUrl: to.staffUrl || from.staffUrl || null,
    updatedAt: now,
  }));
  await kv.delete(`project:${fromId}`);
  await atTouch(kv, ['#projects', '#clients', ...touched]);
  return done;
}
// One-time merges of clients created twice: [the duplicate, the client to keep].
const PROJECT_MERGES = [
  ['elena-kisileva', 'elena-kiseleva'], // 26.10.2026: the work-chat topic «Кисилева Елена» had a typo
];
async function atRunProjectMerges(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  for (const [fromId, toId] of PROJECT_MERGES) {
    const flag = `projmerge:${fromId}`;
    if (await kv.get(flag)) continue;
    const res = await atMergeProjects(env, fromId, toId);
    await kv.put(flag, JSON.stringify({ at: new Date().toISOString(), toId, ...res }));
  }
}

// One-time (2026-09-30): the clients whose topics were already in the work chat but not in the dashboard.
const CLIENTS_SEED_V2 = [
  ['natalina-sass', 'Наталина Сасс'], ['elena-okuneva', 'Елена Окунева'], ['natalya-valiullova', 'Наталья Валиуллова'],
  ['gulnara-lyutova', 'Гульнара Лютова'], ['nataliya-popova', 'Наталия Попова'], ['olga-klimovich', 'Ольга Климович'],
  ['tatyana-verkhoturova', 'Татьяна Верхотурова'],
];
async function ensureClientsSeedV2(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (await kv.get('clientsSeedV2')) return;
  await kv.put('clientsSeedV2', '1');
  const now = new Date().toISOString();
  const projects = await botProjects(kv);
  const added = [];
  for (const [id, name] of CLIENTS_SEED_V2) {
    if (botMatchProject(name, projects) || (await kv.get(`project:${id}`))) continue;
    await kv.put(`project:${id}`, JSON.stringify({
      id, name, service: 'Продвижение на Авито', responsibleId: null, status: 'active', stage: '', currentWork: '', review: '',
      rowColor: '', avitoAccountId: null, inactive: false, ratings: { result: 0, communication: 0, quality: 0 }, createdAt: now, updatedAt: now,
    }));
    added.push(name);
  }
  if (added.length) await atTouch(kv, ['#projects']);
  const res = await botRelinkClients(env);
  if (added.length && env.CONTROL_BOT_TOKEN) {
    await botNotifyOwner(env, `🆕 <b>Добавил клиентов: ${added.length}</b>\n${added.map((n) => `• ${escapeHtml(n)}`).join('\n')}\n`
      + `Они в дашборде и Avito Tasks, топики рабочего чата привязаны${res.tasks ? `, задач из их топиков: ${res.tasks}` : ''}.`
      + '\n\nДальше новые клиенты добавляются сами: создали в рабочем чате топик с именем клиента — он сразу появится в дашборде и Avito Tasks.');
  }
}

// ── message log ──
function botMessageText(msg) {
  let text = msg.text || msg.caption || '';
  const media = msg.photo ? '[фото]' : msg.video ? '[видео]' : msg.voice ? '[голосовое]' : msg.video_note ? '[кружок]'
    : msg.document ? `[файл ${msg.document.file_name || ''}]` : msg.sticker ? `[стикер ${msg.sticker.emoji || ''}]` : '';
  if (media) text = text ? `${media} ${text}` : media;
  return text;
}
function botUserName(user) {
  if (!user) return '?';
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id);
}
async function botAppendLog(kv, chatId, threadId, entry, dateMs) {
  const key = `bot:log:${chatId}:${threadId}:${botMsk(dateMs).date}`;
  const list = (await kv.get(key, 'json')) || [];
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry }; else list.push(entry);
  await kv.put(key, JSON.stringify(list), { expirationTtl: BOT_LOG_TTL });
}
async function botReadLogs(kv, chatId, threadId, fromMs, toMs) {
  const out = [];
  for (let day = botMskStartOfDay(fromMs); day <= toMs; day += 24 * 3600000) {
    const list = await kv.get(`bot:log:${chatId}:${threadId}:${botMsk(day).date}`, 'json');
    if (list) out.push(...list);
  }
  // Imported history. Its ids are the exporting account's, not the bot's (in a basic group every
  // account numbers messages its own way), so a message the bot also saw live is matched on its
  // timestamp, and the live copy wins.
  const hist = await kv.get(`bot:hist:${chatId}:${threadId}`, 'json');
  if (hist) {
    const seen = new Set(out.map((e) => e.t));
    out.push(...hist.filter((e) => !seen.has(e.t)));
  }
  return out.filter((e) => e.t >= fromMs && e.t <= toMs).sort((a, b) => a.t - b.t);
}

// ── webhook ──
async function handleBotWebhook(request, env) {
  const token = env.CONTROL_BOT_TOKEN;
  if (!token) return json({ ok: false }, 503);
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await botWebhookSecret(token)) {
    return json({ ok: false }, 403);
  }
  const update = await readJson(request);
  try {
    if (update && update.my_chat_member) await botOnMembership(env, update.my_chat_member);
    else if (update && update.callback_query) await atOnCallback(env, update.callback_query);
    else if (update && update.message) await botOnMessage(env, update.message, false);
    else if (update && update.edited_message) await botOnMessage(env, update.edited_message, true);
    else if (update && update.message_reaction) await botOnReaction(env, update.message_reaction);
  } catch (err) {
    console.error('control bot update failed', err && err.stack);
  }
  return json({ ok: true }); // always 200, so Telegram doesn't redeliver the same update forever
}

async function botOnMembership(env, upd) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const chat = upd.chat;
  if (!chat || chat.type === 'private') return;
  const status = upd.new_chat_member && upd.new_chat_member.status;
  const title = escapeHtml(chat.title || chat.id);
  if (status === 'left' || status === 'kicked') {
    // The bot leaving on its own (stranger's chat, below) needs no second message.
    if (upd.from && upd.from.is_bot) return;
    await botNotifyOwner(env, `ℹ️ Бота убрали из чата «${title}» (${escapeHtml(botUserName(upd.from))}).`);
    return;
  }
  if (!(await botMayAddBot(env, upd.from)) && !(await kv.get(`bot:chat:${chat.id}`))) {
    await botApi(env, 'leaveChat', { chat_id: chat.id });
    await botNotifyOwner(env, `⚠️ ${escapeHtml(botUserName(upd.from))} добавил(а) бота в «${title}». Бот вышел: этого человека нет в команде `
      + '(добавлять бота могут владелец, сотрудники из Avito Tasks с подключённым Telegram и те, кто пишет в рабочем чате).');
    return;
  }
  const rec = await botGetChat(kv, chat);
  const adminHint = status === 'administrator' ? '' : '\nЛучше сделать бота администратором группы: без этого Telegram может не показывать ему часть сообщений и не показывает реакции.';
  const projectName = rec.projectId ? ((await kv.get(`project:${rec.projectId}`, 'json')) || {}).name || rec.projectId : null;
  const by = botIsOwner(env, upd.from && upd.from.id) ? '' : ` Добавил(а): ${escapeHtml(botUserName(upd.from))}.`;
  const kindText = rec.kind === 'work' ? 'рабочий чат (топики = клиенты)' : `чат клиента${projectName ? ` → ${escapeHtml(projectName)}` : ' (клиент не определён — см. /topics)'}`;
  await botNotifyOwner(env, `✅ Бот подключён к «${title}»: ${kindText}.${by}${adminHint}`);
}
// Who may add the bot to a new group: the owner, people in Avito Tasks who connected their Telegram,
// and anyone who writes in the work chat (the bot keeps them as bot:member:<id>). Anyone else's
// chat the bot leaves at once, so it can't be pulled into strangers' groups.
async function botMayAddBot(env, from) {
  if (!from) return false;
  if (botIsOwner(env, from.id)) return true;
  if (await env.AGENCY_DASHBOARD_KV.get(`bot:member:${from.id}`)) return true;
  const team = await atGetTeam(env);
  return team.users.some((u) => u.active && u.tgId && String(u.tgId) === String(from.id));
}

// «Сделано» tasks that our message in the client's chat reports: the task was done (a person marked
// it), and now someone from the team wrote to the client about it — its words are in the message
// (at least half of the task's word stems, two or more). Then «клиенту сообщили» is a fact, not a
// guess: the task closes, with the message in its history. No AI involved.
async function botCloseReported(env, chatRec, text, t, from) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const msgStems = botTaskStems(text);
  if (msgStems.size < 2) return 0;
  const mem = await atSnapshot(env);
  let closed = 0;
  for (const m of mem.tasks.values()) {
    if (m.status !== 'done' || m.projectId !== chatRec.projectId || !m.doneAt || Date.parse(m.doneAt) > t) continue;
    const stems = botTaskStems(m.text);
    const common = [...stems].filter((x) => msgStems.has(x)).length;
    if (common < Math.min(2, stems.size) || common / stems.size < 0.5) continue;
    const task = await kv.get(`task:${m.id}`, 'json');
    if (!task || task.status !== 'done') continue;
    const nowIso = new Date(t).toISOString();
    Object.assign(task, { status: 'closed', informedAt: nowIso, updatedAt: nowIso, updatedBy: from });
    delete task.hint;
    task.activity = [...(Array.isArray(task.activity) ? task.activity : []), { t: Date.now(), by: 'Бот', what: `клиенту сообщили в чате (${from}): «${String(text).slice(0, 160)}»` }].slice(-20);
    await kv.put(`task:${task.id}`, JSON.stringify(task));
    if (AT_MEM && AT_MEM.tasks) AT_MEM.tasks.set(task.id, task);
    await atTouch(kv, [task.id]);
    closed += 1;
  }
  return closed;
}
async function botOnMessage(env, msg, edited) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const chat = msg.chat;
  if (!chat) return;

  if (chat.type === 'private') {
    if (edited) return;
    // «Подключить Telegram» in Avito Tasks: /start at_<userId>_<code>
    const start = String(msg.text || '').match(/^\/start\s+(\S+)/);
    if (start && (await atLinkTelegram(env, msg, start[1]))) return;
    if (botIsOwner(env, msg.from && msg.from.id)) return botOnOwnerMessage(env, msg);
    const member = (await atGetTeam(env)).users.find((u) => u.active && u.tgId && String(u.tgId) === String(msg.from && msg.from.id));
    if (member) return atOnMemberMessage(env, msg, member);
    await botApi(env, 'sendMessage', { chat_id: chat.id, text: BOT_STRANGER_REPLY });
    if (await botOnce(kv, `stranger:${msg.from && msg.from.id}`, 60 * 60 * 24)) {
      const who = msg.from && msg.from.username ? ` (@${escapeHtml(msg.from.username)})` : '';
      await botNotifyOwner(env, `👀 ${escapeHtml(botUserName(msg.from))}${who} открыл(а) бота и написал(а): «${escapeHtml(botMessageText(msg).slice(0, 200))}». Ответил стандартной отбивкой.`, { disable_notification: true });
    }
    return;
  }
  if (chat.type !== 'group' && chat.type !== 'supergroup') return;

  const chatRec = await botGetChat(kv, chat);
  const threadId = chatRec.isForum ? (msg.is_topic_message && msg.message_thread_id) || 0 : 0;

  if (msg.forum_topic_created) {
    await botSetTopicName(kv, chat.id, msg.message_thread_id || msg.message_id, msg.forum_topic_created.name, env);
    return;
  }
  if (msg.forum_topic_edited && msg.forum_topic_edited.name) {
    await botSetTopicName(kv, chat.id, msg.message_thread_id || threadId, msg.forum_topic_edited.name, env);
    return;
  }
  // Learn a topic's name from the topic root a message replies to.
  const root = msg.reply_to_message && msg.reply_to_message.forum_topic_created;
  if (root && threadId) {
    const known = await kv.get(`bot:topic:${chat.id}:${threadId}`, 'json');
    if (!known || known.name !== root.name) await botSetTopicName(kv, chat.id, threadId, root.name, env);
  }

  if (!msg.from || msg.from.is_bot) return;
  const text = botMessageText(msg);
  if (!text) return;

  const fromId = msg.from.id;
  const isTeam = chatRec.kind === 'work' || botIsOwner(env, fromId) || !!(await kv.get(`bot:member:${fromId}`));
  // KV writes are the scarce resource on the free plan, so every "flag" below is read first.
  if (chatRec.kind === 'work' && !edited && !(await kv.get(`bot:member:${fromId}`))) {
    await kv.put(`bot:member:${fromId}`, JSON.stringify({ id: fromId, name: botUserName(msg.from), seenAt: new Date().toISOString() }));
  }

  const t = msg.date * 1000;
  const replyTo = msg.reply_to_message && !msg.reply_to_message.forum_topic_created ? msg.reply_to_message.message_id : null;
  await botAppendLog(kv, chat.id, threadId, {
    id: msg.message_id, t, from: botUserName(msg.from), fromId, team: isTeam, text: botRedactSecrets(text).slice(0, 4000), reply: replyTo, edited: edited || undefined,
  }, t);
  const dirtyKey = `bot:dirty:${chat.id}:${threadId}`;
  if (!edited && !(await kv.get(dirtyKey))) await kv.put(dirtyKey, '1');
  if (isTeam) await botSaveStaffLink(env, chatRec, threadId, text);
  if (chatRec.kind === 'work' && !edited) {
    try { await botTrackQuestions(env, chatRec, threadId, msg, text, t, replyTo); } catch (err) { console.error('question tracking failed', err && err.message); }
  }

  if (chatRec.kind === 'client' && !edited) {
    const pendingKey = `bot:pending:${chat.id}`;
    let signalChanged = false; // Avito Tasks' Clients tab re-reads these on a change-log bump
    if (isTeam) {
      if (await kv.get(pendingKey)) { await kv.delete(pendingKey); signalChanged = true; }
      if (chatRec.projectId) {
        // "When did we last write to this client" — at most one write an hour per client.
        const clients = (await kv.get('at:clients', 'json')) || {};
        const rec = clients[chatRec.projectId] || {};
        if (t - (Date.parse(rec.lastTeamAt || 0) || 0) > 3600000) {
          clients[chatRec.projectId] = { ...rec, lastTeamAt: new Date(t).toISOString() };
          await kv.put('at:clients', JSON.stringify(clients));
          signalChanged = true;
        }
      }
      if (chatRec.projectId) {
        try { await botCloseReported(env, chatRec, text, t, botUserName(msg.from)); } catch (err) { console.error('close reported failed', err && err.message); }
      }
      const { date, hh } = botMsk(t);
      const reportKey = `bot:report:${chat.id}:${date}`;
      if (hh < 13 && /отч[её]т|бюджет[\s\S]*контакт/i.test(text) && !(await kv.get(reportKey))) {
        await kv.put(reportKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });
      }
    } else if (!botIsAckText(text) && !(await kv.get(pendingKey))) {
      await kv.put(pendingKey, JSON.stringify({ since: t, msgId: msg.message_id, text: text.slice(0, 300) }));
      signalChanged = true;
    }
    if (signalChanged) await atTouch(kv, ['#clients']);
  }
}

// ── Questions in the work chat nobody answered ──
// A question in the work chat («@oleg рассылку согласовываем с клиентом? или сами решаем?») is not a task:
// it waits in bot:questions until someone answers — a reply to it, a message from the person it tags,
// or, when nobody is tagged, anyone else's message in that topic. After 3 working hours without an
// answer the person asked (the tagged ones; nobody tagged — the owner) gets one message with a link
// straight to it in the chat. A question that asks someone to do something («можешь поправить фото?»)
// is a task instead (BOT_REQUEST_RE) and isn't tracked here.
//   bot:questions -> [{ chatId, threadId, msgId, t, from, fromId, text, tags: [tg usernames] }]  (3 days at most)
const BOT_QUESTION_WMIN = 180;
async function botTrackQuestions(env, chatRec, threadId, msg, text, t, replyTo) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const fromId = String(msg.from.id);
  const fromTag = msg.from.username ? String(msg.from.username).toLowerCase() : null;
  const tags = [...String(text).matchAll(/@([A-Za-z0-9_]{4,})/g)].map((m) => m[1].toLowerCase());
  const isQuestion = /\?/.test(text) && String(text).replace(/@\w+/g, '').trim().length >= 8 && !botIsAckText(text) && !BOT_REQUEST_RE.test(text);
  const list = (await kv.get('bot:questions', 'json')) || [];
  const left = list.filter((q) => {
    if (t - q.t > 3 * 24 * 3600000) return false;
    if (String(q.chatId) !== String(chatRec.id) || Number(q.threadId) !== Number(threadId) || String(q.fromId) === fromId) return true;
    if (replyTo && Number(replyTo) === Number(q.msgId)) return false;
    return q.tags.length ? !(fromTag && q.tags.includes(fromTag)) : false;
  });
  if (isQuestion) left.push({ chatId: chatRec.id, threadId: Number(threadId), msgId: msg.message_id, t, from: botUserName(msg.from), fromId, text: String(text).slice(0, 300), tags });
  if (left.length !== list.length || isQuestion) await kv.put('bot:questions', JSON.stringify(left.slice(-100)));
}
async function botQuestionsCron(env, team, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const list = (await kv.get('bot:questions', 'json')) || [];
  const due = list.filter((q) => botWorkingMinutes(q.t, nowMs) >= BOT_QUESTION_WMIN);
  if (!due.length) return;
  await kv.put('bot:questions', JSON.stringify(list.filter((q) => !due.includes(q))));
  for (const q of due) {
    const chat = await kv.get(`bot:chat:${q.chatId}`, 'json');
    const topic = q.threadId ? await kv.get(`bot:topic:${q.chatId}:${q.threadId}`, 'json') : null;
    const link = botMessageLink(q.chatId, chat && chat.isForum ? q.threadId : null, q.msgId);
    const asked = team.users.filter((u) => u.active && u.tgId && u.tgUsername && q.tags.includes(String(u.tgUsername).toLowerCase()) && String(u.tgId) !== String(q.fromId));
    const text = [
      `❓ <b>Вопрос без ответа 3 рабочих часа</b>${topic && topic.name ? ` · ${escapeHtml(topic.name)}` : chat && chat.title ? ` · ${escapeHtml(chat.title)}` : ''}`,
      `${escapeHtml(q.from)}, ${botFmtDate(q.t)}: «${escapeHtml(q.text)}»`,
    ].join('\n');
    const extra = link ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть сообщение', url: link }]] } } : {};
    if (asked.length) for (const u of asked) await botSend(env, u.tgId, text, extra);
    else await botNotifyOwner(env, text, extra);
  }
}

// ── reactions ──
// A reaction from the team counts as an answer: on a client's message in the client chat it settles
// "the client is waiting", and on the message a task was found in it marks the task taken — 👍 👌 🫡 ✍
// 👨‍💻 🤝 👀 ⚡ (by the person who reacted, if nobody had it). Done is never set from a reaction: only a
// person marks a task done. The reaction is also
// put on the logged message, so the AI sees it alongside the text. Telegram only sends reactions to
// a bot that is an administrator of the group.
const BOT_REACT_TAKEN = new Set(['👍', '👌', '🫡', '✍', '✍️', '👨‍💻', '🤝', '👀', '⚡']);

function botReactionEmojis(list) {
  return (Array.isArray(list) ? list : []).map((r) => (r && r.type === 'emoji' ? r.emoji : r && r.type === 'custom_emoji' ? '★' : r && r.type === 'paid' ? '⭐' : null)).filter(Boolean);
}

async function botOnReaction(env, upd) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const chat = upd.chat;
  const user = upd.user;
  if (!chat || !user || user.is_bot) return;
  const was = new Set(botReactionEmojis(upd.old_reaction));
  const added = botReactionEmojis(upd.new_reaction).filter((e) => !was.has(e));
  if (!added.length) return; // a reaction taken back changes nothing
  const chatRec = await kv.get(`bot:chat:${chat.id}`, 'json');
  if (!chatRec) return;
  const msgId = Number(upd.message_id);
  const t = (Number(upd.date) || Math.floor(Date.now() / 1000)) * 1000;
  const isTeam = chatRec.kind === 'work' || botIsOwner(env, user.id) || !!(await kv.get(`bot:member:${user.id}`));
  const team = await atGetTeam(env);
  const reactor = team.users.find((u) => u.active && u.tgId && String(u.tgId) === String(user.id))
    || atMatchUser(botUserName(user), team.users.filter((u) => u.active)) || null;

  // The work-chat message a task was found in. (In the client chat a reaction from the manager only
  // acknowledges the client — the request still has to reach the specialists.)
  let task = null;
  if (isTeam && chatRec.kind === 'work') {
    const mem = await atSnapshot(env);
    const hit = [...mem.tasks.values()].find((x) => String(x.chatId) === String(chat.id) && Number(x.msgId) === msgId && (x.status === 'open' || x.status === 'done'));
    if (hit) task = await kv.get(`task:${hit.id}`, 'json');
  }
  const threadId = chatRec.isForum ? (task ? Number(task.threadId) || 0 : null) : 0;

  // Put the reaction on the logged message (client chats always; work-chat topics when a task says which).
  if (threadId != null) {
    for (let i = 0; i < 3; i += 1) {
      const key = `bot:log:${chat.id}:${threadId}:${botMsk(t - i * 24 * 3600000).date}`;
      const list = await kv.get(key, 'json');
      const entry = list && list.find((e) => e.id === msgId);
      if (!entry) continue;
      entry.reactions = [...(Array.isArray(entry.reactions) ? entry.reactions : []), ...added.map((e) => ({ by: botUserName(user), team: isTeam, e, t }))].slice(-12);
      await kv.put(key, JSON.stringify(list), { expirationTtl: BOT_LOG_TTL });
      break;
    }
  }
  if (!isTeam) return;

  const touched = [];
  // Client chat: the team reacting to the client's waiting message (or anything after it) is an answer.
  if (chatRec.kind === 'client') {
    const pendingKey = `bot:pending:${chat.id}`;
    const p = await kv.get(pendingKey, 'json');
    if (p && msgId >= Number(p.msgId)) {
      await kv.delete(pendingKey);
      if (AT_MEM && AT_MEM.pending) delete AT_MEM.pending[String(chat.id)];
      touched.push('#clients');
    }
  }
  // The client manager's 👍 in the work chat means «увидела», not «беру»: it neither takes the
  // task nor puts it on her.
  if (task && reactor && reactor.role !== 'manager') {
    const taken = added.some((e) => BOT_REACT_TAKEN.has(e));
    const what = [];
    const nowIso = new Date(t).toISOString();
    const prevAssignee = atAssigneeId(task, team.users);
    if (taken && !prevAssignee && reactor && reactor.role !== 'owner' && reactor.role !== 'assistant') {
      Object.assign(task, { assigneeId: reactor.id, owner: reactor.name });
      what.push(`исполнитель → ${atFirstName(reactor.name)}`);
    }
    if (task.status === 'open' && taken && !task.takenAt) {
      task.takenAt = nowIso;
      what.push('взяли в работу');
    }
    if (what.length) {
      task.updatedAt = nowIso;
      task.updatedBy = botUserName(user);
      task.activity = [...(Array.isArray(task.activity) ? task.activity : []), { t: Date.now(), by: botUserName(user), what: `реакция ${added.join('')} в чате: ${what.join(', ')}` }].slice(-20);
      await kv.put(`task:${task.id}`, JSON.stringify(task));
      if (AT_MEM && AT_MEM.tasks) AT_MEM.tasks.set(task.id, task);
      touched.push(task.id);
    }
  }
  if (touched.length) await atTouch(kv, touched);
}

// ── owner's private chat ──
async function botOnOwnerMessage(env, msg) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const text = String(msg.text || '').trim();
  const reply = (body) => botSend(env, msg.chat.id, body);
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.startsWith('/') ? cmdRaw.slice(1).split('@')[0].toLowerCase() : null;

  if (cmd === 'start' || cmd === 'help') {
    return reply([
      '<b>Помощник Cantor Agency</b>',
      'Я молча читаю рабочий чат (и чаты клиентов, куда меня добавят), сам нахожу задачи, сроки и выполнение и пишу только вам.',
      '',
      '/summary — просрочено, без срока, сделано но не сообщили клиенту',
      '/my — мои задачи в Avito Tasks · /access — ссылки доступа для команды',
      '/activity — кто когда работал сегодня (трекер, чаты, задачи)',
      '/tasks — открытые задачи по клиентам (/tasks Агешина — только один клиент)',
      '/overdue — просроченные',
      '/metrics — проверка метрик из дашборда',
      '/errors Добрынина — файл ошибок автозагрузки Авито (или просто «дай файл ошибок Добрыниной»)',
      '/topics — какие чаты и топики к каким клиентам привязаны',
      '/ai — статус ИИ и очереди',
      '/done &lt;id&gt; · /informed &lt;id&gt; · /cancel &lt;id&gt; — поправить задачу вручную',
      '/map &lt;чат:топик&gt; &lt;id клиента&gt; — привязать топик или чат к клиенту',
      '/notclient &lt;чат:топик&gt; — топик не клиент (бот сам заводит клиента на каждый новый топик с именем человека)',
      '',
      'Любой другой текст — вопрос по переписке, например: «что мы обещали Агешиной на этой неделе?»',
    ].join('\n'));
  }
  if (cmd === 'summary') return reply(await botBuildSummary(env, Date.now()));
  if (cmd === 'my') {
    const me = (await atGetTeam(env)).users.find((u) => u.role === 'owner');
    return me ? reply(await atBuildMyTasks(env, me)) : reply('В Avito Tasks нет руководителя.');
  }
  if (cmd === 'access') return reply(atAccessMessage(await atGetTeam(env), false));
  if (cmd === 'activity') return reply(await atActivityText(env));
  if (cmd === 'tasks') return reply(await botBuildTaskList(env, 'open', args.join(' ')));
  if (cmd === 'overdue') return reply(await botBuildTaskList(env, 'overdue'));
  if (cmd === 'metrics') return reply((await botBuildMetricsReport(env, Date.now())) || 'По метрикам всё спокойно: данные за вчера внесены, аномалий нет.');
  if (cmd === 'topics') return reply(await botBuildTopicsList(env));
  if (cmd === 'ai') {
    const state = (await kv.get('bot:ai', 'json')) || {};
    const queue = await kv.list({ prefix: 'bot:dirty:' });
    return reply(`ИИ: ${state.limited ? '🔴 лимит исчерпан с ' + botFmtDate(state.since) : '🟢 работает'}\nМодель: ${escapeHtml(env.CONTROL_BOT_AI_MODEL || BOT_AI_MODEL_DEFAULT)}\nТопиков/чатов с неразобранными сообщениями: ${queue.keys.length}`);
  }
  if (cmd === 'done' || cmd === 'informed' || cmd === 'cancel') {
    const task = args[0] && (await kv.get(`task:${args[0]}`, 'json'));
    if (!task) return reply('Не нашёл задачу с таким id. Id есть в /tasks.');
    const now = new Date().toISOString();
    if (cmd === 'done') Object.assign(task, { status: 'done', doneAt: task.doneAt || now });
    if (cmd === 'informed') Object.assign(task, { status: 'closed', doneAt: task.doneAt || now, informedAt: now });
    if (cmd === 'cancel') task.status = 'cancelled';
    task.updatedAt = now;
    await kv.put(`task:${task.id}`, JSON.stringify(task));
    await atTouch(kv, [task.id]);
    return reply(`Готово: «${escapeHtml(task.text)}» → ${botStatusLabel(task)}.`);
  }
  if (cmd === 'map') {
    const [target, projectId] = args;
    const m = String(target || '').match(/^(-?\d+)(?::(\d+))?$/);
    if (!m || !projectId) return reply('Формат: /map &lt;чат:топик&gt; &lt;id клиента&gt; — оба значения есть в /topics.');
    if (!(await kv.get(`project:${projectId}`))) return reply(`В дашборде нет клиента с id ${escapeHtml(projectId)}.`);
    if (m[2]) {
      const key = `bot:topic:${m[1]}:${m[2]}`;
      const rec = (await kv.get(key, 'json')) || { name: `Топик ${m[2]}` };
      await kv.put(key, JSON.stringify({ ...rec, projectId, projectLocked: true }));
    } else {
      const key = `bot:chat:${m[1]}`;
      const rec = await kv.get(key, 'json');
      if (!rec) return reply('Такого чата бот не знает.');
      await kv.put(key, JSON.stringify({ ...rec, projectId, projectLocked: true }));
    }
    const res = await botRelinkClients(env);
    return reply(`Привязал ${escapeHtml(target)} → ${escapeHtml(projectId)}.${res.tasks ? ` Задач из него: ${res.tasks}.` : ''}`);
  }
  // A topic the bot took for a new client but which isn't one ("Эдвайзеры"-like): unlink it for good
  // and remove the client it created.
  if (cmd === 'notclient') {
    const m = String(args[0] || '').match(/^(-?\d+):(\d+)$/);
    if (!m) return reply('Формат: /notclient &lt;чат:топик&gt; — значение есть в /topics.');
    const key = `bot:topic:${m[1]}:${m[2]}`;
    const rec = (await kv.get(key, 'json')) || { name: `Топик ${m[2]}` };
    const project = rec.projectId && (await kv.get(`project:${rec.projectId}`, 'json'));
    await kv.put(key, JSON.stringify({ ...rec, projectId: null, projectLocked: true }));
    let removed = '';
    if (project && project.autoFromTopic === `${m[1]}:${m[2]}`) {
      await kv.delete(`project:${project.id}`);
      await atTouch(kv, ['#projects']);
      removed = ` Клиента «${escapeHtml(project.name)}», которого бот создал из этого топика, удалил.`;
    }
    return reply(`Топик «${escapeHtml(rec.name)}» больше не считается клиентом.${removed}`);
  }
  if (cmd === 'errors') return botSendAutoloadErrors(env, msg.chat.id, args.join(' '));
  if (cmd) return reply('Не знаю такой команды. /help — список.');
  if (!text) return;
  // «дай файл ошибок Добрыниной», «ошибки автозагрузки Верхотуровой»
  if (/ошиб|автозагруз|автовыгруз|выгрузк/i.test(text) && (await botFindAvitoAccounts(env, text)).length) {
    return botSendAutoloadErrors(env, msg.chat.id, text);
  }
  return reply(await botAnswerQuestion(env, text));
}

// ── autoload errors on request: /errors <client> or «дай файл ошибок Добрыниной» ──
// Matches a connected Avito cabinet by any word of its name (a stem, so «Добрыниной» finds
// «Елена Добрынина»), says it's working on it, then sends a summary and a CSV of the problem
// listings from the cabinet's last completed autoload report.
async function botFindAvitoAccounts(env, text) {
  const words = botNorm(text).split(' ').filter((w) => w.length >= 4);
  if (!words.length) return [];
  const hit = (part) => part.length >= 4 && words.some((w) => w.startsWith(part.slice(0, Math.max(4, part.length - 2))));
  // A surname hit (last word of the name) beats a first-name hit: «Елены Добрыниной» → Добрынина only.
  const scored = (await listByPrefix(env.AVITO_KV, 'account:')).map((a) => {
    const parts = botNorm(a.name).split(' ').filter(Boolean);
    const score = parts.length && hit(parts[parts.length - 1]) ? 2 : (parts.some(hit) ? 1 : 0);
    return { a, score };
  }).filter((x) => x.score);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.a);
}

async function botSendAutoloadErrors(env, chatId, query) {
  const reply = (body) => botSend(env, chatId, body);
  const found = await botFindAvitoAccounts(env, query);
  if (!found.length) {
    const all = (await listByPrefix(env.AVITO_KV, 'account:')).map((a) => a.name).sort();
    return reply(`Не нашёл кабинет Авито по «${escapeHtml(query || '')}». Подключены: ${escapeHtml(all.join(', '))}.`);
  }
  if (found.length > 1) return reply(`Подходит несколько кабинетов: ${escapeHtml(found.map((a) => a.name).join(', '))}. Уточните фамилию.`);
  const account = found[0];
  await reply(`⏳ Собираю отчёт автозагрузки по кабинету «${escapeHtml(account.name)}», подождите немного…`);
  let result;
  try {
    result = await fetchAvitoAutoloadReport(env, account, null);
  } catch (e) {
    return reply(`Не получилось получить отчёт автозагрузки «${escapeHtml(account.name)}»: ${escapeHtml(String(e && e.message).slice(0, 300))}`);
  }
  const s = result.summary;
  const lines = [`<b>Автозагрузка — ${escapeHtml(account.name)}</b>`];
  if (s.finishedAt) lines.push(`Отчёт ${escapeHtml(String(s.reportId))} от ${botFmtDate(Date.parse(s.finishedAt))}, всего объявлений: ${s.items}`);
  const stats = s.sectionStats && Array.isArray(s.sectionStats.sections) ? s.sectionStats.sections : [];
  stats.forEach((sec) => {
    const subs = (sec.sections || []).filter((x) => x.count).map((x) => `${x.title} ${x.count}`).join(', ');
    lines.push(`• ${escapeHtml(sec.title)}: <b>${sec.count}</b>${subs && (sec.sections || []).length > 1 ? ` (${escapeHtml(subs)})` : ''}`);
  });
  const problems = result.items.filter((it) => it.problem);
  if (!problems.length) {
    lines.push('', '✅ Ошибок нет — все объявления опубликованы.');
    return reply(lines.join('\n'));
  }
  const reasons = {};
  problems.forEach((it) => it.messages.filter((m) => m.type === 'error' || m.type === 'alarm').forEach((m) => {
    const short = m.text.split(/[.:]\s/)[0].slice(0, 120);
    reasons[short] = (reasons[short] || 0) + 1;
  }));
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) {
    lines.push('', '<b>Основные причины:</b>');
    top.forEach(([r, n]) => lines.push(`${n} — ${escapeHtml(r)}`));
  }
  await reply(lines.join('\n'));
  const date = s.finishedAt ? s.finishedAt.slice(0, 10) : 'last';
  const name = `Oshibki_avtozagruzki_${botTranslit(account.name)}_${date}.csv`;
  return botSendDocument(env, chatId, name, `\ufeff${autoloadCsv(problems)}`, `Проблемные объявления: ${problems.length}`);
}

function botTranslit(s) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return String(s || '').toLowerCase().split('').map((c) => (c in map ? map[c] : c)).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function botSendDocument(env, chatId, filename, content, caption, opts = {}) {
  const token = env.CONTROL_BOT_TOKEN;
  if (!token) return null;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (opts.threadId) form.append('message_thread_id', String(opts.threadId));
  if (caption) form.append('caption', caption);
  if (opts.parseMode) form.append('parse_mode', opts.parseMode);
  form.append('document', new Blob([content], { type: opts.type || 'text/csv' }), filename);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) console.error('control bot sendDocument failed', data && data.description);
    return data;
  } catch (err) {
    console.error('control bot sendDocument failed', String(err && err.message));
    return null;
  }
}

function botStatusLabel(task) {
  return { open: 'открыта', done: 'сделана, клиенту не сообщили', closed: 'закрыта', cancelled: 'отменена' }[task.status] || task.status;
}
// Tasks the bot found in chats plus the ones people add in Avito Tasks.
async function botAllTasks(kv) {
  return (await listByPrefix(kv, 'task:')).filter(atIsTrackerTask);
}
function botTaskClient(task, projectsById) {
  return task.projectId && projectsById[task.projectId] ? projectsById[task.projectId].name : task.topicName || 'без клиента';
}
function botTaskLine(task, projectsById, nowMs, withClient = true) {
  const due = botDueMs(task);
  const parts = [withClient ? `• <b>${escapeHtml(botTaskClient(task, projectsById))}</b>: ${escapeHtml(task.text)}` : `• ${escapeHtml(task.text)}`];
  if (task.owner) parts.push(`— ${escapeHtml(task.owner)}`);
  if (due) parts.push(due < nowMs ? `⏰ был срок ${botFmtDate(due)}` : `срок ${botFmtDate(due)}`);
  else parts.push('без срока');
  if (task.link) parts.push(`<a href="${escapeHtml(task.link)}">↗</a>`);
  parts.push(`<code>${escapeHtml(task.id)}</code>`);
  return parts.join(' ');
}
async function botProjectsById(kv) {
  const byId = {};
  for (const p of await botProjects(kv)) byId[p.id] = p;
  return byId;
}
async function botBuildTaskList(env, mode, clientFilter) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const now = Date.now();
  const byId = await botProjectsById(kv);
  let tasks = (await botAllTasks(kv)).filter((t) => t.status === 'open');
  // "/tasks Агешина" — one client (matched on a word stem, so declensions work too).
  const stem = botNorm(clientFilter).split(' ').filter((w) => w.length > 2).map((w) => w.slice(0, Math.max(3, w.length - 2)));
  if (stem.length) tasks = tasks.filter((t) => { const n = ` ${botNorm(botTaskClient(t, byId))}`; return stem.every((w) => n.includes(` ${w}`)); });
  if (mode === 'overdue') tasks = tasks.filter((t) => botDueMs(t) && botDueMs(t) < now);
  if (!tasks.length) return mode === 'overdue' ? 'Просроченных задач нет 👌' : 'Открытых задач нет.';
  // Grouped by client, most tasks first; within a client by deadline.
  const groups = new Map();
  for (const t of tasks) {
    const name = botTaskClient(t, byId);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(t);
  }
  const lines = [mode === 'overdue' ? `🔴 <b>Просрочено: ${tasks.length}</b>` : `📋 <b>Открытые задачи: ${tasks.length}</b>`];
  for (const [name, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    list.sort((a, b) => (botDueMs(a) || Infinity) - (botDueMs(b) || Infinity));
    lines.push('', `<b>${escapeHtml(name)}</b> (${list.length})`, ...list.map((t) => botTaskLine(t, byId, now, false)));
  }
  lines.push('', 'Закрыть: /done &lt;id&gt; · клиенту сообщили: /informed &lt;id&gt; · не нужна: /cancel &lt;id&gt;');
  return lines.join('\n');
}
async function botBuildTopicsList(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byId = await botProjectsById(kv);
  const chats = await listByPrefix(kv, 'bot:chat:');
  if (!chats.length) return 'Бот пока не добавлен ни в один чат.';
  const lines = [];
  for (const c of chats) {
    if (c.isForum) {
      lines.push(`<b>${escapeHtml(c.title)}</b> (рабочий чат, ${c.id})`);
      const topicKeys = await kv.list({ prefix: `bot:topic:${c.id}:` });
      for (const k of topicKeys.keys) {
        const rec = await kv.get(k.name, 'json');
        const thread = k.name.split(':').pop();
        lines.push(`  • ${escapeHtml(rec && rec.name)} → ${rec && rec.projectId ? escapeHtml((byId[rec.projectId] || {}).name || rec.projectId) : '❔ не привязан'} <code>${c.id}:${thread}</code>`);
      }
    } else {
      lines.push(`<b>${escapeHtml(c.title)}</b> → ${c.projectId ? escapeHtml((byId[c.projectId] || {}).name || c.projectId) : '❔ не привязан'} <code>${c.id}</code>`);
    }
  }
  lines.push('', 'Новый топик с именем клиента бот сам добавляет в дашборд и Avito Tasks. Не клиент — /notclient &lt;чат:топик&gt;.');
  lines.push('', 'Клиенты в дашборде: ' + Object.values(byId).map((p) => `${escapeHtml(p.name)} <code>${escapeHtml(p.id)}</code>`).join(', '));
  return lines.join('\n');
}

// ── Workers AI ──
function botIsLimitError(err) {
  const s = String((err && (err.message || err)) || '');
  return /neuron|allocation|quota|limit|exceeded|4006|capacity|429/i.test(s);
}
async function botAi(env, system, user, maxTokens, opts = {}) {
  if (!env.AI) throw new Error('AI binding is not configured');
  const model = opts.model || env.CONTROL_BOT_AI_MODEL || BOT_AI_MODEL_DEFAULT;
  // OpenAI's gpt-oss models on Workers AI take the Responses API shape (instructions + input).
  const res = /gpt-oss/.test(model)
    ? await env.AI.run(model, { instructions: system, input: user, reasoning: { effort: 'low' } })
    : await env.AI.run(model, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: `${user}\n\n/no_think` }],
      max_tokens: maxTokens || 1500,
      temperature: opts.temperature == null ? 0.1 : opts.temperature,
    });
  let out = '';
  if (res && Array.isArray(res.output)) out = res.output.filter((x) => x && x.type === 'message').flatMap((x) => x.content || []).map((c) => c.text || '').join('');
  else if (typeof res === 'string') out = res;
  else if (res && typeof res.response === 'string') out = res.response;
  else if (res && res.response && typeof res.response === 'object') out = JSON.stringify(res.response);
  else if (res && res.choices && res.choices[0]) out = (res.choices[0].message && res.choices[0].message.content) || res.choices[0].text || '';
  return String(out).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
function botParseJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}
async function botSetAiLimited(env, limited, extra = {}) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const state = (await kv.get('bot:ai', 'json')) || {};
  if (limited && !state.limited) {
    await kv.put('bot:ai', JSON.stringify({ limited: true, since: Date.now() }));
    await botNotifyOwner(env, '🔴🔴🔴 <b>Лимит ИИ исчерпан.</b>\nСообщения продолжаю сохранять, но задачи из них пока не разбираю. Как только лимит обновится (обычно в 03:00 МСК), разберу всё накопившееся и напишу 🟢.');
  } else if (!limited && state.limited) {
    await kv.put('bot:ai', JSON.stringify({ limited: false, since: Date.now() }));
    await botNotifyOwner(env, `🟢 <b>ИИ снова работает.</b> Разбираю накопившиеся сообщения${extra.backlog ? ` (в очереди ${extra.backlog})` : ''}.`);
  }
}

const BOT_EXTRACT_SYSTEM = [
  'Ты помощник руководителя агентства Cantor Agency (продвижение репетиторов на Авито).',
  'Роли: «Олег Ежков» — руководитель; «Менеджер — Cantor Agency» (КМ) — общается с клиентами и передаёт задачи;',
  'остальные в рабочем чате — специалисты по Авито. Задача = просьба что-то сделать для клиента или в его кабинете Авито',
  '(правки объявлений, фото, ставки, города, отчёт, ответ на вопрос клиента, проверка и т.п.). Болтовня, благодарности,',
  'статистика без просьбы — не задачи. Новости и отчёты клиента о результатах («пришла заявка», «была продажа», «ученик',
  'записался»), приветствия и ответы «спасибо/хорошо/ок» — тоже НЕ задачи: в том числе не заводи задач вида «подтвердить',
  'получение», «ответить клиенту», «поблагодарить», «отреагировать», «сообщить о диагностиках/продажах». Задача из чата клиента — только конкретная просьба',
  'клиента что-то сделать или вопрос, на который команда ещё не ответила в этих же сообщениях.',
  'Просьба команды КЛИЕНТУ (пополнить баланс, прислать скриншот или файл, выбрать время, ответить на вопрос, подтвердить) —',
  'это дело клиента, а НЕ задача команды: такие задачи не заводи.',
  'Пополнение баланса/аванса на Авито — всегда дело клиента: задач на пополнение не заводи, кто бы о нём ни писал.',
  'Вопрос руководителя или команды на обсуждение или уточнение («есть смысл увеличить лимит?», «какие будут ближайшие действия?», «@oleg рассылку согласовываем с клиентом или сами решаем?») — не задача, даже если кого-то тегнули:',
  'задача только если кого-то прямо просят что-то сделать. Ответ команды «взяли в работу», напоминание клиенту о встрече — тоже не задачи.',
  'Если КМ пересылает в рабочий чат ответ или правки клиента по работе, по которой уже есть открытая задача (тексты, фото, отзывы),',
  '— это update к этой задаче, а не новые задачи; не дроби одно сообщение на несколько задач по одной работе. Упоминание уже',
  'поставленной задачи («стоит задача у Кати на создание объявления») — тоже не новая задача.',
  'В рабочем чате задачу на КМ («Менеджер — Cantor Agency») ставь только если КМ прямо тегнули (@username) или назвали по имени.',
  'Реакции (👍 и т.п.) показаны в квадратных скобках после текста: реакция команды на просьбу = её приняли/взяли.',
  'Тебе дают новые сообщения из одного топика/чата, контекст до них и список открытых задач этого клиента.',
  'Верни ТОЛЬКО JSON без пояснений:',
  '{"events":[',
  ' {"type":"new_task","msg":<id сообщения>,"text":"<суть задачи до 15 слов>","assignee":"<имя исполнителя или null>","due":"<YYYY-MM-DD HH:MM или null>","priority":"urgent|high|normal|low"},',
  ' {"type":"update","task":"<id открытой задачи>","msg":<id сообщения>,"status":"taken|done|informed|cancelled","assignee":"<имя или null>","due":"<YYYY-MM-DD HH:MM или null>"}',
  ']}',
  'assignee — ТОЛЬКО если в сообщении человек прямо назван (имя или @username — см. Telegram в списке команды) или сам пишет, что сделает. Не угадывай по роли',
  'или по контексту: если явно не назван — null. due — только если в сообщении прямо назван срок («крайний срок 21.10.2026 18:00», «до пятницы»), иначе null; время самого сообщения сроком не считается.',
  'priority: urgent — «срочно», «горит», «ASAP», «прямо сейчас» или срок в ближайшие 3 часа; high — срок сегодня или завтра, «важно», «в приоритете»; low — «когда будет время», «не срочно»; иначе normal.',
  'taken — кто-то взял задачу или назвал срок; done — из сообщений команды ясно, что работа сделана («готово», «поправила», «загрузили», «запустили», «сделано», скрин результата); informed — КМ/Олег сообщили клиенту результат;',
  'cancelled — задача больше не нужна. Сроки переводи в абсолютные дату и время по Москве («до завтра» = завтра 18:00,',
  '«сегодня» = сегодня 18:00, «через час» = время сообщения + 1 час). Не выдумывай: если срока нет — null.',
  'Если сообщение продолжает уже известную задачу — используй update, а не new_task. Если КМ или Олег уже ответили клиенту',
  'по задаче вида «ответить на вопрос клиента» — это informed. Если событий нет — {"events":[]}.',
].join('\n');

function botFormatLogLines(entries) {
  const reacts = (e) => (Array.isArray(e.reactions) && e.reactions.length
    ? ` [реакции: ${e.reactions.map((r) => `${r.by}${r.team === false ? ' (клиент)' : ''} ${r.e}`).join(', ')}]` : '');
  return entries.map((e) => `[${e.id}] ${botFmtDate(e.t)} ${e.from}${e.team === false ? ' (клиент)' : ''}${e.reply ? ` (ответ на ${e.reply})` : ''}: ${String(e.text).replace(/\s+/g, ' ').slice(0, 700)}${reacts(e)}`).join('\n');
}

// Feeds new messages to the AI, a few topics per cron run. The dirty flag is cleared before the
// log is read, so a message arriving mid-run re-flags its topic; the cursor (last processed
// message id) keeps anything from being processed twice.
async function botProcessQueue(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const listing = await kv.list({ prefix: 'bot:dirty:', limit: 100 });
  if (!listing.keys.length) return { processed: 0 };
  const state = (await kv.get('bot:ai', 'json')) || {};
  const projectsById = await botProjectsById(kv);
  const team = await atGetTeam(env);
  let allTasks = null;
  let processed = 0;
  for (const k of listing.keys.slice(0, BOT_AI_BATCH_GROUPS)) {
    const [, , chatId, threadId] = k.name.split(':');
    await kv.delete(k.name);
    const chatRec = await kv.get(`bot:chat:${chatId}`, 'json');
    if (!chatRec) continue;
    const topic = await botGetTopic(kv, chatRec, threadId);
    if (!topic.projectId && chatRec.isForum && !topic.projectLocked) {
      // The client may have been added to the dashboard after the topic was first seen.
      const match = botMatchProject(topic.name, Object.values(projectsById));
      if (match) {
        topic.projectId = match.id;
        await kv.put(`bot:topic:${chatId}:${threadId}`, JSON.stringify(topic));
      }
    }
    const cursorKey = `bot:cursor:${chatId}:${threadId}`;
    const cursor = Number(await kv.get(cursorKey)) || 0;
    const now = Date.now();
    const logs = await botReadLogs(kv, chatId, threadId, now - 10 * 24 * 3600000, now);
    // Imported history is context only: its tasks came in with the import, and its ids aren't the bot's.
    const unseen = logs.filter((e) => !e.imported && e.id > cursor);
    if (!unseen.length) continue;
    const batch = unseen.slice(0, BOT_AI_BATCH_MESSAGES);
    if (unseen.length > batch.length) await kv.put(k.name, '1'); // the rest goes next run
    const context = logs.filter((e) => e.imported || e.id <= cursor).slice(-15);

    if (!allTasks) allTasks = await botAllTasks(kv);
    const sameTopic = (t) => (topic.projectId && t.projectId === topic.projectId) || (String(t.chatId) === String(chatId) && String(t.threadId) === String(threadId));
    const openTasks = allTasks.filter((t) => (t.status === 'open' || t.status === 'done') && sameTopic(t));
    const recentClosed = allTasks.filter((t) => (t.status === 'closed' || t.status === 'cancelled') && sameTopic(t) && now - Date.parse(t.updatedAt || t.createdAt || 0) < 4 * 24 * 3600000);
    // A team list «@tag / • item / • item» is read here, item by item, without the model: each item is a
    // task on the tagged person. A team report «Сделали …» closes the open task it is about. Neither
    // goes to the model.
    const listCtx = { chatRec, topic, threadId, fresh: batch, openTasks, recentClosed, team, projectsById };
    const handled = new Set();
    for (const e of batch) {
      if (!e.team || chatRec.kind !== 'work') continue;
      const items = botParseTaskList(e.text);
      if (items) {
        await botApplyEvents(env, items.map((it) => ({
          type: 'new_task', msg: e.id, fromList: true, text: botShortTask(it.text), detail: it.text, priorityText: it.text,
          assignee: it.tags.length === 1 ? `@${it.tags[0]}` : null, due: botExplicitDue(it.text) || botExplicitDue(e.text),
        })), listCtx);
        handled.add(e.id);
      } else if (BOT_DONE_REPORT_RE.test(String(e.text || '').trim()) && !/\?/.test(e.text)) {
        await botCloseByReport(env, listCtx, e);
      }
    }
    const fresh = batch.filter((e) => !handled.has(e.id));
    if (!fresh.length) {
      await kv.put(cursorKey, String(batch[batch.length - 1].id));
      processed += batch.length;
      continue;
    }
    const projectName = topic.projectId && projectsById[topic.projectId] ? projectsById[topic.projectId].name : topic.name;
    const user = [
      `Сейчас: ${botFmtDate(now)}.${botMsk(now).date.slice(0, 4)} (МСК). Сегодня ${['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][botMsk(now).dow]}.`,
      `Чат: ${chatRec.kind === 'work' ? 'рабочий чат агентства, топик клиента' : 'чат с клиентом'} «${projectName}».`,
      `Команда агентства: ${atTeamPromptLine(team)}. Исполнителя (assignee) пиши полным именем из этого списка.`,
      `Открытые задачи клиента:\n${openTasks.length ? openTasks.map((t) => `- id=${t.id} [${botStatusLabel(t)}] ${t.text} (исполнитель: ${t.owner || '—'}, срок: ${t.due ? botFmtDate(botDueMs(t)) : '—'})`).join('\n') : '—'}`,
      `Контекст (уже разобрано):\n${context.length ? botFormatLogLines(context) : '—'}`,
      `НОВЫЕ сообщения:\n${botFormatLogLines(fresh)}`,
    ].join('\n\n');

    let parsed = null;
    try {
      parsed = botParseJson(await botAi(env, BOT_EXTRACT_SYSTEM, user, 1500));
    } catch (err) {
      if (botIsLimitError(err)) {
        await kv.put(k.name, '1');
        await botSetAiLimited(env, true);
        return { processed, limited: true };
      }
      console.error('control bot AI failed', err && err.message);
    }
    const attemptsKey = `bot:attempts:${chatId}:${threadId}`;
    if (!parsed) {
      // Failed/unparseable: retry next run; after a few tries skip this batch so it can't block the topic.
      const attempts = (Number(await kv.get(attemptsKey)) || 0) + 1;
      if (attempts >= BOT_AI_MAX_ATTEMPTS) {
        await kv.put(cursorKey, String(batch[batch.length - 1].id));
        await kv.delete(attemptsKey);
      } else {
        await kv.put(attemptsKey, String(attempts), { expirationTtl: 60 * 60 * 24 * 3 });
        await kv.put(k.name, '1');
      }
      continue;
    }
    if (state.limited) {
      await botSetAiLimited(env, false, { backlog: listing.keys.length });
      state.limited = false;
    }
    await botApplyEvents(env, parsed.events || [], { chatRec, topic, threadId, fresh, openTasks, recentClosed, team, projectsById });
    await kv.put(cursorKey, String(batch[batch.length - 1].id));
    processed += batch.length;
  }
  return { processed };
}

// «@SEEREKAG / • Проверить публикацию… / • Заменить… / @GSDorr / • Проверить…» → [{ tags, text }], one per item
// under the tag line above it. null when the message isn't such a list (fewer than two items).
function botParseTaskList(text) {
  const items = [];
  let tags = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const tagLine = line.match(/^((?:@[A-Za-z0-9_]{4,}[\s,;:]*)+)$/);
    if (tagLine) { tags = [...tagLine[1].matchAll(/@([A-Za-z0-9_]{4,})/g)].map((m) => m[1].toLowerCase()); continue; }
    const item = line.match(/^(?:[•\-–—*▪●·]|\d{1,2}[.)])\s*(.{6,})$/);
    if (item && tags.length) items.push({ tags: [...tags], text: item[1].trim() });
  }
  return items.length >= 2 ? items : null;
}
// A card title from a list item: up to the first bracket / colon / semicolon, at most 14 words.
function botShortTask(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = s.search(/\s\(|;|:\s/);
  if (cut >= 15) s = s.slice(0, cut);
  const words = s.split(' ');
  if (words.length > 14) s = `${words.slice(0, 14).join(' ')}…`;
  return s.replace(/[.,;]+$/, '');
}
// «крайний срок 21.10.2026 18:00», «до 23.10», «срок: 24.10 12:00» → «YYYY-MM-DD HH:MM» (no time — 18:00).
function botExplicitDue(text) {
  const m = String(text || '').match(/(?:срок|до|к)\s*:?\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?:[,\s]+(?:в\s*)?(\d{1,2})[:.](\d{2}))?/i);
  if (!m) return null;
  const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : botMsk(Date.now()).date.slice(0, 4);
  const pad = (x) => String(x).padStart(2, '0');
  return `${year}-${pad(m[2])}-${pad(m[1])} ${m[4] ? pad(m[4]) : '18'}:${m[5] || '00'}`;
}
// «Сделали днем рассылку на 2000 руб…» closes the open task «Запустить рассылку на 2000 руб»: the task's
// words other than its first (the action) are in the report — at least two and most of them.
async function botCloseByReport(env, ctx, e) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const msg = botTaskStems(e.text);
  const hits = ctx.openTasks.filter((t) => {
    if (t.status !== 'open') return false;
    const stems = [...botTaskStems(t.text)].slice(1);
    const common = stems.filter((x) => msg.has(x)).length;
    return common >= 2 && common / stems.length >= 0.6;
  });
  if (hits.length !== 1) return; // none, or not sure which one
  await botApplyEvents(env, [{ type: 'update', task: hits[0].id, msg: e.id, status: 'done' }], ctx);
}

// The bot only puts a task on someone the message itself names — by name, alias or @username — or
// on the person who wrote it ("сделаю"). A guess from context leaves the task unclaimed: it waits at
// the top of the tracker for someone to take it and set the deadline.
// "Сделаю к вечеру", "проверю", "беру" — the author takes it on themselves.
const BOT_SELF_COMMIT_RE = /(^|[^а-яё])(сделаю|сделаем|беру|возьму|возьм[её]м|займусь|займ[её]мся|подготовлю|подготовим|отправлю|отправим|пришлю|пришл[её]м|проверю|проверим|посмотрю|посмотрим|исправлю|исправим|настрою|настроим|загружу|выложу|поправлю|передам|напишу|уточню|созвонюсь|разберусь|доделаю)([^а-яё]|$)/i;
// The person was asked: tagged (@username) or named in the message — or wrote it themselves as a
// commitment. Being the author of a request to someone else ("Пополните аванс") isn't enough.
function botNamedIn(src, who) {
  if (!src || !who) return false;
  if (atMatchUser(src.from, [who]) && BOT_SELF_COMMIT_RE.test(String(src.text || ''))) return true;
  const text = String(src.text || '');
  if (who.tgUsername && text.toLowerCase().includes(`@${String(who.tgUsername).toLowerCase()}`)) return true;
  return !!atMatchUser(text, [who]);
}

// Same client, still open or done-not-reported, made in the last 7 days, and the same request: the
// same words, or one text is the other plus extra words ("Проверить причину отсутствия заявок" /
// "… с 1 октября"), starting with the same action. Different specifics on both sides — «фото для математики» / «… информатики»,
// 17:00 / 18:30, two different names — are different tasks.
const BOT_TWIN_FILLER = new Set(['нужно', 'нужна', 'нужен', 'надо', 'необходимо', 'пожалуйста', 'срочно', 'сегодня', 'завтра', 'все', 'всё', 'еще', 'ещё', 'для', 'это']);
function botTaskStems(text) {
  return new Set(botNorm(text).split(' ').filter((w) => (w.length > 2 || /\d/.test(w)) && !BOT_TWIN_FILLER.has(w)).map((w) => (/\d/.test(w) ? w : w.slice(0, 5))));
}
function botFindTwinTask(openTasks, text, projectId, chatId, threadId) {
  const a = botTaskStems(text);
  if (!a.size) return null;
  const weekAgo = Date.now() - 7 * 24 * 3600000;
  return (openTasks || []).find((t) => {
    if (t.status !== 'open' && t.status !== 'done') return false;
    if (Date.parse(t.createdAt || 0) < weekAgo) return false;
    const same = projectId ? t.projectId === projectId : String(t.chatId) === String(chatId) && String(t.threadId) === String(threadId);
    if (!same) return false;
    const b = botTaskStems(t.text);
    if (!b.size) return false;
    if ([...a][0] !== [...b][0]) return false; // the action itself («пополнить» / «сообщить о пополнении»)
    const onlyA = [...a].filter((x) => !b.has(x)).length;
    const onlyB = [...b].filter((x) => !a.has(x)).length;
    if (onlyA && onlyB) return false;
    const common = a.size - onlyA;
    return common >= Math.min(2, Math.min(a.size, b.size)) && common / Math.max(a.size, b.size) >= 0.5;
  }) || null;
}
// Our message in the client's chat asking the CLIENT to do something ("Пополните, пожалуйста, аванс",
// "Пришлите скриншот", "Подскажите удобное время", «просим пополнить аванс») — the client's to-do,
// not a task for the team. Our own commitments in it ("проверю и напишу") still are.
function botIsRequestToClient(chatRec, src) {
  if (!chatRec || chatRec.kind !== 'client' || !src || !src.team) return false;
  const text = String(src.text || '');
  if (BOT_SELF_COMMIT_RE.test(text)) return false;
  return /(^|[^а-яё])(пополн|пришл|отправ|выбер|подскаж|напиш|подтверд|оплат|скин|загруз|заполн|посмотр|проверь|дайте|сообщ)[а-яё]*(ите|йте)([^а-яё]|$)/i.test(text)
    || /(^|[^а-яё])(просим|прошу|нужно|необходимо|надо|требуется)[^.!?\n]{0,40}(пополн|оплат|прислать|отправить|выбрать|подтвердить|заполнить|скинуть)/i.test(text);
}
// A client's own report of results («было назначено 3 диагностики, проведено две, одна продажа») —
// news for the dashboard, not work for the team, unless it also asks for something.
function botIsClientReport(src) {
  if (!src || src.team !== false) return false;
  const text = String(src.text || '');
  if (/\?|можно|нужно|надо|сделайте|подскажите|помогите|пожалуйста|прошу|почему|когда/i.test(text)) return false;
  return /диагностик|продаж|заявк|учени|записал|купил|оплатил/i.test(text) && /\d|одн[ауо]|две|два|три|четыре|пять/i.test(text);
}
// A request in a team message: someone is tagged, asked politely, or told to do something.
const BOT_ASK_RE = /@\w|(^|[^а-яё])кто[^?]{0,30}(бер|возьм|займ|сдела)|(^|[^а-яё])(можешь|можете|сможешь|сможете|пожалуйста|прошу|просьба|нужно|надо|необходимо|давай|давайте|сделай|сделайте|проверь|проверьте|посмотри|посмотрите|глянь|гляньте|поставь|поставьте|добавь|добавьте|поправь|поправьте|исправь|исправьте|загрузи|загрузите|отправь|отправьте|напиши|напишите|подготовь|подготовьте|узнай|узнайте|уточни|уточните|возьми|возьмите|займись|займитесь)([^а-яё]|$)/i;
// «Сделали…», «Запустили…», «Готово…» at the start of a team message: a report that something is done.
const BOT_DONE_REPORT_RE = /^(?:@\w+[\s,]*)*(?:[а-яё]+[\s,]+)?(сделали|сделал[а]?|сделано|запустили|запустил[а]?|разместили|разместил[а]?|поправили|поправил[а]?|исправили|исправил[а]?|загрузили|загрузил[а]?|выложили|отправили|отправил[а]?|обновили|обновил[а]?|подключили|настроили|заменили|удалили|отключили|подняли|снизили|готово|выполнено)([^а-яё]|$)/i;
// The same, without «@someone»: what turns a question into a request («можешь поправить фото?»).
const BOT_REQUEST_RE = new RegExp(BOT_ASK_RE.source.replace(/^@\\w\|/, ''), 'i');
// Why a message the AI read a task from is not work for the team — or null when it is. Shared by new
// messages and by the one-time sweep of tasks made before these rules.
function botNotTeamTaskReason(chatRec, src, taskText) {
  if (!src) return null;
  const text = String(src.text || '').trim();
  // Topping up the Avito balance is always the client's job: whoever writes about it, there is
  // nothing for the team to do.
  if (/(^|[^а-яё])пополн/i.test(String(taskText || '')) && !/после пополн/i.test(String(taskText || ''))) return 'пополнение — дело клиента';
  if (botIsRequestToClient(chatRec, src)) return 'просьба к клиенту — дело клиента';
  if (botIsClientReport(src)) return 'новости клиента о результатах';
  if (!src.team) return null;
  // «Сделали днем рассылку на 2000 руб, рассчитываем на 8-10 контактов» — a report of done work
  // (botCloseByReport closes the task it reports), not a new task.
  if (BOT_DONE_REPORT_RE.test(text) && !/\?/.test(text) && !BOT_REQUEST_RE.test(text)) return 'отчёт о сделанном';
  // «Тексты взяли в работу, спасибо» — our answer to a request, not a new one.
  if (text.length < 160 && !text.includes('?') && /(^|[^а-яё])(взял[аи]?|берём|берем|приняли|принято|получили) (в работу|тексты|фото|материалы|информацию)|(^|[^а-яё])(взял[аи]?|приняли) в работу/i.test(text)) return 'команда подтвердила, что взяла в работу';
  // «Напоминаем о встрече сегодня в 9:30» — the reminder is the work, and it's done.
  if (chatRec && chatRec.kind === 'client' && /(^|[^а-яё])напомина(ем|ю)/i.test(text)) return 'напоминание клиенту уже отправлено';
  // «Дневной лимит есть смысл увеличить?», «Тут какие будут ближайшие действия?» — a question to
  // talk over, not an assignment: it becomes a task only when it asks someone to do something.
  // A tag alone doesn't make it a request: «@oleg рассылку согласовываем с клиентом? или сами решаем?»
  // is a question — it waits for an answer (botQuestionsCron reminds after 3 working hours), not a card.
  if (/\?/.test(text) && !BOT_REQUEST_RE.test(text)) return 'вопрос на обсуждение';
  return null;
}
// The model's priority, checked against the message: «срочно» or a deadline within 3 hours is urgent,
// a deadline today or tomorrow at least high.
function botTaskPriority(fromAi, text, dueMs) {
  const order = ['low', 'normal', 'high', 'urgent'];
  // The model marks almost everything urgent — only «low» is taken from it; the rest comes from the
  // task's own words and its deadline (for a list, the item's words — not the whole message's).
  let p = fromAi === 'low' ? 'low' : 'normal';
  const raise = (to) => { if (order.indexOf(to) > order.indexOf(p)) p = to; };
  text = String(text || '');
  // «срочно», «в срочном порядке» — not «проверить выполнение срочных правок».
  if (/(^|[^а-яё])(срочно|в срочном порядке|горит|asap)([^а-яё]|$)/i.test(text)) raise('urgent');
  if (/(^|[^а-яё])(важн|в приоритете|первым делом|в первую очередь)/i.test(text)) raise('high');
  if (dueMs) {
    const left = dueMs - Date.now();
    if (left < 3 * 3600000) raise('urgent');
    else if (dueMs < botMskStartOfDay(Date.now()) + 2 * 24 * 3600000) raise('high');
  }
  return p;
}
const BOT_DUE_HINT_RE = /\d{1,2}[.:/]\d{2}|\d{1,2}\s*(час|ч\b)|сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц|суббот|воскресен|до\s+(конца|вечера|утра|обеда|ночи)|через\s+\d|через\s+(час|день|неделю)|срок|дедлайн|к\s+\d|утром|вечером|asap|срочно|сейчас/i;
async function botApplyEvents(env, events, ctx) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byMsg = new Map(ctx.fresh.map((e) => [e.id, e]));
  const openById = new Map(ctx.openTasks.map((t) => [t.id, t]));
  const nowIso = new Date().toISOString();
  const users = ctx.team ? ctx.team.users : [];
  const touched = [];
  const assigned = []; // [task, source message] — the person gets a (quiet) heads-up in Avito Tasks / Telegram
  const autoClosed = []; // [task, status, message] — set from the chat; the person is told
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== 'object') continue;
    const src = byMsg.get(Number(ev.msg));
    // A deadline only when the message names one: the model sometimes puts the message's own time there,
    // which then reads as «due in a minute» and makes the task urgent.
    const dueMs = ev.fromList ? botParseMskDateTime(ev.due) : src && BOT_DUE_HINT_RE.test(String(src.text || '')) ? botParseMskDateTime(ev.due) : null;
    if (ev.type === 'new_task' && ev.text && !ev.fromList && botNotTeamTaskReason(ctx.chatRec, src, ev.text)) continue;
    if (ev.type === 'new_task' && ev.text) {
      // The same request often comes twice: the client asks in their chat and the manager passes it
      // on in the work chat, or two messages in a row repeat it — the AI then proposes it again.
      // A task of the same client with (nearly) the same words, still open, is the same task: the
      // new message is noted on it instead of a second card.
      const twin = botFindTwinTask(ctx.openTasks, String(ev.text), ctx.topic.projectId, ctx.chatRec.id, ctx.threadId);
      // Done and closed in the last days: the chat talking about it again doesn't make it a new task.
      if (!twin && botFindTwinTask((ctx.recentClosed || []).map((t) => ({ ...t, status: 'open' })), String(ev.text), ctx.topic.projectId, ctx.chatRec.id, ctx.threadId)) continue;
      if (twin) {
        twin.activity = [...(Array.isArray(twin.activity) ? twin.activity : []), { t: Date.now(), by: 'Бот', what: `снова в ${ctx.chatRec.kind === 'client' ? 'чате клиента' : 'рабочем чате'}${src ? ` (${src.from}): «${String(src.text).slice(0, 160)}»` : ''}` }].slice(-20);
        twin.updatedAt = nowIso;
        await kv.put(`task:${twin.id}`, JSON.stringify(twin));
        touched.push(twin.id);
        continue;
      }
      const msgId = src ? src.id : ctx.fresh[ctx.fresh.length - 1].id;
      const id = `bot${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const task = {
        id,
        text: String(ev.text).slice(0, 300),
        // The message the task came from, as the description: who asked and in what words.
        note: src && src.text ? `${src.from}: «${String(ev.detail || src.text).slice(0, 1500)}»` : '',
        status: 'open',
        owner: null,
        assigneeId: null,
        priority: botTaskPriority(ev.priority, ev.priorityText || (src && src.text), dueMs),
        // A deadline the message names is the task's deadline («крайний срок 21.10 18:00»).
        due: dueMs ? botIsoMsk(dueMs) : null,
        suggestedDue: dueMs ? botIsoMsk(dueMs) : null,
        projectId: ctx.topic.projectId || null,
        topicName: ctx.topic.name,
        source: 'bot',
        origin: ctx.chatRec.kind,
        chatId: ctx.chatRec.id,
        threadId: Number(ctx.threadId),
        msgId,
        link: botMessageLink(ctx.chatRec.id, ctx.chatRec.isForum ? ctx.threadId : null, msgId),
        author: src ? src.from : null,
        startedAt: src ? new Date(src.t).toISOString() : nowIso,
        notified: {},
        activity: [{ t: Date.now(), by: 'Бот', what: 'нашёл задачу в чате' }],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const who = ev.assignee && ev.assignee !== 'null' ? atMatchUser(String(ev.assignee), users) : null;
      if (who && botNamedIn(src, who)) Object.assign(task, { assigneeId: who.id, owner: who.name });
      await kv.put(`task:${id}`, JSON.stringify(task));
      openById.set(id, task);
      ctx.openTasks.push(task);
      touched.push(id);
      if (who) assigned.push([task, src]);
    } else if (ev.type === 'update' && openById.has(String(ev.task))) {
      const task = openById.get(String(ev.task));
      if (ev.assignee && ev.assignee !== 'null') {
        const who = atMatchUser(ev.assignee, users);
        const prevId = atAssigneeId(task, users);
        if (who && who.id !== prevId && botNamedIn(src, who)) {
          Object.assign(task, { owner: who.name, assigneeId: who.id });
          assigned.push([task, src]);
        }
      }
      if (dueMs) task.due = botIsoMsk(dueMs);
      if (ev.status === 'taken' && !task.takenAt) task.takenAt = src ? new Date(src.t).toISOString() : nowIso;
      // «Готово» / «клиенту сообщили» / «не нужно» from our own message in the chat sets the status by itself
      // (the person is told, quietly, and can put it back in the tracker); a question or a bare «ок» doesn't.
      const closes = (ev.status === 'done' || ev.status === 'cancelled') ? task.status === 'open'
        : ev.status === 'informed' ? task.status === 'open' || task.status === 'done' : false;
      // A question ("а это сделали?") is not an answer; and a task already asked about with the same
      // guess in the last day isn't asked about again (a save in the tracker clears task.hint).
      const asking = src && /\?[\s)!.]*$/.test(String(src.text || '').trim());
      // Only our own messages say that something is done or was told to the client — not the
      // client's, and not a bare «хорошо» / «окей».
      const weak = !src || src.team === false || botIsAckText(src.text) || String(src.text || '').trim().length < 12;
      let label = ev.status === 'taken' ? 'взяли в работу' : null;
      if (closes && !asking && !weak) {
        const at = src ? new Date(src.t).toISOString() : nowIso;
        if (ev.status === 'done') Object.assign(task, { status: 'done', doneAt: task.doneAt || at });
        if (ev.status === 'informed') Object.assign(task, { status: 'closed', doneAt: task.doneAt || at, informedAt: at });
        if (ev.status === 'cancelled') task.status = 'cancelled';
        task.updatedBy = 'Бот';
        delete task.hint;
        label = `${{ done: 'сделано', informed: 'закрыл — клиенту сообщили', cancelled: 'отменил — не нужна' }[ev.status]}${src ? ` (${src.from}: «${String(src.text).replace(/\s+/g, ' ').slice(0, 120)}»)` : ''}`;
        autoClosed.push([task, ev.status, src]);
      }
      task.updatedAt = nowIso;
      task.activity = [...(Array.isArray(task.activity) ? task.activity : []), { t: Date.now(), by: 'Бот', what: `по переписке${label ? `: ${label}` : ''}` }].slice(-20);
      await kv.put(`task:${task.id}`, JSON.stringify(task));
      touched.push(task.id);
    }
  }
  if (touched.length) await atTouch(kv, touched);
  // No ping when the person set the task themselves ("сделаю к вечеру") — they know already.
  for (const [task, src] of assigned) {
    const who = users.find((u) => u.id === task.assigneeId);
    if (!who || (src && atMatchUser(src.from, users) === who)) continue;
    const projectName = task.projectId && ctx.projectsById && ctx.projectsById[task.projectId] ? ctx.projectsById[task.projectId].name : task.topicName;
    await atNotify(env, ctx.team, [who.id], { kind: 'assigned', taskId: task.id, text: `Бот записал на вас задачу из чата: ${task.text}`, by: 'Бот' }, {
      text: `🤖 <b>Задача на вас из чата</b>${src ? ` (от ${escapeHtml(src.from)})` : ''}\n${atTgTaskBlock(task, projectName)}`,
      extra: { ...atTgButtons(task, true), disable_notification: true },
    });
  }
  // Statuses set from the chat: the assignee (for «клиенту сообщили» — the client managers) gets a quiet
  // note with the message it was read from; a wrong guess is put back in the tracker.
  for (const [task, status, src] of autoClosed) {
    const to = status === 'informed'
      ? users.filter((u) => u.role === 'manager' && u.active).map((u) => u.id)
      : [atAssigneeId(task, users)].filter(Boolean);
    if (!to.length) continue;
    const what = { done: 'сделана', informed: 'закрыта — клиенту сообщили', cancelled: 'отменена — больше не нужна' }[status];
    const projectName = task.projectId && ctx.projectsById && ctx.projectsById[task.projectId] ? ctx.projectsById[task.projectId].name : task.topicName;
    const quote = src ? `\n<i>${escapeHtml(src.from || '')}: «${escapeHtml(String(src.text).slice(0, 200))}»</i>` : '';
    await atNotify(env, ctx.team, to, { kind: 'edited', taskId: task.id, text: `Бот по переписке: задача ${what} — ${task.text}`, by: 'Бот' }, {
      text: `🤖 <b>Задача ${what}</b> — бот понял это из чата. Если ошибся, верните статус в трекере.\n${atTgTaskBlock(task, projectName)}${quote}`,
      extra: { reply_markup: { inline_keyboard: [atOpenTaskRow(task.id)] }, disable_notification: true },
    });
  }
}

// ── checks & summaries ──
// ── plain-language lines for the owner's automatic messages ──
// (/tasks and /overdue keep botTaskLine with task ids — those are for /done <id>.)
const BOT_ACK_WORDS = new Set(('да нет ок окей ok хорошо понятно ясно спасибо благодарю отлично супер класс договорились '
  + 'принято принял приняла ага угу конечно согласна согласен жду ждем ждём поняла понял вас большое очень пожалуйста давайте давай').split(/\s+/));
// "Хорошо", "Здравствуйте, нет", "Спасибо большое!" — a reply that needs no answer back.
function botIsAckText(text) {
  const t = String(text || '').toLowerCase().replace(/ё/g, 'е');
  if (t.includes('?') || t.length > 60) return false;
  const words = t.replace(/здравствуйте|добрый день|доброе утро|добрый вечер|привет/g, ' ')
    .replace(/[^a-zа-я\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.every((w) => BOT_ACK_WORDS.has(w));
}
function botShortDate(ms) {
  const d = botMsk(ms);
  const day = `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`;
  return d.hh === BOT_WORK_END_H && d.mm === 0 ? day : `${day} ${String(d.hh).padStart(2, '0')}:${String(d.mm).padStart(2, '0')}`;
}
function botHoursAgo(fromMs, nowMs) {
  const h = Math.floor((nowMs - fromMs) / 3600000);
  return h < 1 ? 'меньше часа' : h < 24 ? `${h} ч` : `${Math.floor(h / 24)} дн`;
}
// "Получить отзывы — Татьяна Верхотурова · срок был 05.10 (16 ч назад)", the text linking to the tracker.
function botOwnerTaskLine(task, byId, nowMs, what) {
  const client = task.projectId && byId[task.projectId] ? byId[task.projectId].name : null;
  const due = botDueMs(task);
  let tail = '';
  if (what === 'overdue' && due) tail = ` · срок был ${botShortDate(due)}, ${botHoursAgo(due, nowMs)} назад`;
  else if (what === 'done' && task.doneAt) tail = ` · сделано ${botShortDate(Date.parse(task.doneAt))}`;
  else if (what === 'since') tail = ` · с ${botShortDate(Date.parse(task.startedAt || task.createdAt))}`;
  return `• <a href="${escapeHtml(atTaskUrl(task.id))}">${escapeHtml(task.text)}</a>${client ? ` — ${escapeHtml(client)}` : ''}${tail}`;
}
// Tasks grouped by who has them (the owner reads it as "Вы"), biggest pile first, a few lines each.
function botTasksByPerson(tasks, team, byId, nowMs, what, ownerId, perPerson = 6) {
  const groups = new Map();
  for (const t of tasks) {
    const uid = atAssigneeId(t, team.users);
    const u = uid && team.users.find((x) => x.id === uid);
    const name = u ? (u.id === ownerId ? 'Вы' : u.name) : t.owner || 'Без исполнителя';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(t);
  }
  const lines = [];
  for (const [name, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`<b>${escapeHtml(name)}</b> · ${list.length}`);
    lines.push(...list.slice(0, perPerson).map((t) => botOwnerTaskLine(t, byId, nowMs, what)));
    if (list.length > perPerson) lines.push(`  …и ещё ${list.length - perPerson} — в трекере`);
  }
  return lines;
}
async function botPendingList(env, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const out = [];
  for (const k of (await kv.list({ prefix: 'bot:pending:' })).keys) {
    const p = await kv.get(k.name, 'json');
    const chat = p && await kv.get(`bot:chat:${k.name.split(':').pop()}`, 'json');
    if (p && chat && !botIsAckText(p.text)) out.push({ ...p, chatId: chat.id, title: chat.title, projectId: chat.projectId || null });
  }
  return out.sort((a, b) => a.since - b.since);
}

async function botBuildSummary(env, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byId = await botProjectsById(kv);
  const tasks = await botAllTasks(kv);
  const team = await atGetTeam(env);
  const ownerId = (team.users.find((u) => u.role === 'owner') || {}).id;
  const open = tasks.filter((t) => t.status === 'open');
  const overdue = open.filter((t) => botDueMs(t) && botDueMs(t) < nowMs).sort((a, b) => botDueMs(a) - botDueMs(b));
  const unclaimed = open.filter((t) => atIsUnclaimed(t, team.users));
  const noDue = open.filter((t) => !botDueMs(t) && !atIsUnclaimed(t, team.users) && botWorkingMinutes(Date.parse(t.startedAt || t.createdAt), nowMs) >= BOT_NO_DUE_AFTER_WMIN);
  const notInformed = tasks.filter((t) => t.status === 'done' && t.doneAt && atNeedsInform(t, team.users) && botWorkingMinutes(Date.parse(t.doneAt), nowMs) >= BOT_NOT_INFORMED_WMIN)
    .sort((a, b) => Date.parse(a.doneAt) - Date.parse(b.doneAt));
  const notPassed = open.filter((t) => t.notified && t.notified.handoff && t.notified.handoff !== 'ok' && !t.takenAt);
  const pendingAll = (await botPendingList(env, nowMs)).filter((p) => botWorkingMinutes(p.since, nowMs) >= BOT_CLIENT_REPLY_WMIN);
  const pending = pendingAll.filter((p) => nowMs - p.since <= BOT_CLIENT_REPLY_STALE_MS);
  const stalePending = pendingAll.length - pending.length;
  const managers = team.users.filter((u) => u.role === 'manager' && u.active).map((u) => atFirstName(u.name)).join(', ') || 'клиентский менеджер';
  const state = (await kv.get('bot:ai', 'json')) || {};
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][botMsk(nowMs).dow];

  // One short message: counts per problem and per person, details are in the tracker. Only the
  // owner's own tasks are listed one by one — those are his to do.
  const firstOf = (t) => {
    const uid = atAssigneeId(t, team.users);
    const u = uid && team.users.find((x) => x.id === uid);
    return u ? atFirstName(u.name) : null;
  };
  const byPerson = (list) => {
    const m = new Map();
    for (const t of list) { const n = firstOf(t); if (n && t.assigneeId !== ownerId && atAssigneeId(t, team.users) !== ownerId) m.set(n, (m.get(n) || 0) + 1); }
    return [...m].sort((x, y) => y[1] - x[1]).map(([n, c]) => `${escapeHtml(n)} ${c}`).join(' · ');
  };
  const mine = (t) => atAssigneeId(t, team.users) === ownerId;
  const clientName = (p) => (p.projectId && byId[p.projectId] ? byId[p.projectId].name : String(p.title).replace(/^Авито\s*[—-]\s*/, ''));
  const kbIndex = (await kv.get('kb:index', 'json')) || [];
  const kbDay = kbIndex.filter((x) => nowMs - Date.parse(x.updatedAt || 0) < 24 * 3600000);
  const kbDone = kbDay.filter((x) => x.status === 'done').length;
  const kbFailed = kbDay.filter((x) => x.status === 'failed' || x.status === 'stuck').length;

  const lines = [`☀️ <b>Сводка на ${wd}, ${botShortDate(botMskStartOfDay(nowMs) + 12 * 3600000).slice(0, 5)}</b>`, ''];
  if (state.limited) lines.push('⚠️ ИИ бота на лимите — последние сообщения из чатов ещё не разобраны.', '');
  const othersOverdue = overdue.filter((t) => !mine(t));
  if (othersOverdue.length) lines.push(`🔴 Просрочено у команды: <b>${othersOverdue.length}</b>${byPerson(othersOverdue) ? ` — ${byPerson(othersOverdue)}` : ''}`);
  if (unclaimed.length) lines.push(`🙋 Ничьи задачи из чатов: <b>${unclaimed.length}</b> — их никто не взял`);
  if (notInformed.length) lines.push(`📨 Сделано, клиенту не сообщили: <b>${notInformed.length}</b> — ${escapeHtml(managers)}`);
  if (notPassed.length) lines.push(`⏱ Просьбы клиентов не переданы в рабочий чат: <b>${notPassed.length}</b>`);
  if (pending.length) {
    const names = [...new Set(pending.map(clientName))];
    lines.push(`💬 Ждут ответа: <b>${pending.length}</b> — ${names.slice(0, 4).map(escapeHtml).join(', ')}${names.length > 4 ? ` и ещё ${names.length - 4}` : ''}`);
  }
  const othersNoDue = noDue.filter((t) => !mine(t));
  if (othersNoDue.length) lines.push(`⚪ Без срока: <b>${othersNoDue.length}</b>`);
  if (kbDone || kbFailed) lines.push(`📚 База знаний за сутки: обновлено ${kbDone}${kbFailed ? `, не получилось ${kbFailed}` : ''}`);
  if (lines.length === 2) lines.push('Всё в порядке: просрочек нет, клиенты не ждут ✅');

  // The owner's own: overdue, due today, without a deadline.
  const today = botMsk(nowMs).date;
  const myOpen = open.filter(mine);
  const myLate = myOpen.filter((t) => botDueMs(t) && botDueMs(t) < nowMs).sort((x, y) => botDueMs(x) - botDueMs(y));
  const myToday = myOpen.filter((t) => botDueMs(t) && botDueMs(t) >= nowMs && botMsk(botDueMs(t)).date === today);
  const myNoDue = myOpen.filter((t) => !botDueMs(t));
  if (myLate.length || myToday.length || myNoDue.length) {
    const line = (t, mark) => `${mark} <a href="${escapeHtml(atTaskUrl(t.id))}">${escapeHtml(t.text)}</a>${t.projectId && byId[t.projectId] ? ` — ${escapeHtml(byId[t.projectId].name)}` : ''}`;
    const mineLines = [...myLate.map((t) => line(t, '🔴')), ...myToday.map((t) => line(t, '🟠')), ...myNoDue.map((t) => line(t, '⚪'))];
    lines.push('', `👤 <b>Ваши задачи</b>: ${[myLate.length && `просрочено ${myLate.length}`, myToday.length && `сегодня ${myToday.length}`, myNoDue.length && `без срока ${myNoDue.length}`].filter(Boolean).join(' · ')}`);
    lines.push(...mineLines.slice(0, 8));
    if (mineLines.length > 8) lines.push(`…и ещё ${mineLines.length - 8} — в трекере`);
  }
  return lines.join('\n');
}

// Daily metrics come from the dashboard (dailyMetrics:<projectId>:<date>), filled in by the team.
async function botBuildMetricsReport(env, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const projects = (await botProjects(kv)).filter((p) => !p.status || /activ|актив/i.test(p.status));
  let prev = botMskStartOfDay(nowMs) - 24 * 3600000;
  while (!botIsWorkday(prev + 12 * 3600000)) prev -= 24 * 3600000;
  const yesterday = botMsk(prev).date;
  const missing = [];
  const alerts = [];
  for (const p of projects) {
    const days = [];
    for (let i = 0; i < 8; i += 1) days.push(botMsk(prev - i * 24 * 3600000).date);
    const recs = await Promise.all(days.map((d) => kv.get(`dailyMetrics:${p.id}:${d}`, 'json')));
    const y = recs[0];
    if (!y) { missing.push(p.name); continue; }
    const before = recs.slice(1).find(Boolean); // previous day with data (skips weekends)
    if (y.budget > 0 && !y.contacts && before && before.budget > 0 && !before.contacts) {
      alerts.push(`• <b>${escapeHtml(p.name)}</b>: 0 контактов два дня подряд при расходе ${y.budget + before.budget} ₽`);
    }
    const week = recs.slice(1).filter(Boolean);
    const wBudget = week.reduce((s, r) => s + (r.budget || 0), 0);
    const wContacts = week.reduce((s, r) => s + (r.contacts || 0), 0);
    if (y.contacts > 0 && wContacts > 0) {
      const cpl = y.budget / y.contacts;
      const avg = wBudget / wContacts;
      if (cpl > avg * 1.3) alerts.push(`• <b>${escapeHtml(p.name)}</b>: CPL ${Math.round(cpl)} ₽ — на ${Math.round((cpl / avg - 1) * 100)}% выше среднего за 7 дней (${Math.round(avg)} ₽)`);
    }
  }
  if (!missing.length && !alerts.length) return null;
  const lines = [`<b>Метрики за ${yesterday.slice(8, 10)}.${yesterday.slice(5, 7)}</b>`];
  if (missing.length) lines.push(`📝 Не внесены в дашборд: ${missing.map(escapeHtml).join(', ')}`);
  if (alerts.length) lines.push('⚠️ Аномалии:', ...alerts);
  return lines.join('\n');
}

// CRM (/sales-crm): leads whose next-action date is overdue, today, or coming up in 2 days.
async function botBuildCrmReminders(env, nowMs) {
  const kv = env.AVITO_KV;
  if (!kv) return null;
  const list = await kv.list({ prefix: 'salescrm:client:' });
  const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
  const today = botMsk(nowMs).date;
  const soonBy = botMsk(nowMs + 2 * 24 * 3600000).date;
  const overdue = [];
  const dueToday = [];
  const soon = [];
  for (const c of records.filter(Boolean)) {
    if (!c.nextActionDate || !SALES_CRM_DATE_RE.test(c.nextActionDate)) continue;
    if (c.status === 'Продажа' || c.status === 'Отказ') continue;
    if (c.nextActionDate < today) overdue.push(c);
    else if (c.nextActionDate === today) dueToday.push(c);
    else if (c.nextActionDate <= soonBy) soon.push(c);
  }
  if (!overdue.length && !dueToday.length && !soon.length) return null;
  const line = (c) => `• <b>${escapeHtml(c.name)}</b>${c.telegram ? ` (@${escapeHtml(c.telegram)})` : ''} — ${c.nextActionDate}`;
  const lines = ['📋 <b>CRM: даты следующих действий</b>'];
  if (overdue.length) lines.push(`🔴 Просрочено: ${overdue.length}`, ...overdue.map(line));
  if (dueToday.length) lines.push(`🟠 Сегодня: ${dueToday.length}`, ...dueToday.map(line));
  if (soon.length) lines.push(`🟡 Скоро (2 дня): ${soon.length}`, ...soon.map(line));
  return lines.join('\n');
}

async function botRunChecks(env, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byId = await botProjectsById(kv);
  const { date, hh, mm } = botMsk(nowMs);
  const workday = botIsWorkday(nowMs);
  const inHours = workday && hh >= BOT_WORK_START_H && hh < BOT_WORK_END_H;
  const allTasks = await botAllTasks(kv);
  // The first run after 10:00 sends the morning summary: what expired overnight goes into it, not
  // into separate "срок вышел" messages on top of it.
  const morning = workday && hh >= 10 && hh < 12 && !(await kv.get(`bot:once:summary:${date}`));
  const team = await atGetTeam(env);
  const ownerId = (team.users.find((u) => u.role === 'owner') || {}).id;

  if (inHours) {
    // Newly overdue / still-without-deadline tasks, one message per kind per run.
    const overdue = [];
    const noDue = [];
    for (const task of allTasks.filter((t) => t.status === 'open')) {
      task.notified = task.notified || {};
      const due = botDueMs(task);
      let changed = false;
      if (due && due < nowMs && !task.notified.overdue) {
        overdue.push(task);
        task.notified.overdue = new Date(nowMs).toISOString();
        changed = true;
      }
      if (!due && !task.notified.noDue && !atIsUnclaimed(task, team.users) && botWorkingMinutes(Date.parse(task.startedAt || task.createdAt), nowMs) >= BOT_NO_DUE_AFTER_WMIN) {
        noDue.push(task);
        task.notified.noDue = new Date(nowMs).toISOString();
        changed = true;
      }
      if (changed) await kv.put(`task:${task.id}`, JSON.stringify(task));
    }
    // The owner isn't pinged about other people's missed deadlines or tasks without one during the
    // day (they are in the 10:00 summary — the owner asked for fewer messages); his own deadlines
    // come in one message from atRunChecks. The flags above still mark what was already counted.
    // Client waiting for an answer: one message per check to the client manager, whose job it is;
    // the owner sees them in the summary. A message nobody answered for over a day is stale (the
    // talk moved on elsewhere, or it needed no answer) — nobody gets pinged about it.
    const waiting = [];
    for (const k of (await kv.list({ prefix: 'bot:pending:' })).keys) {
      const p = await kv.get(k.name, 'json');
      if (!p || botWorkingMinutes(p.since, nowMs) < BOT_CLIENT_REPLY_WMIN) continue;
      if (nowMs - p.since > BOT_CLIENT_REPLY_STALE_MS || botIsAckText(p.text)) continue;
      const chatId = k.name.split(':').pop();
      if (!(await botOnce(kv, `pending:${chatId}:${p.msgId}`, 60 * 60 * 24 * 7))) continue;
      const chat = await kv.get(`bot:chat:${chatId}`, 'json');
      const link = botMessageLink(chatId, null, p.msgId);
      waiting.push(`• <b>${escapeHtml(chat ? chat.title.replace(/^Авито\s*[—-]\s*/, '') : chatId)}</b>: «${escapeHtml(String(p.text).slice(0, 140))}»${link ? ` · <a href="${link}">открыть</a>` : ''}`);
    }
    if (waiting.length) {
      const note = [`💬 <b>Клиенты ждут ответа больше 30 рабочих минут: ${waiting.length}</b>`, ...waiting].join('\n');
      for (const m of team.users.filter((u) => u.role === 'manager' && u.active && u.tgId)) await botSend(env, m.tgId, note);
    }
    try {
      await botQuestionsCron(env, team, nowMs);
    } catch (err) {
      console.error('unanswered questions failed', err && err.stack);
    }
    try {
      await botCheckHandoffs(env, nowMs, allTasks, byId);
    } catch (err) {
      console.error('handoff checks failed', err && err.stack);
    }
  }
  // Avito Tasks: per-person deadline pings and the 10:00 digest (same task objects, so the
  // "notified" flags written above and there end up in one record).
  try {
    await atRunChecks(env, nowMs, allTasks, byId);
  } catch (err) {
    console.error('avito-tasks checks failed', err && err.stack);
  }
  if (!workday) return;
  // 10:00 — morning summary.
  if (hh >= 10 && hh < 12 && (await botOnce(kv, `summary:${date}`, 60 * 60 * 36))) {
    await botNotifyOwner(env, await botBuildSummary(env, nowMs), { reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: AT_PAGE_URL }]] } });
  }
  // 10:00 — CRM: leads due for a follow-up today, overdue, or coming up soon.
  if (hh >= 10 && hh < 12 && (await botOnce(kv, `crm:${date}`, 60 * 60 * 36))) {
    const report = await botBuildCrmReminders(env, nowMs);
    if (report) await botNotifyOwner(env, report);
  }
  // 11:00 — metrics from the dashboard.
  if (hh >= 11 && hh < 13 && (await botOnce(kv, `metrics:${date}`, 60 * 60 * 36))) {
    const report = await botBuildMetricsReport(env, nowMs);
    if (report) await botNotifyOwner(env, report);
  }
  // 13:05 — daily report to each connected client chat.
  if ((hh > 13 || (hh === 13 && mm >= 5)) && hh < 15 && (await botOnce(kv, `reports:${date}`, 60 * 60 * 36))) {
    const missing = [];
    for (const c of (await listByPrefix(kv, 'bot:chat:')).filter((c) => c.kind === 'client')) {
      if (!(await kv.get(`bot:report:${c.id}:${date}`))) missing.push(c.title);
    }
    if (missing.length) await botNotifyOwner(env, `📊 <b>Отчёт до 13:00 не отправлен:</b> ${missing.map(escapeHtml).join(', ')}`);
  }
}

// The client manager's two 2-hour handoffs (working hours):
//   • client → work chat: a request the bot found in the client's chat has to reach the client's
//     topic in the work chat (someone from the team writes there after it, or a specialist takes it);
//   • work chat → client: a done task has to be reported to the client (closed as «клиенту сообщили»).
// Each task is pinged once per handoff, to the manager (Avito Tasks + Telegram); the owner sees
// what is still hanging in the morning summary.
// Internal (specialist → specialist) tasks are skipped, and only the last 3 days are looked at.
async function botCheckHandoffs(env, nowMs, allTasks, byId) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const team = await atGetTeam(env);
  const recent = (iso) => { const ms = Date.parse(iso || 0); return ms && nowMs - ms <= BOT_SLA_LOOKBACK_MS ? ms : 0; };
  const isSpec = (id) => { const u = id && team.users.find((x) => x.id === id); return !!u && (u.role === 'specialist' || u.role === 'trainee'); };
  // A task on the manager (or the owner / assistant) is answered right in the client's chat — there
  // is nothing to pass on to the specialists, so only unassigned client requests are checked.
  const handledInChat = (id) => { const u = id && team.users.find((x) => x.id === id); return !!u && ['manager', 'owner', 'assistant'].includes(u.role); };

  const toHandoff = allTasks.filter((t) => t.status === 'open' && t.origin === 'client' && t.projectId
    && !t.takenAt && !isSpec(atAssigneeId(t, team.users)) && !handledInChat(atAssigneeId(t, team.users)) && !(t.notified && t.notified.handoff)
    && recent(t.startedAt || t.createdAt) && botWorkingMinutes(recent(t.startedAt || t.createdAt), nowMs) >= BOT_HANDOFF_WMIN);
  const toInform = allTasks.filter((t) => t.status === 'done' && atNeedsInform(t, team.users)
    && !(t.notified && t.notified.informLate) && recent(t.doneAt) && botWorkingMinutes(recent(t.doneAt), nowMs) >= BOT_NOT_INFORMED_WMIN);
  if (!toHandoff.length && !toInform.length) return;

  // Work-chat topics by client, read only when there is something to check.
  const topicsByProject = {};
  if (toHandoff.length) {
    const chats = {};
    let cursor;
    for (;;) {
      const list = await kv.list({ prefix: 'bot:topic:', cursor });
      for (const k of list.keys) {
        const [, , chatId, threadId] = k.name.split(':');
        if (!(chatId in chats)) chats[chatId] = await kv.get(`bot:chat:${chatId}`, 'json');
        if (!chats[chatId] || chats[chatId].kind !== 'work') continue;
        const topic = await kv.get(k.name, 'json');
        if (topic && topic.projectId) (topicsByProject[topic.projectId] = topicsByProject[topic.projectId] || []).push([chatId, threadId]);
      }
      if (list.list_complete || !list.cursor) break;
      cursor = list.cursor;
    }
  }

  const managers = team.users.filter((u) => u.role === 'manager' && u.active).map((u) => u.id);
  const touched = [];
  const save = async (task, key, value) => {
    task.notified = { ...(task.notified || {}), [key]: value };
    await kv.put(`task:${task.id}`, JSON.stringify(task));
    touched.push(task.id);
  };
  for (const task of toHandoff) {
    const since = Date.parse(task.startedAt || task.createdAt);
    let passed = false;
    for (const [chatId, threadId] of topicsByProject[task.projectId] || []) {
      const logs = await botReadLogs(kv, chatId, threadId, since, nowMs);
      if (logs.some((e) => e.team !== false && !e.imported)) { passed = true; break; }
    }
    if (passed) { await save(task, 'handoff', 'ok'); continue; }
    await save(task, 'handoff', new Date(nowMs).toISOString());
    const client = botTaskClient(task, byId);
    await atNotify(env, team, managers, { kind: 'handoff', taskId: task.id, text: `${client}: просьба клиента не передана в рабочий чат за 2 часа — ${task.text}` }, {
      text: `⏱ <b>${escapeHtml(client)}: передайте в рабочий чат</b>\nКлиент попросил ${botFmtDate(since)}, в топике клиента с тех пор тишина (2+ рабочих часа).\n«${escapeHtml(task.text)}»${task.link ? ` <a href="${escapeHtml(task.link)}">сообщение</a>` : ''}`,
      extra: atTgButtons(task, false),
    });
  }
  for (const task of toInform) {
    await save(task, 'informLate', new Date(nowMs).toISOString());
    const client = botTaskClient(task, byId);
    await atNotify(env, team, managers, { kind: 'inform', taskId: task.id, text: `${client}: готово больше 2 часов назад, клиенту ещё не сообщили — ${task.text}` }, {
      text: `📨 <b>${escapeHtml(client)}: сообщите клиенту</b>\nСделано ${botFmtDate(Date.parse(task.doneAt))}, клиенту не сообщили уже 2+ рабочих часа.\n«${escapeHtml(task.text)}»`,
      extra: atTgButtons(task, false),
    });
  }
  if (touched.length) await atTouch(kv, touched);
}

// Since the 08.10 deploy Cloudflare fires every 10-minute tick twice (two invocations a few seconds
// apart, one schedule registered), and the second one re-sent the morning summary. Each tick is
// claimed in KV: the invocation that finds it taken stops. Both write, wait, read back — the last
// writer wins, so two that started together still leave only one running.
async function cronClaimTick(env, scheduledTime) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!kv) return true;
  const key = `cron:tick:${Math.floor((Number(scheduledTime) || Date.now()) / 600000)}`;
  try {
    if (await kv.get(key)) return false;
    const me = crypto.randomUUID();
    await kv.put(key, me, { expirationTtl: 60 * 60 });
    await new Promise((r) => setTimeout(r, 1500));
    const owner = await kv.get(key);
    return !owner || owner === me;
  } catch (err) {
    console.error('cron claim failed', err && err.message);
    return true;
  }
}
// Once: «🤖 похоже, сделано?» marks the AI put on tasks from a client's message or a bare «хорошо»
// before such messages stopped counting — they only cluttered the tracker.
async function botDropWeakHintsOnce(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (await kv.get('at:migr:hints-v1')) return;
  await kv.put('at:migr:hints-v1', '1');
  const team = await atGetTeam(env);
  const ours = (name) => !!atMatchUser(String(name || ''), team.users) || /менеджер|cantor/i.test(String(name || ''));
  const touched = [];
  for (const task of await botAllTasks(kv)) {
    const h = task.hint;
    if (!h || (task.status !== 'open' && task.status !== 'done')) continue;
    if (ours(h.from) && !botIsAckText(h.text) && String(h.text || '').trim().length >= 12) continue;
    delete task.hint;
    await kv.put(`task:${task.id}`, JSON.stringify(task));
    touched.push(task.id);
  }
  if (touched.length) await atTouch(kv, touched);
}
async function botScheduled(env) {
  if (!env.CONTROL_BOT_TOKEN || !env.AGENCY_DASHBOARD_KV) return;
  const kv = env.AGENCY_DASHBOARD_KV;
  const setupWas = await kv.get('bot:setup');
  if (setupWas !== BOT_SETUP_VERSION) {
    const res = await botSetup(env);
    if (res.ok && !setupWas) await botNotifyOwner(env, '👋 Бот запущен и настроен. Добавьте его администратором в рабочий чат — дальше я всё делаю сам. /help — что я умею.');
    else if (!res.ok) console.error('control bot setup failed', JSON.stringify(res));
  }
  // Avito Tasks: the first run sets up the team and sends the owner everyone's invite links.
  await atGetTeam(env);
  try {
    await ensureClientsSeedV2(env);
  } catch (err) {
    console.error('clients seed failed', err && err.stack);
  }
  try {
    await atRunProjectMerges(env);
  } catch (err) {
    console.error('project merge failed', err && err.stack);
  }
  try {
    await atEnsureNewMembers(env);
  } catch (err) {
    console.error('team members seed failed', err && err.stack);
  }
  try {
    await botDropWeakHintsOnce(env);
  } catch (err) {
    console.error('hint cleanup failed', err && err.stack);
  }
  try {
    await botProcessQueue(env);
  } catch (err) {
    console.error('control bot queue failed', err && err.stack);
  }
  await botRunChecks(env, Date.now());
}

// Free-text question from the owner. A question about one person's tasks ("какие у Альбины задачи",
// "что делает Евгений") is answered straight from the tracker — exact, no AI. Anything else goes to
// the AI with the whole picture: the team, every open task and the last two weeks' closed ones, the
// clients with their last 7 days of metrics, clients waiting for an answer, this week's reflection,
// and the chat logs (30 days for clients the question names, otherwise the last 3 days).
const BOT_PERSON_TASKS_RE = /задач|дела[ею]т|делает|занят|поручен|на (н[её]м|ней)|что у н|работает над|в работе/i;

async function botAnswerQuestion(env, question) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const now = Date.now();
  const team = await atGetTeam(env);
  const people = team.users.filter((u) => u.active);
  const byId = await botProjectsById(kv);
  const q = ` ${botNorm(question)} `;
  // Declensions: "Агешиной" → "агешин", "Альбины" → "альбин"; short aliases ("Женя" → "Жени") by stem too.
  const hits = (name) => botNorm(name).split(' ').some((w) => w.length > 3 && q.includes(` ${w.slice(0, Math.max(4, w.length - 2))}`));
  const aliasHit = (u) => (u.aliases || []).some((a) => { const w = botNorm(a); return w.length >= 4 && !w.includes(' ') && new RegExp(` ${w.slice(0, -1)}[а-яё]{0,2} `).test(q); });
  const person = atMatchUser(question, people) || (() => { const m = people.filter(aliasHit); return m.length === 1 ? m[0] : null; })();
  // A client sharing the first name ("задачи по Ольге Агешиной") makes it a question about the client.
  const surnameHit = (name) => botNorm(name).split(' ').slice(1).some((w) => hits(w));
  const clientNamed = Object.values(byId).some((p) => (person ? surnameHit(p.name) : hits(p.name)));
  if (person && BOT_PERSON_TASKS_RE.test(question) && !clientNamed && !/клиент|проект/i.test(question.replace(/задач\S*/gi, ''))) {
    const list = await atBuildMyTasks(env, person, false, true);
    return `👤 <b>${escapeHtml(person.name)}</b> · ${escapeHtml(person.roleLabel || AT_ROLES[person.role] || '')}\n${list}`;
  }

  const projects = Object.values(byId);
  // Clients the question names ("что с Шевчуком"): then everything is about them, in more depth.
  const named = new Set(projects.filter((p) => (person ? surnameHit(p.name) : hits(p.name))).map((p) => p.id));
  const about = (pid) => !named.size || named.has(pid);
  const tasks = await botAllTasks(kv);
  const fmt = (ms) => (ms ? botFmtDate(ms) : '—');
  const nameOf = (t) => (t.projectId && byId[t.projectId] ? byId[t.projectId].name : t.topicName || 'без клиента');
  const whoOf = (t) => { const uid = atAssigneeId(t, team.users); const u = uid && team.users.find((x) => x.id === uid); return u ? u.name : t.owner || 'ничья'; };
  const statusOf = (t) => (t.status === 'open' ? (t.takenAt ? 'в работе' : 'новая') : { done: 'сделана, клиенту не сообщили', closed: 'закрыта', cancelled: 'отменена' }[t.status] || t.status);
  const recentMs = now - (named.size ? 45 : 7) * 24 * 3600000;
  const live = (t) => t.status === 'open' || t.status === 'done';
  const shown = tasks.filter((t) => about(t.projectId) && (live(t) || Date.parse(t.updatedAt || t.createdAt || 0) > recentMs))
    .sort((a, b) => Number(live(b)) - Number(live(a)) || nameOf(a).localeCompare(nameOf(b), 'ru'));
  const taskLines = shown.map((t) => {
    const due = botDueMs(t);
    const creator = t.createdById ? (team.users.find((u) => u.id === t.createdById) || {}).name : t.author;
    return `- ${nameOf(t)} | ${String(t.text).slice(0, 150)} | ${whoOf(t)} | ${statusOf(t)} | срок ${due ? `${fmt(due)}${due < now && t.status === 'open' ? ' ПРОСРОЧЕНО' : ''}` : 'нет'} | поставил ${creator || '—'} ${fmt(Date.parse(t.startedAt || t.createdAt || 0))}${t.doneAt ? ` | сделано ${fmt(Date.parse(t.doneAt))}` : ''}`;
  });

  // Last 7 days of the dashboard's daily numbers, per client (day by day for a named client).
  const days = [];
  for (let i = 1; i <= 7; i += 1) days.push(botMsk(now - i * 24 * 3600000).date);
  const inactive = projects.filter((p) => p.inactive && about(p.id)).map((p) => p.name);
  const clientLines = await Promise.all(projects.filter((p) => !p.inactive && about(p.id)).map(async (p) => {
    const recs = (await Promise.all(days.map(async (d) => [d, await kv.get(`dailyMetrics:${p.id}:${d}`, 'json')]))).filter(([, r]) => r);
    const sum = (k) => recs.reduce((acc, [, r]) => acc + (Number(r[k]) || 0), 0);
    const line = `- ${p.name}: за 7 дней бюджет ${sum('budget')} ₽, просмотры ${sum('views')}, контакты ${sum('contacts')}, диагностики ${sum('diagnostics')}, продажи ${sum('sales')} (дней с данными: ${recs.length})`;
    if (!named.size) return line;
    return [line, ...recs.map(([d, r]) => `  ${d}: бюджет ${Number(r.budget) || 0}, просмотры ${Number(r.views) || 0}, контакты ${Number(r.contacts) || 0}, диагностики ${Number(r.diagnostics) || 0}, продажи ${Number(r.sales) || 0}`)].join('\n');
  }));
  if (inactive.length) clientLines.push(`- неактивные: ${inactive.join(', ')}`);

  const pending = (await botPendingList(env, now)).filter((p) => about(p.projectId))
    .map((p) => `- ${p.projectId && byId[p.projectId] ? byId[p.projectId].name : p.title}: «${String(p.text).slice(0, 160)}» — ждёт с ${fmt(p.since)}`);

  let reflLines = [];
  try {
    const week = reflWeek(now);
    const recs = await Promise.all(people.filter((u) => REFL_READ_ROLES.has(u.role)).map(async (u) => [u, await kv.get(`refl:${week}:${u.id}`, 'json')]));
    reflLines = recs.flatMap(([u, r]) => Object.entries((r && r.answers) || {}).filter(([pid]) => about(pid))
      .map(([pid, a]) => `- ${(byId[pid] || {}).name || pid}: ${u.name} — ${a.score}/10, «${String(a.comment || '').slice(0, 200)}»`));
  } catch (err) { /* reflection is optional context */ }

  // Chats: the clients the question names (30 days), otherwise everything from the last 3 days.
  const chats = await listByPrefix(kv, 'bot:chat:');
  const sources = [];
  for (const c of chats) {
    if (c.isForum) {
      for (const k of (await kv.list({ prefix: `bot:topic:${c.id}:` })).keys) {
        const rec = await kv.get(k.name, 'json');
        sources.push({ chatId: c.id, threadId: k.name.split(':').pop(), projectId: rec && rec.projectId, name: (rec && rec.projectId && byId[rec.projectId] && byId[rec.projectId].name) || (rec && rec.name) || '' });
      }
      sources.push({ chatId: c.id, threadId: '0', name: 'Общий топик' });
    } else {
      sources.push({ chatId: c.id, threadId: '0', projectId: c.projectId, name: (c.projectId && byId[c.projectId] && byId[c.projectId].name) || c.title });
    }
  }
  const focused = sources.filter((src) => (src.projectId && named.has(src.projectId)) || hits(src.name));
  const picked = focused.length ? focused : sources;
  const span = focused.length ? 30 : 3;
  const chatParts = [];
  for (const src of picked) {
    const logs = await botReadLogs(kv, src.chatId, src.threadId, now - span * 24 * 3600000, now);
    if (logs.length) chatParts.push(`### ${src.name}\n${botFormatLogLines(logs)}`);
  }

  // The model takes 32k tokens in all, and Russian runs ~2–3 characters a token: the context is
  // cut to a character budget — the chats first (oldest lines go), then the closed tasks.
  const d = botMsk(now);
  const build = (budget) => {
    const head = [
      `СЕЙЧАС: ${d.date} ${fmt(now).split(' ')[1]} (МСК), ${['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][d.dow]}.`,
      `КОМАНДА:\n${people.map((u) => `- ${u.name} — ${u.roleLabel || AT_ROLES[u.role] || u.role}`).join('\n')}`,
      `КЛИЕНТЫ И МЕТРИКИ (из дашборда${named.size ? '' : ', все клиенты'}):\n${clientLines.join('\n') || '—'}`,
      `КЛИЕНТЫ ЖДУТ ОТВЕТА В ЧАТЕ:\n${pending.join('\n') || '—'}`,
      `РЕФЛЕКСИЯ ЭТОЙ НЕДЕЛИ (оценки проектов командой):\n${reflLines.join('\n') || '—'}`,
    ].join('\n\n');
    let lines = taskLines;
    const taskTitle = `ЗАДАЧИ (${named.size ? 'по клиентам из вопроса: открытые и за 45 дней' : 'все открытые и изменённые за 7 дней'}; формат: клиент | задача | исполнитель | статус | срок | кто и когда поставил)`;
    const taskBudget = Math.floor(budget * 0.45);
    let cut = 0;
    while (lines.join('\n').length > taskBudget && lines.length) { lines = lines.slice(0, -1); cut += 1; }
    const taskBlock = `${taskTitle}:\n${lines.join('\n') || '—'}${cut ? `\n(ещё ${cut} задач не поместились — в основном закрытые)` : ''}`;
    let chat = chatParts.join('\n\n');
    const room = Math.max(0, budget - head.length - taskBlock.length - 300);
    if (chat.length > room) chat = `…${chat.slice(-room)}`;
    return [head, taskBlock, `ПЕРЕПИСКА (${focused.length ? 'по клиентам из вопроса, 30 дней' : 'все чаты, последние 3 дня'}; формат [id] дата автор: текст):\n${chat || '—'}`].join('\n\n');
  };
  const system = [
    'Ты — умный помощник руководителя агентства Cantor Agency (продвижение репетиторов на Авито). Отвечаешь Олегу Ежкову в Telegram.',
    'Ниже — актуальные данные из трекера задач, дашборда и рабочих чатов. Отвечай ТОЛЬКО по ним, но пользуйся ими по-настоящему:',
    'фильтруй, считай, сравнивай, группируй (по людям, клиентам, срокам). Вопросы о задачах — по разделу ЗАДАЧИ',
    '(исполнитель, статус, срок), о цифрах — по КЛИЕНТЫ И МЕТРИКИ, о том, что обсуждали, — по ПЕРЕПИСКЕ.',
    'На вопрос «что с клиентом» ответь сводкой: что сейчас делаем (открытые задачи, кто и к какому сроку), что сделано недавно,',
    'что клиент просил и ждёт ли ответа, как идут цифры, и есть ли проблемы.',
    'Имена в вопросе могут быть в любом падеже и уменьшительными (Альбины, Жени, Шевчуком) — сопоставляй с КОМАНДОЙ и клиентами.',
    'Ответ: по-русски, коротко и конкретно, сначала главное. Списки — строками с «• ». Без markdown-таблиц и решёток.',
    'Если данных для ответа нет — скажи прямо, чего именно не хватает, и не выдумывай.',
  ].join('\n');
  let lastErr = null;
  for (const budget of [36000, 18000]) {
    try {
      const answer = await botAi(env, system, `Вопрос: ${question}\n\n${build(budget)}`, 1200);
      return escapeHtml(answer || 'Не получилось сформулировать ответ.').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#+\s*/gm, '');
    } catch (err) {
      if (botIsLimitError(err)) { await botSetAiLimited(env, true); return '🔴 Лимит ИИ на сегодня исчерпан — отвечу, когда он обновится. Про задачи человека можно спросить и сейчас: «какие задачи у Альбины».'; }
      lastErr = err;
      if (!/context length|input_tokens|too long/i.test(String(err && err.message))) break; // only a too-long prompt is worth a smaller retry
    }
  }
  console.error('bot answer failed', lastErr && lastErr.message);
  return 'Не получилось ответить — спросите конкретнее: про одного клиента или человека.';
}

// History import from a Telegram Desktop export (the bot can't read messages sent before it joined):
// the work chat's topics or a client chat. The messages go into one bot:hist key per topic/chat
// (one KV write per chat, not one per day — writes are the scarce resource on the free plan); the
// AI treats them as context only, and the open tasks found in them come in as `tasks`. Sent one
// chat (or a few topics) per request.
//   POST /api/tgbot/import  (x-dashboard-password)
//   { chatId? | chatTitle?, topics: { <threadId>: name }, entries: [{ thread, id, t, from, team, text, reply }], tasks: [...] }
// chatTitle ("Авито — Ольга Агешина", as in the export) finds the client chat the bot is in; with
// neither, the work chat is used.
// «Ссылка для подключения сотрудников» (приглашение в кабинет Авито клиента), отправленная командой в
// топик клиента рабочего чата или в чат клиента, сохраняется в карточку клиента — кнопка «Кабинет»
// в Avito Tasks. В журнал переписки ссылка попадает скрытой, как и раньше.
const BOT_STAFF_LINK_RE = /https?:\/\/(?:www\.)?avito\.ru\/(?:to\/)?employees\/invite\/[A-Za-z0-9_-]+/i;
async function botSaveStaffLink(env, chatRec, threadId, text) {
  const m = String(text || '').match(BOT_STAFF_LINK_RE);
  if (!m) return;
  const kv = env.AGENCY_DASHBOARD_KV;
  let projectId = chatRec.kind === 'client' ? chatRec.projectId : null;
  if (chatRec.kind === 'work') {
    const topic = await kv.get(`bot:topic:${chatRec.id}:${threadId}`, 'json');
    projectId = topic && topic.projectId;
  }
  const project = projectId && (await kv.get(`project:${projectId}`, 'json'));
  if (!project || project.staffUrl === m[0]) return;
  await kv.put(`project:${projectId}`, JSON.stringify({ ...project, staffUrl: m[0], updatedAt: new Date().toISOString() }));
  await atTouch(kv, ['#projects']);
}
function botRedactSecrets(text) {
  return String(text || '')
    // API keys / client secrets pasted into chats: long unbroken letter+digit runs.
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g, '[скрыто]')
    // Clients' Avito passwords: "пароль: Abc123", "Password Abc123", "abc123-пароль",
    // and "login@mail.ru Abc123" (an email followed by something with a digit in it).
    .replace(/(парол[ьяе]|password)(\s*(?:от\s+[а-яё]+\s*)?[:=\-–—]?\s*)[A-Za-z0-9_!@#$%^&*.+?-]{5,}/gi, '$1$2[скрыто]')
    .replace(/[A-Za-z0-9_!@#$%^&*.+?]{5,}(\s*[-–—]\s*парол[ьяе])/gi, '[скрыто]$1')
    .replace(/([\w.+-]+@[\w-]+\.[\w.]+[\s,;:]+)(?=\S*\d)[A-Za-z0-9_!@#$%^&*.+?-]{5,}/g, '$1[скрыто]');
}
async function botFindImportChat(kv, body) {
  const chats = await listByPrefix(kv, 'bot:chat:');
  if (body.chatId) return chats.find((c) => String(c.id) === String(body.chatId)) || null;
  if (body.chatTitle) {
    const clientChats = chats.filter((c) => !c.isForum);
    const title = botNorm(body.chatTitle);
    // A basic group that became a supergroup leaves a second record with the same title: the newer one is live.
    const exact = clientChats.filter((c) => botNorm(c.title) === title)
      .sort((a, b) => (Date.parse(b.addedAt || 0) || 0) - (Date.parse(a.addedAt || 0) || 0));
    if (exact.length) return exact[0];
    const project = botMatchProject(body.chatTitle, await botProjects(kv));
    const byProject = project ? clientChats.filter((c) => c.projectId === project.id) : [];
    return byProject.length === 1 ? byProject[0] : null;
  }
  const forums = chats.filter((c) => c.isForum);
  return forums.length === 1 ? forums[0] : null;
}
async function handleBotImport(request, env) {
  if (!checkDashboardAuth(request)) return json({ error: 'unauthorized' }, 401);
  const kv = env.AGENCY_DASHBOARD_KV;
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_json' }, 400);
  const chatRec = await botFindImportChat(kv, body);
  if (!chatRec) {
    const chats = await listByPrefix(kv, 'bot:chat:');
    return json({
      error: 'chat_unknown',
      message: body.chatTitle ? `Бот не знает чат «${body.chatTitle}» — добавьте бота в него (или передайте chatId)` : 'Добавьте бота в рабочий чат (или передайте chatId)',
      chats: chats.map((c) => ({ id: c.id, title: c.title, kind: c.kind, projectId: c.projectId || null })),
    }, 409);
  }
  const chatId = chatRec.id;
  const result = { chatId, title: chatRec.title, projectId: chatRec.projectId || null, topics: 0, entries: 0, tasks: 0 };

  if (chatRec.isForum) {
    for (const [thread, name] of Object.entries(body.topics || {})) {
      const key = `bot:topic:${chatId}:${thread}`;
      const known = await kv.get(key, 'json');
      if (!known || /^Топик \d+$/.test(known.name)) { await botSetTopicName(kv, chatId, thread, name); result.topics += 1; }
    }
  }

  const groups = new Map();
  let lastTeamMs = 0;
  for (const e of Array.isArray(body.entries) ? body.entries : []) {
    if (!e || !Number.isFinite(e.id) || !Number.isFinite(e.t) || !e.text) continue;
    const thread = chatRec.isForum ? String(e.thread || 0) : '0';
    if (!groups.has(thread)) groups.set(thread, []);
    const team = e.team !== false;
    groups.get(thread).push({ id: e.id, t: e.t, from: String(e.from || '?').slice(0, 80), fromId: null, team, text: botRedactSecrets(e.text).slice(0, 4000), reply: e.reply || null, imported: true });
    if (team) lastTeamMs = Math.max(lastTeamMs, e.t);
  }
  for (const [thread, list] of groups) {
    const key = `bot:hist:${chatId}:${thread}`;
    const existing = (await kv.get(key, 'json')) || [];
    const byKey = new Map(existing.map((x) => [`${x.t}|${x.id}`, x]));
    for (const x of list) byKey.set(`${x.t}|${x.id}`, x); // a re-import replaces the same messages
    const merged = [...byKey.values()].sort((a, b) => a.t - b.t);
    await kv.put(key, JSON.stringify(merged), { expirationTtl: BOT_LOG_TTL });
    result.entries += list.length;
  }

  // "When did we last write to this client" (Avito Tasks' Clients tab, the stale-clients digest).
  if (!chatRec.isForum && chatRec.projectId && lastTeamMs) {
    const clients = (await kv.get('at:clients', 'json')) || {};
    const rec = clients[chatRec.projectId] || {};
    if (lastTeamMs > (Date.parse(rec.lastTeamAt || 0) || 0)) {
      clients[chatRec.projectId] = { ...rec, lastTeamAt: new Date(lastTeamMs).toISOString() };
      await kv.put('at:clients', JSON.stringify(clients));
      await atTouch(kv, ['#clients']);
    }
  }

  const nowIso = new Date().toISOString();
  const importedIds = [];
  const users = Array.isArray(body.tasks) && body.tasks.length ? (await atGetTeam(env)).users : [];
  for (const t of Array.isArray(body.tasks) ? body.tasks : []) {
    if (!t || !t.text || !t.importKey) continue;
    const id = `imp${String(t.importKey).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;
    if (await kv.get(`task:${id}`)) continue;
    const who = t.owner ? atMatchUser(String(t.owner), users) : null;
    const thread = chatRec.isForum ? Number(t.thread || 0) : 0;
    const topic = chatRec.isForum ? await kv.get(`bot:topic:${chatId}:${thread}`, 'json') : { name: chatRec.title, projectId: chatRec.projectId };
    const dueMs = botParseMskDateTime(t.due);
    await kv.put(`task:${id}`, JSON.stringify({
      id,
      text: String(t.text).slice(0, 300),
      status: 'open',
      owner: who ? who.name : t.owner || null,
      assigneeId: who ? who.id : null,
      priority: AT_PRIORITIES.includes(t.priority) ? t.priority : 'normal',
      due: dueMs ? botIsoMsk(dueMs) : null,
      projectId: (topic && topic.projectId) || null,
      topicName: topic ? topic.name : null,
      source: 'bot',
      origin: 'import',
      chatId,
      threadId: thread,
      msgId: t.msgId || null,
      // Export ids are the bot's own only in supergroups (basic groups have no message links anyway).
      link: t.msgId ? botMessageLink(chatId, chatRec.isForum ? thread : null, t.msgId) : null,
      author: t.author || null,
      note: t.note || null,
      startedAt: Number.isFinite(t.t) ? new Date(t.t).toISOString() : nowIso,
      // Old backlog: counted in /summary and /tasks, but no individual "no deadline" pings.
      notified: { noDue: nowIso, overdue: dueMs && dueMs < Date.now() ? nowIso : undefined },
      activity: [{ t: Date.now(), by: 'Бот', what: 'нашёл задачу в истории чата (импорт)' }],
      createdAt: nowIso,
      updatedAt: nowIso,
    }));
    result.tasks += 1;
    importedIds.push(id);
  }
  if (importedIds.length) await atTouch(kv, importedIds);
  return json({ ok: true, ...result });
}

async function handleBotApi(request, env, url) {
  if (url.pathname === '/api/tgbot/webhook' && request.method === 'POST') return handleBotWebhook(request, env);
  if (url.pathname === '/api/tgbot/import' && request.method === 'POST') return handleBotImport(request, env);
  // Manual re-setup (normally the cron does it): GET /api/tgbot/setup?key=<dashboard password>
  if (url.pathname === '/api/tgbot/setup') {
    if (url.searchParams.get('key') !== DASHBOARD_PASSWORD) return json({ error: 'unauthorized' }, 401);
    return json(await botSetup(env));
  }
  return json({ error: 'not_found' }, 404);
}

// ── /avito-tasks: the team's task tracker ──
// Page: /avito-tasks, kept apart from /dashboard. Its API lives under /api/dashboard/avito-tasks/*
// for the same reason as the academy's: the Yandex Cloud proxy (yc-dashboard-api-proxy) only lets
// /api/dashboard/* through, so the page works in Russia without a VPN.
// Access is per person, by invite link (/avito-tasks?invite=<code>): opening it once gives the
// device a signed token (kept in localStorage), after which the bare /avito-tasks opens on that
// device. The owner (role "owner") adds people, switches access off and re-issues links in the
// page's «Команда» tab; a re-issued link signs every device of that person out. The owner's own
// link comes from the control bot (sent once when the team is first set up, and on /access).
// Tasks are the same `task:<id>` records the control bot writes (source 'bot') plus ones created
// on the page (source 'tracker'); the bot's summaries and deadline checks cover both.
// Notifications: an in-page list and, once the person has pressed «Подключить Telegram» (a /start
// deep link into the control bot), private messages from the bot: new task for them, deadline in
// an hour / missed, their task done, a 10:00 digest.
// The page polls /sync every minute while it is open; to keep KV reads low the task list is cached
// in the isolate and only the tasks named in at:ver's change log are re-read (full re-read every
// 10 minutes as a safety net). The first sync of a page load also nudges the bot's AI queue, so
// someone opening the page gets tasks from the latest chat messages without waiting for the cron.
//
// KV keys (AGENCY_DASHBOARD_KV, "at:" prefix):
//   at:team            -> { secret, users: [{ id, name, role, roleLabel, aliases, invite, v, active,
//                           tgId, tgUsername, createdAt, activatedAt }] }
//   at:ver             -> { v, log: [[v, taskId | '#projects' | '#clients'], ...] }  bumped on every change
//   at:notif:<userId>  -> [{ id, t, kind, taskId, ref, text, by, read }]  (latest 60; ref: 'kb:<jobId>' for «База знаний»)
//   at:seen:<userId>   -> ISO time the person last opened the page (written at most every 3 h)
//   at:clients         -> { <projectId>: { lastUpdateAt, by, note, lastTeamAt } }
//   at:act:<userId>:<date>  -> { slots: [0..143] }  10-minute slots the person was active on the page
//   at:chatact2:<date> -> per-person chat message counts by hour for a finished day (cache)
//   bot:me             -> the control bot's @username (for the «Подключить Telegram» link)
//   bot:qrun           -> last time a page visit kicked the AI queue
//   kb:*               -> «База знаний» update requests — see "Avito Tasks → «База знаний»" below
//   refl:<wed>:<userId> -> «Рефлексия» for the week starting on that Wednesday — see below
//   mail:<YYYY-MM>     -> «Рассылки» for that month — see atMailApi
//   at:owners          -> who leads which client and its priority — see atLoadOwners

const AT_PAGE_URL = 'https://cantor.agency/avito-tasks';
const AT_OWNER_TG = 'oleg_ezhkov';
const AT_ROLES = {
  owner: 'Руководитель',
  manager: 'Клиентский менеджер',
  specialist: 'Специалист по Авито',
  trainee: 'Стажёр по Авито',
  assistant: 'Ассистент', // same access as the owner, except the owner's own record
};
// Tracker sections («Задачи» is always on). By default they follow the role; the owner can turn
// any section on or off for a person in Команда → Доступы (user.sections), the owner always has all.
const AT_SECTIONS = ['tasks', 'clients', 'analytics', 'meet', 'mail', 'reflection', 'team', 'kb'];
const AT_ROLE_SECTIONS = {
  owner: AT_SECTIONS,
  assistant: AT_SECTIONS,
  manager: ['tasks', 'clients', 'analytics', 'meet', 'reflection'],
  specialist: ['tasks', 'meet', 'reflection'],
  trainee: ['tasks', 'meet', 'reflection'],
};
function atSections(u) {
  if (!u || u.role === 'owner') return AT_SECTIONS.slice();
  const s = Array.isArray(u.sections) ? u.sections : AT_ROLE_SECTIONS[u.role] || ['tasks'];
  return AT_SECTIONS.filter((k) => k === 'tasks' || s.includes(k));
}
const AT_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const AT_PRIORITY_LABEL = { urgent: 'срочно', high: 'высокий', normal: 'обычный', low: 'низкий' };
const AT_FULL_REBUILD_MS = 10 * 60 * 1000;
const AT_SEEN_EVERY_MS = 3 * 60 * 60 * 1000;
const AT_NOTIF_KEEP = 60;
const AT_HIDE_CLOSED_AFTER_MS = 21 * 24 * 3600000;

const AT_SEED_USERS = [
  { id: 'oleg', name: 'Олег Ежков', role: 'owner', aliases: ['Олег', 'Oleg'] },
  { id: 'olga', name: 'Ольга Шпаковская', role: 'manager', aliases: ['Ольга', 'Оля', 'Менеджер Cantor Agency', 'КМ'] },
  { id: 'evgeny', name: 'Евгений Исаев', role: 'specialist', aliases: ['Евгений', 'Женя'] },
  { id: 'albina', name: 'Альбина', role: 'trainee', aliases: ['Альбина'] },
  { id: 'ekaterina', name: 'Екатерина', role: 'trainee', aliases: ['Екатерина', 'Катя'] },
];

let AT_MEM = null; // { v, builtAt, stamp, tasks: Map, projects, chats, pending, clients }
let AT_BOT_USERNAME = null;
let AT_QUEUE_KICKED_AT = 0;

function atRandom(len) {
  let s = '';
  while (s.length < len) s += crypto.randomUUID().replace(/-/g, '');
  return s.slice(0, len);
}
async function atHmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function atFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}
function atInviteUrl(user) {
  return `${AT_PAGE_URL}?invite=${user.invite}`;
}
function atClean(value, max) {
  return String(value == null ? '' : value).replace(/\r/g, '').trim().slice(0, max);
}

// Next working day (or today, when asked and it is one) at hh:00 MSK, as epoch ms.
function atWorkdayAt(nowMs, hh, includeToday) {
  let day = botMskStartOfDay(nowMs) + (includeToday ? 0 : 24 * 3600000);
  while (!botIsWorkday(day + 12 * 3600000)) day += 24 * 3600000;
  return day + hh * 3600000;
}

// ── team ──
async function atGetTeam(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const team = await kv.get('at:team', 'json');
  return team || atSeedTeam(env);
}
async function atPutTeam(kv, team) {
  await kv.put('at:team', JSON.stringify(team));
}
// First run: the five people the owner named, a starter task list (the owner's own reminders) and
// a message to the owner with everyone's invite links.
async function atSeedTeam(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const ownerTg = botOwnerIds(env)[0] || null;
  const team = {
    secret: atRandom(48),
    users: AT_SEED_USERS.map((u) => ({
      ...u,
      roleLabel: AT_ROLES[u.role],
      invite: atRandom(16),
      v: 1,
      active: true,
      tgId: u.role === 'owner' ? ownerTg : null,
      tgUsername: u.role === 'owner' ? AT_OWNER_TG : null,
      createdAt: now,
      activatedAt: null,
    })),
    seededAt: now,
  };
  await atPutTeam(kv, team);

  const seedTasks = [
    {
      text: 'Добавить бота во все чаты с клиентами',
      note: 'Сейчас бот есть только в рабочем чате «Авито». Добавить его администратором в чат каждого клиента — '
        + 'тогда трекер увидит вопросы клиентов, ответы команды и подсветит клиентов, которым давно не писали. '
        + 'В чатах клиентов бот молчит и пишет только в личку.',
      priority: 'high',
      due: atWorkdayAt(nowMs, 18, false),
    },
    {
      text: 'Выгрузить историю чатов с клиентами для базы знаний бота',
      note: 'Telegram Desktop → чат клиента → ⋮ → «Экспорт истории чата» → формат JSON, без медиа. '
        + 'По каждому клиенту (и рабочий чат целиком). Архивы передать Claude — он загрузит их в бота как исходную базу знаний.',
      priority: 'high',
      due: atWorkdayAt(nowMs, 18, false) + 24 * 3600000,
    },
    {
      text: 'Разослать команде ссылки в Avito Tasks и попросить подключить Telegram',
      note: 'Вкладка «Команда» → у каждого «Отправить в Telegram». После входа человек жмёт «Подключить Telegram» — '
        + 'и бот начнёт присылать ему задачи и напоминания о сроках.',
      priority: 'normal',
      due: atWorkdayAt(nowMs, 18, true),
    },
  ];
  const ids = [];
  for (const s of seedTasks) {
    const id = `tr${atRandom(10)}`;
    ids.push(id);
    await kv.put(`task:${id}`, JSON.stringify({
      id,
      text: s.text,
      note: s.note,
      status: 'open',
      priority: s.priority,
      owner: 'Олег Ежков',
      assigneeId: 'oleg',
      due: botIsoMsk(s.due),
      projectId: null,
      source: 'tracker',
      origin: 'tracker',
      author: 'Олег Ежков',
      createdById: 'oleg',
      startedAt: now,
      notified: {},
      activity: [{ t: nowMs, by: 'Claude', what: 'поставил(а) задачу' }],
      createdAt: now,
      updatedAt: now,
    }));
  }
  await atTouch(kv, ids);
  if (env.CONTROL_BOT_TOKEN) await botNotifyOwner(env, atAccessMessage(team, true));
  return team;
}
// People added to the team after it was first set up (2026-10-01: София, ассистент). Each is added
// once, with Telegram already tied (so the bot can write to her as soon as she has opened it), and
// gets her invite link from the bot; the owner is told either way.
const AT_NEW_MEMBERS = [
  { id: 'sofia', name: 'София Романовна', role: 'assistant', aliases: ['София', 'Софья', 'Соня'], tgId: '993366229', tgUsername: 'sofiuspasskaya' },
  { id: 'stanislav', name: 'Станислав', role: 'trainee', aliases: ['Станислав', 'Стас'], tgId: '426349175' },
];
// The access message for a new member: their own invite link (both addresses) and what the bot does.
// Sent when they are added — or, if they hadn't opened the bot yet (Telegram doesn't let a bot write
// first), as soon as they press Start.
async function atWelcomeMember(env, user) {
  const res = await botApi(env, 'sendMessage', {
    chat_id: Number(user.tgId),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text: [
      `<b>${escapeHtml(atFirstName(user.name))}, вас добавили в Avito Tasks</b> — трекер задач команды Cantor Agency.`,
      '',
      'Откройте свою ссылку один раз — дальше трекер будет открываться на этом устройстве сам:',
      atInviteUrl(user),
      `Если без VPN не открывается: ${BOT_WORKER_ORIGIN}/avito-tasks?invite=${user.invite}`,
      '',
      'Telegram уже подключён: сюда будут приходить ваши задачи, напоминания о сроках и сводка в 10:00. /tasks — ваши задачи.',
    ].join('\n'),
    reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: atInviteUrl(user) }]] },
  });
  if (!res || !res.ok) return false;
  await botApi(env, 'setMyCommands', { commands: AT_EMPLOYEE_COMMANDS, scope: { type: 'chat', chat_id: Number(user.tgId) } });
  const team = await atGetTeam(env);
  const rec = team.users.find((u) => u.id === user.id);
  if (rec && !rec.welcomedAt) { rec.welcomedAt = new Date().toISOString(); await atPutTeam(env.AGENCY_DASHBOARD_KV, team); }
  return true;
}
async function atEnsureNewMembers(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  for (const m of AT_NEW_MEMBERS) {
    const flag = `at:member-added:${m.id}`;
    if (await kv.get(flag)) continue;
    await kv.put(flag, '1');
    const team = await atGetTeam(env);
    if (team.users.some((u) => u.id === m.id || String(u.tgId) === m.tgId)) continue;
    const user = {
      ...m, roleLabel: AT_ROLES[m.role], invite: atRandom(16), v: 1, active: true,
      createdAt: new Date().toISOString(), activatedAt: null,
    };
    team.users.push(user);
    await atPutTeam(kv, team);
    await atTouch(kv, ['#team']);
    const sent = await atWelcomeMember(env, user);
    await botNotifyOwner(env, [
      `👤 <b>В команду добавлен(а) ${escapeHtml(user.name)}</b> — ${escapeHtml(user.roleLabel)}${user.tgUsername ? ` (@${escapeHtml(user.tgUsername)})` : ''}.`,
      sent
        ? 'Бот уже отправил ссылку на трекер и будет присылать задачи.'
        : `Бот пока не может написать: человек ещё не открывал бота. Как только нажмёт Start — бот сам пришлёт ссылку на трекер. Ссылка на всякий случай:\n${atInviteUrl(user)}`,
    ].join('\n'));
  }
}

function atAccessMessage(team, first) {
  const owner = team.users.find((u) => u.role === 'owner');
  const lines = [first ? '🗂 <b>Avito Tasks готов</b> — трекер задач команды.' : '🔑 <b>Avito Tasks — доступы</b>'];
  if (owner) lines.push('', `Ваша ссылка (откройте один раз на каждом своём устройстве):\n${atInviteUrl(owner)}`);
  const others = team.users.filter((u) => u.role !== 'owner');
  if (others.length) {
    lines.push('', '<b>Ссылки сотрудников</b> — у каждого своя:');
    for (const u of others) lines.push(`${u.active ? '•' : '⛔'} ${escapeHtml(u.name)} — ${escapeHtml(u.roleLabel)}\n${atInviteUrl(u)}`);
  }
  lines.push('', 'Отключить доступ, выдать новую ссылку или добавить человека — вкладка «Команда» в трекере.');
  return lines.join('\n');
}
function atPublicUser(u) {
  return { id: u.id, name: u.name, role: u.role, roleLabel: u.roleLabel, active: !!u.active, tg: !!u.tgId };
}
async function atAuth(team, token) {
  const [id, v, sig] = String(token || '').split('.');
  const user = team.users.find((u) => u.id === id);
  if (!user || String(user.v) !== v || !sig) return { error: 'no_access' };
  if (sig !== (await atHmac(team.secret, `s:${id}.${v}`)).slice(0, 32)) return { error: 'no_access' };
  if (!user.active) return { error: 'blocked' };
  return { user };
}
async function atToken(team, user) {
  return `${user.id}.${user.v}.${(await atHmac(team.secret, `s:${user.id}.${user.v}`)).slice(0, 32)}`;
}
async function atTgStartParam(team, user) {
  return `at_${user.id}_${(await atHmac(team.secret, `tg:${user.id}.${user.v}`)).slice(0, 16)}`;
}
// A name in Latin letters, spelled loosely: Telegram names are often typed in Latin ("al'bina",
// "Evgeny"), the team list is in Cyrillic ("Альбина", "Евгений") — both come out as "albina",
// "evgeni". Used as a second try when the plain comparison finds nobody.
function atLatin(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').split('').map((c) => (c in BOT_TRANSLIT ? BOT_TRANSLIT[c] : c)).join('')
    .replace(/['’ʼ`´]/g, '').replace(/kh/g, 'h').replace(/[yj]/g, 'i').replace(/i+/g, 'i')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Team member named in free text ("Евгений", "Менеджер — Cantor Agency", "Женя", "al'bina"), or null.
const AT_NAME_FORMS = {
  екатерина: ['катерина', 'катя', 'катю', 'кати', 'кате'],
  евгений: ['женя', 'жене', 'жени', 'женю', 'евгению', 'евгения'],
  евгения: ['женя', 'жене', 'жени', 'женю'],
  ольга: ['оля', 'оле', 'оли', 'олю', 'ольге', 'ольги', 'ольгу'],
  александр: ['саша', 'саше', 'саши', 'сашу'],
  александра: ['саша', 'саше', 'саши', 'сашу'],
  анастасия: ['настя', 'насте', 'насти', 'настю'],
  мария: ['маша', 'маше', 'маши', 'машу'],
  наталья: ['наташа', 'наташе', 'наташи', 'наталия'],
  наталия: ['наташа', 'наташе', 'наташи', 'наталья'],
  елена: ['лена', 'лене', 'лены', 'лену'],
  татьяна: ['таня', 'тане', 'тани', 'таню'],
  анна: ['аня', 'ане', 'ани', 'аню'],
  дарья: ['даша', 'даше', 'даши', 'дашу'],
  юлия: ['юля', 'юле', 'юли', 'юлю'],
  софия: ['соня', 'соне', 'сони', 'софья'],
  альбина: ['аля'],
};
function atMatchUser(name, users) {
  return atMatchUserBy(name, users, botNorm) || atMatchUserBy(name, users, atLatin);
}
function atMatchUserBy(name, users, norm) {
  const n = ` ${norm(name)} `;
  if (!n.trim()) return null;
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const u of users) {
    let score = 0;
    const full = norm(u.name);
    if (full && n.includes(` ${full} `)) score = 3;
    // «@SEEREKAG» in a message is that person's Telegram username.
    const tg = u.tgUsername ? norm(u.tgUsername) : '';
    if (tg && n.includes(` ${tg} `)) score = 3;
    for (const a of u.aliases || []) {
      const an = norm(a);
      if (an && n.includes(` ${an} `)) score = Math.max(score, an.includes(' ') ? 3 : 2);
    }
    const first = norm(atFirstName(u.name));
    // Everyday forms of the first name ("Катерина", "Катя" → Екатерина), whole words only.
    for (const alt of AT_NAME_FORMS[botNorm(atFirstName(u.name))] || []) {
      if (n.includes(` ${norm(alt)} `)) score = Math.max(score, 2);
    }
    if (!score && first.length >= 4 && n.includes(` ${first.slice(0, first.length - 1)}`)) score = 1;
    if (score > bestScore) { best = u; bestScore = score; tie = false; } else if (score && score === bestScore && best !== u) tie = true;
  }
  return tie ? null : best;
}
function atAssigneeId(task, users) {
  if (task.assigneeId) return task.assigneeId;
  const u = task.owner ? atMatchUser(task.owner, users) : null;
  return u ? u.id : null;
}
// Found by the bot with nobody named: waits at the top of the tracker for someone to take it.
function atIsUnclaimed(task, users) {
  return !!task && task.status === 'open' && !atAssigneeId(task, users) && !task.owner;
}
function atIsTrackerTask(t) {
  return !!t && (t.source === 'bot' || t.source === 'tracker');
}
// Tasks specialists pass between themselves (set by a specialist or trainee for one of them, not
// taken from the client's chat) are the team's own business: there is nothing to tell the client,
// so they never go to the client manager — «Готово» closes them straight away.
function atIsInternalTask(task, users) {
  if (!task || task.origin === 'client') return false;
  const isSpec = (u) => !!u && (u.role === 'specialist' || u.role === 'trainee');
  const author = task.createdById ? users.find((u) => u.id === task.createdById) : task.author ? atMatchUser(task.author, users) : null;
  if (!isSpec(author)) return false;
  const aid = atAssigneeId(task, users);
  return !aid || isSpec(users.find((u) => u.id === aid));
}
// A finished task whose result the client manager passes on to the client.
function atNeedsInform(task, users) {
  return !!task && !!task.projectId && !atIsInternalTask(task, users);
}
function atTeamPromptLine(team) {
  return team.users.filter((u) => u.active).map((u) => {
    const aka = (u.aliases || []).filter((a) => botNorm(a) !== botNorm(atFirstName(u.name)));
    return `${u.name} — ${u.roleLabel}${u.tgUsername ? `, Telegram @${u.tgUsername}` : ''}${aka.length ? ` (может подписываться: ${aka.join(', ')})` : ''}`;
  }).join('; ');
}

// ── change log / snapshot ──
async function atTouch(kv, ids) {
  const rec = (await kv.get('at:ver', 'json')) || { v: 0, log: [] };
  rec.v += 1;
  for (const id of ids) rec.log.push([rec.v, id]);
  rec.log = rec.log.slice(-300);
  await kv.put('at:ver', JSON.stringify(rec));
  return rec.v;
}
async function atLoadProjects(kv) {
  const [list, owners] = await Promise.all([listByPrefix(kv, 'project:'), atLoadOwners(kv)]);
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    inactive: !!p.inactive,
    profileUrl: p.profileUrl || p.avitoProfileUrl || null,
    briefUrl: p.briefUrl || null,
    staffUrl: p.staffUrl || null,
    ownerId: (owners[p.id] && owners[p.id].userId) || null,
    priority: (owners[p.id] && owners[p.id].priority) || null,
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// ── Who leads which client: «Клиенты → Настройки» (the owner and the assistant) ──
//   at:owners -> { <projectId>: { userId, priority: 1 | 2 | 3 } }
// Until the first save it starts from the split the owner posted in the work chat on 20.10.2026
// (matched by surname; new clients go to Альбина).
const AT_OWNERS_SEED = {
  ekaterina: { 1: ['шевчук', 'армбристер'], 2: ['верхотурова', 'сасс', 'попова'], 3: ['алексеева', 'симагина', 'соболева', 'добрынина'] },
  albina: { 1: ['кариентиди', 'лютова', 'валиуллова'], 2: ['окунева', 'климович', 'шахин', 'лазарева', 'чакова', 'бусленко'], 3: ['ромашова', 'губкина'] },
};
async function atLoadOwners(kv) {
  const saved = await kv.get('at:owners', 'json');
  if (saved) return saved;
  const out = {};
  for (const p of await listByPrefix(kv, 'project:')) {
    if (p.inactive) continue;
    const last = String(p.name || '').trim().split(/\s+/).pop().toLowerCase();
    for (const [userId, byPrio] of Object.entries(AT_OWNERS_SEED)) {
      for (const [prio, names] of Object.entries(byPrio)) if (names.includes(last)) out[p.id] = { userId, priority: Number(prio) };
    }
  }
  return out;
}
async function atLoadClientSignals(kv) {
  const [chats, pendingList, clients] = await Promise.all([
    listByPrefix(kv, 'bot:chat:'),
    kv.list({ prefix: 'bot:pending:' }),
    kv.get('at:clients', 'json'),
  ]);
  const pending = {};
  await Promise.all(pendingList.keys.map(async (k) => {
    const p = await kv.get(k.name, 'json');
    if (p && !botIsAckText(p.text)) pending[k.name.slice('bot:pending:'.length)] = p;
  }));
  return { chats: chats.filter((c) => c.kind === 'client'), pending, clients: clients || {} };
}
async function atSnapshot(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const ver = (await kv.get('at:ver', 'json')) || { v: 0, log: [] };
  const now = Date.now();
  const fresh = AT_MEM && now - AT_MEM.builtAt < AT_FULL_REBUILD_MS;
  if (fresh && AT_MEM.v === ver.v) return AT_MEM;
  if (fresh && AT_MEM.v < ver.v && ver.log.length && ver.log[0][0] <= AT_MEM.v + 1) {
    const next = { ...AT_MEM, tasks: new Map(AT_MEM.tasks), v: ver.v };
    const changed = new Set(ver.log.filter(([v]) => v > AT_MEM.v).map(([, id]) => id));
    for (const id of changed) {
      if (id === '#projects') next.projects = await atLoadProjects(kv);
      else if (id === '#clients') Object.assign(next, await atLoadClientSignals(kv));
      else if (id.startsWith('#')) continue; // '#team': people are read per request, the bump just makes pages re-fetch
      else {
        const t = await kv.get(`task:${id}`, 'json');
        if (atIsTrackerTask(t)) next.tasks.set(id, t); else next.tasks.delete(id);
      }
    }
    AT_MEM = next;
    return next;
  }
  const [tasks, projects, signals] = await Promise.all([listByPrefix(kv, 'task:'), atLoadProjects(kv), atLoadClientSignals(kv)]);
  AT_MEM = {
    v: ver.v,
    builtAt: now,
    stamp: now.toString(36),
    tasks: new Map(tasks.filter(atIsTrackerTask).map((t) => [t.id, t])),
    projects,
    ...signals,
  };
  return AT_MEM;
}
function atPublicTask(t, users) {
  return {
    id: t.id,
    text: t.text,
    note: t.note || '',
    status: t.status,
    takenAt: t.takenAt || null,
    doneAt: t.doneAt || null,
    informedAt: t.informedAt || null,
    due: t.due || null,
    suggestedDue: t.suggestedDue || null,
    hint: t.hint && t.status !== 'closed' && t.status !== 'cancelled' ? { status: t.hint.status, at: t.hint.at, from: t.hint.from || null } : null,
    priority: AT_PRIORITIES.includes(t.priority) ? t.priority : 'normal',
    projectId: t.projectId || null,
    topicName: t.topicName || null,
    assigneeId: atAssigneeId(t, users),
    owner: t.owner || null,
    author: t.author || null,
    createdById: t.createdById || null,
    source: t.source,
    origin: t.origin || null,
    internal: atIsInternalTask(t, users),
    link: t.link || null,
    startedAt: t.startedAt || t.createdAt || null,
    createdAt: t.createdAt || null,
    updatedAt: t.updatedAt || null,
    updatedBy: t.updatedBy || null,
    activity: Array.isArray(t.activity) ? t.activity.slice(-20) : [],
  };
}
// Clients tab (owner and client manager only — specialists don't need clients' messages).
function atClientBoard(mem) {
  return mem.projects.map((p) => {
    const chat = mem.chats.find((c) => c.projectId === p.id);
    const pend = chat && mem.pending[String(chat.id)];
    const c = mem.clients[p.id] || {};
    return {
      id: p.id,
      chat: chat ? { title: chat.title } : null,
      pending: pend ? { since: pend.since, text: pend.text, link: botMessageLink(chat.id, null, pend.msgId) } : null,
      lastUpdateAt: c.lastUpdateAt || null,
      lastUpdateBy: c.by || null,
      lastUpdateNote: c.note || null,
      lastTeamAt: c.lastTeamAt || null,
    };
  });
}

// ── notifications ──
async function atNotify(env, team, userIds, n, tg) {
  const kv = env.AGENCY_DASHBOARD_KV;
  for (const uid of [...new Set(userIds)].filter(Boolean)) {
    const user = team.users.find((u) => u.id === uid && u.active);
    if (!user) continue;
    const key = `at:notif:${uid}`;
    const list = (await kv.get(key, 'json')) || [];
    list.unshift({ id: atRandom(8), t: Date.now(), kind: n.kind, taskId: n.taskId || null, ref: n.ref || null, text: String(n.text || '').slice(0, 400), by: n.by || null, read: false });
    await kv.put(key, JSON.stringify(list.slice(0, AT_NOTIF_KEEP)));
    if (tg && user.tgId) await botSend(env, user.tgId, tg.text, tg.extra || {});
  }
}
// Telegram on phones opens links in its own in-app browser, which may not keep the tracker's
// sign-in (it lives in localStorage) — then a bare tracker link shows «Нет доступа». So tracker
// buttons in a team member's private chat carry their own invite: it signs them in on the spot,
// in whatever browser opens it. (The bot already sends people their invite link the same way.)
// The tracker opens two ways: cantor.agency (its API goes through the Yandex Cloud proxy — works in
// Russia without a VPN) and the worker's own address (*.workers.dev — quicker, but needs a VPN there).
const AT_PAGE_URL_VPN = `${BOT_WORKER_ORIGIN}/avito-tasks`;
const atIsTrackerUrl = (url) => String(url).startsWith(AT_PAGE_URL) || String(url).startsWith(AT_PAGE_URL_VPN);
function atPersonalUrl(url, user) {
  if (!user || !user.invite || !user.active || !atIsTrackerUrl(url)) return url;
  const u = new URL(url);
  u.searchParams.set('invite', user.invite);
  return u.toString();
}
function atPersonalizeMarkup(markup, user) {
  const rows = markup && markup.inline_keyboard;
  if (!rows || !user) return markup;
  return { ...markup, inline_keyboard: rows.map((row) => row.map((b) => (b.url ? { ...b, url: atPersonalUrl(b.url, user) } : b))) };
}
async function atPersonalizeExtra(env, chatId, extra) {
  const rows = extra && extra.reply_markup && extra.reply_markup.inline_keyboard;
  if (!rows || !rows.some((row) => row.some((b) => b.url && atIsTrackerUrl(b.url)))) return extra;
  const team = await atGetTeam(env);
  const user = team.users.find((u) => u.tgId && String(u.tgId) === String(chatId));
  return user ? { ...extra, reply_markup: atPersonalizeMarkup(extra.reply_markup, user) } : extra;
}
function atTaskUrl(taskId, vpn) {
  return `${vpn ? AT_PAGE_URL_VPN : AT_PAGE_URL}#t=${encodeURIComponent(taskId)}`;
}
// Bottom row under a task message: the same task, without and with a VPN.
function atOpenTaskRow(taskId) {
  return [{ text: 'Без VPN', url: atTaskUrl(taskId) }, { text: 'С VPN', url: atTaskUrl(taskId, true) }];
}
function atTgButtons(task, withActions) {
  const row = [];
  if (withActions && task.status === 'open' && !task.takenAt) row.push({ text: '▶️ Беру в работу', callback_data: `at:take:${task.id}` });
  if (withActions && task.status === 'open') row.push({ text: '✅ Готово', callback_data: `at:done:${task.id}` });
  const rows = row.length ? [row] : [];
  rows.push(atOpenTaskRow(task.id));
  return { reply_markup: { inline_keyboard: rows } };
}
function atTgTaskBlock(task, projectName) {
  const due = botDueMs(task);
  const meta = [];
  if (projectName) meta.push(`Клиент: ${escapeHtml(projectName)}`);
  meta.push(due ? `Срок: ${botFmtDate(due)}` : 'Без срока');
  if (task.priority && task.priority !== 'normal') meta.push(`Приоритет: ${AT_PRIORITY_LABEL[task.priority] || task.priority}`);
  const lines = [`<b>${escapeHtml(task.text)}</b>`, meta.join(' · ')];
  if (task.note) lines.push(`<i>${escapeHtml(String(task.note).slice(0, 500))}</i>`);
  return lines.join('\n');
}
async function atProjectName(kv, projectId) {
  if (!projectId) return null;
  if (AT_MEM) {
    const p = AT_MEM.projects.find((x) => x.id === projectId);
    if (p) return p.name;
  }
  const p = await kv.get(`project:${projectId}`, 'json');
  return p ? p.name : null;
}

// ── create / edit a task (page, and the bot's «Беру» / «Готово» buttons) ──
// input: { id?, text?, note?, projectId?, assigneeId?, due?: 'YYYY-MM-DDTHH:MM' (MSK) | null,
//          priority?, status?: 'new' | 'progress' | 'done' | 'closed' | 'cancelled' }
async function atSaveTask(env, team, user, input) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const existing = input.id ? await kv.get(`task:${String(input.id)}`, 'json') : null;
  if (input.id && !existing) return { error: 'not_found', status: 404 };
  const task = existing ? { ...existing } : {
    id: `tr${atRandom(10)}`,
    text: '',
    status: 'open',
    priority: 'normal',
    source: 'tracker',
    origin: 'tracker',
    author: user.name,
    createdById: user.id,
    startedAt: now,
    notified: {},
    createdAt: now,
  };
  const before = { ...task, assigneeId: atAssigneeId(task, team.users) };
  const changes = [];

  if ('text' in input) {
    const text = atClean(input.text, 300).replace(/\s*\n\s*/g, ' ');
    if (!text) return { error: 'missing_text', status: 400 };
    if (text !== task.text) { task.text = text; if (existing) changes.push('суть'); }
  } else if (!existing) return { error: 'missing_text', status: 400 };
  if ('note' in input) {
    const note = atClean(input.note, 4000);
    if (note !== (task.note || '')) { task.note = note; if (existing) changes.push('описание'); }
  }
  if ('projectId' in input) {
    const pid = input.projectId ? atClean(input.projectId, 80) : null;
    if (pid !== (task.projectId || null)) { task.projectId = pid; if (existing) changes.push('клиент'); }
  }
  if ('assigneeId' in input) {
    const a = input.assigneeId ? team.users.find((u) => u.id === input.assigneeId) : null;
    if ((a ? a.id : null) !== before.assigneeId || (!existing && a)) {
      task.assigneeId = a ? a.id : null;
      task.owner = a ? a.name : null;
      if (existing) changes.push(a ? `исполнитель → ${atFirstName(a.name)}` : 'без исполнителя');
    }
  } else if (!existing) {
    task.assigneeId = user.id;
    task.owner = user.name;
  }
  if ('due' in input) {
    const ms = input.due ? botParseMskDateTime(input.due) : null;
    const due = ms ? botIsoMsk(ms) : null;
    if (due !== (task.due || null)) {
      task.due = due;
      // A new deadline gets fresh "an hour left" / "missed" notifications.
      task.notified = { ...(task.notified || {}), overdue: undefined, overdueUser: undefined, soonUser: undefined };
      if (existing) changes.push(due ? `срок → ${botFmtDate(ms)}` : 'срок снят');
    }
  }
  if ('priority' in input && AT_PRIORITIES.includes(input.priority) && input.priority !== (task.priority || 'normal')) {
    task.priority = input.priority;
    if (existing) changes.push(`приоритет → ${AT_PRIORITY_LABEL[input.priority]}`);
  }
  let statusChange = null;
  if ('status' in input && task.hint) delete task.hint; // a person decided — the bot's guess is settled
  if ('status' in input) {
    const inform = atNeedsInform(task, team.users);
    // Nothing to tell the client about an internal task, so «готово» closes it.
    const s = input.status === 'done' && !inform ? 'closed' : input.status;
    const cur = task.status === 'open' ? (task.takenAt ? 'progress' : 'new') : task.status;
    if (s !== cur && ['new', 'progress', 'done', 'closed', 'cancelled'].includes(s)) {
      // The reflection task closes itself once every client is rated — by hand only the owner or assistant.
      if (existing && String(task.id).startsWith('trrefl') && ['done', 'closed'].includes(s) && !['owner', 'assistant'].includes(user.role)) {
        const rec = await kv.get(`refl:${reflWeek(nowMs)}:${atAssigneeId(task, team.users)}`, 'json');
        if (rec && rec.taskId === task.id && !rec.doneAt) return { error: 'refl_not_done', status: 409 };
      }
      statusChange = s;
      if (s === 'new') Object.assign(task, { status: 'open', takenAt: null });
      if (s === 'progress') Object.assign(task, { status: 'open', takenAt: task.takenAt || now });
      if (s === 'done') Object.assign(task, { status: 'done', doneAt: now });
      if (s === 'closed') Object.assign(task, { status: 'closed', doneAt: task.doneAt || now, informedAt: inform ? now : task.informedAt || null });
      if (s === 'cancelled') task.status = 'cancelled';
      changes.push({ new: 'вернул(а) в новые', progress: 'взял(а) в работу', done: 'отметил(а) «готово»', closed: inform ? 'закрыл(а): клиенту сообщили' : 'закрыл(а)', cancelled: 'отменил(а)' }[s]);
    }
  }
  if (existing && !changes.length) return { task };

  task.updatedAt = now;
  task.updatedBy = user.name;
  task.activity = [...(Array.isArray(task.activity) ? task.activity : []), { t: nowMs, by: user.name, what: existing ? changes.join(', ') : 'поставил(а) задачу' }].slice(-20);
  await kv.put(`task:${task.id}`, JSON.stringify(task));
  await atTouch(kv, [task.id]);
  if (AT_MEM && AT_MEM.tasks) AT_MEM.tasks.set(task.id, task);

  // Who hears about it.
  const assigneeId = atAssigneeId(task, team.users);
  const projectName = await atProjectName(kv, task.projectId);
  const by = atFirstName(user.name);
  if (assigneeId && assigneeId !== user.id && assigneeId !== before.assigneeId) {
    await atNotify(env, team, [assigneeId], { kind: 'assigned', taskId: task.id, text: `${by} поставил(а) вам задачу: ${task.text}`, by: user.name }, {
      text: `📌 <b>Новая задача для вас</b> · поставил(а) ${escapeHtml(user.name)}\n${atTgTaskBlock(task, projectName)}`,
      extra: atTgButtons(task, true),
    });
  } else if (existing && assigneeId && assigneeId !== user.id && !statusChange && changes.length) {
    await atNotify(env, team, [assigneeId], { kind: 'edited', taskId: task.id, text: `${by} изменил(а) вашу задачу (${changes.join(', ')}): ${task.text}`, by: user.name });
  }
  if (statusChange === 'done' || statusChange === 'closed') {
    // A client manager waiting on a client's task gets «Сообщите клиенту» (below) instead of a plain «готово».
    const informs = task.status === 'done' && atNeedsInform(task, team.users);
    const isManager = (id) => informs && team.users.some((u) => u.id === id && u.role === 'manager');
    const watchers = [task.createdById, assigneeId].filter((id) => id && id !== user.id && !isManager(id));
    if (watchers.length) {
      await atNotify(env, team, watchers, { kind: 'done', taskId: task.id, text: `${by}: готово — ${task.text}`, by: user.name }, {
        text: `✅ <b>${escapeHtml(by)}: готово</b>\n${atTgTaskBlock(task, projectName)}`,
        extra: { ...atTgButtons(task, false), disable_notification: true },
      });
    }
    // The client manager passes results on to the client.
    if (task.status === 'done') await atNotifyInform(env, team, task, user.name, [user.id, ...watchers]);
  }
  return { task };
}

// «📨 Сообщите клиенту» to the client manager(s) — except whoever is in `skipIds` (they know already).
async function atNotifyInform(env, team, task, byName, skipIds) {
  if (!atNeedsInform(task, team.users)) return;
  const skip = new Set((skipIds || []).filter(Boolean));
  const managers = team.users.filter((u) => u.role === 'manager' && u.active && !skip.has(u.id)).map((u) => u.id);
  if (!managers.length) return;
  const projectName = await atProjectName(env.AGENCY_DASHBOARD_KV, task.projectId);
  const by = atFirstName(byName || '');
  await atNotify(env, team, managers, { kind: 'inform', taskId: task.id, text: `Готово по ${projectName || 'клиенту'} — сообщите клиенту: ${task.text}`, by: byName || null }, {
    text: `📨 <b>Сообщите клиенту: ${escapeHtml(projectName || '')}</b>\n${by ? `${escapeHtml(by)} сделал(а)` : 'Сделано'}: ${escapeHtml(task.text)}`,
    extra: atTgButtons(task, false),
  });
}

// ── «Встречи»: slots for calls with clients ──
// The owner (or assistant) opens 30-minute slots on the days they pick; the client manager books a
// client into a free slot with one tap (and clears it to move them). Everyone else sees only the
// booked meetings — with the one Zoom link — and can mark «хочу прийти»; the owner sees their avatars.
// Two KV records, so the owner's edits and the manager's bookings don't overwrite each other:
//   at:meet:days  { 'YYYY-MM-DD': ['10:00', '10:30', …] }   open slots per day (a day with [] is shown empty)
//   at:meet:book  { 'YYYY-MM-DD HH:MM': { client, projectId, by, at, want: [userId] } }
const AT_MEET_ZOOM = 'https://us06web.zoom.us/j/82724621140?pwd=SDp78Esp8JRp83P4BsJRuKyvxuDrNI.1';
const AT_MEET_KEEP_DAYS = 60;
const atMeetDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const atMeetTime = (v) => (/^([01]\d|2[0-3]):[03]0$/.test(String(v || '')) ? String(v) : null);
async function atMeetLoad(kv) {
  const [days, book] = await Promise.all([kv.get('at:meet:days', 'json'), kv.get('at:meet:book', 'json')]);
  return { days: days || {}, book: book || {} };
}
// What a person sees: the owner/assistant and the manager — the open slots and every booking; the
// rest — only the bookings (from yesterday on).
function atMeetView(state, me, nowMs) {
  const manages = me.role === 'owner' || me.role === 'assistant' || me.role === 'manager';
  const from = botMsk(nowMs - 24 * 3600000).date;
  const book = {};
  for (const [key, b] of Object.entries(state.book)) if (manages || key.slice(0, 10) >= from) book[key] = b;
  return { days: manages ? state.days : null, book, zoom: AT_MEET_ZOOM, today: botMsk(nowMs).date };
}
async function atMeetApi(env, team, me, action, body, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const isAdmin = me.role === 'owner' || me.role === 'assistant';
  const state = await atMeetLoad(kv);
  if (action === 'meet') return { state: atMeetView(state, me, nowMs) };
  const oldest = botMsk(nowMs - AT_MEET_KEEP_DAYS * 24 * 3600000).date;

  // Owner: days on/off and slots open/closed, in one batch (a drag across days is one save).
  if (action === 'meet-days') {
    if (!isAdmin) return { error: 'forbidden', status: 403 };
    const days = state.days;
    for (const d of Array.isArray(body.addDays) ? body.addDays.slice(0, 60) : []) if (atMeetDate(d) && !days[d]) days[d] = [];
    for (const d of Array.isArray(body.removeDays) ? body.removeDays.slice(0, 60) : []) {
      if (!atMeetDate(d)) continue;
      const booked = Object.keys(state.book).filter((k) => k.startsWith(`${d} `)).map((k) => k.slice(11));
      if (booked.length) days[d] = booked; else delete days[d]; // booked slots stay until the manager moves them
    }
    for (const op of Array.isArray(body.ops) ? body.ops.slice(0, 400) : []) {
      const d = op && atMeetDate(op.date);
      const t = op && atMeetTime(op.time);
      if (!d || !t) continue;
      const set = new Set(days[d] || []);
      if (op.open) set.add(t); else if (!state.book[`${d} ${t}`]) set.delete(t);
      days[d] = [...set].sort();
    }
    for (const d of Object.keys(days)) if (d < oldest) delete days[d];
    await kv.put('at:meet:days', JSON.stringify(days));
    return { state: atMeetView({ days, book: state.book }, me, nowMs) };
  }

  // Manager (or owner): put a client into a slot, or clear it.
  if (action === 'meet-book') {
    if (!isAdmin && me.role !== 'manager') return { error: 'forbidden', status: 403 };
    const d = atMeetDate(body.date);
    const t = atMeetTime(body.time);
    if (!d || !t) return { error: 'bad_slot', status: 400 };
    const key = `${d} ${t}`;
    const prev = state.book[key];
    if (body.clear) {
      delete state.book[key];
    } else {
      const projectId = atClean(body.projectId, 80) || null;
      const project = projectId ? await kv.get(`project:${projectId}`, 'json') : null;
      const client = (project && project.name) || atClean(body.client, 120);
      if (!client) return { error: 'missing_client', status: 400 };
      state.book[key] = { client, projectId: project ? projectId : null, by: me.name, byId: me.id, at: new Date(nowMs).toISOString(), want: prev && prev.client === client ? prev.want || [] : [] };
      // The slot is open from now on even if the owner's list (another location's KV) hasn't caught up.
      const set = new Set(state.days[d] || []);
      if (!set.has(t)) { set.add(t); state.days[d] = [...set].sort(); await kv.put('at:meet:days', JSON.stringify(state.days)); }
    }
    for (const k of Object.keys(state.book)) if (k.slice(0, 10) < oldest) delete state.book[k];
    await kv.put('at:meet:book', JSON.stringify(state.book));
    // The owner hears about it in the bell (not in Telegram — they asked for less noise there).
    const b = state.book[key];
    if (b && (!prev || prev.client !== b.client)) {
      const owners = team.users.filter((u) => (u.role === 'owner' || u.role === 'assistant') && u.active && u.id !== me.id).map((u) => u.id);
      await atNotify(env, team, owners, { kind: 'meet', ref: key, text: `${me.name} записал(а) на встречу: ${b.client} — ${atMeetHuman(d, t)}`, by: me.name });
    }
    return { state: atMeetView(state, me, nowMs) };
  }

  // Anyone but the manager: «хочу прийти» on a booked meeting.
  if (action === 'meet-want') {
    if (me.role === 'manager') return { error: 'forbidden', status: 403 };
    const key = `${atMeetDate(String(body.key || '').slice(0, 10))} ${atMeetTime(String(body.key || '').slice(11))}`;
    const b = state.book[key];
    if (!b) return { error: 'not_found', status: 404 };
    const want = new Set(b.want || []);
    if (body.on) want.add(me.id); else want.delete(me.id);
    b.want = [...want];
    await kv.put('at:meet:book', JSON.stringify(state.book));
    return { state: atMeetView(state, me, nowMs) };
  }
  return { error: 'unknown_action', status: 404 };
}
function atMeetHuman(date, time) {
  const ms = Date.parse(`${date}T${time}:00+03:00`);
  const d = new Date(ms + BOT_MSK_OFFSET_MS);
  return `${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getUTCDay()]} ${date.slice(8, 10)}.${date.slice(5, 7)} в ${time}`;
}

// ── «Рефлексия»: weekly project ratings from the team ──
// Every Wednesday (00:00 MSK) a new week opens: each employee (client manager, specialists,
// trainees) rates every active client 1–10 with a comment of a sentence or two, one client at a
// time, and can leave and come back to the same place. Done — the tab is quiet until next Wednesday.
// The cron puts a «Заполнить рефлексию» task on each of them and closes it once they are done.
// The client manager's and the specialist's scores also land in the dashboard's weekly project
// ratings (projectRating:<project>:<monday>:<role>), so the Projects tab fills itself.
//   refl:<wed>:<userId> -> { week, userId, answers: { <projectId>: { score, comment, at } | { skip: true, at } }, taskId, doneAt }
// skip — «не веду этот кабинет»: counts as answered, never in averages.
// Weeks before the tracker (from 07.09) live in the old dashboard's projectRating keys
// (Monday-based, roles manager / specialist / client); results and the history chart read them too.
// One record per person and week, written only by that person; the page always sends every answer
// it knows, so a save from one Cloudflare location can't drop one made a moment ago from another.
// Who rates clients every week (the specialists — the «trainee» role). The client manager and the
// specialists' lead («specialist» role) don't rate any more, but see the results like the owner does.
// Their earlier answers stay in the results and the history (REFL_READ_ROLES).
const REFL_ROLES = new Set(['trainee']);
const REFL_VIEW_ROLES = new Set(['manager', 'specialist']);
const REFL_READ_ROLES = new Set([...REFL_ROLES, ...REFL_VIEW_ROLES]);
const REFL_TTL = 60 * 60 * 24 * 400;
const REFL_COMMENT_MAX = 400;

function reflWeek(nowMs) {
  const d = botMsk(nowMs);
  const back = (d.dow - 3 + 7) % 7; // days since Wednesday
  return botMsk(botMskStartOfDay(nowMs) - back * 24 * 3600000 + 12 * 3600000).date;
}
function reflAddDays(ymd, n) {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 24 * 3600000).toISOString().slice(0, 10);
}
function reflClients(projects) {
  return projects.filter((p) => !p.inactive).map((p) => p.id);
}
// The clients a specialist rates: the active ones they lead («Клиенты → Настройки»). Someone who leads
// nobody yet rates every active client, so the form is never empty.
function reflClientsFor(projects, userId) {
  const mine = projects.filter((p) => !p.inactive && p.ownerId === userId).map((p) => p.id);
  return mine.length ? mine : reflClients(projects);
}
function reflDone(rec, clientIds) {
  const a = (rec && rec.answers) || {};
  return clientIds.filter((id) => a[id] && (a[id].score > 0 || a[id].skip)).length;
}
// What the page needs: this week's open clients and my answers.
async function atReflectionState(kv, me, mem, nowMs) {
  if (!REFL_ROLES.has(me.role)) return null;
  const week = reflWeek(nowMs);
  const rec = (await kv.get(`refl:${week}:${me.id}`, 'json')) || { answers: {} };
  const clients = reflClientsFor(mem.projects, me.id);
  return { week, next: reflAddDays(week, 7), clients, answers: rec.answers || {}, done: reflDone(rec, clients), total: clients.length, doneAt: rec.doneAt || null };
}
async function atReflectionSave(env, team, me, body, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!REFL_ROLES.has(me.role)) return { error: 'forbidden', status: 403 };
  const week = reflWeek(nowMs);
  if (body.week !== week) return { error: 'week_closed', status: 409, week };
  const key = `refl:${week}:${me.id}`;
  const rec = (await kv.get(key, 'json')) || { week, userId: me.id, answers: {} };
  const mem = await atSnapshot(env);
  const clientIds = new Set(mem.projects.map((p) => p.id));
  const changed = [];
  for (const [pid, a] of Object.entries(body.answers && typeof body.answers === 'object' ? body.answers : {})) {
    if (!clientIds.has(pid)) continue;
    if (a && a.skip === true) {
      if (rec.answers[pid] && rec.answers[pid].skip) continue;
      rec.answers[pid] = { skip: true, at: new Date(nowMs).toISOString() };
      changed.push(pid);
      continue;
    }
    const score = Number(a && a.score);
    if (!Number.isInteger(score) || score < 1 || score > 10) continue;
    const comment = atClean(a.comment, REFL_COMMENT_MAX);
    const prev = rec.answers[pid];
    if (prev && prev.score === score && prev.comment === comment) continue;
    rec.answers[pid] = { score, comment, at: new Date(nowMs).toISOString() };
    changed.push(pid);
  }
  const active = reflClientsFor(mem.projects, me.id);
  const doneNow = reflDone(rec, active) >= active.length && active.length > 0;
  if (!changed.length && (!doneNow || rec.doneAt)) return { state: await atReflectionState(kv, me, mem, nowMs) };
  if (doneNow && !rec.doneAt) rec.doneAt = new Date(nowMs).toISOString();
  rec.updatedAt = new Date(nowMs).toISOString();
  await kv.put(key, JSON.stringify(rec), { expirationTtl: REFL_TTL });
  // The dashboard's weekly ratings (Monday-based weeks) get the manager's and the specialist's scores.
  const role = me.role === 'manager' ? 'manager' : me.role === 'specialist' ? 'specialist' : null;
  if (role) {
    const monday = reflAddDays(week, -2);
    await Promise.all(changed.map((pid) => (rec.answers[pid].skip
      ? kv.delete(`projectRating:${pid}:${monday}:${role}`)
      : kv.put(`projectRating:${pid}:${monday}:${role}`, JSON.stringify({
        projectId: pid, weekStart: monday, role, score: rec.answers[pid].score, comment: rec.answers[pid].comment, by: me.name, updatedAt: rec.updatedAt,
      })))));
  }
  if (doneNow && rec.taskId) {
    const task = await kv.get(`task:${rec.taskId}`, 'json');
    if (task && task.status === 'open') {
      Object.assign(task, { status: 'closed', doneAt: rec.doneAt, updatedAt: rec.doneAt, updatedBy: me.name });
      task.activity = [...(Array.isArray(task.activity) ? task.activity : []), { t: nowMs, by: me.name, what: 'заполнил(а) рефлексию — закрыто само' }].slice(-20);
      await kv.put(`task:${task.id}`, JSON.stringify(task));
      if (AT_MEM && AT_MEM.tasks) AT_MEM.tasks.set(task.id, task);
      await atTouch(kv, [task.id]);
    }
  }
  return { state: await atReflectionState(kv, me, mem, nowMs) };
}
// Wednesday–Friday is when the week gets rated: an employee sees the team's answers for it only once
// they have given their own, so the others' scores don't steer theirs. From Saturday it's open to all.
function reflLocked(nowMs, week, rec) {
  if (week !== reflWeek(nowMs) || (rec && rec.doneAt)) return false;
  return [3, 4, 5].includes(botMsk(nowMs).dow);
}
// A week's average per client (the old dashboard's ratings for a week before the tracker).
async function reflWeekAverages(kv, people, week) {
  const recs = await Promise.all(people.map((u) => kv.get(`refl:${week}:${u.id}`, 'json')));
  const xs = {};
  const add = (pid, score) => (xs[pid] = xs[pid] || []).push(score);
  recs.forEach((r) => { for (const [pid, a] of Object.entries((r && r.answers) || {})) if (a && a.score > 0 && !a.skip) add(pid, a.score); });
  if (!Object.keys(xs).length) {
    const monday = reflAddDays(week, -2);
    const keys = (await kv.list({ prefix: 'projectRating:' })).keys.filter((k) => k.name.split(':')[2] === monday);
    (await Promise.all(keys.map((k) => kv.get(k.name, 'json')))).forEach((r) => { if (r && r.score > 0) add(r.projectId, Number(r.score)); });
  }
  return Object.fromEntries(Object.entries(xs).map(([pid, v]) => [pid, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10]));
}
// Everyone's answers for a week — the owner and the assistant always, the team per reflLocked.
const REFL_LEGACY_ROLES = { manager: 'От менеджера', specialist: 'От специалиста', client: 'От клиента' };
// ── Avito Tasks → «Рассылки» ──
// One KV record per month: mail:<YYYY-MM> -> { items: [{ id, date, projectId, budget, status, contacts, result,
// comment, by, at, updatedBy, updatedAt }] }. budget/contacts are whole numbers or null (contacts stay
// null until the outcome is entered); status — 'launched' (запущено) / 'results' (получены результаты) /
// null (запланирована); result is 'good' | 'ok' | 'bad' | null. Contacts or a result mean 'results'.
//   mail       { month }                 -> { month, items }
//   mail-save  { item: { id?, from?, … } } -> { month, items, item }  (from — the date it had, to move it)
//   mail-del   { id, date }               -> { month, items }
const MAIL_RESULTS = ['good', 'ok', 'bad'];
const MAIL_STATUSES = ['launched', 'results'];
async function atMailApi(env, me, action, body, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const isDay = (v) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(v || ''));
  const read = async (month) => ((await kv.get(`mail:${month}`, 'json')) || {}).items || [];
  const write = (month, items) => kv.put(`mail:${month}`, JSON.stringify({ items }));
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  if (action === 'mail') {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.month || '')) ? body.month : botMsk(nowMs).date.slice(0, 7);
    return { month, items: await read(month) };
  }

  if (action === 'mail-save') {
    const it = body.item || {};
    if (!isDay(it.date)) return { error: 'bad_date', status: 400 };
    const projectId = atClean(it.projectId, 80);
    if (!projectId) return { error: 'no_client', status: 400 };
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.min(1e9, Math.max(0, Math.round(Number(v)))));
    const month = it.date.slice(0, 7);
    const iso = new Date(nowMs).toISOString();
    let items = await read(month);
    let old = it.id ? items.find((x) => x.id === it.id) : null;
    // The date moved to another month: take it out of the old month's record.
    const fromMonth = isDay(it.from) ? it.from.slice(0, 7) : month;
    if (it.id && !old && fromMonth !== month) {
      const prev = await read(fromMonth);
      old = prev.find((x) => x.id === it.id) || null;
      if (old) await write(fromMonth, prev.filter((x) => x.id !== it.id));
    }
    const rec = {
      ...(old || { id: atClean(it.id, 40) || `ml${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`, by: me.name, at: iso }),
      date: it.date,
      projectId,
      budget: num(it.budget),
      contacts: num(it.contacts),
      result: MAIL_RESULTS.includes(it.result) ? it.result : null,
      status: MAIL_STATUSES.includes(it.status) ? it.status : null,
      comment: String(it.comment || '').trim().slice(0, 2000),
      updatedBy: me.name,
      updatedAt: iso,
    };
    if (rec.contacts != null || rec.result) rec.status = 'results';
    delete rec.sent;
    items = items.filter((x) => x.id !== rec.id).concat(rec).sort(byDate);
    await write(month, items);
    return { month, items, item: rec };
  }

  if (action === 'mail-del') {
    if (!isDay(body.date)) return { error: 'bad_date', status: 400 };
    const month = body.date.slice(0, 7);
    const items = (await read(month)).filter((x) => x.id !== body.id);
    await write(month, items);
    return { month, items };
  }

  return { error: 'not_found', status: 404 };
}

async function atReflectionResults(env, team, week) {
  const kv = env.AGENCY_DASHBOARD_KV;
  // The raters, plus anyone who rated this week before they stopped rating (or left).
  const all = team.users.filter((u) => REFL_READ_ROLES.has(u.role));
  const allRecs = await Promise.all(all.map((u) => kv.get(`refl:${week}:${u.id}`, 'json')));
  const keep = all.map((u, i) => (u.active && REFL_ROLES.has(u.role)) || !!allRecs[i]);
  const people = all.filter((u, i) => keep[i]);
  const recs = allRecs.filter((r, i) => keep[i]);
  const mem = await atSnapshot(env);
  if (!recs.some(Boolean)) {
    // A week from before the tracker: the old dashboard's ratings for its Monday.
    const monday = reflAddDays(week, -2);
    const rows = (await Promise.all((await kv.list({ prefix: 'projectRating:' })).keys
      .filter((k) => k.name.split(':')[2] === monday).map((k) => kv.get(k.name, 'json')))).filter((r) => r && r.score > 0);
    if (rows.length) {
      const clients = [...new Set(rows.map((r) => r.projectId))];
      return {
        week, legacy: true, clients, prevAvg: await reflWeekAverages(kv, people, reflAddDays(week, -7)),
        people: Object.entries(REFL_LEGACY_ROLES).map(([role, name]) => {
          const answers = {};
          rows.filter((r) => r.role === role).forEach((r) => { answers[r.projectId] = { score: r.score, comment: r.comment || '', at: r.updatedAt || null }; });
          return { id: `legacy-${role}`, name, role, legacy: true, answers, done: Object.keys(answers).length, doneAt: null };
        }).filter((x) => x.done),
      };
    }
  }
  const clients = reflClients(mem.projects);
  return {
    week,
    clients,
    prevAvg: await reflWeekAverages(kv, people, reflAddDays(week, -7)),
    // rates: false — no longer rates (only the answers given are shown, no «not rated yet»).
    // mine — the clients this person rates (theirs); done / total count only those.
    people: people.map((u, i) => {
      const mine = reflClientsFor(mem.projects, u.id);
      return { id: u.id, name: u.name, role: u.role, rates: u.active && REFL_ROLES.has(u.role), mine, total: mine.length, answers: (recs[i] && recs[i].answers) || {}, done: reflDone(recs[i], mine), doneAt: (recs[i] && recs[i].doneAt) || null };
    }),
  };
}
// Every week's average per client — the tracker's weeks and the old dashboard's before them.
async function atReflectionHistory(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const [reflKeys, legacyKeys, projects] = await Promise.all([kv.list({ prefix: 'refl:' }), kv.list({ prefix: 'projectRating:' }), listByPrefix(kv, 'project:')]);
  const recs = await Promise.all(reflKeys.keys.map((k) => kv.get(k.name, 'json')));
  const scores = {}; // week -> pid -> [scores]
  const add = (week, pid, score) => { ((scores[week] = scores[week] || {})[pid] = scores[week][pid] || []).push(score); };
  const reflWeeks = new Set();
  recs.forEach((r, i) => {
    const week = reflKeys.keys[i].name.split(':')[1];
    if (!r || !r.answers) return;
    for (const [pid, a] of Object.entries(r.answers)) if (a && a.score > 0 && !a.skip) { add(week, pid, a.score); reflWeeks.add(week); }
  });
  const legacy = legacyKeys.keys.filter((k) => !reflWeeks.has(reflAddDays(k.name.split(':')[2], 2)));
  const rows = await Promise.all(legacy.map((k) => kv.get(k.name, 'json')));
  rows.forEach((r) => { if (r && r.score > 0 && r.weekStart) add(reflAddDays(r.weekStart, 2), r.projectId, Number(r.score)); });
  const known = Object.keys(scores).sort();
  // Every week from the first to the last — a week nobody rated stays empty on the chart.
  const weeks = [];
  for (let w = known[0]; known.length && w <= known[known.length - 1]; w = reflAddDays(w, 7)) weeks.push(w);
  for (const w of weeks) scores[w] = scores[w] || {};
  const avg = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const byClient = {};
  for (const w of weeks) for (const [pid, xs] of Object.entries(scores[w])) (byClient[pid] = byClient[pid] || {})[w] = avg(xs);
  const overall = {};
  for (const w of weeks) { const xs = Object.values(scores[w]).map(avg); if (xs.length) overall[w] = avg(xs); }
  const names = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  return {
    weeks,
    overall,
    clients: Object.keys(byClient).filter((pid) => names[pid]).map((pid) => ({ id: pid, name: names[pid], inactive: Boolean((projects.find((p) => p.id === pid) || {}).inactive), points: byClient[pid] }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  };
}
// One-time: answers from the week of 07.10 that say «не занималась / не работала с ней» and the like
// were given a filler score — they become «не веду этот кабинет» (the original is kept in `was`).
const REFL_SKIP_RE = /не\s+(занимал|работал|веду|вела|веду)|кроме ставок задач не было|смогу сказать подробнее/i;
async function reflMigrateSkips(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (await kv.get('at:migr:refl-skip-v1')) return;
  const keys = (await kv.list({ prefix: 'refl:2026-10-07:' })).keys;
  const changed = [];
  for (const k of keys) {
    const rec = await kv.get(k.name, 'json');
    if (!rec || !rec.answers) continue;
    let n = 0;
    for (const [pid, a] of Object.entries(rec.answers)) {
      if (a && a.score > 0 && REFL_SKIP_RE.test(a.comment || '')) { rec.answers[pid] = { skip: true, at: a.at, was: { score: a.score, comment: a.comment } }; n += 1; }
    }
    if (n) { await kv.put(k.name, JSON.stringify(rec), { expirationTtl: REFL_TTL }); changed.push(`${k.name}: ${n}`); }
  }
  await kv.put('at:migr:refl-skip-v1', JSON.stringify({ at: new Date().toISOString(), changed }));
}
// Cron: from Wednesday 10:00, once a week per person — a task to fill it in, with a link.
async function atReflectionCron(env, team, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  await reflMigrateSkips(env);
  if (botMsk(nowMs).hh < 10 && botMsk(nowMs).dow === 3) return;
  const week = reflWeek(nowMs);
  const mem = await atSnapshot(env);
  const clients = reflClients(mem.projects);
  if (!clients.length) return;
  // Those who no longer rate: an open «Заполнить рефлексию» task of theirs is cancelled.
  for (const u of team.users.filter((x) => REFL_VIEW_ROLES.has(x.role))) {
    const rec = await kv.get(`refl:${week}:${u.id}`, 'json');
    const t = rec && rec.taskId && !rec.doneAt && (await kv.get(`task:${rec.taskId}`, 'json'));
    if (!t || t.status !== 'open') continue;
    Object.assign(t, { status: 'cancelled', updatedAt: new Date(nowMs).toISOString(), updatedBy: 'Бот' });
    t.activity = [...(t.activity || []), { t: nowMs, by: 'Бот', what: 'отменил: рефлексию теперь заполняют только специалисты' }].slice(-20);
    await kv.put(`task:${t.id}`, JSON.stringify(t));
    if (AT_MEM && AT_MEM.tasks) AT_MEM.tasks.set(t.id, t);
    await atTouch(kv, [t.id]);
  }
  for (const u of team.users.filter((x) => x.active && REFL_ROLES.has(x.role))) {
    const clients = reflClientsFor(mem.projects, u.id);
    const key = `refl:${week}:${u.id}`;
    const rec = (await kv.get(key, 'json')) || { week, userId: u.id, answers: {} };
    // Closed by hand without rating anyone — open it again, once a week.
    if (rec.taskId && !rec.doneAt && reflDone(rec, clients) < clients.length) {
      const t = await kv.get(`task:${rec.taskId}`, 'json');
      const last = t && Array.isArray(t.activity) ? t.activity[t.activity.length - 1] : null;
      if (t && ['done', 'closed'].includes(t.status) && last && last.by === u.name && await botOnce(kv, `reflreopen:${week}:${u.id}`, 60 * 60 * 24 * 9)) {
        Object.assign(t, { status: 'open', doneAt: null, informedAt: null, updatedAt: new Date(nowMs).toISOString(), updatedBy: 'Бот' });
        t.activity = [...t.activity, { t: nowMs, by: 'Бот', what: `открыл снова: рефлексия не заполнена (${reflDone(rec, clients)} из ${clients.length}) — задача закроется сама, когда все клиенты будут оценены` }].slice(-20);
        await kv.put(`task:${t.id}`, JSON.stringify(t));
        if (AT_MEM && AT_MEM.tasks) AT_MEM.tasks.set(t.id, t);
        await atTouch(kv, [t.id]);
        await atNotify(env, team, [u.id], { kind: 'assigned', taskId: t.id, text: 'Рефлексия ещё не заполнена — задача снова открыта', by: 'Бот' }, {
          text: `🪞 <b>Рефлексия ещё не заполнена</b>\nЗадачу закрыли, но клиенты не оценены (${reflDone(rec, clients)} из ${clients.length}). Она закроется сама, когда оцените всех.`,
          extra: { reply_markup: { inline_keyboard: [[{ text: 'Заполнить рефлексию', url: `${AT_PAGE_URL}#reflection` }]] }, disable_notification: true },
        });
      }
      continue;
    }
    if (rec.taskId || rec.doneAt) continue;
    if (!(await botOnce(kv, `refltask:${week}:${u.id}`, 60 * 60 * 24 * 9))) continue;
    // Due at the end of the working day it is set (or the next one, if set after 18:00).
    const due = atWorkdayAt(nowMs, BOT_WORK_END_H, botMsk(nowMs).hh < BOT_WORK_END_H);
    const id = `trrefl${atRandom(8)}`;
    const now = new Date(nowMs).toISOString();
    const task = {
      id, text: `Заполнить рефлексию по клиентам (неделя с ${week.slice(8, 10)}.${week.slice(5, 7)})`,
      note: 'Вкладка «Рефлексия» в трекере: оценка 1–10 и пара предложений по каждому своему клиенту. Можно выйти и продолжить потом — задача закроется сама, когда всё будет заполнено.',
      status: 'open', priority: 'normal', source: 'tracker', origin: 'tracker', author: 'Бот', createdById: null,
      assigneeId: u.id, owner: u.name, due: botIsoMsk(due), link: `${AT_PAGE_URL}#reflection`, startedAt: now,
      notified: {}, activity: [{ t: nowMs, by: 'Бот', what: 'поставил задачу на рефлексию' }], createdAt: now, updatedAt: now,
    };
    await kv.put(`task:${id}`, JSON.stringify(task));
    rec.taskId = id;
    await kv.put(key, JSON.stringify(rec), { expirationTtl: REFL_TTL });
    await atTouch(kv, [id]);
    await atNotify(env, team, [u.id], { kind: 'assigned', taskId: id, text: `Рефлексия за неделю: оцените клиентов (${clients.length})`, by: 'Бот' }, {
      text: `🪞 <b>Рефлексия за неделю</b>\nОцените каждого своего клиента по шкале 1–10 и коротко объясните почему — ${clients.length} ${clients.length % 10 === 1 && clients.length % 100 !== 11 ? 'клиент' : 'клиентов'}. Можно прерваться и продолжить потом.`,
      extra: { reply_markup: { inline_keyboard: [[{ text: 'Заполнить рефлексию', url: `${AT_PAGE_URL}#reflection` }]] }, disable_notification: true },
    });
  }
}

// ── Sign-in with a code from the control bot ──
// The gate's «Получить код»: pick yourself from the team list, the bot sends you a 6-digit code in
// Telegram, type it in. Nothing about the code is stored: the server hands the page a signed
// challenge (who, until when, a random nonce) and the code is derived from it, so checking it needs
// no KV read — the request can land on any Cloudflare location. KV only rate-limits (best effort):
// one code a minute per person, 5 wrong tries per challenge. The code lives 10 minutes and works
// once (a used challenge is remembered until it would expire anyway).
const AT_CODE_TTL_MS = 10 * 60000;
const AT_CODE_TRIES = 5;
async function atLoginCode(team, challenge) {
  const h = await atHmac(team.secret, `code:${challenge}`);
  return String(parseInt(h.slice(0, 12), 16) % 1000000).padStart(6, '0');
}
async function atLoginChallenge(team, user, nowMs) {
  const body = `${user.id}.${user.v}.${nowMs + AT_CODE_TTL_MS}.${atRandom(10)}`;
  return `${body}.${(await atHmac(team.secret, `ch:${body}`)).slice(0, 24)}`;
}
async function atCheckChallenge(team, challenge, nowMs) {
  const m = String(challenge || '').match(/^([A-Za-z0-9_-]{1,40})\.(\d{1,6})\.(\d{10,16})\.([A-Za-z0-9]{6,20})\.([0-9a-f]{24})$/);
  if (!m) return null;
  const body = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  if ((await atHmac(team.secret, `ch:${body}`)).slice(0, 24) !== m[5]) return null;
  if (Number(m[3]) < nowMs) return { expired: true };
  const user = team.users.find((u) => u.id === m[1]);
  if (!user || String(user.v) !== m[2]) return null;
  return { user, nonce: m[4], exp: Number(m[3]) };
}
async function atLoginApi(env, team, action, body, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  // Who can sign in this way: active people the bot can write to.
  if (action === 'login-people') {
    return json({
      people: team.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, roleLabel: u.roleLabel || AT_ROLES[u.role] || '', tg: !!u.tgId })),
      owner: AT_OWNER_TG,
    });
  }
  if (action === 'login-code') {
    const user = team.users.find((u) => u.id === atClean(body.userId, 40));
    if (!user) return json({ error: 'not_found' }, 404);
    if (!user.active) return json({ error: 'blocked' }, 403);
    if (!user.tgId) return json({ error: 'no_telegram', owner: AT_OWNER_TG }, 409);
    const rlKey = `at:coderl:${user.id}`;
    const last = Number(await kv.get(rlKey)) || 0;
    if (nowMs - last < 60000) return json({ error: 'too_soon', wait: Math.ceil((60000 - (nowMs - last)) / 1000) }, 429);
    await kv.put(rlKey, String(nowMs), { expirationTtl: 120 });
    const challenge = await atLoginChallenge(team, user, nowMs);
    const code = await atLoginCode(team, challenge);
    const res = await botApi(env, 'sendMessage', {
      chat_id: user.tgId,
      parse_mode: 'HTML',
      text: `🔐 Код для входа в Avito Tasks: <code>${code}</code>\nДействует 10 минут. Если вход запросили не вы — просто проигнорируйте это сообщение.`,
    });
    if (!res || !res.ok) return json({ error: 'send_failed', owner: AT_OWNER_TG }, 502);
    return json({ challenge, ttl: AT_CODE_TTL_MS });
  }
  if (action === 'login-verify') {
    const ch = await atCheckChallenge(team, body.challenge, nowMs);
    if (!ch) return json({ error: 'bad_challenge' }, 400);
    if (ch.expired) return json({ error: 'expired' }, 410);
    if (!ch.user.active) return json({ error: 'blocked' }, 403);
    const triesKey = `at:codetry:${ch.nonce}`;
    const tries = Number(await kv.get(triesKey)) || 0;
    if (tries >= AT_CODE_TRIES) return json({ error: 'too_many' }, 429);
    const code = String(body.code || '').replace(/\D/g, '');
    if (code !== await atLoginCode(team, body.challenge)) {
      await kv.put(triesKey, String(tries + 1), { expirationTtl: Math.ceil(AT_CODE_TTL_MS / 1000) + 60 });
      return json({ error: 'wrong_code', left: AT_CODE_TRIES - tries - 1 }, 401);
    }
    await kv.put(triesKey, String(AT_CODE_TRIES), { expirationTtl: Math.ceil(AT_CODE_TTL_MS / 1000) + 60 }); // used up
    const user = ch.user;
    if (!user.activatedAt) {
      user.activatedAt = new Date(nowMs).toISOString();
      await atPutTeam(kv, team);
    }
    return json({ token: await atToken(team, user), me: atPublicUser(user) });
  }
  return null;
}

// ── /finance: the owner's finance dashboard (P&L, CF, operations, staff payouts, clients) ──
// Page: /finance, API under /api/dashboard/finance/* (so the Yandex Cloud proxy lets it through).
// Only the tracker's owner gets in: the same signed token as /avito-tasks (the page reuses it from
// localStorage when the owner is already signed in there), or a 6-digit code the control bot sends
// to the owner's Telegram (the tracker's own login-code / login-verify, limited to the owner).
// The whole dashboard is one JSON document — operations, plans, balances, staff, clients, labels —
// written back on every edit. `rev` guards against two open tabs overwriting each other: a save
// with a stale rev gets 409 and the current document back.
//
// KV keys (AGENCY_DASHBOARD_KV):
//   fin:data -> { rev, savedAt, ops, plan, cfp, snaps, staff, clients, months, lbl, extra, cfg }
const FIN_KEY = 'fin:data';
const FIN_MAX_BYTES = 5 * 1024 * 1024;
async function handleFinanceApi(request, env, url) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!kv) return json({ error: 'kv_not_configured' }, 500);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = (await readJson(request)) || {};
  const action = url.pathname.slice('/api/dashboard/finance/'.length);
  const team = await atGetTeam(env);
  const owner = team.users.find((u) => u.role === 'owner' && u.active);

  if (action === 'login-code' || action === 'login-verify') {
    if (!owner) return json({ error: 'no_owner' }, 404);
    if (action === 'login-code') return atLoginApi(env, team, 'login-code', { userId: owner.id }, Date.now());
    const ch = await atCheckChallenge(team, body.challenge, Date.now());
    if (ch && !ch.expired && ch.user.id !== owner.id) return json({ error: 'forbidden' }, 403);
    return atLoginApi(env, team, 'login-verify', body, Date.now());
  }

  const auth = await atAuth(team, body.token);
  if (auth.error) return json({ error: auth.error }, auth.error === 'blocked' ? 403 : 401);
  if (auth.user.role !== 'owner') return json({ error: 'forbidden' }, 403);

  if (action === 'load') {
    // Клиенты в финансах дополняются проектами из дашборда / Avito Tasks (новые появляются сами).
    const projects = (await listByPrefix(kv, 'project:')).map((p) => ({
      id: p.id, name: p.name, service: p.service || '', inactive: Boolean(p.inactive), createdAt: p.createdAt || null,
    }));
    // Ники клиентов: из CRM продаж (имя + Telegram) — по ним страница находит оплаты в операциях.
    const crm = env.AVITO_KV ? (await listByPrefix(env.AVITO_KV, 'salescrm:client:'))
      .filter((c) => c && c.name && c.telegram)
      .map((c) => ({ name: c.name, telegram: salesCrmNormalizeTg(c.telegram), status: c.status || '' })) : [];
    return json({ data: (await kv.get(FIN_KEY, 'json')) || null, projects, crm, me: atPublicUser(auth.user) });
  }
  if (action === 'save') {
    const data = body.data;
    if (!data || typeof data !== 'object' || !Array.isArray(data.ops)) return json({ error: 'bad_data' }, 400);
    const cur = await kv.get(FIN_KEY, 'json');
    const curRev = (cur && cur.rev) || 0;
    if (!body.force && Number(body.rev || 0) !== curRev) return json({ error: 'conflict', data: cur }, 409);
    const next = Object.assign({}, data, { rev: curRev + 1, savedAt: new Date().toISOString() });
    const raw = JSON.stringify(next);
    if (raw.length > FIN_MAX_BYTES) return json({ error: 'too_big' }, 413);
    await kv.put(FIN_KEY, raw);
    return json({ ok: true, rev: next.rev, savedAt: next.savedAt });
  }
  return json({ error: 'not_found' }, 404);
}

// Reminders to the owner from the control bot (cron, once a day after 10:00 MSK):
//  - a client's next payment is 5 days away or closer — with everything the dashboard knows about them;
//  - a staff payout is tomorrow or today.
// The dates follow the page's own rules (nextPay / empNext in /finance): a client pays monthly on the
// day they started unless a date was set by hand; a person is paid 14 days after their last payout
// unless set by hand. Each reminder goes out once per date (fin:sent).
//   fin:sent -> { "<kind>|<name>|<date>": "<sent on>" }   (entries older than 60 days are dropped)
//   fin:remind:<date> -> '1' once that day's check has run
function finHandles(tg) {
  return String(tg || '').split(/[\s,;]+/).map((h) => h.trim().toLowerCase()).filter((h) => h.startsWith('@'));
}
function finDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}
function finClientNext(c, today) {
  if (!c || c.noNext || c.status !== 'Активен') return null;
  if (c.next && c.next >= today) return c.next;
  const day = Number(String(c.start || '').slice(8, 10));
  if (!day) return null;
  let [y, m] = today.split('-').map(Number);
  const mk = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(day, new Date(Date.UTC(yy, mm, 0)).getUTCDate())).padStart(2, '0')}`;
  let d = mk(y, m);
  if (d <= today) { m += 1; if (m > 12) { m = 1; y += 1; } d = mk(y, m); }
  return d;
}
function finStaffNext(s, ops, today) {
  if (!s || s.noNext) return null;
  if (s.next && s.next >= today) return s.next;
  const last = ops.filter((o) => o.sal && o.emp === s.n).map((o) => o.d).sort().pop();
  if (!last || finDays(last, today) > 35) return null;
  return avitoAddDays(last, 14);
}
const finRub = (v) => `${Math.round(Number(v) || 0).toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;
const finDt = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const finWhen = (n) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${n < 5 ? 'дня' : 'дней'}`);
async function finRemindCron(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!kv || !botOwnerIds(env).length) return;
  const nowMsk = new Date(Date.now() + 3 * 3600e3);
  if (nowMsk.getUTCHours() < 10) return;
  const today = mskToday();
  if (await kv.get(`fin:remind:${today}`)) return;
  await kv.put(`fin:remind:${today}`, '1', { expirationTtl: 3 * 86400 });
  const data = await kv.get(FIN_KEY, 'json');
  if (!data) return;
  const sent = (await kv.get('fin:sent', 'json')) || {};
  const ops = Array.isArray(data.ops) ? data.ops : [];
  const msgs = [];
  for (const c of data.clients || []) {
    const next = finClientNext(c, today);
    if (!next) continue;
    const n = finDays(today, next);
    const key = `client|${c.name}|${next}`;
    if (n < 0 || n > 5 || sent[key]) continue;
    // Оплаты — из операций по контакту клиента (@telegram), иначе из старого реестра.
    const handles = finHandles(c.tg);
    const paid = handles.length
      ? ops.filter((o) => o.kind === 'rev' && o.client && handles.includes(String(o.client).toLowerCase())).reduce((a, o) => a + (Number(o.amt) || 0), 0)
      : Object.values(c.pays || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    const months = c.start ? Math.max(1, Math.round(finDays(c.start, today) / 30.4)) : null;
    msgs.push([
      `💳 <b>${escapeHtml(c.name)}</b> — оплата ${finWhen(n)}, ${finDt(next)}`,
      `Сумма продления: ${finRub(c.renew == null ? 25000 : c.renew)}`,
      c.tg ? `Контакт: ${escapeHtml(c.tg)}` : '',
      c.start ? `С нами с ${finDt(c.start)}.${c.start.slice(0, 4)}${months ? ` (${months} мес)` : ''}, оплачено всего ${finRub(paid)}` : '',
      c.note ? `Примечание: ${escapeHtml(c.note)}` : '',
    ].filter(Boolean).join('\n'));
    sent[key] = today;
  }
  for (const s of data.staff || []) {
    const next = finStaffNext(s, ops, today);
    if (!next) continue;
    const n = finDays(today, next);
    const key = `staff|${s.n}|${next}`;
    if (n < 0 || n > 1 || sent[key]) continue;
    const last = ops.filter((o) => o.sal && o.emp === s.n).sort((a, b) => (a.d < b.d ? 1 : -1))[0];
    msgs.push([
      `👤 <b>${escapeHtml(s.n)}</b>${s.role ? ` (${escapeHtml(s.role)})` : ''} — выплата ${finWhen(n)}, ${finDt(next)}`,
      s.rate ? `Ставка: ${escapeHtml(s.rate)}` : '',
      s.pay || s.req ? `Платим с: ${escapeHtml([s.pay, s.req].filter(Boolean).join(' · '))}` : '',
      last ? `Последняя выплата: ${finDt(last.d)} — ${finRub(-last.amt)}` : '',
    ].filter(Boolean).join('\n'));
    sent[key] = today;
  }
  if (!msgs.length) return;
  for (const k of Object.keys(sent)) if (finDays(sent[k], today) > 60) delete sent[k];
  await kv.put('fin:sent', JSON.stringify(sent));
  await botNotifyOwner(env, `${msgs.join('\n\n')}\n\n<a href="https://cantor.agency/finance">Открыть финансы</a>`);
}

// ── API: POST /api/dashboard/avito-tasks/<action>, token in the JSON body ──
// ── «Аналитика» и цифры клиентов в Avito Tasks ──
// The tracker reuses the dashboard's own handlers (daily metrics, Avito pull, cabinets, report):
// the person is already checked by their tracker token and section, so the call goes in with the
// dashboard password the browser never sees.
async function atDashCall(env, ctx, url, method, path, body) {
  const target = new URL(path, url.origin);
  const req = new Request(target, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-dashboard-password': DASHBOARD_PASSWORD },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleDashboardApi(req, env, target, ctx);
}
const AT_AN_RAW = ['budget', 'views', 'contacts', 'diagnostics', 'sales'];
let AT_DM = null; // { at, rows } — every dailyMetrics record, kept a minute per isolate
async function atDailyMetrics(kv) {
  if (AT_DM && Date.now() - AT_DM.at < 60000) return AT_DM.rows;
  const rows = await listByPrefix(kv, 'dailyMetrics:');
  AT_DM = { at: Date.now(), rows };
  return rows;
}
const atZeroMetric = () => ({ budget: 0, views: 0, contacts: 0, diagnostics: 0, sales: 0 });
function atAddMetric(acc, r) { AT_AN_RAW.forEach((k) => { acc[k] += Number(r[k]) || 0; }); return acc; }
// The latest Avito pull that has this client's numbers (yesterday's, or the day before if the
// morning pull hasn't run yet) — for the advance currently left in the cabinet.
async function atLatestPull(kv) {
  const y = mskYesterday();
  for (const d of [y, avitoAddDays(y, -1)]) {
    const pull = await kv.get(`avitoPull:${d}`, 'json');
    if (pull && pull.results && Object.keys(pull.results).length) return pull;
  }
  return null;
}
async function atClientsMetrics(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const [projects, rows, pull, live] = await Promise.all([listByPrefix(kv, 'project:'), atDailyMetrics(kv), atLatestPull(kv), kv.get('at:avitoMoney', 'json')]);
  const pullAt = pull ? Date.parse(pull.finishedAt || pull.startedAt || 0) || 0 : 0;
  const liveAt = live ? Date.parse(live.at) || 0 : 0;
  const y = mskYesterday();
  const monthKey = y.slice(0, 7);
  const weekFrom = avitoAddDays(y, -6);
  const out = {};
  for (const p of projects) {
    if (p.inactive) continue;
    out[p.id] = { day: atZeroMetric(), month: atZeroMetric(), monthKey, week: atZeroMetric(), perDay: 0, linked: !!p.avitoAccountId, advance: null, wallet: null, moneyAt: null };
    // Advance and wallet: from the «Обновить с Авито» button if it is newer than the morning pull.
    const lr = live && live.rows && live.rows[p.id];
    const r = pull && pull.results && pull.results[p.id];
    if (lr && liveAt >= pullAt) Object.assign(out[p.id], { advance: lr.advance, wallet: lr.wallet, moneyAt: live.at, moneyError: lr.error || null });
    else if (r) Object.assign(out[p.id], { advance: r.advance != null ? r.advance : null, wallet: r.wallet != null ? r.wallet : null, moneyAt: pull.finishedAt || pull.startedAt || null });
  }
  for (const r of rows) {
    const m = out[r.projectId];
    if (!m || !r.date || r.date > y) continue;
    if (r.date === y) atAddMetric(m.day, r);
    if (r.date.startsWith(monthKey)) atAddMetric(m.month, r);
    if (r.date >= weekFrom) atAddMetric(m.week, r);
  }
  Object.values(out).forEach((m) => { m.perDay = m.week.budget / 7; delete m.week; });
  return out;
}
// The Avito pull for a day in the shape the tracker's «Подтянуть» window shows.
async function atAvitoDay(env, pull) {
  const projects = (await listByPrefix(env.AGENCY_DASHBOARD_KV, 'project:')).filter((p) => !p.inactive);
  const pending = new Set((pull && pull.pending) || []);
  const rows = projects.map((p) => {
    if (!p.avitoAccountId) return { projectId: p.id, off: 'кабинет не подключен' };
    if (p.avitoPullOff) return { projectId: p.id, off: 'не подтягивается — включите в «Кабинеты Авито»' };
    const r = pull && pull.results && pull.results[p.id];
    if (!r) return { projectId: p.id, off: pending.has(p.id) ? 'загружается…' : '—' };
    if (r.views == null && r.contacts == null && r.spend == null) return { projectId: p.id, off: r.errors && r.errors.length ? 'ошибка Авито' : 'нет данных' };
    const spendError = r.spend == null ? ((r.errors || []).find((e) => e.startsWith('Статистика v2')) || 'Авито не вернул расход') : null;
    return { projectId: p.id, views: r.views, contacts: r.contacts, spend: r.spend, spendError, advance: r.advance != null ? r.advance : r.wallet != null ? r.wallet : null, error: r.errors && r.errors.length ? r.errors[0] : null };
  });
  return { date: pull ? pull.date : null, status: pull ? pull.status : 'none', finishedAt: pull ? pull.finishedAt : null, rows };
}
async function atAnalyticsApi(env, ctx, url, action, body) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  const dash = async (method, path, payload) => {
    const res = await atDashCall(env, ctx, url, method, path, payload);
    return { res, data: await res.json().catch(() => ({})) };
  };
  // Таблица: один день (только его записи) или итоги за месяц / всё время, посчитанные здесь.
  if (action === 'an-table') {
    const projects = await listByPrefix(kv, 'project:');
    if (body.mode === 'day') {
      if (!isDate(body.date)) return json({ error: 'bad_date' }, 400);
      const recs = await Promise.all(projects.map((p) => kv.get(`dailyMetrics:${p.id}:${body.date}`, 'json')));
      return json({ rows: projects.map((p, i) => ({ projectId: p.id, ...atAddMetric(atZeroMetric(), recs[i] || {}) })) });
    }
    const month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? body.month : null;
    const sums = Object.fromEntries(projects.map((p) => [p.id, atZeroMetric()]));
    for (const r of await atDailyMetrics(kv)) {
      if (!sums[r.projectId] || (month && !String(r.date || '').startsWith(month))) continue;
      atAddMetric(sums[r.projectId], r);
    }
    return json({ rows: projects.map((p) => ({ projectId: p.id, ...sums[p.id] })) });
  }
  if (action === 'an-save') {
    if (!AT_AN_RAW.includes(body.key)) return json({ error: 'bad_key' }, 400);
    const { res, data } = await dash('POST', '/api/dashboard/daily-metric', { projectId: body.projectId, date: body.date, [body.key]: body.value });
    AT_DM = null;
    return json(data, res.status);
  }
  // «Подтянуть»: цифры из кабинетов Авито за день. Нет сбора за этот день (или «Загрузить заново») —
  // запускаем его; дальше страница опрашивает, пока статус не станет done.
  if (action === 'an-avito') {
    const date = isDate(body.date) ? body.date : mskYesterday();
    let { data } = await dash('GET', `/api/dashboard/avito-pull?date=${date}`);
    if (!data.pull || body.force) ({ data } = await dash('POST', '/api/dashboard/avito-pull', { date, force: !!body.force }));
    return json(await atAvitoDay(env, data.pull));
  }
  if (action === 'an-avito-apply') {
    const date = isDate(body.date) ? body.date : null;
    const pull = date && (await kv.get(`avitoPull:${date}`, 'json'));
    if (!pull) return json({ error: 'not_found' }, 404);
    let saved = 0;
    for (const [projectId, r] of Object.entries(pull.results || {})) {
      if (!r || !r.linked) continue;
      const payload = { projectId, date };
      if (r.views != null) payload.views = r.views;
      if (r.contacts != null) payload.contacts = r.contacts;
      if (r.spend != null) payload.budget = r.spend; // a missing spend never overwrites a hand-entered budget
      if (Object.keys(payload).length === 2) continue;
      const { res } = await dash('POST', '/api/dashboard/daily-metric', payload);
      if (res.ok) saved += 1;
    }
    AT_DM = null;
    return json({ saved });
  }
  // «Кабинеты Авито» (шестерёнка): ключи и какой кабинет у какого клиента.
  // «Подтягивать»: a new client's cabinet can be linked before its numbers are wanted in «Подтянуть».
  if (action === 'an-cabinet-pull') {
    const project = await kv.get(`project:${String(body.projectId || '')}`, 'json');
    if (!project) return json({ error: 'not_found' }, 404);
    if (body.on) delete project.avitoPullOff; else project.avitoPullOff = true;
    project.updatedAt = new Date().toISOString();
    await kv.put(`project:${project.id}`, JSON.stringify(project));
    await atTouch(kv, ['#projects']);
    return json({ ok: true, pull: !project.avitoPullOff });
  }
  if (action === 'an-cabinets' || action === 'an-cabinet-link' || action === 'an-cabinet-import') {
    let out;
    if (action === 'an-cabinets') out = (await dash('GET', '/api/dashboard/avito-links')).data;
    if (action === 'an-cabinet-link') out = (await dash('POST', '/api/dashboard/avito-link', { projectId: body.projectId, accountId: body.accountId || null })).data;
    if (action === 'an-cabinet-import') {
      const r = await dash('POST', '/api/dashboard/avito-import', { text: String(body.text || '') });
      if (!r.res.ok) return json(r.data, r.res.status);
      out = r.data;
    }
    const projects = (await listByPrefix(kv, 'project:')).filter((p) => !p.inactive).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const linkOf = Object.fromEntries((out.links || []).map((l) => [l.projectId, l.accountId]));
    return json({
      results: out.results || null,
      accounts: out.accounts || [],
      projects: projects.map((p) => ({ id: p.id, name: p.name, accountId: linkOf[p.id] || null, pull: !p.avitoPullOff })),
    });
  }
  // «Отчёт»: тот же отчёт (наблюдения пишет Workers AI), что и в дашборде.
  if (action === 'an-reports') {
    const [{ data: jobs }, { data: last }] = await Promise.all([dash('GET', '/api/dashboard/report-jobs'), dash('GET', '/api/dashboard/report-last')]);
    return json({ jobs: jobs.jobs || [], lastTo: last.lastTo || null, yesterday: last.yesterday || mskYesterday() });
  }
  if (action === 'an-report') {
    const { res, data } = await dash('POST', '/api/dashboard/report-job', { dateFrom: body.dateFrom, dateTo: body.dateTo });
    return json(data, res.status);
  }
  if (action === 'an-report-file') {
    return atDashCall(env, ctx, url, 'GET', `/api/dashboard/report-job/file?id=${encodeURIComponent(String(body.id || ''))}`);
  }
  return json({ error: 'not_found' }, 404);
}

async function handleAvitoTasksApi(request, env, url, ctx) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!kv) return json({ error: 'kv_not_configured' }, 500);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = (await readJson(request)) || {};
  const action = url.pathname.slice('/api/dashboard/avito-tasks/'.length);
  const team = await atGetTeam(env);
  const nowMs = Date.now();

  if (action.startsWith('login-')) {
    const res = await atLoginApi(env, team, action, body, nowMs);
    if (res) return res;
  }

  if (action === 'activate') {
    const code = atClean(body.invite, 64);
    const user = code && team.users.find((u) => u.invite === code);
    if (!user) return json({ error: 'bad_invite' }, 404);
    if (!user.active) return json({ error: 'blocked' }, 403);
    if (!user.activatedAt) {
      user.activatedAt = new Date(nowMs).toISOString();
      await atPutTeam(kv, team);
    }
    return json({ token: await atToken(team, user), me: atPublicUser(user) });
  }

  const auth = await atAuth(team, body.token);
  if (auth.error) return json({ error: auth.error, owner: AT_OWNER_TG }, auth.error === 'blocked' ? 403 : 401);
  const me = auth.user;
  const isOwner = me.role === 'owner';
  // The assistant sees and manages everything the owner does (Clients, Team, Activity); only the
  // owner's own record (and invite link) stays out of her reach.
  const isAdmin = isOwner || me.role === 'assistant';
  const sections = atSections(me);
  const seesClients = sections.includes('clients');
  const seesAnalytics = sections.includes('analytics');

  if (action === 'sync') {
    if (body.initial) {
      const seenKey = `at:seen:${me.id}`;
      const seen = Date.parse((await kv.get(seenKey)) || 0) || 0;
      if (nowMs - seen > AT_SEEN_EVERY_MS) await kv.put(seenKey, new Date(nowMs).toISOString());
      atKickQueue(env, ctx);
    }
    if (body.initial) await atSaveOpen(kv, me, nowMs);
    if (body.activity) await atSaveActivity(kv, me, body.activity, nowMs);
    const [mem, notifications] = await Promise.all([atSnapshot(env), kv.get(`at:notif:${me.id}`, 'json')]);
    // Tasks this device saved lately (body.known). An isolate in another Cloudflare location may not
    // have heard of them yet (its snapshot is rebuilt from KV every 10 minutes, and the change log can
    // lose an entry when two saves race), so they are read straight from KV and put into the snapshot
    // — for everyone this isolate serves. Ids KV doesn't have come back as `gone`.
    const known = Array.isArray(body.known) ? body.known.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id)).slice(0, 60) : [];
    const gone = [];
    const missing = known.filter((id) => !mem.tasks.has(id));
    if (missing.length) {
      const found = await Promise.all(missing.map((id) => kv.get(`task:${id}`, 'json')));
      let healed = false;
      found.forEach((t, i) => {
        if (atIsTrackerTask(t)) { mem.tasks.set(t.id, t); healed = true; } else gone.push(missing[i]);
      });
      if (healed) mem.stamp = `${Date.now().toString(36)}h`;
    }
    const ver = `${mem.v}.${mem.stamp}`;
    const out = {
      ver,
      me: { ...atPublicUser(me), roleLabel: me.roleLabel, sections },
      notifications: notifications || [],
      serverTime: nowMs,
    };
    if (gone.length) out.gone = gone;
    const reflection = await atReflectionState(kv, me, mem, nowMs);
    if (reflection) out.reflection = reflection;
    if (body.ver === ver) return json({ ...out, unchanged: true });
    const cutoff = nowMs - AT_HIDE_CLOSED_AFTER_MS;
    out.users = team.users.map(atPublicUser);
    out.projects = mem.projects;
    out.tasks = [...mem.tasks.values()]
      .filter((t) => (t.status === 'open' || t.status === 'done') || Date.parse(t.updatedAt || t.createdAt || 0) > cutoff)
      .map((t) => atPublicTask(t, team.users));
    if (seesClients) out.clients = atClientBoard(mem);
    if (!me.tgId) out.tgStart = await atTgStartParam(team, me);
    out.bot = await atBotUsername(env);
    return json(out);
  }

  // /at-visit.js on other cantor.agency pages (knowledge base, dashboard, …) — see «Activity» below.
  if (action === 'visit') {
    const res = await atSaveSiteVisit(kv, me, body, nowMs);
    return json(res, res.error ? 400 : 200);
  }

  if (action === 'task-save') {
    const res = await atSaveTask(env, team, me, body.task || {});
    if (res.error) return json({ error: res.error }, res.status || 400);
    return json({ task: atPublicTask(res.task, team.users) });
  }

  if (action === 'task-delete') {
    const id = atClean(body.id, 40);
    const task = id && (await kv.get(`task:${id}`, 'json'));
    if (!task) return json({ error: 'not_found' }, 404);
    if (!isAdmin && task.createdById !== me.id) return json({ error: 'forbidden' }, 403);
    await kv.delete(`task:${id}`);
    await atTouch(kv, [id]);
    if (AT_MEM && AT_MEM.tasks) AT_MEM.tasks.delete(id);
    return json({ ok: true });
  }

  if (action === 'notif-read') {
    const key = `at:notif:${me.id}`;
    const list = (await kv.get(key, 'json')) || [];
    if (list.some((n) => !n.read)) await kv.put(key, JSON.stringify(list.map((n) => ({ ...n, read: true }))));
    return json({ ok: true });
  }

  if (action === 'tg-unlink') {
    if (me.tgId && !isOwner) {
      me.tgId = null;
      me.tgUsername = null;
      await atPutTeam(kv, team);
    }
    return json({ ok: true });
  }

  if (action === 'refl-save') {
    const res = await atReflectionSave(env, team, me, body, nowMs);
    if (res.error) return json({ error: res.error, week: res.week }, res.status || 400);
    return json({ reflection: res.state });
  }
  if (action === 'refl-results') {
    if (!isAdmin && !REFL_READ_ROLES.has(me.role)) return json({ error: 'forbidden' }, 403);
    const current = reflWeek(nowMs);
    let week = /^\d{4}-\d{2}-\d{2}$/.test(String(body.week || '')) ? body.week : current;
    if (week > current) week = current;
    if (!isAdmin && REFL_ROLES.has(me.role) && reflLocked(nowMs, week, await kv.get(`refl:${current}:${me.id}`, 'json'))) {
      return json({ locked: true, week, current, prev: reflAddDays(current, -7) });
    }
    return json({ results: await atReflectionResults(env, team, week), current });
  }
  if (action === 'refl-history') {
    if (!isAdmin && !REFL_READ_ROLES.has(me.role)) return json({ error: 'forbidden' }, 403);
    const history = await atReflectionHistory(env);
    const current = reflWeek(nowMs);
    // Until the employee has rated this week, its averages stay off their chart too.
    if (!isAdmin && REFL_ROLES.has(me.role) && reflLocked(nowMs, current, await kv.get(`refl:${current}:${me.id}`, 'json'))) {
      history.weeks = history.weeks.filter((w) => w !== current);
      delete history.overall[current];
      history.clients.forEach((c) => { delete c.points[current]; });
      history.clients = history.clients.filter((c) => Object.keys(c.points).length);
    }
    return json({ history });
  }

  // «Рассылки» — календарь: когда, какому кабинету, на какой бюджет и что вышло.
  if (action === 'mail' || action.startsWith('mail-')) {
    if (!sections.includes('mail')) return json({ error: 'forbidden' }, 403);
    const res = await atMailApi(env, me, action, body, nowMs);
    return json(res.error ? { error: res.error } : res, res.status || 200);
  }

  // «ИИ-помощник» — у всех: свои диалоги, руководитель видит и чужие.
  if (action.startsWith('ai-')) return atAiApi(env, team, me, action, body, ctx);

  if (action === 'meet' || action.startsWith('meet-')) {
    const res = await atMeetApi(env, team, me, action, body, nowMs);
    return json(res.error ? { error: res.error } : res, res.status || 200);
  }

  // «Клиенту написали» — the client manager's mark on the Clients tab.
  if (action === 'client-touch') {
    if (!seesClients) return json({ error: 'forbidden' }, 403);
    const projectId = atClean(body.projectId, 80);
    if (!projectId) return json({ error: 'missing_project' }, 400);
    const clients = (await kv.get('at:clients', 'json')) || {};
    clients[projectId] = { ...(clients[projectId] || {}), lastUpdateAt: new Date(nowMs).toISOString(), by: me.name, note: atClean(body.note, 300) || null };
    await kv.put('at:clients', JSON.stringify(clients));
    // Answered: the client's waiting question (if the bot is in their chat) is settled too.
    for (const c of (await listByPrefix(kv, 'bot:chat:')).filter((x) => x.kind === 'client' && x.projectId === projectId)) {
      if (await kv.get(`bot:pending:${c.id}`)) await kv.delete(`bot:pending:${c.id}`);
      if (AT_MEM && AT_MEM.pending) delete AT_MEM.pending[String(c.id)];
    }
    await atTouch(kv, ['#clients']);
    if (AT_MEM) AT_MEM.clients = clients;
    return json({ ok: true, client: clients[projectId] });
  }

  // Client card links: the Avito profile and the brief (an empty value clears the hand-entered one;
  // the profile then falls back to the one the Avito pull found).
  if (action === 'client-links') {
    if (!seesClients) return json({ error: 'forbidden' }, 403);
    const projectId = atClean(body.projectId, 80);
    const project = projectId && (await kv.get(`project:${projectId}`, 'json'));
    if (!project) return json({ error: 'not_found' }, 404);
    const link = (value) => {
      let v = atClean(value, 500);
      if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
      return v && isValidHttpUrl(v) ? v : null;
    };
    for (const key of ['profileUrl', 'briefUrl', 'staffUrl']) {
      if (!(key in body)) continue;
      if (body[key] && !link(body[key])) return json({ error: 'bad_url', field: key }, 400);
      project[key] = link(body[key]);
    }
    // «Неактивный клиент» (the pencil on the client card). Grey in the old dashboard meant the same.
    if ('inactive' in body) {
      project.inactive = !!body.inactive;
      project.rowColor = project.inactive ? 'gray' : project.rowColor === 'gray' ? '' : project.rowColor || '';
    }
    project.updatedAt = new Date(nowMs).toISOString();
    await kv.put(`project:${projectId}`, JSON.stringify(project));
    await atTouch(kv, ['#projects']);
    const pub = { id: project.id, name: project.name, inactive: !!project.inactive, profileUrl: project.profileUrl || project.avitoProfileUrl || null, briefUrl: project.briefUrl || null, staffUrl: project.staffUrl || null };
    if (AT_MEM && AT_MEM.projects) AT_MEM.projects = AT_MEM.projects.map((p) => (p.id === projectId ? pub : p));
    return json({ ok: true, project: pub });
  }

  // A new client (it used to be «Новый проект» in the dashboard).
  if (action === 'client-new') {
    if (!seesClients || !isAdmin) return json({ error: 'forbidden' }, 403);
    const name = atClean(body.name, 120).replace(/\s+/g, ' ');
    if (name.length < 2) return json({ error: 'bad_name' }, 400);
    const res = await atDashCall(env, ctx, url, 'POST', '/api/dashboard/project', { name });
    const data = await res.json();
    if (!res.ok) return json(data, res.status);
    const p = data.project;
    return json({ ok: true, project: { id: p.id, name: p.name, inactive: false, profileUrl: null, briefUrl: null, staffUrl: null } });
  }

  // «Клиенты → Настройки»: кто ведёт клиента и его приоритет. body.owners — { <projectId>: { userId, priority } }.
  if (action === 'client-owners') {
    if (!seesClients || !isAdmin) return json({ error: 'forbidden' }, 403);
    const ids = new Set((await atLoadProjects(kv)).map((p) => p.id));
    const people = new Set(team.users.filter((u) => u.active).map((u) => u.id));
    const next = {};
    for (const [pid, o] of Object.entries((body && body.owners) || {})) {
      if (!ids.has(pid) || !o) continue;
      const userId = people.has(o.userId) ? o.userId : null;
      const priority = [1, 2, 3].includes(Number(o.priority)) ? Number(o.priority) : null;
      if (userId || priority) next[pid] = { userId, priority };
    }
    await kv.put('at:owners', JSON.stringify(next));
    await atTouch(kv, ['#projects']);
    return json({ ok: true, projects: await atLoadProjects(kv) });
  }

  // Цифры по клиентам для вкладки «Клиенты»: вчера, текущий месяц, траты за неделю и аванс.
  if (action === 'clients-metrics') {
    if (!seesClients) return json({ error: 'forbidden' }, 403);
    return json({ clients: await atClientsMetrics(env) });
  }
  // «Обновить с Авито»: аванс и кошелёк по всем клиентам — прямо сейчас.
  if (action === 'clients-refresh') {
    if (!seesClients) return json({ error: 'forbidden' }, 403);
    const rec = await atRefreshAvitoMoney(env);
    return json({ clients: await atClientsMetrics(env), at: rec.at });
  }

  // ── «Аналитика» (бывший дашборд): данные грузятся только при открытой вкладке ──
  if (action.startsWith('an-')) {
    if (!seesAnalytics) return json({ error: 'forbidden' }, 403);
    return atAnalyticsApi(env, ctx, url, action, body);
  }

  // ── Команда, Активность, База знаний ──
  if (!sections.includes('team') && !sections.includes('kb')) return json({ error: 'forbidden' }, 403);

  // «База знаний»: updates to cantor.agency/base through Workers AI.
  if (action.startsWith('kb-')) {
    if (!sections.includes('kb')) return json({ error: 'forbidden' }, 403);
    return atKbApi(env, me, action, body, ctx);
  }
  if (!sections.includes('team')) return json({ error: 'forbidden' }, 403);

  const teamView = async () => {
    const seen = await Promise.all(team.users.map((u) => kv.get(`at:seen:${u.id}`)));
    return json({
      users: team.users.map((u, i) => ({
        ...atPublicUser(u),
        aliases: u.aliases || [],
        // The owner's link signs in as the owner — only they see it.
        invite: u.role === 'owner' && !isOwner ? null : atInviteUrl(u),
        inviteCode: u.role === 'owner' && !isOwner ? null : u.invite,
        tgUsername: u.tgUsername || null,
        activatedAt: u.activatedAt || null,
        seenAt: seen[i] || null,
        createdAt: u.createdAt || null,
        sections: Array.isArray(u.sections) ? u.sections : null,
      })),
      roles: AT_ROLES,
      roleSections: AT_ROLE_SECTIONS,
    });
  };
  const target = body.id ? team.users.find((u) => u.id === body.id) : null;
  if (target && target.role === 'owner' && !isOwner && action !== 'team' && action !== 'activity') return json({ error: 'forbidden' }, 403);

  if (action === 'team') return teamView();

  if (action === 'activity') {
    const days = Math.min(31, Math.max(1, Number(body.days) || 14));
    return json(await atBuildActivity(env, team, days, nowMs));
  }

  if (action === 'user-save') {
    const input = body.user || {};
    const name = atClean(input.name, 80).replace(/\s+/g, ' ');
    if (name.length < 2) return json({ error: 'bad_name' }, 400);
    // Nobody becomes owner from the Team tab; the one owner stays as they are.
    // Only the owner and the assistant hand out the assistant role (it sees everything).
    const role = AT_ROLES[input.role] && input.role !== 'owner' && (isAdmin || input.role !== 'assistant') ? input.role : 'specialist';
    const aliases = Array.isArray(input.aliases) ? input.aliases.map((a) => atClean(a, 60)).filter(Boolean).slice(0, 8) : null;
    const now = new Date(nowMs).toISOString();
    let user = input.id ? team.users.find((u) => u.id === input.id) : null;
    if (input.id && !user) return json({ error: 'not_found' }, 404);
    if (user && user.role === 'owner' && !isOwner) return json({ error: 'forbidden' }, 403);
    if (user) {
      user.name = name;
      if (user.id !== me.id && user.role !== 'owner') user.role = role; // nobody demotes themselves or the owner out of the Team tab
      user.roleLabel = atClean(input.roleLabel, 60) || AT_ROLES[user.role];
      if (aliases) user.aliases = aliases;
    } else {
      user = {
        id: `u${atRandom(7)}`,
        name,
        role,
        roleLabel: atClean(input.roleLabel, 60) || AT_ROLES[role],
        aliases: aliases || [atFirstName(name)],
        invite: atRandom(16),
        v: 1,
        active: true,
        tgId: null,
        tgUsername: null,
        createdAt: now,
        activatedAt: null,
      };
      team.users.push(user);
    }
    await atPutTeam(kv, team);
    await atTouch(kv, ['#team']);
    return teamView();
  }

  // Разделы для одного человека: null — как у роли.
  if (action === 'user-sections') {
    if (!isAdmin) return json({ error: 'forbidden' }, 403);
    if (!target) return json({ error: 'not_found' }, 404);
    if (target.role === 'owner') return json({ error: 'forbidden' }, 403);
    let next = Array.isArray(body.sections) ? AT_SECTIONS.filter((k) => k === 'tasks' || body.sections.includes(k)) : null;
    const byRole = AT_ROLE_SECTIONS[target.role] || [];
    if (next && next.length === byRole.length && next.every((k) => byRole.includes(k))) next = null;
    if (next) target.sections = next; else delete target.sections;
    await atPutTeam(kv, team);
    await atTouch(kv, ['#team']);
    return teamView();
  }

  if (action === 'user-access') {
    if (!target) return json({ error: 'not_found' }, 404);
    if (target.id === me.id) return json({ error: 'self' }, 400);
    target.active = !!body.active;
    await atPutTeam(kv, team);
    await atTouch(kv, ['#team']);
    return teamView();
  }

  if (action === 'user-reset') {
    if (!target) return json({ error: 'not_found' }, 404);
    target.invite = atRandom(16);
    target.v = (Number(target.v) || 1) + 1;
    target.activatedAt = null;
    await atPutTeam(kv, team);
    const res = await teamView();
    // The owner's own devices are signed out too — hand this one a fresh token.
    if (target.id === me.id) {
      const data = await res.json();
      return json({ ...data, token: await atToken(team, target) });
    }
    return res;
  }

  if (action === 'user-delete') {
    if (!target) return json({ error: 'not_found' }, 404);
    if (target.id === me.id) return json({ error: 'self' }, 400);
    team.users = team.users.filter((u) => u.id !== target.id);
    await atPutTeam(kv, team);
    await kv.delete(`at:notif:${target.id}`);
    await atTouch(kv, ['#team']);
    return teamView();
  }

  return json({ error: 'not_found' }, 404);
}

// ── Avito Tasks → «База знаний»: updates to cantor.agency/base via Workers AI ──
// The owner and the assistant describe new knowledge on the tracker's «База знаний» tab: into a
// chosen regulation, into «общее» (the AI decides where it belongs) or as a new regulation —
// text plus files and pictures. The page uploads files in ≤1.5 MB parts (the Yandex Cloud proxy
// takes ≤3.5 MB per request), then «kb-send» starts a Workers AI job (see "Workers AI jobs") and
// answers at once — nobody waits on the page. The job reads the material, edits base/ and commits
// it to main through the GitHub API (the GitHub Action deploys cantor.agency); the worker then
// notifies the requester in the tracker and in Telegram, naming what changed where. The cron
// finishes unfinished jobs and marks hopeless ones as stuck, telling the requester and the owner.
//
// KV keys (AGENCY_DASHBOARD_KV, "kb:" prefix):
//   kb:job:<id>              -> { id, token, status, mode, target, newTitle, newSection, text, files,
//                                 byId, byName, sessionUrl, progress, result, error, createdAt,
//                                 updatedAt, sentAt, finishedAt }  (60-day TTL)
//                               status: draft → sent → running → done | failed | stuck | not_configured
//                               mode: 'reglament' (target = { slug, title }) | 'general' | 'new'
//   kb:file:<id>:<fileId>:<part> -> raw bytes of one ≤1.5 MB part of an attached file (30-day TTL)
//   kb:index                 -> [{ id, status, byId, createdAt, updatedAt }]  newest first, latest 60

const KB_JOB_TTL = 60 * 24 * 3600;
const KB_FILE_TTL = 30 * 24 * 3600;
const KB_PART_BYTES = 1536 * 1024; // a multiple of 3, so every part is standalone base64
const KB_MAX_FILES = 12;
const KB_MAX_FILE_BYTES = 25 * 1024 * 1024;
const KB_MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const KB_MAX_TEXT = 30000;
const KB_STUCK_MS = 150 * 60 * 1000;
const KB_ACTIVE = new Set(['sent', 'running']);
const KB_BASE_URL = 'https://cantor.agency/base';

function kbSlug(value) {
  const s = String(value || '').trim().replace(/^\/?base\//, '').replace(/\/+$/, '');
  return /^[a-z0-9][a-z0-9-]{1,79}$/.test(s) ? s : '';
}
async function kbPutJob(kv, job) {
  job.updatedAt = new Date().toISOString();
  await kv.put(`kb:job:${job.id}`, JSON.stringify(job), { expirationTtl: job.mode === 'assistant' ? AI_JOB_TTL : KB_JOB_TTL });
  if (job.status === 'draft' || job.mode === 'assistant') return;
  const index = ((await kv.get('kb:index', 'json')) || []).filter((x) => x.id !== job.id);
  index.unshift({ id: job.id, status: job.status, byId: job.byId, createdAt: job.createdAt, updatedAt: job.updatedAt });
  await kv.put('kb:index', JSON.stringify(index.slice(0, 60)));
}
const kbDm = (ymd) => `${String(ymd).slice(8, 10)}.${String(ymd).slice(5, 7)}`;
function kbMeetingTitle(job) {
  return `${job.meeting.clientName} — решения ${kbDm(job.meeting.date)}`;
}
// The decisions as the editor shows them: the title line, then «• …» items.
function kbMeetingText(job) {
  const m = job.meeting || {};
  if (m.text) return m.text;
  return [kbMeetingTitle(job), '', ...(m.items || []).map((x) => `• ${x}`)].join('\n');
}
// For Telegram: the first line bold, every item «• …» on its own with an empty line between.
function kbMeetingHtml(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  const firstIdx = lines.findIndex(Boolean);
  if (firstIdx < 0) return '';
  const title = lines[firstIdx].replace(/^\*+|\*+$/g, '').trim();
  const out = [`<b>${escapeHtml(title)}</b>`];
  let para = [];
  const flush = () => { if (para.length) { out.push('', para.join('\n')); para = []; } };
  for (const l of lines.slice(firstIdx + 1)) {
    if (!l) { flush(); continue; }
    const item = l.match(/^(?:[•\-*–—]|\d+[.)])\s*(.+)$/);
    if (item) { flush(); para.push(`• ${escapeHtml(item[1])}`); flush(); } else para.push(escapeHtml(l));
  }
  flush();
  return out.join('\n');
}
function kbTargetLabel(job) {
  if (job.mode === 'meeting' && job.meeting) return `Итоги встречи: ${job.meeting.clientName}, ${kbDm(job.meeting.date)}`;
  if (job.mode === 'reglament' && job.target) return job.target.title;
  if (job.mode === 'new') return `Новый регламент: ${job.newTitle}`;
  return 'Общее — ИИ разберёт сам';
}
function kbPublicJob(job) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    target: job.target || null,
    targetLabel: kbTargetLabel(job),
    newTitle: job.newTitle || null,
    newSection: job.newSection || null,
    text: job.text,
    files: (job.files || []).map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size })),
    byId: job.byId,
    byName: job.byName,
    sessionUrl: job.sessionUrl || null,
    progress: job.progress || null,
    result: job.result || null,
    error: job.error || null,
    meeting: job.meeting ? { ...job.meeting, title: kbMeetingTitle(job), text: job.status === 'done' ? kbMeetingText(job) : null } : null,
    createdAt: job.createdAt,
    sentAt: job.sentAt || null,
    finishedAt: job.finishedAt || null,
  };
}

// Tracker API actions kb-* (owner and assistant only — called from handleAvitoTasksApi).
async function atKbApi(env, me, action, body, ctx) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const nowIso = new Date().toISOString();

  if (action === 'kb-list') {
    const index = (await kv.get('kb:index', 'json')) || [];
    const jobs = (await Promise.all(index.slice(0, 30).map((x) => kv.get(`kb:job:${x.id}`, 'json')))).filter(Boolean);
    // The page polls while something is in work — each poll pushes those jobs on a step.
    for (const j of jobs.filter((x) => KB_ACTIVE.has(x.status)).slice(0, 3)) await waiKick(env, ctx, 'kb', j.id);
    return json({ jobs: jobs.map(kbPublicJob), configured: Boolean(env.AI && env.GITHUB_TOKEN) });
  }

  if (action === 'kb-create') {
    const mode = ['reglament', 'general', 'new', 'meeting'].includes(body.mode) ? body.mode : null;
    if (!mode) return json({ error: 'bad_mode' }, 400);
    const text = String(body.text == null ? '' : body.text).replace(/\r/g, '').trim().slice(0, KB_MAX_TEXT);
    const filesIn = Array.isArray(body.files) ? body.files.slice(0, KB_MAX_FILES + 1) : [];
    if (filesIn.length > KB_MAX_FILES) return json({ error: 'too_many_files' }, 400);
    if (!text && !filesIn.length) return json({ error: 'empty' }, 400);
    let target = null;
    if (mode === 'reglament') {
      const slug = kbSlug(body.slug);
      if (!slug) return json({ error: 'bad_target' }, 400);
      target = { slug, title: atClean(body.title, 200) || slug };
    }
    let meeting = null;
    if (mode === 'meeting') {
      const projectId = atClean(body.projectId, 80);
      const project = projectId ? await kv.get(`project:${projectId}`, 'json') : null;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : null;
      if (!project) return json({ error: 'bad_client' }, 400);
      if (!date) return json({ error: 'bad_date' }, 400);
      meeting = { projectId, clientName: project.name, date, items: [], text: null, sentAt: null, sentTo: [] };
    }
    const newTitle = mode === 'new' ? atClean(body.newTitle, 200).replace(/\s+/g, ' ') : '';
    if (mode === 'new' && newTitle.length < 3) return json({ error: 'bad_title' }, 400);
    let total = 0;
    const files = [];
    for (const f of filesIn) {
      const size = Math.floor(Number(f && f.size) || 0);
      if (size <= 0 || size > KB_MAX_FILE_BYTES) return json({ error: 'file_too_big', name: atClean(f && f.name, 120) }, 400);
      total += size;
      files.push({
        id: `f${files.length + 1}${atRandom(5)}`,
        name: atClean(f.name, 160).replace(/[\\/]/g, '_') || `file-${files.length + 1}`,
        type: atClean(f.type, 100) || 'application/octet-stream',
        size,
        parts: Math.ceil(size / KB_PART_BYTES),
      });
    }
    if (total > KB_MAX_TOTAL_BYTES) return json({ error: 'files_too_big' }, 400);
    const job = {
      id: atRandom(12),
      token: atRandom(32),
      status: 'draft',
      mode,
      target,
      newTitle: newTitle || null,
      newSection: mode === 'new' ? atClean(body.newSection, 120) || null : null,
      meeting,
      text,
      files,
      byId: me.id,
      byName: me.name,
      sessionUrl: null,
      progress: null,
      result: null,
      error: null,
      createdAt: nowIso,
    };
    await kbPutJob(kv, job);
    return json({ job: { id: job.id, files: files.map((f) => ({ id: f.id, parts: f.parts })) }, partBytes: KB_PART_BYTES });
  }

  const id = atClean(body.id, 24);
  const job = /^[a-z0-9]{12}$/.test(id) ? await kv.get(`kb:job:${id}`, 'json') : null;
  if (!job) return json({ error: 'not_found' }, 404);

  if (action === 'kb-file') {
    if (job.status !== 'draft') return json({ error: 'already_sent' }, 409);
    const file = job.files.find((f) => f.id === body.fileId);
    const part = Number(body.part);
    if (!file || !Number.isInteger(part) || part < 0 || part >= file.parts) return json({ error: 'bad_part' }, 400);
    let bytes;
    try {
      bytes = Uint8Array.from(atob(String(body.data || '')), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: 'bad_data' }, 400);
    }
    const expected = part < file.parts - 1 ? KB_PART_BYTES : file.size - KB_PART_BYTES * (file.parts - 1);
    if (bytes.length !== expected) return json({ error: 'bad_size', expected, got: bytes.length }, 400);
    await kv.put(`kb:file:${job.id}:${file.id}:${part}`, bytes, { expirationTtl: KB_FILE_TTL });
    return json({ ok: true });
  }

  // «Итоги встречи»: правка текста и «Готово» — в чат клиента и в его топик рабочего чата.
  if (action === 'kb-meeting-save' || action === 'kb-meeting-send') {
    if (job.mode !== 'meeting' || job.status !== 'done') return json({ error: 'not_ready' }, 409);
    const text = String(body.text == null ? kbMeetingText(job) : body.text).replace(/\r/g, '').trim().slice(0, 8000);
    if (!text) return json({ error: 'empty' }, 400);
    job.meeting.text = text;
    if (action === 'kb-meeting-send') {
      const html = kbMeetingHtml(text);
      const chats = await listByPrefix(kv, 'bot:chat:');
      const targets = [];
      for (const c of chats.filter((x) => !x.isForum && x.kind === 'client' && x.projectId === job.meeting.projectId)) targets.push({ chatId: c.id, label: c.title || 'чат клиента' });
      for (const c of chats.filter((x) => x.isForum)) {
        for (const k of (await kv.list({ prefix: `bot:topic:${c.id}:` })).keys) {
          const t = await kv.get(k.name, 'json');
          if (t && t.projectId === job.meeting.projectId) targets.push({ chatId: c.id, threadId: Number(k.name.split(':').pop()), label: `${c.title || 'рабочий чат'} → ${t.name || 'топик клиента'}` });
        }
      }
      if (!targets.length) return json({ error: 'no_chats', message: 'Бот не знает ни чата этого клиента, ни его топика в рабочем чате.' }, 409);
      const sent = [];
      for (const t of targets) {
        const res = await botApi(env, 'sendMessage', { chat_id: t.chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...(t.threadId ? { message_thread_id: t.threadId } : {}) });
        if (res && res.ok) sent.push(t.label);
      }
      if (!sent.length) return json({ error: 'send_failed', message: 'Telegram не принял сообщение — попробуйте ещё раз.' }, 502);
      job.meeting.sentAt = nowIso;
      job.meeting.sentTo = sent;
      job.meeting.sentBy = me.name;
    }
    await kbPutJob(kv, job);
    return json({ job: kbPublicJob(job) });
  }

  if (action === 'kb-send') {
    if (job.status === 'draft') {
      const have = new Set();
      let cursor;
      do {
        const page = await kv.list({ prefix: `kb:file:${job.id}:`, cursor });
        page.keys.forEach((k) => have.add(k.name.slice(`kb:file:${job.id}:`.length)));
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      const missing = [];
      for (const f of job.files) for (let p = 0; p < f.parts; p += 1) if (!have.has(`${f.id}:${p}`)) missing.push({ fileId: f.id, part: p });
      if (missing.length) return json({ error: 'files_incomplete', missing }, 409);
    } else if (KB_ACTIVE.has(job.status) || job.status === 'done') {
      return json({ job: kbPublicJob(job) });
    }
    await kbStart(env, ctx, job);
    return json({ job: kbPublicJob(job) });
  }

  return json({ error: 'not_found' }, 404);
}

// The requester hears about the outcome in the tracker and in Telegram; the owner gets a quiet copy
// when someone else asked (and a loud one for anything that went wrong).
async function kbNotify(env, job) {
  if (job.mode === 'assistant') return aiNotify(env, job);
  const team = await atGetTeam(env);
  const requester = team.users.find((u) => u.id === job.byId);
  const owner = team.users.find((u) => u.role === 'owner');
  const when = botFmtDate(Date.parse(job.createdAt));
  const excerpt = String(job.text || (job.files[0] && job.files[0].name) || '').replace(/\s+/g, ' ').slice(0, 90);
  const about = `Запрос от ${when}${excerpt ? `: «${escapeHtml(excerpt)}${job.text && job.text.length > 90 ? '…' : ''}»` : ''}`;
  const kbPage = `${AT_PAGE_URL}#kb=${job.id}`;
  let inApp;
  let tg;
  if (job.status === 'done' && job.mode === 'meeting') {
    inApp = `Итоги встречи готовы: ${job.meeting.clientName}, ${kbDm(job.meeting.date)} — проверьте и отправьте клиенту.`;
    tg = {
      text: [`📝 <b>Итоги встречи готовы</b> — ${escapeHtml(job.meeting.clientName)}, ${kbDm(job.meeting.date)}`, `Решений: ${(job.meeting.items || []).length}. Проверьте текст и нажмите «Готово» — бот отправит его в чат клиента и в его топик в рабочем чате.`].join('\n'),
      extra: { reply_markup: { inline_keyboard: [[{ text: 'Открыть и отправить', url: kbPage }]] } },
    };
  } else if (job.status === 'done') {
    const r = job.result;
    const names = r.changes.map((c) => `«${c.title}»`).join(', ');
    const head = !r.changes.length ? 'База знаний: менять ничего не понадобилось' : r.published ? 'База знаний обновлена' : 'Правки базы знаний готовы, ждут публикации';
    inApp = `${head}${names ? `: ${names}` : ''}. ${r.summary}`.trim();
    const lines = [!r.changes.length ? `📚 <b>${head}</b>` : r.published ? '📚 <b>База знаний обновлена</b>' : '📝 <b>Правки базы знаний готовы, но ещё не опубликованы</b>', `<i>${about}</i>`];
    if (r.changes.length) lines.push('', '<b>Что изменилось:</b>');
    for (const c of r.changes) lines.push(`• <b>${escapeHtml(c.title)}</b>${c.isNew ? ' (новый регламент)' : ''}${c.what ? ` — ${escapeHtml(c.what)}` : ''}`);
    if (r.summary) lines.push('', escapeHtml(r.summary));
    if (!r.published && r.changes.length) lines.push('', 'PR ждёт проверки Олега — после мержа изменения появятся на сайте.');
    const rows = r.changes.filter((c) => c.url).slice(0, 4).map((c) => [{ text: `📖 ${c.title}`.slice(0, 60), url: c.url }]);
    rows.push([{ text: 'Открыть в трекере', url: kbPage }]);
    tg = { text: lines.join('\n'), extra: { reply_markup: { inline_keyboard: rows } } };
  } else {
    const reason = job.status === 'stuck' ? 'ИИ не ответил больше двух часов' : job.error || 'неизвестная ошибка';
    inApp = `Не получилось обновить базу знаний (${kbTargetLabel(job)}): ${reason}. Можно отправить снова.`;
    tg = {
      text: ['⚠️ <b>Не получилось обновить базу знаний</b>', `<i>${about}</i>`, `Куда: ${escapeHtml(kbTargetLabel(job))}`, `Причина: ${escapeHtml(reason)}`, '', 'В трекере на вкладке «База знаний» можно отправить запрос снова.'].join('\n'),
      extra: { reply_markup: { inline_keyboard: [[{ text: 'Открыть в трекере', url: kbPage }]] } },
    };
  }
  if (requester) await atNotify(env, team, [requester.id], { kind: job.status === 'done' ? 'kb' : 'kbfail', ref: `kb:${job.id}`, text: inApp, by: 'ИИ' }, tg);
  // The owner: only the bell in Avito Tasks — a Telegram message per request was too much (one
  // dictation makes a dozen requests). The morning summary has a line with the day's count.
  if (owner && owner.id !== job.byId) {
    await atNotify(env, team, [owner.id], { kind: job.status === 'done' ? 'kb' : 'kbfail', ref: `kb:${job.id}`, text: `${job.byName}: ${inApp}`, by: 'ИИ' });
  }
}

// Cron: requests that never finished (the AI kept failing, limits) don't hang forever.
async function atKbCron(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const index = (await kv.get('kb:index', 'json')) || [];
  const now = Date.now();
  for (const x of index.filter((i) => KB_ACTIVE.has(i.status) && now - Date.parse(i.updatedAt) > KB_STUCK_MS)) {
    const job = await kv.get(`kb:job:${x.id}`, 'json');
    if (!job || !KB_ACTIVE.has(job.status) || now - Date.parse(job.updatedAt) <= KB_STUCK_MS) continue;
    job.status = 'stuck';
    job.error = 'ИИ не ответил больше двух часов.';
    job.finishedAt = new Date().toISOString();
    await kbPutJob(kv, job);
    await kbNotify(env, job);
  }
}

// ── Workers AI jobs: the daily report, «База знаний», «Итоги встречи» and «ИИ-помощник» ──
// All four used to go to Claude Code routines; now the worker does them itself on the free Workers AI
// allocation (the AI binding — the same one the control bot uses). A job runs in steps, each one model
// call that fits in waitUntil's ~30 s after a response, and keeps its progress in job.wai, so a step cut
// off midway is simply redone: the request that creates a job starts it, the pages that poll it (report
// list, «База знаний», an open dialog) push it on, and the cron finishes whatever is left (wai:queue).
// Knowledge-base edits are committed straight to main through the GitHub API — GITHUB_TOKEN secret, a
// fine-grained token with Contents: read and write on this repository; the GitHub Action then deploys
// cantor.agency, as it did for the routine's merges.
//
// KV keys (AGENCY_DASHBOARD_KV):
//   wai:queue        -> [{ kind: 'report'|'kb', id, at }]  jobs not finished yet — the cron's list
//   wai:text:<jobId> -> the material text extracted from a job's text and files (14-day TTL)
const WAI_LEASE_MS = 50 * 1000;
const WAI_CRON_QUIET_MS = 3 * 60 * 1000;
const WAI_MAX_TRIES = 3;
const WAI_ACTIVE = new Set(['queued', 'sent', 'running']);
const WAI_TEXT_TTL = 14 * 24 * 3600;
const WAI_CHUNK_CHARS = 22000;
const WAI_KB_MATERIAL_CHARS = 18000;
const WAI_KB_DOC_CHARS = 14000;
const WAI_REPORT_BATCH = 10;
const WAI_GH_REPO = 'oxionezhkov-hub/cantor-agency-web';
const WAI_GH_BRANCH = 'main';
const WAI_LIMIT_TEXT = 'Дневной бесплатный лимит Workers AI исчерпан — он обновляется в 03:00 МСК. Отправьте запрос снова после этого.';

function waiModel(env) {
  return env.WORKERS_AI_MODEL || env.CONTROL_BOT_AI_MODEL || BOT_AI_MODEL_DEFAULT;
}
function waiAi(env, system, user, maxTokens) {
  return botAi(env, system, user, maxTokens, { model: waiModel(env), temperature: 0.3 });
}
function waiClip(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}\n…(дальше обрезано)` : s;
}
function waiErrorText(e) {
  if (botIsLimitError(e)) return WAI_LIMIT_TEXT;
  return `ИИ не справился: ${String((e && e.message) || e).slice(0, 300)}`;
}
// JSON from a model: the object in the text, tolerating raw line breaks inside strings.
function waiParseJson(text) {
  const parsed = botParseJson(text);
  if (parsed) return parsed;
  return botParseJson(String(text || '').replace(/[\u0000-\u001f]+/g, ' '));
}
function waiHtmlText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// ── queue, lease and the step loop ──
async function waiEnqueue(kv, kind, id) {
  const q = ((await kv.get('wai:queue', 'json')) || []).filter((x) => !(x.kind === kind && x.id === id));
  q.push({ kind, id, at: Date.now() });
  await kv.put('wai:queue', JSON.stringify(q.slice(-60)));
}
async function waiDequeue(kv, kind, id) {
  const q = (await kv.get('wai:queue', 'json')) || [];
  if (!q.some((x) => x.kind === kind && x.id === id)) return;
  await kv.put('wai:queue', JSON.stringify(q.filter((x) => !(x.kind === kind && x.id === id))));
}
// Pushes a job on: in the background when there is a request context, inline otherwise.
async function waiKick(env, ctx, kind, id) {
  const short = Boolean(ctx && ctx.waitUntil);
  const run = waiRun(env, kind, id, short ? 2 : 40, short).catch((e) => console.error('workers ai job failed', kind, id, e && e.stack));
  if (ctx && ctx.waitUntil) ctx.waitUntil(run);
  else await run;
}
// short: inside a request's waitUntil (~30 s). A step that was cut off there once (inflight still set
// when its lease ran out) is left to the cron, which has minutes for it.
async function waiRun(env, kind, id, maxSteps, short) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const key = kind === 'report' ? `reportJob:${id}` : `kb:job:${id}`;
  const save = (job) => (kind === 'report' ? putReportJob(kv, job) : kbPutJob(kv, job));
  for (let step = 0; step < maxSteps; step += 1) {
    const job = await kv.get(key, 'json');
    if (!job || !WAI_ACTIVE.has(job.status)) {
      await waiDequeue(kv, kind, id);
      return;
    }
    const w = job.wai || (job.wai = {});
    if (w.lease && w.lease > Date.now()) return; // another request is on this step right now
    if (short && w.inflight) return;
    // The cron runs in another Cloudflare location, where KV can still show this job as it was a
    // minute ago — without its lease. A job someone touched lately is left to them.
    if (!short && step === 0 && Date.now() - Date.parse(job.updatedAt || job.createdAt || 0) < WAI_CRON_QUIET_MS) return;
    w.tries = (w.tries || 0) + 1;
    w.inflight = true;
    w.lease = Date.now() + WAI_LEASE_MS;
    job.status = 'running';
    await save(job);
    let finished = false;
    try {
      if (w.tries > WAI_MAX_TRIES) throw new Error('шаг не удался несколько раз подряд');
      finished = kind === 'report' ? await waiReportStep(env, job) : await waiKbStep(env, job);
      if (!finished) w.tries = 0;
    } catch (e) {
      console.error('workers ai step failed', kind, id, e && e.stack);
      // A spent allocation won't come back within this job's retries; anything else gets another go.
      if (botIsLimitError(e) || w.tries >= WAI_MAX_TRIES) {
        job.status = 'failed';
        job.error = waiErrorText(e);
        job.progress = null;
        finished = true;
      }
    }
    w.lease = 0;
    w.inflight = false;
    if (finished) job.finishedAt = new Date().toISOString();
    await save(job);
    if (!finished) continue;
    await waiDequeue(kv, kind, id);
    await kv.delete(`wai:text:${id}`);
    // Two passes that both finished the job (the race above) must not both post or notify.
    if (!(await waiClaimOnce(kv, `wai:done:${kind}:${id}:${job.sentAt || job.createdAt}`))) return; // a re-sent job notifies again
    if (kind === 'report') await reportPostToChat(env, job);
    else await kbNotify(env, job);
    return;
  }
}
// Claims a one-off action (cronClaimTick's way: write, wait, read back — the last writer wins),
// so two passes racing to the same finish post and notify once.
async function waiClaimOnce(kv, key) {
  if (await kv.get(key)) return false;
  const me = crypto.randomUUID();
  await kv.put(key, me, { expirationTtl: 14 * 24 * 3600 });
  await new Promise((r) => setTimeout(r, 1500));
  const owner = await kv.get(key);
  return !owner || owner === me;
}
// Cron: everything still in the queue, oldest first, as far as the tick allows.
async function waiCron(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const started = Date.now();
  const q = (await kv.get('wai:queue', 'json')) || [];
  const index = (await kv.get('kb:index', 'json')) || [];
  const items = [...q];
  index.filter((x) => WAI_ACTIVE.has(x.status) && !q.some((y) => y.kind === 'kb' && y.id === x.id)).forEach((x) => items.push({ kind: 'kb', id: x.id }));
  for (const x of items) {
    if (Date.now() - started > 8 * 60 * 1000) break;
    await waiRun(env, x.kind, x.id, 40, false);
  }
}

// ── reading the material: text plus files (TXT/VTT/SRT as is, the rest through AI.toMarkdown) ──
function waiDecode(bytes) {
  const utf = new TextDecoder('utf-8').decode(bytes);
  if ((utf.match(/�/g) || []).length < 20) return utf.replace(/^﻿/, '');
  try { return new TextDecoder('windows-1251').decode(bytes); } catch { return utf; }
}
// Zoom/Teams subtitles: drop the header, cue numbers and timings — only who said what stays.
function waiCleanSubs(text) {
  return String(text).split(/\r?\n/)
    .filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^(NOTE|STYLE|REGION)\b/.test(l))
    .join('\n');
}
async function waiFileText(env, file, bytes) {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '');
  if (/\.(vtt|srt)$/.test(name) || type === 'text/vtt') return waiCleanSubs(waiDecode(bytes));
  if (/\.(txt|md|csv|tsv|json|log|text)$/.test(name) || /^text\/(plain|csv|markdown|tab)/.test(type)) return waiDecode(bytes);
  if (/\.html?$/.test(name) || type === 'text/html') return waiHtmlText(waiDecode(bytes));
  if (!env.AI || typeof env.AI.toMarkdown !== 'function') throw new Error('нет AI.toMarkdown');
  const out = await env.AI.toMarkdown([{ name: file.name || 'file', blob: new Blob([bytes], { type: type || 'application/octet-stream' }) }]);
  const r = Array.isArray(out) ? out[0] : out;
  if (!r || r.format === 'error' || !r.data) throw new Error((r && r.error) || 'формат не поддерживается');
  return String(r.data);
}
async function waiReadMaterial(env, job) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const parts = [];
  const unread = [];
  if (job.text && job.text.trim()) parts.push(job.text.trim());
  for (const f of job.files || []) {
    const chunks = await Promise.all(Array.from({ length: f.parts }, (_, p) => kv.get(`kb:file:${job.id}:${f.id}:${p}`, 'arrayBuffer')));
    if (chunks.some((c) => !c)) { unread.push(`${f.name} (файл не найден — истёк срок хранения)`); continue; }
    const bytes = new Uint8Array(f.size);
    let off = 0;
    for (const c of chunks) { bytes.set(new Uint8Array(c), off); off += c.byteLength; }
    try {
      const text = (await waiFileText(env, f, bytes)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (text) parts.push(`=== Файл «${f.name}» ===\n${text}`);
      else unread.push(`${f.name} (пустой)`);
    } catch (e) {
      unread.push(`${f.name} (${String(e && e.message).slice(0, 80)})`);
    }
  }
  const text = parts.join('\n\n');
  await kv.put(`wai:text:${job.id}`, text || ' ', { expirationTtl: WAI_TEXT_TTL });
  job.wai.unread = unread;
  job.wai.chars = text.length;
}
async function waiMaterial(env, job) {
  const text = await env.AGENCY_DASHBOARD_KV.get(`wai:text:${job.id}`);
  return String(text == null ? job.text || '' : text).trim();
}
// Splits long text on line breaks into pieces of about max characters.
function waiChunks(text, max) {
  const out = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if (cur.length + line.length + 1 > max && cur) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + (line.length > max ? line.slice(0, max) : line);
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ── the daily report: «Текущие наблюдения» for every client ──
const WAI_REPORT_SYSTEM = [
  'Ты аналитик агентства Cantor Agency (продвижение репетиторов и онлайн-школ на Авито). Пишешь блок «Текущие наблюдения» ежедневного отчёта, который менеджер перешлёт клиенту.',
  'Для каждого клиента — одно-два предложения по-русски: конверсия из просмотра в контакт за месяц (month.conversionPct, цель 10–12%), стоимость контакта (month.cpl, цель 1000–1500 ₽) и динамика просмотров за последние 3 дня (last3).',
  'draft — механический черновик с верными цифрами: перепиши его живым деловым языком, но цифры и выводы (выше/ниже цели, растут/снижаются) не меняй и ничего не добавляй от себя.',
  'Тон спокойный и конкретный, без воды, обещаний, эмодзи и markdown. Если контактов за месяц нет — так и скажи, без конверсии и CPL.',
  'Ответ — только JSON-объект {"<id клиента>": "<наблюдение>", …} для всех клиентов из запроса.',
].join('\n');

async function waiReportStep(env, job) {
  const w = job.wai;
  const clients = job.report.clients;
  w.obs = w.obs || {};
  const todo = clients.filter((c) => !w.obs[c.projectId]).slice(0, WAI_REPORT_BATCH);
  if (todo.length) {
    const rows = todo.map((c) => ({
      id: c.projectId,
      name: c.name,
      month: { budget: c.month.budget, views: c.month.views, contacts: c.month.contacts, conversionPct: c.month.conversionPct, cpl: c.month.cpl },
      last3: c.last3.map((d) => d.views),
      draft: c.draftObservation,
    }));
    const out = await waiAi(env, WAI_REPORT_SYSTEM, `Период отчёта: ${job.report.periodLabel}.\nКлиенты:\n${JSON.stringify(rows)}`, 2500);
    const parsed = waiParseJson(out);
    if (!parsed) throw new Error('ответ не похож на JSON');
    // A client the model skipped keeps the draft — the job always moves on.
    for (const c of todo) {
      const t = parsed[c.projectId];
      w.obs[c.projectId] = typeof t === 'string' && t.trim() ? t.replace(/\s+/g, ' ').trim().slice(0, 600) : c.draftObservation;
    }
    if (clients.some((c) => !w.obs[c.projectId])) return false;
  }
  job.observations = w.obs;
  job.status = 'done';
  job.error = null;
  return true;
}

// ── «База знаний», «Итоги встречи», «ИИ-помощник» ──
async function kbStart(env, ctx, job) {
  const kv = env.AGENCY_DASHBOARD_KV;
  job.error = null;
  job.result = null;
  job.progress = null;
  job.wai = null;
  const missing = !env.AI ? 'привязки Workers AI (ai в wrangler.jsonc)'
    : !['meeting', 'assistant'].includes(job.mode) && !env.GITHUB_TOKEN ? 'секрета GITHUB_TOKEN — правки базы знаний некуда сохранить' : null;
  if (missing) {
    job.status = 'not_configured';
    job.error = `ИИ ещё не подключён: в настройках воркера нет ${missing}. Запрос сохранён — его можно отправить снова, когда подключат.`;
    await kbPutJob(kv, job);
    if (job.mode !== 'assistant' && await botOnce(kv, `kb-not-configured:${botMsk(Date.now()).date}`, 86400)) {
      await botNotifyOwner(env, `📚 ${escapeHtml(job.byName)} отправил(а) запрос в «Базу знаний», но ИИ не подключён: нет ${escapeHtml(missing)} (Cloudflare → mainweb → Settings). Запрос сохранён в трекере.`);
    }
    return;
  }
  job.status = 'sent';
  job.sentAt = new Date().toISOString();
  await kbPutJob(kv, job);
  await waiEnqueue(kv, 'kb', job.id);
  await waiKick(env, ctx, 'kb', job.id);
}

async function waiKbStep(env, job) {
  if (job.mode === 'assistant') return waiAssistantStep(env, job);
  const w = job.wai;
  if (!w.read) {
    job.progress = job.mode === 'meeting' ? 'читаю транскрибацию' : 'читаю материалы';
    await waiReadMaterial(env, job);
    w.read = true;
    return false;
  }
  return job.mode === 'meeting' ? waiMeetingStep(env, job) : waiKbEditStep(env, job);
}

// «Итоги встречи»: a long transcript is read in parts (notes per part), then the decisions are written.
function waiMeetingRules(job) {
  const first = String(job.meeting.clientName).trim().split(/\s+/)[0];
  return [
    `Ты составляешь итоги встречи агентства Cantor Agency (продвижение репетиторов на Авито) с клиентом «${job.meeting.clientName}» (встреча ${kbDm(job.meeting.date)}) — список принятых решений, который уйдёт клиенту.`,
    'Что нужно: только решения и договорённости встречи — что меняем, что тестируем, что продолжаем, что кто должен сделать и к какому сроку, ключевые цифры, на которые опирались. Без пересказа разговора, без воды.',
    `Формулировки: что делает или решает агентство — пиши без подлежащего, во множественном числе, как общее решение: «Делаем упор на…», «Продолжим оптимизировать…», «Запустили рассылку…», «Лимит увеличили…». Слово «Команда» не используй. Что делает, должен или сказал клиент — с его именем без фамилии: «${first} будет писать…», «${first} подготовит…». Пиши по-русски, коротко, конкретно, как деловые договорённости; каждый пункт — одно-три предложения, ключевые цифры сохраняй. Обычно 5–12 пунктов. Не выдумывай того, чего не было во встрече. Пароли и телефоны не включай.`,
    `Порядок: сначала все пункты про то, что делаем и решили мы (объявления, города, картинки, ставки, лимиты, рассылки, тесты, планы по бюджету). В самом конце — действия ${first} и рекомендации по диалогам и работе с контактами (как отвечать, сколько раз писать, звонить, видео, фото, отзывы). Близкие действия ${first} объединяй в один пункт.`,
    `Пример хороших пунктов (другой клиент): «Делаем упор на объявления логопеда: объявления по русскому языку и математике пока не дают результата, их отключат или разместят иначе.», «Продолжим оптимизировать города и картинки в объявлениях; у лучших объявлений конверсия из просмотра в контакт 10–11%, в среднем пока около 5% (цель — поднять до 12%).», «Запустили рассылку с бесплатной консультацией; ожидается 5–10 контактов в ближайшие дни.», «Если контакты выйдут на стабильный уровень, дневной лимит поднимем с 1000 до 1500–2000 ₽.», «Ольга будет писать каждому контакту минимум 3–4 раза, в том числе тем, кто создал чат и ничего не написал: молчание — не отказ, чаще всего человек просто не увидел сообщение.», «Ольга подготовит видео: нарежет имеющуюся запись на короткие части и по возможности запишет простое видео о себе на 30–60 секунд без монтажа и сценария.»`,
    'Формат ответа: только пункты, каждый с новой строки и начинается с «• ». Без заголовка, вступления и заключения.',
  ].join('\n');
}
const WAI_MEETING_PART_SYSTEM = [
  'Ты читаешь часть расшифровки встречи агентства Cantor Agency (продвижение репетиторов на Авито) с клиентом.',
  'Выпиши из этой части все решения, договорённости, планы, поручения (кто, что, к какому сроку) и ключевые цифры — коротко, по-русски, каждый пункт с новой строки с «• ».',
  'Пересказ разговора, приветствия и посторонние темы не нужны. Ничего не выдумывай. Если решений в этой части нет — ответь одной строкой «• —».',
].join('\n');
function waiItems(text) {
  return String(text || '').split('\n')
    .map((l) => l.replace(/^\s*(?:[•\-*–—]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.length > 3 && !/^(итоги|решения)\b.{0,60}:?$/i.test(l))
    .map((l) => atClean(l, 600))
    .slice(0, 40);
}
async function waiMeetingStep(env, job) {
  const w = job.wai;
  const text = await waiMaterial(env, job);
  if (text.length < 200) throw new Error(`в транскрибации почти нет текста${w.unread && w.unread.length ? ` (не прочитались: ${w.unread.join(', ')})` : ''}`);
  const chunks = waiChunks(text, WAI_CHUNK_CHARS);
  w.notes = w.notes || [];
  if (chunks.length > 1 && w.notes.length < chunks.length) {
    const i = w.notes.length;
    job.progress = `читаю транскрибацию: часть ${i + 1} из ${chunks.length}`;
    const out = await waiAi(env, WAI_MEETING_PART_SYSTEM, `Часть ${i + 1} из ${chunks.length}:\n\n${chunks[i]}`, 1500);
    w.notes.push(String(out).slice(0, 5000));
    return false;
  }
  job.progress = 'составляю итоги';
  const material = chunks.length > 1
    ? `Встреча длинная, её прочитали по частям. Заметки по частям (по порядку):\n\n${w.notes.map((n, i) => `— Часть ${i + 1} —\n${n}`).join('\n\n')}`
    : `Расшифровка встречи:\n\n${text}`;
  const items = waiItems(await waiAi(env, waiMeetingRules(job), material, 2500));
  if (!items.length) throw new Error('ИИ не вернул ни одного решения');
  job.meeting = { ...(job.meeting || {}), items, text: null };
  job.result = { summary: `Решений: ${items.length}`, changes: [], prUrl: null, published: true };
  job.status = 'done';
  job.error = null;
  job.progress = null;
  return true;
}

// ── GitHub: the knowledge base lives in base/ on main ──
async function ghApi(env, path, method = 'GET', body) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || WAI_GH_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cantor-agency-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${String((data && data.message) || '').slice(0, 160)}`);
  return data;
}
async function ghGetFile(env, path) {
  const d = await ghApi(env, `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${WAI_GH_BRANCH}`);
  if (!d || typeof d.content !== 'string') return null;
  return new TextDecoder('utf-8').decode(Uint8Array.from(atob(d.content.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
}
// One commit with every file, fast-forwarded onto main (a race with another push fails the step,
// and its retry reads the files again).
async function ghCommit(env, files, message) {
  const ref = await ghApi(env, `/git/ref/heads/${WAI_GH_BRANCH}`);
  const head = ref.object.sha;
  const parent = await ghApi(env, `/git/commits/${head}`);
  const tree = await ghApi(env, '/git/trees', 'POST', { base_tree: parent.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) });
  const commit = await ghApi(env, '/git/commits', 'POST', { message, tree: tree.sha, parents: [head] });
  await ghApi(env, `/git/refs/heads/${WAI_GH_BRANCH}`, 'PATCH', { sha: commit.sha, force: false });
  return commit.html_url || `https://github.com/${env.GITHUB_REPO || WAI_GH_REPO}/commit/${commit.sha}`;
}

// ── regulation HTML: steps, table of contents, catalog ──
// End of the <div> that opens at `start` (index just past its matching </div>), or -1.
function kbDivEnd(html, start) {
  const re = /<div\b|<\/div\s*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      depth -= 1;
      if (depth === 0) return re.lastIndex;
    } else depth += 1;
  }
  return -1;
}
function kbSteps(html) {
  const out = [];
  const re = /<div class="step"\s+id="([\w-]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const end = kbDivEnd(html, m.index);
    if (end < 0) continue;
    const inner = html.slice(m.index, end);
    const title = waiHtmlText((inner.match(/<div class="step-title">([\s\S]*?)<\/div>/) || [])[1] || '');
    out.push({ id: m[1], start: m.index, end, title, text: waiHtmlText(inner) });
  }
  return out;
}
function kbDocTitle(html) {
  return waiHtmlText((String(html).match(/<div class="doc-title">([\s\S]*?)<\/div>/) || [])[1] || '');
}
function kbCatalog(indexHtml) {
  const out = [];
  const re = /<a href="\/base\/([a-z0-9-]+)" class="(?:cat-card|featured-card)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(indexHtml))) {
    const title = waiHtmlText((m[2].match(/-title">([\s\S]*?)<\/div>/) || [])[1] || '');
    const desc = waiHtmlText((m[2].match(/-desc">([\s\S]*?)<\/div>/) || [])[1] || '');
    out.push({ slug: m[1], title, desc });
  }
  return out;
}
const KB_TAGS = new Set(['p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'br', 'a', 'code']);
// Only plain content tags get into a regulation: a stray <div> would break the page's structure.
function kbSafeHtml(html) {
  let s = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|svg)[\s\S]*?<\/\1>/gi, '');
  if (!/<[a-z][\s\S]*>/i.test(s)) {
    s = s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  }
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (tag, name, attrs) => {
    const t = name.toLowerCase();
    if (!KB_TAGS.has(t)) return '';
    if (tag[1] === '/') return t === 'br' ? '' : `</${t}>`;
    if (t === 'a') {
      const href = ((attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1] || '').trim();
      return /^(https:\/\/|\/base\/|#)[^"<>\s]*$/.test(href) ? `<a href="${href}">` : '<a>';
    }
    return `<${t}>`;
  }).trim();
}
// Inserts text as its own lines right before the closing tag at `at`, keeping that tag's indent.
function kbInsertLines(html, at, text) {
  const lineStart = html.lastIndexOf('\n', at - 1) + 1;
  const pos = /^\s*$/.test(html.slice(lineStart, at)) ? lineStart : at;
  return `${html.slice(0, pos)}${text}\n${html.slice(pos)}`;
}
function kbNewStepHtml(id, title, meta, body) {
  return [
    `    <div class="step" id="${id}">`,
    `      <div class="step-title">${escapeHtml(title)}</div>`,
    meta ? `      <div class="step-meta">${escapeHtml(meta)}</div>` : null,
    `      ${body}`,
    '    </div>',
  ].filter((x) => x != null).join('\n');
}
// Applies the model's plan to a regulation: additions into existing steps, new steps at the end (and
// in the table of contents). Returns the new HTML, or null when nothing applied.
function kbApplyPlan(html, plan) {
  let out = html;
  let changed = false;
  const usedIds = new Set(kbSteps(html).map((s) => s.id));
  for (const op of (Array.isArray(plan.add) ? plan.add : []).slice(0, 4)) {
    const body = kbSafeHtml(op && op.html);
    if (!body) continue;
    const step = kbSteps(out).find((s) => s.id === String(op.step || ''));
    if (!step) continue;
    out = kbInsertLines(out, out.lastIndexOf('</div>', step.end), `      ${body}`);
    changed = true;
  }
  for (const st of (Array.isArray(plan.newSteps) ? plan.newSteps : []).slice(0, 3)) {
    const body = kbSafeHtml(st && st.html);
    const title = atClean(st && st.title, 120);
    if (!body || !title) continue;
    let id = `k${Date.now().toString(36).slice(-5)}`;
    while (usedIds.has(id)) id = `k${atRandom(5)}`;
    usedIds.add(id);
    const steps = kbSteps(out);
    const block = kbNewStepHtml(id, title, atClean(st.meta, 160), body);
    if (steps.length) {
      const last = steps[steps.length - 1];
      out = `${out.slice(0, last.end)}\n\n${block}${out.slice(last.end)}`;
    } else {
      const card = out.indexOf('<div class="reg-card">');
      const end = card >= 0 ? kbDivEnd(out, card) : -1;
      if (end < 0) continue;
      out = kbInsertLines(out, out.lastIndexOf('</div>', end), `\n${block}`);
    }
    const toc = out.indexOf('<div class="toc-links">');
    const tocEnd = toc >= 0 ? kbDivEnd(out, toc) : -1;
    if (tocEnd > 0) out = kbInsertLines(out, out.lastIndexOf('</div>', tocEnd), `        <a href="#${id}">${escapeHtml(title)}</a>`);
    changed = true;
  }
  return changed ? out : null;
}
const KB_TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function kbSlugFromTitle(title) {
  const s = String(title || '').toLowerCase().replace(/^регламент\.?\s*/, '').split('').map((c) => (KB_TRANSLIT[c] != null ? KB_TRANSLIT[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  return s.length >= 3 ? `reglament-${s}` : `reglament-${atRandom(6)}`;
}

const WAI_KB_STYLE = [
  'Ты редактор базы знаний агентства Cantor Agency (продвижение репетиторов и онлайн-школ на Авито). База — регламенты для команды: менеджеров (КМ), специалистов по Авито, ассистента.',
  'Пиши как в регламентах: по-русски, коротко, конкретно, в повелительном наклонении или как правило работы. Не дублируй то, что уже есть в регламенте, — добавляй только новое.',
  'Не выдумывай факты сверх материала. Имена клиентов, телефоны, пароли и прочие личные данные в базу не переноси: вместо имени клиента — описание («репетитор английского с блогом на 7 тыс. подписчиков»).',
  'Если материал — не правило, а рассказ, кейс, переписка или цифры клиента, вытащи из него практический вывод для команды (что это значит для работы с такими клиентами) и оформи как правило или как «Пример из практики».',
  'HTML — только теги <p>, <ul>, <ol>, <li>, <strong>, <em>, <a href="…">, без классов, стилей и <div>.',
].join('\n');

async function waiKbEditStep(env, job) {
  const w = job.wai;
  const material = waiClip(await waiMaterial(env, job), WAI_KB_MATERIAL_CHARS);
  if (!material.trim()) throw new Error(`материал пустой${w.unread && w.unread.length ? ` — не прочитались файлы: ${w.unread.join(', ')}` : ''}`);
  const unreadNote = w.unread && w.unread.length ? ` Не удалось прочитать: ${w.unread.join(', ')}.` : '';
  if (job.mode === 'new') return waiKbNewStep(env, job, material, unreadNote);

  if (!w.slug && job.mode === 'reglament') w.slug = kbSlug(job.target && job.target.slug);
  if (!w.slug) {
    job.progress = 'выбираю регламент';
    const catalog = kbCatalog((await ghGetFile(env, 'base/index.html')) || '');
    if (!catalog.length) throw new Error('не удалось прочитать каталог base/index.html');
    const list = catalog.map((c) => `${c.slug} — ${c.title}: ${c.desc}`).join('\n');
    const out = await waiAi(env, `${WAI_KB_STYLE}\nЗадача: выбрать один регламент, куда лучше всего внести присланный материал. Ответь только slug регламента из списка, без пояснений. Если материал — кейс или наблюдение, которому нет места в остальных, выбери keisy-i-nablyudeniya.`,
      `Регламенты (slug — название: описание):\n${list}\n\nМатериал:\n${waiClip(material, 6000)}`, 60);
    const picked = catalog.find((c) => String(out).includes(c.slug));
    w.slug = picked ? picked.slug : (catalog.find((c) => c.slug === 'keisy-i-nablyudeniya') || catalog[0]).slug;
    return false;
  }

  job.progress = 'вношу правки';
  const path = `base/${w.slug}`;
  const html = await ghGetFile(env, path);
  if (!html) throw new Error(`регламент ${path} не найден в репозитории`);
  const title = kbDocTitle(html) || (job.target && job.target.title) || w.slug;
  const steps = kbSteps(html);
  const per = Math.max(300, Math.floor(WAI_KB_DOC_CHARS / Math.max(1, steps.length)));
  const outline = steps.length
    ? steps.map((s) => `[${s.id}] ${s.title}\n${waiClip(s.text.slice(s.title.length).trim(), per)}`).join('\n\n')
    : waiClip(waiHtmlText(html), WAI_KB_DOC_CHARS);
  const system = [
    WAI_KB_STYLE,
    `Задача: внести новые знания в регламент «${title}». Тебе дан текущий регламент по шагам ([id] заголовок и текст) и новый материал.`,
    'Реши, куда это добавить: дополнить существующие шаги (add) и/или завести новые шаги в конце (newSteps). Отказываться нельзя: любой присланный материал должен оказаться в регламенте, хотя бы как «Пример из практики». Если ровно это уже написано — ничего не добавляй и объясни в summary, где.',
    'Ответ — только JSON: {"add":[{"step":"<id шага>","html":"<что дописать в конец шага>"}],"newSteps":[{"title":"<заголовок шага>","meta":"<подпись: когда/кто, можно пусто>","html":"<текст шага>"}],"what":"<что изменилось, конкретно: какой шаг дополнен или добавлен>","summary":"<2–4 предложения простым языком: что именно добавлено>"}',
  ].join('\n');
  const plan = waiParseJson(await waiAi(env, system, `Регламент «${title}»:\n\n${outline}\n\n=== Новый материал от ${job.byName} ===\n${material}`, 3000));
  if (!plan) throw new Error('ответ не похож на JSON');
  const next = kbApplyPlan(html, plan);
  const summary = atClean(plan.summary, 1500);
  if (!next) {
    job.result = { summary: (summary || `Эти знания уже есть в регламенте «${title}».`) + unreadNote, changes: [], prUrl: null, published: true };
  } else {
    const what = atClean(plan.what, 600) || 'добавлены новые знания';
    const commitUrl = await ghCommit(env, [{ path, content: next }], `База знаний: ${title} — ${what}`.slice(0, 200));
    job.result = {
      summary: (summary || what) + unreadNote,
      changes: [{ slug: w.slug, title, what, isNew: false, url: `${KB_BASE_URL}/${w.slug}` }],
      prUrl: commitUrl,
      published: true,
    };
  }
  job.status = 'done';
  job.error = null;
  job.progress = null;
  return true;
}

// A new regulation: the page is built from an existing one (head, styles, feedback widget), its card
// goes into the catalog section the model picked.
async function waiKbNewStep(env, job, material, unreadNote) {
  job.progress = 'пишу новый регламент';
  const [indexHtml, template] = await Promise.all([ghGetFile(env, 'base/index.html'), ghGetFile(env, 'base/reglament-4-vstrechi')]);
  if (!indexHtml || !template) throw new Error('не удалось прочитать каталог или образец регламента');
  const sections = [...indexHtml.matchAll(/<div class="section-label">([\s\S]*?)<\/div>/g)].map((m) => waiHtmlText(m[1]));
  const system = [
    WAI_KB_STYLE,
    `Задача: написать новый регламент «${job.newTitle}» по присланному материалу.`,
    `Раздел каталога: ${job.newSection ? `«${job.newSection}»` : `выбери из списка: ${sections.map((s) => `«${s}»`).join(', ')}`}.`,
    'Ответ — только JSON: {"meta":"<одна строка под заголовком: о чём регламент>","goal":"<Цель: …, одно предложение>","cardDesc":"<1–2 предложения для карточки в каталоге>","section":"<раздел каталога>","steps":[{"title":"<заголовок шага>","meta":"<когда/кто, можно пусто>","html":"<текст шага>"}],"summary":"<2–4 предложения: что вошло в регламент>"}. Шагов обычно 3–8.',
  ].join('\n');
  const plan = waiParseJson(await waiAi(env, system, `Материал от ${job.byName}:\n${material}`, 3500));
  if (!plan || !Array.isArray(plan.steps)) throw new Error('ответ не похож на JSON');
  const steps = plan.steps.slice(0, 12).map((s, i) => ({ id: `s${i + 1}`, title: atClean(s && s.title, 120), meta: atClean(s && s.meta, 160), body: kbSafeHtml(s && s.html) })).filter((s) => s.title && s.body);
  if (!steps.length) throw new Error('в ответе нет ни одного шага');
  const title = job.newTitle;
  const existing = new Set(kbCatalog(indexHtml).map((c) => c.slug));
  let slug = kbSlugFromTitle(title);
  if (existing.has(slug) || (await ghGetFile(env, `base/${slug}`))) slug = `${slug}-${atRandom(4)}`;

  let page = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)} — База знаний Cantor Agency</title>`)
    .replace(/(<div class="doc-title">)[\s\S]*?(<\/div>)/, `$1${escapeHtml(title)}$2`)
    .replace(/(<div class="doc-meta">)[\s\S]*?(<\/div>)/, `$1${escapeHtml(atClean(plan.meta, 300))}$2`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${escapeHtml(atClean(plan.meta, 300))}"`);
  const toc = page.indexOf('<div class="toc-links">');
  const tocEnd = toc >= 0 ? kbDivEnd(page, toc) : -1;
  if (tocEnd > 0) page = `${page.slice(0, toc)}<div class="toc-links">\n${steps.map((s) => `        <a href="#${s.id}">${escapeHtml(s.title)}</a>`).join('\n')}\n    </div>${page.slice(tocEnd)}`;
  const card = page.indexOf('<div class="reg-card">');
  const cardEnd = card >= 0 ? kbDivEnd(page, card) : -1;
  if (cardEnd < 0) throw new Error('образец регламента не разобрался');
  const goal = atClean(plan.goal, 400);
  page = `${page.slice(0, card)}<div class="reg-card">\n    <div class="reg-title">${escapeHtml(title)}</div>\n${goal ? `    <div class="reg-goal">${escapeHtml(goal)}</div>\n` : ''}\n${steps.map((s) => kbNewStepHtml(s.id, s.title, s.meta, s.body)).join('\n\n')}\n  </div>${page.slice(cardEnd)}`;
  // The sample's «← previous / next →» links belong to it; the link to the catalog stays.
  page = page.replace(/\s*<div class="doc-nav">(?:(?!<\/div>)[\s\S])*?<\/div>/, (m) => (m.includes('to-catalog') ? m : ''));

  const sectionName = atClean(job.newSection || plan.section, 120);
  const cardHtml = [
    `      <a href="/base/${slug}" class="cat-card">`,
    `        <div class="cat-card-title">${escapeHtml(title)}</div>`,
    `        <div class="cat-card-desc">${escapeHtml(atClean(plan.cardDesc || plan.meta, 300))}</div>`,
    '        <div class="cat-card-link">Открыть →</div>',
    '      </a>',
  ].join('\n');
  let index = indexHtml;
  const labels = [...indexHtml.matchAll(/<div class="section-label">([\s\S]*?)<\/div>/g)];
  const label = labels.find((m) => waiHtmlText(m[1]).toLowerCase() === sectionName.toLowerCase()) || labels[labels.length - 1];
  const sectionStart = label ? index.lastIndexOf('<div class="cat-section">', label.index) : -1;
  const sectionEnd = sectionStart >= 0 ? kbDivEnd(index, sectionStart) : -1;
  if (sectionEnd < 0) throw new Error('не нашёлся раздел каталога');
  const grid = index.slice(sectionStart, sectionEnd).lastIndexOf('<div class="cat-grid"');
  if (grid >= 0) {
    index = kbInsertLines(index, index.lastIndexOf('</div>', kbDivEnd(index, sectionStart + grid)), cardHtml);
  } else {
    index = kbInsertLines(index, index.lastIndexOf('</div>', sectionEnd), `    <div class="cat-grid" style="margin-top:16px">\n${cardHtml}\n    </div>`);
  }
  const commitUrl = await ghCommit(env, [{ path: `base/${slug}`, content: page }, { path: 'base/index.html', content: index }], `База знаний: новый регламент «${title}»`.slice(0, 200));
  job.result = {
    summary: (atClean(plan.summary, 1500) || `Создан регламент «${title}».`) + unreadNote,
    changes: [{ slug, title, what: `новый регламент, шагов: ${steps.length}`, isNew: true, url: `${KB_BASE_URL}/${slug}` }],
    prUrl: commitUrl,
    published: true,
  };
  job.status = 'done';
  job.error = null;
  job.progress = null;
  return true;
}

// ── «ИИ-помощник» ──
// The knowledge base for the assistant: every step of every regulation as a block of text, read from
// the deployed pages (ASSETS) and kept per isolate for half an hour.
let WAI_KB_CACHE = null;
async function waiKbBlocks(env) {
  if (WAI_KB_CACHE && Date.now() - WAI_KB_CACHE.at < 30 * 60 * 1000) return WAI_KB_CACHE.blocks;
  const get = async (path) => {
    const res = await env.ASSETS.fetch(new Request(`https://cantor.agency${path}`));
    return res.ok ? res.text() : '';
  };
  const catalog = kbCatalog(await get('/base/'));
  const blocks = [];
  await Promise.all(catalog.map(async (c) => {
    const html = await get(`/base/${c.slug}`);
    const steps = kbSteps(html);
    if (!steps.length) blocks.push({ slug: c.slug, doc: c.title, step: '', text: waiHtmlText(html).slice(0, 4000) });
    steps.forEach((s) => blocks.push({ slug: c.slug, id: s.id, doc: c.title, step: s.title, text: s.text }));
  }));
  WAI_KB_CACHE = { at: Date.now(), blocks };
  return blocks;
}
// The regulation steps that share the most words with the question (crude stems: first 5 letters).
async function waiKbExcerpts(env, query, budget) {
  let blocks;
  try { blocks = await waiKbBlocks(env); } catch (e) { return ''; }
  const stems = [...new Set(String(query).toLowerCase().match(/[а-яёa-z0-9]{4,}/g) || [])].map((w) => w.slice(0, 5));
  if (!stems.length) return '';
  const scored = blocks.map((b) => {
    const t = `${b.step} ${b.text}`.toLowerCase();
    return { b, score: stems.reduce((n, s) => n + (t.includes(s) ? 1 : 0), 0) };
  }).filter((x) => x.score >= Math.min(2, stems.length)).sort((x, y) => y.score - x.score);
  const out = [];
  let used = 0;
  for (const { b } of scored) {
    const piece = `[${b.doc}${b.step ? ` → ${b.step}` : ''}] ${KB_BASE_URL}/${b.slug}${b.id ? `#${b.id}` : ''}\n${b.text.slice(0, 2500)}`;
    if (used + piece.length > budget) break;
    out.push(piece);
    used += piece.length;
  }
  return out.join('\n\n');
}
function waiAssistantSystem(job) {
  const a = job.assistant || {};
  return [
    `Ты ИИ-помощник в трекере агентства Cantor Agency. Пишет: ${job.byName} (${a.role || 'сотрудник'}). Агентство продвигает репетиторов и онлайн-школ на Авито: ведёт кабинеты клиентов, объявления, ставки, рассылки и диалоги.`,
    'Тебе даны: сжатая память диалога, последние сообщения, данные трекера (команда, клиенты с цифрами, деньги, задачи; по клиентам из вопроса — подробности, переписка, кабинет Авито) и выдержки из регламентов агентства.',
    'Отвечай на новое сообщение, опираясь на эти данные: считай, сравнивай, делай выводы. Ссылаясь на регламент, давай его ссылку.',
    'Не переспрашивай: если чего-то не уточнили, бери по умолчанию последние 7 дней по вчера, все показатели и все объявления — и сразу отвечай по данным. Уточняющий вопрос — только если ответить нельзя совсем (например, непонятно, о каком клиенте речь), и никогда не задавай тот же вопрос второй раз.',
    'Не выдумывай. Если в данных нет того, о чём спрашивают (рассылка, даты публикации объявлений, переписка и т. п.), прямо напиши, чего именно нет. Ты не можешь менять файлы и выгрузки и ничего не делаешь в кабинете Авито: никогда не пиши «добавил», «изменил», «обновил», если этого не было. Не предлагай лишнего, о чём не спрашивали.',
    'Если в сообщении несколько вопросов — ответь на каждый отдельным блоком с жирным заголовком (например, **Цифры**, **Чат с клиентом**, **Диалоги на Авито**). Каждый блок подробно: 3–6 пунктов с конкретными цифрами, датами и выводом.',
    'Роли не путай: клиент агентства — репетитор или школа (например, Наталия Попова). «Чат с клиентом» — переписка агентства с ним в Telegram (ПЕРЕПИСКА). «Диалоги на Авито» — переписка кабинета клиента с покупателями (родителями, учениками). Рассылку бери из блока РАССЫЛКА — цифры там уже посчитаны, не пересчитывай их.',
    'Вопрос про чат или настроение клиента («всё норм?», «как общение?») — разбери ПЕРЕПИСКУ: что клиент писал в последние дни, доволен ли, есть ли претензии, вопросы без ответа, что обещали и сделали ли. Приведи 1–2 короткие цитаты с датами и дай свою оценку. Если переписки по клиенту в данных нет — так и скажи.',
    'Цифры бери ровно из данных и не смешивай периоды: итоги за 7 дней отдельно, события по дням — с датами. Не противоречь сам себе. Если в данных написано, что Авито что-то не отдал (ошибка), — прямо скажи это, без догадок о диалогах и объявлениях.',
    'Пиши по-русски, сначала главное. Оформление: **жирный**, списки строками «• », абзацы через пустую строку. Без markdown-таблиц и заголовков с #. Токены, ключи и пароли не включай.',
    job.prepFiles && job.prepFiles.length ? `Файл выгрузки уже подготовлен и приложится к ответу сам: ${job.prepFiles.map((f) => f.name).join(', ')}. Его колонки: ID, название, статус, цена, категория, адрес, просмотры, контакты, в избранное, ссылка — других (например, даты публикации) в нём нет. В тексте дай краткий итог по нему: сколько объявлений, сколько просмотров и контактов, какие объявления лучшие.` : 'Файлы ты приложить не можешь: если просят выгрузку, скажи, что её можно получить, указав клиента и период (например, «выгрузка по Авито клиента … за неделю»).',
    'Формат ответа строго такой, три части с этими заголовками:',
    '===ОТВЕТ===',
    '<ответ человеку>',
    '===ПАМЯТЬ===',
    '<сжатая память диалога до 1200 символов: о чём просит человек, ключевые факты, цифры, выводы и договорённости, его предпочтения; старую память обнови, лишнее выкинь>',
    '===ТЕМА===',
    '<тема диалога, 2–5 слов>',
  ].join('\n');
}
function waiAssistantParse(out) {
  const s = String(out || '');
  const part = (name) => {
    const m = s.match(new RegExp(`===\\s*${name}\\s*===\\s*([\\s\\S]*?)(?====\\s*[А-ЯЁ]+\\s*===|$)`));
    return m ? m[1].trim() : '';
  };
  const answer = part('ОТВЕТ') || s.replace(/===\s*[А-ЯЁ]+\s*===[\s\S]*$/, '').trim();
  return { answer, memory: part('ПАМЯТЬ'), title: part('ТЕМА').split('\n')[0] };
}
async function waiAssistantStep(env, job) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const w = job.wai;
  if (!w.data) {
    job.progress = 'собираю данные';
    if (job.dataText == null) {
      try {
        job.dataText = await aiBuildData(env, job, true);
      } catch (e) {
        console.error('assistant data failed', e && e.stack);
        job.dataText = `Данные трекера собрать не получилось (${String(e && e.message).slice(0, 200)}).`;
      }
    }
    if (!job.avitoDone) {
      try {
        const av = await aiBuildAvito(env, job);
        job.prepFiles = [];
        for (const f of av.prepFiles.slice(0, 3)) {
          const meta = { id: `p${job.prepFiles.length + 1}${atRandom(5)}`, name: f.name.replace(/[\\/]/g, '_'), type: f.type, size: f.bytes.length, parts: Math.ceil(f.bytes.length / KB_PART_BYTES) };
          for (let p = 0; p < meta.parts; p += 1) await kv.put(`kb:file:${job.id}:${meta.id}:${p}`, f.bytes.slice(p * KB_PART_BYTES, (p + 1) * KB_PART_BYTES), { expirationTtl: AI_JOB_TTL });
          job.prepFiles.push(meta);
        }
        if (av.text) job.dataText += `\n\n${av.text}`;
      } catch (e) {
        console.error('assistant avito failed', e && e.stack);
      }
      job.avitoDone = true;
    }
    w.data = true;
    return false;
  }
  job.progress = 'пишу ответ';
  const a = job.assistant || {};
  const recent = (a.recent || []).map((m) => `${m.role}: ${m.text}`).join('\n\n');
  const kb = await waiKbExcerpts(env, `${job.text} ${(a.recent || []).slice(-2).map((m) => m.text).join(' ')}`, 6000);
  const user = [
    a.memory ? `ПАМЯТЬ ДИАЛОГА:\n${a.memory}` : 'ПАМЯТЬ ДИАЛОГА: пусто (новый диалог).',
    recent ? `ПОСЛЕДНИЕ СООБЩЕНИЯ:\n${waiClip(recent, 5000)}` : '',
    `ДАННЫЕ ТРЕКЕРА:\n${waiClip(job.dataText || '—', 22000)}`,
    kb ? `ВЫДЕРЖКИ ИЗ РЕГЛАМЕНТОВ:\n${kb}` : '',
    `НОВОЕ СООБЩЕНИЕ от ${job.byName}:\n${job.text}`,
  ].filter(Boolean).join('\n\n');
  const res = waiAssistantParse(await botAi(env, waiAssistantSystem(job), user, 3500, { model: env.ASSISTANT_AI_MODEL || waiModel(env), temperature: 0.3 }));
  if (!res.answer) throw new Error('пустой ответ');
  job.files = [...(job.prepFiles || [])];
  job.result = {
    answer: res.answer.slice(0, 30000),
    memory: atClean(res.memory, 2000) || a.memory || null,
    title: atClean(res.title, 60).replace(/[«»"*]/g, '') || null,
  };
  job.status = 'done';
  job.error = null;
  job.progress = null;
  return true;
}

// ── Avito Tasks → «ИИ-помощник»: a chat with Workers AI for everyone on the team ──
// Every message is a Workers AI job like the knowledge base's (a kb:job with mode 'assistant' — file
// storage and stuck handling are shared). The worker gathers the data the question needs (all
// clients, the clients and people it names, tasks, chats, the Avito cabinet and a CSV export when
// asked) plus the regulation steps that match the question, and the model writes the answer and an
// updated short memory of the dialog.
// A dialog keeps its last messages for display; the model gets only the memory and the last few
// messages, so the context stays small. The page folds a finished job into its dialog when it next
// reads it, so only the tracker side ever writes a dialog (the job may finish in the cron, in
// another Cloudflare location, and would race it).
// Everyone sees their own dialogs; the owner also sees everyone else's (read only), deleted ones too.
//
// KV keys (AGENCY_DASHBOARD_KV):
//   ai:dlgs:<userId> -> [{ id, title, main, createdAt, updatedAt, last }]  newest first
//   ai:dlg:<id>      -> { id, userId, userName, title, main, autoTitle, memory,
//                         messages: [{ id, role: 'user'|'assistant', text, at, jobId, done, error, files }] }
const AI_JOB_TTL = 14 * 24 * 3600;
const AI_STUCK_MS = 45 * 60 * 1000;
const AI_KEEP_MESSAGES = 80;
const AI_CONTEXT_MESSAGES = 6;
const AI_MAX_TEXT = 8000;
const AI_MAX_DIALOGS = 40;

const aiMainId = (userId) => `main-${userId}`;
const aiIdOk = (id) => /^(main-[a-z0-9_-]{1,40}|[a-f0-9]{10})$/.test(String(id || ''));

// ── data for the assistant ──
// Everything a question needs is gathered here, by the worker, into job.dataText. One
// request may not read more than ~1000 KV keys — so no full listings of daily metrics here: per-day
// keys are read for just the clients and days in question, tasks come from the tracker's snapshot.
const AI_DATA_BUDGET = 17000;
const AI_AVITO_RE = /авито|объявлен|статистик|выгруз|просмотр|избранн|отзыв|рейтинг|кабинет|позици|ставк/i;
const AI_EXPORT_RE = /выгруз|файл|таблиц|csv|excel|xlsx|эксел/i;
const AI_DIALOG_RE = /диалог|переписк|чат(?!ь)|рассылк|сообщени|лид|заявк/i;
// What the Avito part looks at: the question and, for a follow-up («за 7 дней»), the person's previous message.
function aiAvitoText(job) {
  const a = job.assistant || {};
  const prev = [...(a.recent || [])].reverse().find((m) => m.role !== 'ИИ-помощник');
  return `${job.text}\n${prev ? prev.text : ''}`;
}

async function aiChatSources(kv, byId) {
  const chats = await listByPrefix(kv, 'bot:chat:');
  const out = [];
  for (const c of chats) {
    if (c.isForum) {
      for (const k of (await kv.list({ prefix: `bot:topic:${c.id}:` })).keys) {
        const rec = await kv.get(k.name, 'json');
        out.push({ chatId: c.id, threadId: k.name.split(':').pop(), projectId: (rec && rec.projectId) || null, name: `${c.title || 'Рабочий чат'} → ${(rec && rec.projectId && byId[rec.projectId] && byId[rec.projectId].name) || (rec && rec.name) || 'топик'}` });
      }
      out.push({ chatId: c.id, threadId: '0', projectId: null, name: `${c.title || 'Рабочий чат'} → общий топик` });
    } else {
      out.push({ chatId: c.id, threadId: '0', projectId: c.projectId || null, name: c.title || 'чат' });
    }
  }
  return out;
}
async function aiMoney(kv) {
  const [pull, live] = await Promise.all([atLatestPull(kv), kv.get('at:avitoMoney', 'json')]);
  const pullAt = pull ? Date.parse(pull.finishedAt || pull.startedAt || 0) || 0 : 0;
  const liveAt = live ? Date.parse(live.at) || 0 : 0;
  return (pid) => {
    const lr = live && live.rows && live.rows[pid];
    const r = pull && pull.results && pull.results[pid];
    if (lr && liveAt >= pullAt) return { advance: lr.advance, wallet: lr.wallet, at: live.at };
    if (r) return { advance: r.advance != null ? r.advance : null, wallet: r.wallet != null ? r.wallet : null, at: pull.finishedAt || pull.startedAt || null };
    return null;
  };
}
async function aiDaily(kv, pid, days) {
  const y = mskYesterday();
  const dates = Array.from({ length: days }, (_, i) => avitoAddDays(y, -i)).reverse();
  const recs = await Promise.all(dates.map((d) => kv.get(`dailyMetrics:${pid}:${d}`, 'json')));
  return dates.map((d, i) => recs[i] && { date: d, budget: Number(recs[i].budget) || 0, views: Number(recs[i].views) || 0, contacts: Number(recs[i].contacts) || 0, diagnostics: Number(recs[i].diagnostics) || 0, sales: Number(recs[i].sales) || 0 }).filter(Boolean);
}
const aiSum = (rows) => rows.reduce((a, r) => { ['budget', 'views', 'contacts', 'diagnostics', 'sales'].forEach((k) => { a[k] += r[k]; }); return a; }, { budget: 0, views: 0, contacts: 0, diagnostics: 0, sales: 0 });
const aiRub = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU')} ₽`);
function aiPeriod(text) {
  const t = String(text || '').toLowerCase();
  const m = t.match(/за\s+(?:последние\s+)?(\d{1,2})\s*(?:дн|день|дня|дней|сут)/);
  let days = m ? Number(m[1]) : /вчера/.test(t) ? 1 : /месяц/.test(t) ? 30 : /две недели|2 недели/.test(t) ? 14 : /недел/.test(t) ? 7 : 7;
  days = Math.max(1, Math.min(31, days));
  const to = mskYesterday();
  return { from: avitoAddDays(to, -(days - 1)), to, days };
}
// Clients the text names: by surname; a first name alone only when no one on the team shares it.
function aiNamedClients(text, projects, people) {
  const q = ` ${botNorm(text)} `;
  const hit = (w) => w.length > 3 && q.includes(` ${w.slice(0, Math.max(4, w.length - 2))}`);
  const teamFirst = new Set(people.flatMap((u) => [atFirstName(u.name), ...(u.aliases || [])]).map((x) => botNorm(x)));
  const bySurname = projects.filter((p) => botNorm(p.name).split(' ').slice(1).some(hit));
  // A surname in the text settles it: «натали… сасс» is Наталина Сасс, not also Наталия and Наталья.
  if (bySurname.length) return bySurname;
  // First names are close to each other (Наталина / Наталия / Наталья): only the last letter may
  // change, and the longest match wins («наталиной» is Наталина, not also Наталия).
  const byFirst = projects.map((p) => {
    const firstName = botNorm(p.name).split(' ')[0];
    const stem = firstName.slice(0, firstName.length - 1);
    const ok = firstName.length > 3 && !teamFirst.has(firstName) && q.includes(` ${stem}`)
      && projects.filter((x) => botNorm(x.name).split(' ')[0] === firstName).length === 1;
    return ok ? { p, len: stem.length } : null;
  }).filter(Boolean);
  const best = Math.max(0, ...byFirst.map((x) => x.len));
  return byFirst.filter((x) => x.len === best).map((x) => x.p);
}

async function aiBuildData(env, job, light) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const now = Date.now();
  const a = job.assistant || {};
  const team = await atGetTeam(env);
  const people = team.users.filter((u) => u.active);
  // A cold isolate rebuilds the tracker snapshot (~700 KV reads of the ~1000 a request may make): then the light way.
  if (!AT_MEM || now - AT_MEM.builtAt >= AT_FULL_REBUILD_MS) light = true;
  const [byId, mem, money, pending] = await Promise.all([botProjectsById(kv), atSnapshot(env), aiMoney(kv), botPendingList(env, now)]);
  const projects = Object.values(byId).sort((x, y) => x.name.localeCompare(y.name, 'ru'));
  const tasks = [...mem.tasks.values()];
  const userName = (id) => { const u = team.users.find((x) => x.id === id); return u ? u.name : null; };
  const fmt = (ms) => (ms ? botFmtDate(ms) : '—');
  const statusOf = (t) => (t.status === 'open' ? (t.takenAt ? 'в работе' : 'новая') : { done: 'сделана, клиенту не сообщили', closed: 'закрыта', cancelled: 'отменена' }[t.status] || t.status);
  const taskLine = (t, withClient = true) => {
    const due = botDueMs(t);
    const who = userName(atAssigneeId(t, team.users)) || t.owner || 'ничья';
    return `- ${withClient ? `${(t.projectId && byId[t.projectId] && byId[t.projectId].name) || t.topicName || 'без клиента'} | ` : ''}${String(t.text).replace(/\s+/g, ' ').slice(0, 160)} | ${who} | ${statusOf(t)} | срок ${due ? `${fmt(due)}${due < now && t.status === 'open' ? ' ПРОСРОЧЕНО' : ''}` : 'нет'} | с ${fmt(Date.parse(t.startedAt || t.createdAt || 0))}${t.doneAt ? ` | сделано ${fmt(Date.parse(t.doneAt))}` : ''}`;
  };
  const live = (t) => t.status === 'open' || t.status === 'done';

  // Who and what the question is about: the question first, then the dialog it continues.
  let named = aiNamedClients(job.text, projects, people);
  // «Ольги Климович» names a client, not Ольга from the team: client names are taken out first.
  const clientStems = new Set(named.flatMap((p) => botNorm(p.name).split(' ')).map((w) => w.slice(0, 4)));
  const person = atMatchUser(botNorm(job.text).split(' ').filter((w) => !clientStems.has(w.slice(0, 4))).join(' '), people);
  // A follow-up («а за месяц?») continues the clients of the dialog.
  if (!named.length && !person) named = aiNamedClients([...(a.recent || []).slice(-2).map((m) => m.text), a.memory || ''].join('\n'), projects, people);
  named = named.slice(0, 3);
  job.assistant.named = named.map((p) => p.id);

  const parts = [];
  parts.push(`СЕЙЧАС: ${fmt(now)} МСК. Цифры дашборда — по вчерашний день (${mskYesterday()}).`);
  parts.push(`КОМАНДА:\n${people.map((u) => `- ${u.name} — ${u.roleLabel || AT_ROLES[u.role] || u.role}`).join('\n')}`);

  // All clients, one line each: last 7 days, money, open tasks, waiting for a reply.
  const active = projects.filter((p) => !p.inactive);
  // light: a cold isolate far from the team — the tracker snapshot alone costs ~700 KV reads there.
  const week = light ? active.map(() => []) : await Promise.all(active.map((p) => aiDaily(kv, p.id, 7)));
  parts.push(`КЛИЕНТЫ (активные${light ? '' : '; 7 дней по вчера: бюджет / просмотры / контакты / диагностики / продажи'}):\n${active.map((p, i) => {
    const s = aiSum(week[i]);
    const m = money(p.id);
    const w = pending.find((x) => x.projectId === p.id);
    return `- ${p.name} [id ${p.id}] | ${p.status || '—'}${p.stage && p.stage !== '-' ? `, ${p.stage}` : ''} | отв. ${userName(p.responsibleId) || '—'}${light ? '' : ` | ${aiRub(s.budget)} / ${s.views} / ${s.contacts} / ${s.diagnostics} / ${s.sales}`}${m ? ` | аванс ${aiRub(m.advance)}, кошелёк ${aiRub(m.wallet)}` : ''} | открытых задач ${tasks.filter((t) => t.projectId === p.id && t.status === 'open').length}${w ? ` | ЖДЁТ ОТВЕТА с ${fmt(w.since)}` : ''}${p.avitoAccountId ? '' : ' | кабинет Авито не подключён'}`;
  }).join('\n')}${projects.some((p) => p.inactive) ? `\nНеактивные: ${projects.filter((p) => p.inactive).map((p) => p.name).join(', ')}` : ''}`);

  let chatBlock = '';
  if (person) {
    const pt = tasks.filter((t) => live(t) && atAssigneeId(t, team.users) === person.id);
    parts.push(`ЗАДАЧИ СОТРУДНИКА ${person.name} (открытые и сделанные, но клиенту не сообщили):\n${pt.map((t) => taskLine(t)).join('\n') || '—'}`);
  }
  if (named.length) {
    let meetingJobs = null;
    for (const p of named) {
      const daily = await aiDaily(kv, p.id, 30);
      const m = money(p.id);
      const ct = tasks.filter((t) => t.projectId === p.id && (live(t) || Date.parse(t.updatedAt || t.createdAt || 0) > now - 45 * 24 * 3600000))
        .sort((x, y) => Number(live(y)) - Number(live(x)) || Date.parse(y.updatedAt || y.createdAt || 0) - Date.parse(x.updatedAt || x.createdAt || 0));
      const refl = [];
      for (const wk of [reflWeek(now), reflAddDays(reflWeek(now), -7)]) {
        const recs = await Promise.all(people.filter((u) => REFL_READ_ROLES.has(u.role)).map(async (u) => [u, await kv.get(`refl:${wk}:${u.id}`, 'json')]));
        for (const [u, r] of recs) { const x = r && r.answers && r.answers[p.id]; if (x && x.score) refl.push(`- неделя ${wk}: ${u.name} — ${x.score}/10${x.comment ? `, «${String(x.comment).slice(0, 200)}»` : ''}`); }
      }
      if (!meetingJobs) meetingJobs = (await Promise.all(((await kv.get('kb:index', 'json')) || []).slice(0, light ? 15 : 40).map((x) => kv.get(`kb:job:${x.id}`, 'json')))).filter((j) => j && j.mode === 'meeting' && j.status === 'done' && j.meeting);
      const meets = meetingJobs.filter((j) => j.meeting.projectId === p.id).slice(0, 2).map((j) => kbMeetingText(j));
      const w = pending.filter((x) => x.projectId === p.id);
      parts.push([
        `КЛИЕНТ ПОДРОБНО: ${p.name} [id ${p.id}]`,
        `Карточка: услуга ${p.service || '—'}; статус ${p.status || '—'}; этап ${p.stage || '—'}; ответственный ${userName(p.responsibleId) || '—'}${p.currentWork ? `; текущая работа: ${p.currentWork}` : ''}${p.review ? `; отзыв: ${p.review}` : ''}`,
        m ? `Деньги в кабинете: аванс ${aiRub(m.advance)}, кошелёк ${aiRub(m.wallet)} (на ${fmt(Date.parse(m.at))})` : 'Деньги в кабинете: нет данных',
        `Цифры по дням (дата: бюджет / просмотры / контакты / диагностики / продажи):\n${daily.map((r) => `  ${r.date}: ${r.budget} / ${r.views} / ${r.contacts} / ${r.diagnostics} / ${r.sales}`).join('\n') || '  нет данных'}`,
        `Задачи (клиент | задача | исполнитель | статус | срок | с какого числа):\n${ct.slice(0, 40).map((t) => taskLine(t, false)).join('\n') || '—'}`,
        w.length ? `Клиент ждёт ответа в чате: ${w.map((x) => `с ${fmt(x.since)} — «${String(x.text).slice(0, 200)}»`).join('; ')}` : 'Ответа в чате не ждёт.',
        refl.length ? `Рефлексия команды:\n${refl.join('\n')}` : '',
        meets.length ? `Итоги последних встреч:\n${meets.join('\n\n')}` : '',
      ].filter(Boolean).join('\n'));

    }
    // Chats about the named clients, 21 days.
    const sources = (await aiChatSources(kv, byId)).filter((s) => named.some((p) => p.id === s.projectId));
    const bits = [];
    for (const s of sources) {
      const logs = await botReadLogs(kv, s.chatId, s.threadId, now - (light ? 10 : 21) * 24 * 3600000, now);
      if (logs.length) bits.push(`### ${s.name}\n${botFormatLogLines(logs)}`);
    }
    chatBlock = bits.length ? `ПЕРЕПИСКА по клиентам из вопроса, 21 день ([id] дата автор: текст):\n${bits.join('\n\n')}` : '';
  } else {
    const lt = tasks.filter(live).sort((x, y) => (byId[x.projectId] ? byId[x.projectId].name : 'я').localeCompare(byId[y.projectId] ? byId[y.projectId].name : 'я', 'ru'));
    let lines = lt.map((t) => taskLine(t));
    while (lines.join('\n').length > 7000 && lines.length) lines = lines.slice(0, -1);
    parts.push(`ВСЕ ОТКРЫТЫЕ ЗАДАЧИ (клиент | задача | исполнитель | статус | срок | с какого числа):\n${lines.join('\n') || '—'}${lines.length < lt.length ? `\n(ещё ${lt.length - lines.length} не поместились)` : ''}`);
    if (pending.length) parts.push(`КЛИЕНТЫ ЖДУТ ОТВЕТА В ЧАТЕ:\n${pending.map((x) => `- ${(x.projectId && byId[x.projectId] && byId[x.projectId].name) || x.title}: «${String(x.text).slice(0, 160)}» — с ${fmt(x.since)}`).join('\n')}`);
    const bits = [];
    for (const s of await aiChatSources(kv, byId)) {
      const logs = await botReadLogs(kv, s.chatId, s.threadId, now - 2 * 24 * 3600000, now);
      if (logs.length) bits.push(`### ${s.name}\n${botFormatLogLines(logs)}`);
    }
    chatBlock = bits.length ? `ПЕРЕПИСКА во всех чатах за 2 дня ([id] дата автор: текст):\n${bits.join('\n\n')}` : '';
  }
  if ((AI_AVITO_RE.test(job.text) || AI_DIALOG_RE.test(job.text)) && !named.length) parts.push('АВИТО: клиент в вопросе не распознан — данные кабинета не загружались. Если нужен кабинет, попроси назвать клиента.');

  let text = parts.join('\n\n');
  // A question about the chat itself («в чате всё норм?», «как общение?») gets the chat a big share,
  // not whatever is left after the numbers and tasks.
  const aboutChat = /чат|переписк|общени|ощущени|настроени|доволь|недоволь|диалог/i.test(job.text);
  const budget = aboutChat && chatBlock ? AI_DATA_BUDGET - 7000 : AI_DATA_BUDGET;
  if (text.length > budget) text = `${text.slice(0, budget)}\n…(обрезано)`;
  const room = AI_DATA_BUDGET + 3000 - text.length;
  if (chatBlock && room > 500) text += `\n\n${chatBlock.length > room ? `…${chatBlock.slice(-room)}` : chatBlock}`;
  return text;
}

// The Avito cabinet of the clients in question (Avito API calls, few KV reads) — when it is asked about.
async function aiBuildAvito(env, job) {
  const ask = aiAvitoText(job);
  const wantsStats = AI_AVITO_RE.test(ask);
  const wantsChats = AI_DIALOG_RE.test(ask);
  if ((!wantsStats && !wantsChats) || !(job.assistant && job.assistant.named && job.assistant.named.length)) return { text: '', prepFiles: [] };
  const kv = env.AGENCY_DASHBOARD_KV;
  const wantsFile = AI_EXPORT_RE.test(job.text);
  const period = aiPeriod(ask);
  const parts = [];
  const prepFiles = [];
  for (const pid of job.assistant.named) {
    const p = await kv.get(`project:${pid}`, 'json');
    if (!p) continue;
    if (!p.avitoAccountId) { parts.push(`АВИТО: у клиента ${p.name} кабинет Авито не подключён.`); continue; }
    try {
      const account = await env.AVITO_KV.get(`account:${p.avitoAccountId}`, 'json');
      if (!account) throw new Error('кабинет не найден');
      if (wantsChats) parts.push(await aiAvitoChats(env, account, p, period));
      if (!wantsStats) continue;
      const ov = await runAvitoOverview(env, account, period.from, period.to);
      const items = [...(ov.items || [])].sort((x, y) => (y.contacts || 0) - (x.contacts || 0));
      const tot = items.reduce((acc, it) => ({ views: acc.views + (it.views || 0), contacts: acc.contacts + (it.contacts || 0), favorites: acc.favorites + (it.favorites || 0) }), { views: 0, contacts: 0, favorites: 0 });
      const rating = ov.rating && (ov.rating.rating || ov.rating);
      parts.push([
        `АВИТО: ${p.name}, ${period.from} — ${period.to}`,
        `Объявлений: ${items.length} (активных ${items.filter((it) => /active|активн/i.test(String(it.status))).length}); за период: просмотры ${tot.views}, контакты ${tot.contacts}, в избранное ${tot.favorites}`,
        rating && typeof rating === 'object' ? `Рейтинг: ${rating.score != null ? rating.score : '—'}${rating.reviewsCount != null ? `, отзывов ${rating.reviewsCount}` : ''}` : '',
        `Объявления по контактам (название | статус | цена | просмотры | контакты | избранное | адрес):\n${items.slice(0, 35).map((it) => `- ${String(it.title).slice(0, 80)} | ${it.status} | ${it.price} | ${it.views} | ${it.contacts} | ${it.favorites} | ${String(it.address || '').slice(0, 40)}`).join('\n')}${items.length > 35 ? `\n(ещё ${items.length - 35} объявлений — в файле выгрузки)` : ''}`,
        ov.errors && ov.errors.length ? `Ошибки Авито: ${ov.errors.slice(0, 3).join('; ')}` : '',
      ].filter(Boolean).join('\n'));
      if (wantsFile && items.length) {
        const rows = [['ID', 'Название', 'Статус', 'Цена', 'Категория', 'Адрес', 'Просмотры', 'Контакты', 'В избранное', 'Ссылка'],
          ...items.map((it) => [it.item_id, it.title, it.status, it.price, it.category, it.address, it.views, it.contacts, it.favorites, it.url])];
        const csv = `\ufeff${rows.map((r) => r.map((v) => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n')}`;
        prepFiles.push({ name: `Авито ${p.name} ${period.from}—${period.to}.csv`, type: 'text/csv', bytes: new TextEncoder().encode(csv) });
      }
    } catch (e) {
      parts.push(`АВИТО: ${p.name} — не получилось загрузить данные кабинета (${String(e && e.message).slice(0, 160)})`);
    }
  }
  return { text: parts.join('\n\n'), prepFiles };
}

// Avito dialogs of a client for the period. Roles: «кабинет» is our client (the tutor's cabinet, run by
// the agency), «покупатель» — a parent or student writing to it. The mailing (Avito «предложение» —
// a free consultation offer) leaves system messages in a chat: «Пользователь ознакомился с вашим
// предложением…» when someone opened it, «Покупателя заинтересовало ваше предложение» when they
// clicked interested. The mailing figures are counted here, per day — the model can't count reliably.
const AI_OFFER_OPENED_RE = /ознакомился\s+с\s+вашим\s+предложением/i; // Avito puts non-breaking spaces there
const AI_OFFER_INTEREST_RE = /заинтересовало\s+ваше\s+предложение/i;
const AI_DECLINE_RE = /не актуальн|уже нет|не нужно|нашли|неактуальн|не интересн|передумал/i;
const AI_BOOKED_RE = /договорились|до встречи|ссылк[ау] на встречу|приглашение на встречу/i;
async function aiAvitoChats(env, account, p, period) {
  try {
    const from = Date.parse(`${period.from}T00:00:00+03:00`);
    const list = [];
    for (let offset = 0; offset < 200; offset += 100) {
      const { chats, hasMore } = await runAvitoChatList(env, account, 100, offset);
      list.push(...chats);
      if (!hasMore || chats.some((c) => c.updated && Date.parse(c.updated) < from)) break;
    }
    const recent = list.filter((c) => c.updated && Date.parse(c.updated) >= from).slice(0, 40);
    const withMsgs = [];
    for (let i = 0; i < recent.length; i += 5) {
      const batch = await Promise.all(recent.slice(i, i + 5).map(async (c) => {
        try {
          const r = await runAvitoChatMessages(env, account, c.chat_id);
          return { c, msgs: (Array.isArray(r) ? r : r.messages || []).filter((m) => m && m.datetime).sort((x, y) => Date.parse(x.datetime) - Date.parse(y.datetime)) };
        } catch (e) {
          return { c, msgs: [] };
        }
      }));
      withMsgs.push(...batch);
    }
    const day = (iso) => botMsk(Date.parse(iso)).date;
    const hm = (iso) => botFmtDate(Date.parse(iso));
    const human = (m) => m.author !== 'manager' && m.type !== 'system' && !/Системное\s+сообщение/i.test(String(m.text || '')) && String(m.text || '').trim() && String(m.text) !== '{}';
    // Mailing: per day of the «opened the offer» message — how many opened, replied, declined, got interested, booked.
    const offer = {};
    for (const { c, msgs } of withMsgs) {
      const opened = msgs.find((m) => AI_OFFER_OPENED_RE.test(String(m.text || '')) && Date.parse(m.datetime) >= from);
      if (!opened) continue;
      const after = msgs.filter((m) => Date.parse(m.datetime) >= Date.parse(opened.datetime));
      const replies = after.filter(human);
      const d = day(opened.datetime);
      const o = offer[d] || (offer[d] = { opened: 0, replied: 0, declined: 0, interested: 0, booked: 0, notes: [] });
      o.opened += 1;
      const interested = after.some((m) => AI_OFFER_INTEREST_RE.test(String(m.text || '')));
      const declined = replies.some((m) => AI_DECLINE_RE.test(String(m.text || '')));
      const booked = after.some((m) => m.author === 'manager' && AI_BOOKED_RE.test(String(m.text || '')));
      if (replies.length) o.replied += 1;
      if (declined) o.declined += 1;
      if (interested) o.interested += 1;
      if (booked) o.booked += 1;
      if (replies.length) o.notes.push(`«${String(c.item_title || '').slice(0, 50)}»: ${replies.slice(0, 3).map((m) => `${hm(m.datetime)} «${String(m.text).replace(/\s+/g, ' ').slice(0, 90)}»`).join('; ')}${booked ? ' → договорились о пробном' : ''}`);
    }
    const offerLines = Object.keys(offer).sort().map((d) => {
      const o = offer[d];
      return `- ${d.slice(8, 10)}.${d.slice(5, 7)}: открыли предложение ${o.opened}, ответили ${o.replied} (отказались ${o.declined}, заинтересовались ${o.interested}), договорились о пробном ${o.booked}${o.notes.length ? `\n${o.notes.map((n) => `    ${n}`).join('\n')}` : ''}`;
    });
    const lines = [];
    let used = 0;
    for (const { c, msgs } of withMsgs) {
      const body = msgs.filter((m) => Date.parse(m.datetime) >= from).slice(-10)
        .map((m) => `  ${hm(m.datetime)} ${m.author === 'manager' ? 'кабинет' : 'покупатель'}: ${String(m.text || `[${m.type}]`).replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
      const block = `- «${String(c.item_title || 'без объявления').slice(0, 70)}»\n${body || `  последнее: ${String(c.last_message_text || '').slice(0, 200)}`}`;
      if (used + block.length > 6000) break;
      lines.push(block);
      used += block.length;
    }
    return [
      `АВИТО, ДИАЛОГИ кабинета ${p.name} (кабинет — это ${p.name}, покупатель — родитель или ученик, который пишет в кабинет) с ${period.from} по сегодня: чатов с активностью ${recent.length}${recent.length >= 40 ? '+' : ''}`,
      `РАССЫЛКА (предложение «бесплатная консультация»; посчитано по чатам — видны только те, кто открыл предложение, сколько всего отправлено, в API не видно):\n${offerLines.join('\n') || '- за период никто не открывал предложение'}`,
      `ПЕРЕПИСКА по чатам:\n${lines.join('\n') || '  за период переписки нет'}`,
      withMsgs.length > lines.length ? `(ещё ${withMsgs.length - lines.length} чатов не показаны)` : '',
    ].filter(Boolean).join('\n');
  } catch (e) {
    return `АВИТО, ДИАЛОГИ: ${p.name} — Авито не отдал переписку (${String(e && e.message).slice(0, 160)})`;
  }
}

// The person who asked gets the answer in the tracker's bell and in Telegram (it takes minutes —
// nobody waits on the page). The owner looks into others' dialogs himself; no messages for that.
async function aiNotify(env, job) {
  const team = await atGetTeam(env);
  const requester = team.users.find((u) => u.id === job.byId);
  if (!requester) return;
  const dialogId = job.assistant && job.assistant.dialogId;
  const page = `${AT_PAGE_URL}#ai=${encodeURIComponent(dialogId || '')}`;
  const q = String(job.text || '').replace(/\s+/g, ' ').slice(0, 80);
  if (job.status === 'done') {
    const answer = job.result.answer;
    const tgText = escapeHtml(answer.length > 3300 ? `${answer.slice(0, 3300)}…` : answer).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    await atNotify(env, team, [requester.id], { kind: 'ai', ref: `ai:${dialogId}`, text: `ИИ-помощник ответил: ${answer.replace(/\s+/g, ' ').slice(0, 160)}`, by: 'ИИ' }, {
      text: [`🤖 <b>ИИ-помощник</b> · <i>«${escapeHtml(q)}${(job.text || '').length > 80 ? '…' : ''}»</i>`, '', tgText, job.files.length ? `\n📎 Файлы — в трекере: ${job.files.map((f) => escapeHtml(f.name)).join(', ')}` : ''].join('\n'),
      extra: { reply_markup: { inline_keyboard: [[{ text: 'Открыть диалог', url: page }]] } },
    });
  } else {
    const reason = job.status === 'stuck' ? 'ИИ не ответил' : job.error || 'неизвестная ошибка';
    await atNotify(env, team, [requester.id], { kind: 'aifail', ref: `ai:${dialogId}`, text: `ИИ-помощник не смог ответить: ${reason}`, by: 'ИИ' });
  }
}

// ── tracker API: ai-* ──
function aiPublicDialog(d, me) {
  return {
    id: d.id, userId: d.userId, userName: d.userName, title: d.title, main: Boolean(d.main), own: d.userId === me.id && !d.deletedAt, deletedAt: d.deletedAt || null,
    messages: d.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, at: m.at, error: m.error || undefined, files: m.files || undefined, jobId: m.role === 'assistant' ? m.jobId : undefined })),
    pending: d.pending || null,
    memory: me.role === 'owner' ? d.memory || '' : undefined,
  };
}
async function aiLoadDialog(kv, id, me, team) {
  let d = await kv.get(`ai:dlg:${id}`, 'json');
  if (!d && id === aiMainId(me.id)) d = { id, userId: me.id, userName: me.name, title: 'Основной', main: true, autoTitle: false, memory: '', messages: [], createdAt: new Date().toISOString() };
  if (!d) return null;
  if (d.userId !== me.id && me.role !== 'owner') return null;
  const u = team.users.find((x) => x.id === d.userId);
  if (u) d.userName = u.name;
  return d;
}
async function aiSaveDialog(kv, d) {
  d.updatedAt = new Date().toISOString();
  if (d.messages.length > AI_KEEP_MESSAGES) d.messages = d.messages.slice(-AI_KEEP_MESSAGES);
  delete d.pending;
  await kv.put(`ai:dlg:${d.id}`, JSON.stringify(d));
  const key = `ai:dlgs:${d.userId}`;
  const list = ((await kv.get(key, 'json')) || []).filter((x) => x.id !== d.id);
  const last = [...d.messages].reverse().find((m) => !m.error);
  list.unshift({ id: d.id, title: d.title, main: Boolean(d.main), createdAt: d.createdAt, updatedAt: d.updatedAt, deletedAt: d.deletedAt || undefined, last: last ? `${last.role === 'assistant' ? 'ИИ: ' : ''}${last.text.replace(/\s+/g, ' ').slice(0, 90)}` : '' });
  // Deleted dialogs stay for the owner (he reads everyone's) — up to 60 of them.
  const kept = [...list.filter((x) => !x.deletedAt).slice(0, AI_MAX_DIALOGS + 1), ...list.filter((x) => x.deletedAt).slice(0, 60)];
  await kv.put(key, JSON.stringify(kept));
}
// Brings finished answers into the dialog (and marks a request nobody answered).
async function aiFold(kv, d) {
  let changed = false;
  d.pending = null;
  const now = Date.now();
  for (let i = 0; i < d.messages.length; i += 1) {
    const m = d.messages[i];
    if (m.role !== 'user' || !m.jobId || m.done) continue;
    const job = await kv.get(`kb:job:${m.jobId}`, 'json');
    let reply = null;
    if (!job) {
      if (now - Date.parse(m.at) > 10 * 60000) reply = { error: true, text: 'Запрос потерялся — отправьте его ещё раз.' };
      else d.pending = { jobId: m.jobId, status: 'sent', progress: null };
    } else if (job.status === 'done' && job.result) {
      reply = { text: job.result.answer, files: job.files.length ? job.files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, parts: f.parts })) : undefined, at: job.finishedAt };
      if (job.result.memory) d.memory = job.result.memory;
      if (job.result.title && d.autoTitle) { d.title = job.result.title; d.autoTitle = false; }
    } else if (['failed', 'stuck', 'not_configured'].includes(job.status)) {
      reply = { error: true, text: job.status === 'not_configured' ? 'ИИ не подключён: нет привязки Workers AI в настройках воркера.' : `Не получилось ответить: ${job.error || 'ИИ не ответил'}. Отправьте сообщение ещё раз.` };
    } else if (now - Date.parse(job.sentAt || job.createdAt) > AI_STUCK_MS) {
      job.status = 'stuck';
      job.error = 'ИИ не ответил за 45 минут';
      job.finishedAt = new Date().toISOString();
      await kbPutJob(kv, job);
      reply = { error: true, text: 'ИИ не ответил за 45 минут — отправьте сообщение ещё раз.' };
    } else {
      d.pending = { jobId: job.id, status: job.status, progress: job.progress || null, sessionUrl: job.sessionUrl || null };
    }
    if (reply) {
      m.done = true;
      d.messages.splice(i + 1, 0, { id: atRandom(8), role: 'assistant', text: reply.text, at: reply.at || new Date().toISOString(), jobId: m.jobId, error: reply.error || undefined, files: reply.files });
      i += 1;
      changed = true;
    }
  }
  return changed;
}

async function atAiApi(env, team, me, action, body, ctx) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const nowIso = new Date().toISOString();

  if (action === 'ai-list') {
    const mine = ((await kv.get(`ai:dlgs:${me.id}`, 'json')) || []).filter((x) => !x.deletedAt);
    if (!mine.some((x) => x.id === aiMainId(me.id))) mine.push({ id: aiMainId(me.id), title: 'Основной', main: true, createdAt: nowIso, updatedAt: null, last: '' });
    const res = { mine: [...mine.filter((x) => x.main), ...mine.filter((x) => !x.main)] };
    if (me.role === 'owner') {
      const others = team.users.filter((u) => u.id !== me.id);
      const lists = await Promise.all(others.map((u) => kv.get(`ai:dlgs:${u.id}`, 'json')));
      res.others = others.map((u, i) => ({ user: atPublicUser(u), dialogs: lists[i] || [] })).filter((x) => x.dialogs.length);
    }
    return json(res);
  }

  if (action === 'ai-new') {
    const list = (await kv.get(`ai:dlgs:${me.id}`, 'json')) || [];
    if (list.filter((x) => !x.main && !x.deletedAt).length >= AI_MAX_DIALOGS) return json({ error: 'too_many', message: 'Слишком много диалогов — удалите старые.' }, 400);
    const title = atClean(body.title, 60);
    const d = { id: atRandom(10), userId: me.id, userName: me.name, title: title || 'Новый диалог', main: false, autoTitle: !title, memory: '', messages: [], createdAt: nowIso };
    await aiSaveDialog(kv, d);
    return json({ dialog: aiPublicDialog(d, me) });
  }

  const id = String(body.id || '');
  if (!aiIdOk(id)) return json({ error: 'not_found' }, 404);
  const d = await aiLoadDialog(kv, id, me, team);
  if (!d || (d.deletedAt && me.role !== 'owner' && action !== 'ai-restore')) return json({ error: 'not_found' }, 404);

  if (action === 'ai-dialog') {
    if (await aiFold(kv, d)) await aiSaveDialog(kv, d);
    if (d.pending && d.pending.jobId) await waiKick(env, ctx, 'kb', d.pending.jobId);
    return json({ dialog: aiPublicDialog(d, me) });
  }

  if (action === 'ai-file') {
    const m = d.messages.find((x) => x.role === 'assistant' && x.jobId === String(body.jobId || ''));
    const f = m && (m.files || []).find((x) => x.id === String(body.fileId || ''));
    const part = Math.floor(Number(body.part) || 0);
    if (!f || part < 0 || part >= f.parts) return json({ error: 'not_found' }, 404);
    const buf = await kv.get(`kb:file:${m.jobId}:${f.id}:${part}`, 'arrayBuffer');
    if (!buf) return json({ error: 'expired', message: 'Файл уже удалён — файлы хранятся 2 недели.' }, 410);
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return json({ name: f.name, type: f.type, part, parts: f.parts, data: btoa(bin) });
  }

  if (d.userId !== me.id) return json({ error: 'forbidden', message: 'Это диалог другого сотрудника — только просмотр.' }, 403);

  if (action === 'ai-send') {
    const text = String(body.text == null ? '' : body.text).replace(/\r/g, '').trim().slice(0, AI_MAX_TEXT);
    if (!text) return json({ error: 'empty' }, 400);
    await aiFold(kv, d);
    if (d.pending) return json({ error: 'busy', message: 'ИИ ещё отвечает на прошлое сообщение — дождитесь ответа или откройте другой диалог.', dialog: aiPublicDialog(d, me) }, 409);
    const recent = d.messages.filter((m) => !m.error).slice(-AI_CONTEXT_MESSAGES).map((m) => ({ role: m.role === 'user' ? me.name : 'ИИ-помощник', text: m.text.length > 1500 ? `${m.text.slice(0, 1500)}…` : m.text }));
    const job = {
      id: atRandom(12),
      token: atRandom(32),
      status: 'draft',
      mode: 'assistant',
      text,
      files: [],
      assistant: { dialogId: d.id, title: d.title, memory: d.memory || '', recent, role: me.roleLabel || AT_ROLES[me.role] || me.role },
      byId: me.id,
      byName: me.name,
      sessionUrl: null,
      progress: null,
      result: null,
      error: null,
      createdAt: nowIso,
    };
    d.messages.push({ id: atRandom(8), role: 'user', text, at: nowIso, jobId: job.id });
    if (d.autoTitle && d.messages.filter((m) => m.role === 'user').length === 1) d.title = text.replace(/\s+/g, ' ').slice(0, 40) + (text.length > 40 ? '…' : '');
    // The data is gathered here, where the tracker snapshot is warm; the Avito part is the job's first step.
    try { job.dataText = await aiBuildData(env, job, false); } catch (e) { console.error('assistant data failed', e && e.stack); }
    await kbStart(env, ctx, job);
    await aiFold(kv, d);
    await aiSaveDialog(kv, d);
    await aiFold(kv, d); // pending after save (aiSaveDialog drops it)
    return json({ dialog: aiPublicDialog(d, me) });
  }

  if (action === 'ai-rename') {
    const title = atClean(body.title, 60);
    if (!title) return json({ error: 'empty' }, 400);
    d.title = title;
    d.autoTitle = false;
    await aiSaveDialog(kv, d);
    return json({ dialog: aiPublicDialog(d, me) });
  }

  // Deleting hides a dialog from its author only — the owner still sees it (marked deleted).
  if (action === 'ai-delete' && !d.main) {
    d.deletedAt = nowIso;
    await aiSaveDialog(kv, d);
    return json({ ok: true });
  }
  if (action === 'ai-restore') {
    if (!d.deletedAt) return json({ dialog: aiPublicDialog(d, me) });
    delete d.deletedAt;
    await aiSaveDialog(kv, d);
    return json({ dialog: aiPublicDialog(d, me) });
  }
  // The main dialog is cleared instead (memory too); its old messages move to a deleted copy.
  if (action === 'ai-clear' || action === 'ai-delete') {
    if (d.messages.length) {
      await aiFold(kv, d);
      if (d.pending) return json({ error: 'busy', message: 'ИИ ещё отвечает — очистить можно после ответа.' }, 409);
      await aiSaveDialog(kv, { ...d, id: atRandom(10), main: false, autoTitle: false, title: `${d.title} до ${botFmtDate(Date.now()).split(' ')[0]}`, deletedAt: nowIso });
    }
    d.messages = [];
    d.memory = '';
    await aiSaveDialog(kv, d);
    return json({ dialog: aiPublicDialog(d, me) });
  }

  return json({ error: 'not_found' }, 404);
}

// ── Activity: when who worked (owner only) ──
// Three sources, all bucketed by MSK hour:
//   • tracker — the page marks 10-minute slots in which the person actually did something (click,
//     key, scroll, touch while the tab is visible) and sends them with a sync every ~10 minutes;
//     stored per person and day in at:act:<userId>:<date> = { slots: [0..143] } (a slot = 10 min).
//   • chats — messages the control bot logged (work chat topics and client chats), matched to a
//     person by Telegram id or name; past days are cached in at:chatact2:<date> once computed
//     (the 2 dropped the days counted before Latin-spelled names were matched).
//   • actions — task changes made in the tracker (each task's activity list).
//   • site — other cantor.agency pages the team works on (knowledge base, dashboard, academy and other
//     internal tools) load /at-visit.js; when that browser is signed in to the tracker it reports page
//     opens and 10-minute slots of activity there: at:site:<userId>:<date> = { slots, opens: [minute],
//     pages: { <path>: { t: title, n: opens } } }. Tracker opens themselves land in at:act … opens.
const AT_ACT_TTL = 60 * 60 * 24 * 120;
const AT_SITE_MAX_PAGES = 80;
const AT_ACT_CACHE = new Map(); // `${date}` -> { at, data } for today's chat counts (recomputed every 3 min)

function atMskDate(ms) { return botMsk(ms).date; }

// A tracker page load (sync with initial: true) — counted as one visit at that minute.
async function atSaveOpen(kv, user, nowMs) {
  const key = `at:act:${user.id}:${atMskDate(nowMs)}`;
  const rec = (await kv.get(key, 'json')) || { slots: [] };
  const p = botMsk(nowMs);
  rec.opens = [...(rec.opens || []), p.hh * 60 + p.mm].slice(-300);
  await kv.put(key, JSON.stringify(rec), { expirationTtl: AT_ACT_TTL });
}
// /at-visit.js on other site pages: { page: { path, title }, opened, slots: { <date>: [slot] } }.
async function atSaveSiteVisit(kv, user, body, nowMs) {
  const path = String((body.page && body.page.path) || '').slice(0, 160);
  if (!/^\/[^\s?#]*$/.test(path)) return { error: 'bad_path' };
  const title = atClean(body.page && body.page.title, 140).replace(/\s*[—|]\s*(База знаний )?Cantor Agency\s*$/i, '') || path;
  const recent = new Set([0, 1].map((d) => atMskDate(nowMs - d * 86400000)));
  const today = atMskDate(nowMs);
  const byDate = {};
  for (const [date, raw] of Object.entries((body.slots && typeof body.slots === 'object') ? body.slots : {}).slice(0, 2)) {
    if (!recent.has(date) || !Array.isArray(raw)) continue;
    byDate[date] = raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 144).slice(0, 144);
  }
  if (body.opened && !byDate[today]) byDate[today] = [];
  for (const [date, slots] of Object.entries(byDate)) {
    const key = `at:site:${user.id}:${date}`;
    const rec = (await kv.get(key, 'json')) || { slots: [], opens: [], pages: {} };
    const before = JSON.stringify(rec);
    rec.slots = [...new Set([...rec.slots, ...slots])].sort((a, b) => a - b);
    if (body.opened && date === today) {
      const p = botMsk(nowMs);
      rec.opens = [...rec.opens, p.hh * 60 + p.mm].slice(-500);
      const page = rec.pages[path] || (Object.keys(rec.pages).length < AT_SITE_MAX_PAGES ? (rec.pages[path] = { t: title, n: 0 }) : null);
      if (page) { page.t = title; page.n += 1; }
    }
    if (JSON.stringify(rec) !== before) await kv.put(key, JSON.stringify(rec), { expirationTtl: AT_ACT_TTL });
  }
  return { ok: true };
}

async function atSaveActivity(kv, user, activity, nowMs) {
  if (!activity || typeof activity !== 'object') return;
  const recent = new Set([0, 1, 2].map((d) => atMskDate(nowMs - d * 86400000)));
  for (const [date, slotsRaw] of Object.entries(activity).slice(0, 3)) {
    if (!recent.has(date) || !Array.isArray(slotsRaw)) continue;
    const slots = slotsRaw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 144);
    if (!slots.length) continue;
    const key = `at:act:${user.id}:${date}`;
    const rec = (await kv.get(key, 'json')) || { slots: [] };
    const merged = [...new Set([...rec.slots, ...slots])].sort((a, b) => a - b);
    if (merged.length !== rec.slots.length) await kv.put(key, JSON.stringify({ ...rec, slots: merged }), { expirationTtl: AT_ACT_TTL });
  }
}

// Every place the bot logs messages: work-chat topics and client chats, with a readable label.
async function atChatSources(kv) {
  const byId = await botProjectsById(kv);
  const out = [];
  for (const c of await listByPrefix(kv, 'bot:chat:')) {
    if (c.isForum) {
      const keys = (await kv.list({ prefix: `bot:topic:${c.id}:` })).keys;
      const threads = new Set(['0']);
      for (const k of keys) threads.add(k.name.split(':').pop());
      const recs = await Promise.all(keys.map((k) => kv.get(k.name, 'json')));
      const names = {};
      keys.forEach((k, i) => { const r = recs[i]; names[k.name.split(':').pop()] = r ? ((r.projectId && byId[r.projectId] && byId[r.projectId].name) || r.name) : null; });
      for (const t of threads) out.push({ chatId: c.id, threadId: t, label: names[t] || (t === '0' ? 'Общий' : `Топик ${t}`) });
    } else {
      out.push({ chatId: c.id, threadId: '0', label: `чат: ${(c.projectId && byId[c.projectId] && byId[c.projectId].name) || c.title}` });
    }
  }
  return out;
}
// Same places as atChatSources, plus which client each belongs to — for GET /api/dashboard/chat-log.
async function chatLogSources(kv) {
  const byId = await botProjectsById(kv);
  const name = (id) => (id && byId[id] && byId[id].name) || null;
  const out = [];
  for (const c of await listByPrefix(kv, 'bot:chat:')) {
    if (c.isForum) {
      const keys = (await kv.list({ prefix: `bot:topic:${c.id}:` })).keys;
      const recs = await Promise.all(keys.map((k) => kv.get(k.name, 'json')));
      const topics = { 0: null };
      keys.forEach((k, i) => { topics[k.name.split(':').pop()] = recs[i] || {}; });
      for (const [t, r] of Object.entries(topics)) {
        out.push({ chatId: c.id, threadId: t, kind: c.kind, projectId: (r && r.projectId) || null,
          label: `${c.kind === 'work' ? 'рабочий чат' : c.title}: ${(r && (name(r.projectId) || r.name)) || (t === '0' ? 'Общий' : `Топик ${t}`)}` });
      }
    } else {
      out.push({ chatId: c.id, threadId: '0', kind: c.kind, projectId: c.projectId || null, label: `чат: ${name(c.projectId) || c.title}` });
    }
  }
  return out;
}
// { users: { <userId | 'tg:…'>: { c: [24], f, l, w: { label: n } } }, names: { 'tg:…': name } }
async function atChatActivityForDate(env, users, date, sources, isToday) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!isToday) {
    const cached = await kv.get(`at:chatact2:${date}`, 'json');
    if (cached) return cached;
  } else {
    const hit = AT_ACT_CACHE.get(date);
    if (hit && Date.now() - hit.at < 3 * 60000) return hit.data;
  }
  const data = { users: {}, names: {} };
  const lists = await Promise.all(sources.map((s) => kv.get(`bot:log:${s.chatId}:${s.threadId}:${date}`, 'json')));
  lists.forEach((list, i) => {
    for (const e of list || []) {
      if (e.team === false || !e.t) continue;
      const who = users.find((u) => u.tgId && e.fromId && String(u.tgId) === String(e.fromId)) || atMatchUser(e.from, users);
      const key = who ? who.id : `tg:${e.fromId || e.from}`;
      if (!who) data.names[key] = e.from || '?';
      const rec = data.users[key] || (data.users[key] = { c: new Array(24).fill(0), f: null, l: null, w: {} });
      const p = botMsk(e.t);
      const min = p.hh * 60 + p.mm;
      rec.c[p.hh] += 1;
      rec.f = rec.f == null ? min : Math.min(rec.f, min);
      rec.l = rec.l == null ? min : Math.max(rec.l, min);
      rec.w[sources[i].label] = (rec.w[sources[i].label] || 0) + 1;
    }
  });
  if (isToday) AT_ACT_CACHE.set(date, { at: Date.now(), data });
  else await kv.put(`at:chatact2:${date}`, JSON.stringify(data), { expirationTtl: AT_ACT_TTL });
  return data;
}
// Per date and person: p = tracker minutes per hour, c = chat messages per hour, a = task changes
// per hour, f / l = first / last activity (minutes after MSK midnight), w = where they wrote.
async function atBuildActivity(env, team, days, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const users = team.users;
  const dates = [];
  for (let i = 0; i < days; i += 1) dates.push(atMskDate(nowMs - i * 86400000));
  const today = dates[0];
  const sources = await atChatSources(kv);
  const mem = await atSnapshot(env);
  // p / s = minutes in the tracker / on other site pages, po / so = opens of the tracker / site pages,
  // c = chat messages, a = task changes (all per MSK hour); sp = site pages opened that day.
  const blank = () => ({ p: new Array(24).fill(0), po: new Array(24).fill(0), s: new Array(24).fill(0), so: new Array(24).fill(0), c: new Array(24).fill(0), a: new Array(24).fill(0), f: null, l: null, w: {}, sp: [] });
  const span = (rec, min) => { rec.f = rec.f == null ? min : Math.min(rec.f, min); rec.l = rec.l == null ? min : Math.max(rec.l, min); };
  const data = {};
  const others = {};
  for (const date of dates) {
    const day = (data[date] = {});
    const get = (k) => day[k] || (day[k] = blank());
    // tracker
    const [acts, sites] = await Promise.all([
      Promise.all(users.map((u) => kv.get(`at:act:${u.id}:${date}`, 'json'))),
      Promise.all(users.map((u) => kv.get(`at:site:${u.id}:${date}`, 'json'))),
    ]);
    users.forEach((u, i) => {
      for (const [rec0, mins, opens] of [[acts[i], 'p', 'po'], [sites[i], 's', 'so']]) {
        if (!rec0) continue;
        for (const slot of rec0.slots || []) {
          const rec = get(u.id);
          rec[mins][Math.floor(slot / 6)] += 10;
          span(rec, slot * 10);
          span(rec, slot * 10 + 9);
        }
        for (const min of rec0.opens || []) {
          const rec = get(u.id);
          rec[opens][Math.floor(min / 60)] += 1;
          span(rec, min);
        }
      }
      if (sites[i] && sites[i].pages) {
        get(u.id).sp = Object.entries(sites[i].pages).map(([path, pg]) => ({ path, t: pg.t, n: pg.n })).sort((a, b) => b.n - a.n).slice(0, 30);
      }
    });
    // chats
    const chat = await atChatActivityForDate(env, users, date, sources, date === today);
    for (const [k, r] of Object.entries(chat.users)) {
      const rec = get(k);
      rec.c = r.c;
      rec.w = r.w;
      if (r.f != null) { span(rec, r.f); span(rec, r.l); }
      if (chat.names[k]) others[k] = chat.names[k];
    }
  }
  // actions in the tracker
  const byName = new Map(users.map((u) => [u.name, u]));
  for (const t of mem.tasks.values()) {
    for (const a of Array.isArray(t.activity) ? t.activity : []) {
      if (!a || !a.t || a.by === 'Бот' || a.by === 'Claude' || a.by === 'ИИ') continue;
      const date = atMskDate(a.t);
      if (!data[date]) continue;
      const u = byName.get(a.by) || atMatchUser(a.by, users);
      if (!u) continue;
      const rec = data[date][u.id] || (data[date][u.id] = blank());
      const p = botMsk(a.t);
      rec.a[p.hh] += 1;
      span(rec, p.hh * 60 + p.mm);
    }
  }
  return { dates, users: users.map(atPublicUser), others, data };
}
function atFmtMinutes(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function atFmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`;
}
// /activity in the owner's chat: today, one line per person.
async function atActivityText(env) {
  const team = await atGetTeam(env);
  const res = await atBuildActivity(env, team, 1, Date.now());
  const day = res.data[res.dates[0]];
  const lines = [`🕘 <b>Активность сегодня</b> (${res.dates[0].slice(8, 10)}.${res.dates[0].slice(5, 7)})`];
  const sum = (arr) => arr.reduce((s, n) => s + n, 0);
  for (const u of team.users.filter((x) => x.active)) {
    const r = day[u.id];
    if (!r || r.f == null) { lines.push(`⚪ ${escapeHtml(u.name)} — активности нет`); continue; }
    const parts = [`${atFmtMinutes(r.f)}–${atFmtMinutes(r.l)}`];
    if (sum(r.p) || sum(r.po)) parts.push(`трекер ${atFmtDuration(sum(r.p))}${sum(r.po) ? `, заходов ${sum(r.po)}` : ''}`);
    if (sum(r.s) || sum(r.so)) parts.push(`сайт ${atFmtDuration(sum(r.s))}${sum(r.so) ? `, заходов ${sum(r.so)}` : ''}`);
    if (sum(r.c)) parts.push(`чаты ${sum(r.c)} сообщ.`);
    if (sum(r.a)) parts.push(`задачи ${sum(r.a)} действ.`);
    lines.push(`🟢 ${escapeHtml(u.name)}: ${parts.join(' · ')}`);
  }
  for (const [k, name] of Object.entries(res.others)) {
    const r = day[k];
    if (r && sum(r.c)) lines.push(`• ${escapeHtml(name)} (не в трекере): ${atFmtMinutes(r.f)}–${atFmtMinutes(r.l)} · чаты ${sum(r.c)} сообщ.`);
  }
  lines.push('', `По часам и за прошлые дни — вкладка «Активность»: ${AT_PAGE_URL}`);
  return lines.join('\n');
}

async function atBotUsername(env) {
  if (AT_BOT_USERNAME) return AT_BOT_USERNAME;
  const kv = env.AGENCY_DASHBOARD_KV;
  let name = await kv.get('bot:me');
  if (!name && env.CONTROL_BOT_TOKEN) {
    const res = await botApi(env, 'getMe', {});
    name = res && res.ok && res.result && res.result.username;
    if (name) await kv.put('bot:me', name);
  }
  AT_BOT_USERNAME = name || null;
  return AT_BOT_USERNAME;
}

// A page visit nudges the AI queue (in the background) so fresh chat messages turn into tasks
// without waiting for the cron. Only in the middle of the cron's 10-minute cycle, so a visit-run
// and a cron-run never work on the same topic at once, and at most every 4 minutes.
function atKickQueue(env, ctx) {
  if (!env.CONTROL_BOT_TOKEN || !ctx || !ctx.waitUntil) return;
  const nowMs = Date.now();
  const minute = new Date(nowMs).getUTCMinutes() % 10;
  if (minute < 3 || minute > 6 || nowMs - AT_QUEUE_KICKED_AT < 4 * 60000) return;
  AT_QUEUE_KICKED_AT = nowMs;
  ctx.waitUntil((async () => {
    const kv = env.AGENCY_DASHBOARD_KV;
    const last = Number(await kv.get('bot:qrun')) || 0;
    if (nowMs - last < 4 * 60000) return;
    if (!(await kv.list({ prefix: 'bot:dirty:', limit: 1 })).keys.length) return;
    await kv.put('bot:qrun', String(nowMs), { expirationTtl: 3600 });
    await botProcessQueue(env);
  })().catch((err) => console.error('avito-tasks queue kick failed', err && err.stack)));
}

// ── Telegram side (called from the control bot) ──
// /start at_<userId>_<code> from the «Подключить Telegram» button: ties the chat to the person.
async function atLinkTelegram(env, msg, param) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const m = String(param || '').match(/^at_([a-z0-9]+)_([a-f0-9]{16})$/);
  if (!m) return false;
  const team = await atGetTeam(env);
  const user = team.users.find((u) => u.id === m[1]);
  if (!user || !user.active || m[2] !== (await atTgStartParam(team, user)).split('_').pop()) {
    await botSend(env, msg.chat.id, 'Ссылка устарела. Откройте Avito Tasks и нажмите «Подключить Telegram» ещё раз.');
    return true;
  }
  // One Telegram account per person: drop it from anyone else it was tied to.
  for (const u of team.users) if (u !== user && String(u.tgId) === String(msg.from.id) && u.role !== 'owner') u.tgId = null;
  user.tgId = String(msg.from.id);
  user.tgUsername = msg.from.username || null;
  await atPutTeam(kv, team);
  await atTouch(kv, ['#team']);
  if (user.role !== 'owner') {
    await botApi(env, 'setMyCommands', { commands: AT_EMPLOYEE_COMMANDS, scope: { type: 'chat', chat_id: Number(user.tgId) } });
  }
  await botSend(env, msg.chat.id, [
    `✅ <b>${escapeHtml(atFirstName(user.name))}, Telegram подключён.</b>`,
    'Сюда будут приходить новые задачи для вас, напоминания о сроках (за час и когда срок вышел), отметки «готово» по вашим задачам и сводка в 10:00.',
    '',
    '/tasks — ваши задачи',
  ].join('\n'), { reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: AT_PAGE_URL }]] } });
  if (user.role !== 'owner') await botNotifyOwner(env, `🔔 ${escapeHtml(user.name)} подключил(а) Telegram к Avito Tasks.`, { disable_notification: true });
  return true;
}
const AT_EMPLOYEE_COMMANDS = [
  { command: 'tasks', description: 'Мои задачи' },
  { command: 'help', description: 'Что умеет бот' },
];

// Private chat with a team member the bot knows (not the owner — see botOnOwnerMessage).
async function atOnMemberMessage(env, msg, user) {
  const text = String(msg.text || '').trim();
  // Added before they had opened the bot: the first message (usually /start) gets their access.
  if (!user.welcomedAt && !user.activatedAt && AT_NEW_MEMBERS.some((m) => m.id === user.id) && (await atWelcomeMember(env, user))) return;
  const cmd = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;
  if (cmd === 'tasks' || cmd === 'my') return botSend(env, msg.chat.id, await atBuildMyTasks(env, user), { reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: AT_PAGE_URL }]] } });
  return botSend(env, msg.chat.id, [
    `<b>${escapeHtml(atFirstName(user.name))}, я присылаю ваши задачи из Avito Tasks.</b>`,
    'Новые задачи для вас, напоминание за час до срока и когда срок вышел, сводка в 10:00. Под задачей — кнопки «Беру в работу» и «Готово».',
    '',
    '/tasks — ваши задачи',
  ].join('\n'), { reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: AT_PAGE_URL }]] } });
}

function atUrgency(t, nowMs) {
  const due = botDueMs(t);
  let s = { urgent: 300, high: 150, normal: 0, low: -80 }[t.priority || 'normal'] || 0;
  if (due) {
    if (due < nowMs) s += 1000;
    else if (due - nowMs < 24 * 3600000) s += 500;
    else if (due - nowMs < 72 * 3600000) s += 200;
  }
  return s;
}
// about: the owner asking about this person — no «вы», no unclaimed/inform sections meant for them.
async function atBuildMyTasks(env, user, digest, about) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const nowMs = Date.now();
  const team = await atGetTeam(env);
  const byId = await botProjectsById(kv);
  const all = await botAllTasks(kv);
  // Every task on the person that isn't closed: open ones in full, grouped by client (most urgent
  // client first), and their «готово» ones still waiting for the client to be told.
  const urgentFirst = (a, b) => atUrgency(b, nowMs) - atUrgency(a, nowMs) || (botDueMs(a) || Infinity) - (botDueMs(b) || Infinity);
  const mine = all.filter((t) => t.status === 'open' && atAssigneeId(t, team.users) === user.id).sort(urgentFirst);
  const doneMine = all.filter((t) => t.status === 'done' && atAssigneeId(t, team.users) === user.id);
  const clientOf = (t) => (t.projectId && byId[t.projectId] ? byId[t.projectId].name : t.topicName) || 'Без клиента';
  const lines = [];
  const overdue = mine.filter((t) => botDueMs(t) && botDueMs(t) < nowMs).length;
  const today = mine.filter((t) => botDueMs(t) && botDueMs(t) >= nowMs && botMsk(botDueMs(t)).date === botMsk(nowMs).date).length;
  const inWork = mine.filter((t) => t.takenAt).length;
  if (digest) lines.push(`☀️ <b>Доброе утро, ${escapeHtml(atFirstName(user.name))}!</b>`);
  if (!mine.length) lines.push(about ? 'Открытых задач нет 👌' : 'Открытых задач на вас нет 👌');
  else {
    lines.push(`📋 <b>Незакрытые задачи: ${mine.length}</b>${overdue ? ` · 🔴 просрочено ${overdue}` : ''}${today ? ` · на сегодня ${today}` : ''}${inWork ? ` · ▶️ в работе ${inWork}` : ''}`);
    const groups = new Map();
    for (const t of mine) {
      const name = clientOf(t);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(t);
    }
    for (const [name, list] of groups) {
      lines.push('', `<b>${escapeHtml(name)}</b>`);
      for (const t of list) {
        const due = botDueMs(t);
        const mark = due && due < nowMs ? '🔴' : t.priority === 'urgent' ? '🔥' : t.priority === 'high' ? '🟠' : t.takenAt ? '▶️' : '•';
        lines.push(`${mark} <a href="${escapeHtml(atTaskUrl(t.id))}">${escapeHtml(t.text)}</a> · ${due ? `${due < nowMs ? 'был срок ' : 'до '}${botFmtDate(due)}` : 'без срока'}`);
      }
    }
  }
  const seesInform = user.role === 'manager' || user.role === 'owner' || user.role === 'assistant';
  const unclaimed = all.filter((t) => atIsUnclaimed(t, team.users));
  if (unclaimed.length && !about) {
    lines.push('', `🙋 <b>Ничьи задачи из чатов: ${unclaimed.length}</b> — посмотрите, нет ли среди них ваших, и возьмите в трекере:`);
    for (const t of unclaimed.slice(0, 8)) lines.push(`• <a href="${escapeHtml(atTaskUrl(t.id))}">${escapeHtml(t.text)}</a> — <i>${escapeHtml(clientOf(t))}</i>`);
    if (unclaimed.length > 8) lines.push(`…и ещё ${unclaimed.length - 8} — в трекере.`);
  }
  if (doneMine.length && (about || !seesInform)) { // the manager sees these in «сообщить клиентам» below
    lines.push('', `✅ <b>Сделано, ждёт сообщения клиенту: ${doneMine.length}</b>`);
    for (const t of doneMine) lines.push(`• ${escapeHtml(t.text)} — <i>${escapeHtml(clientOf(t))}</i>`);
  }
  if (!about && (user.role === 'manager' || user.role === 'owner' || user.role === 'assistant')) {
    const toInform = all.filter((t) => t.status === 'done' && atNeedsInform(t, team.users));
    if (toInform.length) {
      lines.push('', `📨 <b>Готово — сообщить клиентам: ${toInform.length}</b>`);
      for (const t of toInform) lines.push(`• <b>${escapeHtml((byId[t.projectId] || {}).name || '')}</b>: ${escapeHtml(t.text)}`);
    }
    if (digest) {
      const stale = await atStaleClients(env, all, byId, nowMs);
      if (stale.length) lines.push('', `⏳ <b>Давно без обновлений (3+ рабочих дня):</b> ${stale.map(escapeHtml).join(', ')}`);
    }
  }
  return lines.join('\n');
}
// Active clients the team hasn't sent an update to for 3+ working days.
async function atStaleClients(env, tasks, byId, nowMs) {
  const clients = (await env.AGENCY_DASHBOARD_KV.get('at:clients', 'json')) || {};
  const out = [];
  for (const p of Object.values(byId)) {
    if (p.inactive) continue;
    let last = Date.parse((clients[p.id] || {}).lastUpdateAt || 0) || 0;
    last = Math.max(last, Date.parse((clients[p.id] || {}).lastTeamAt || 0) || 0);
    for (const t of tasks) if (t.projectId === p.id && t.informedAt) last = Math.max(last, Date.parse(t.informedAt) || 0);
    if (!last || botWorkingMinutes(last, nowMs) >= 3 * 8 * 60) out.push(p.name);
  }
  return out;
}

// «Беру в работу» / «Готово» under a task message.
async function atOnCallback(env, cq) {
  const answer = (text) => botApi(env, 'answerCallbackQuery', { callback_query_id: cq.id, text });
  const m = String(cq.data || '').match(/^at:(take|done|close|cancel):([A-Za-z0-9_-]{1,40})$/);
  if (!m) return answer('');
  const team = await atGetTeam(env);
  const user = team.users.find((u) => u.active && u.tgId && String(u.tgId) === String(cq.from && cq.from.id));
  if (!user) return answer('Нет доступа к Avito Tasks');
  const current = await env.AGENCY_DASHBOARD_KV.get(`task:${m[2]}`, 'json');
  const claim = current && m[1] === 'take' && atIsUnclaimed(current, team.users) ? { assigneeId: user.id } : {};
  const status = { take: 'progress', done: 'done', close: 'closed', cancel: 'cancelled' }[m[1]];
  const res = await atSaveTask(env, team, user, { id: m[2], status, ...claim });
  if (res.error) return answer(res.error === 'not_found' ? 'Задача удалена' : 'Не получилось');
  await answer({ take: 'Взято в работу ▶️', done: 'Отмечено: готово ✅', close: 'Закрыто: клиенту сообщили ✅', cancel: 'Задача отменена' }[m[1]]);
  if (cq.message) {
    // A grouped «похоже, сделаны задачи» message has a button per task: only the pressed one goes.
    const rows = (cq.message.reply_markup && cq.message.reply_markup.inline_keyboard) || [];
    const taskButtons = rows.flat().filter((b) => /^at:(done|close|cancel):/.test(b.callback_data || ''));
    const markup = taskButtons.length > 1
      ? { inline_keyboard: rows.filter((row) => !row.some((b) => b.callback_data === cq.data)) }
      : atPersonalizeMarkup(atTgButtons(res.task, true).reply_markup, user);
    await botApi(env, 'editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: markup });
  }
}

// Deadline pings for the person a task is on + the 10:00 digest. Runs from botRunChecks.
async function atRunChecks(env, nowMs, tasks, byId) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const team = await atGetTeam(env);
  const { date, hh } = botMsk(nowMs);
  const workday = botIsWorkday(nowMs);
  const inHours = workday && hh >= BOT_WORK_START_H && hh < BOT_WORK_END_H;
  // Before the 10:00 digest goes out, deadlines missed overnight are only marked: the digest lists
  // them with 🔴, a message per task on top of it is noise. The owner gets missed deadlines in the
  // summary and the "только что вышел срок" message, so no per-task pings for him either.
  const digestDue = workday && hh >= 10 && hh < 12 && !(await kv.get(`bot:once:atdigest:${date}`));
  if (inHours) {
    try {
      await atReflectionCron(env, team, nowMs);
    } catch (err) {
      console.error('reflection cron failed', err && err.stack);
    }
  }
  const ownerDue = []; // [kind, task] — the owner's own deadlines go out as one message
  if (inHours) {
    for (const task of tasks.filter((t) => t.status === 'open')) {
      const due = botDueMs(task);
      if (!due) continue;
      const uid = atAssigneeId(task, team.users);
      const user = uid && team.users.find((u) => u.id === uid && u.active);
      if (!user) continue;
      task.notified = task.notified || {};
      let kind = null;
      if (due < nowMs && !task.notified.overdueUser) kind = 'overdue';
      else if (due >= nowMs && due - nowMs <= 60 * 60000 && !task.notified.soonUser) kind = 'soon';
      if (!kind) continue;
      task.notified[kind === 'overdue' ? 'overdueUser' : 'soonUser'] = new Date(nowMs).toISOString();
      await kv.put(`task:${task.id}`, JSON.stringify(task));
      if (kind === 'overdue' && digestDue) continue;
      if (user.role === 'owner') { ownerDue.push([kind, task]); continue; }
      const projectName = task.projectId && byId[task.projectId] ? byId[task.projectId].name : null;
      await atNotify(env, team, [user.id], {
        kind,
        taskId: task.id,
        text: kind === 'overdue' ? `Срок вышел: ${task.text}` : `Через час срок: ${task.text}`,
      }, {
        text: `${kind === 'overdue' ? '🔴 <b>Срок вышел</b>' : '⏳ <b>Через час срок</b>'}\n${atTgTaskBlock(task, projectName)}`,
        extra: atTgButtons(task, true),
      });
    }
  }
  if (ownerDue.length) {
    const owner = team.users.find((u) => u.role === 'owner' && u.tgId);
    const line = (t) => {
      const project = t.projectId && byId[t.projectId] ? byId[t.projectId].name : null;
      return `• <a href="${escapeHtml(atTaskUrl(t.id))}">${escapeHtml(t.text)}</a>${project ? ` — ${escapeHtml(project)}` : ''} · ${botFmtDate(botDueMs(t)).slice(6)}`;
    };
    const soon = ownerDue.filter(([k]) => k === 'soon').map(([, t]) => t);
    const late = ownerDue.filter(([k]) => k === 'overdue').map(([, t]) => t);
    const lines = ['⏰ <b>Ваши сроки</b>'];
    if (soon.length) lines.push(`Через час: ${soon.length}`, ...soon.map(line));
    if (late.length) lines.push(`${soon.length ? '\n' : ''}🔴 Срок вышел: ${late.length}`, ...late.map(line));
    if (owner) await botSend(env, owner.tgId, lines.join('\n'), { disable_notification: !late.length });
  }
  // 10:00 — each connected person's own list (the owner gets the full /summary instead).
  if (workday && hh >= 10 && hh < 12 && (await botOnce(kv, `atdigest:${date}`, 60 * 60 * 36))) {
    for (const user of team.users.filter((u) => u.active && u.tgId && u.role !== 'owner')) {
      const text = await atBuildMyTasks(env, user, true);
      await botSend(env, user.tgId, text, { reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: AT_PAGE_URL }]] } });
    }
  }
}

// ── Avito → Telegram: notifier bots ──
// A Telegram bot (token in a Worker secret, never in wrangler.jsonc) serving one or more client
// cabinets. Every new client message in a cabinet's Avito Messenger lands with the people connected
// to that cabinet as 🔴 <name linked to the Avito chat> + text, with a «Ответить» button: the reply
// typed in Telegram goes to the client through the Avito API, from the cabinet itself. Once the
// chat is answered — from the bot or straight on Avito — every notification of that chat turns 🟢.
// Delivery: each cabinet's Avito messenger webhook (subscribed by the setup below) plus a cron poll
// of the latest chats as a safety net; messages are de-duplicated by id.
// Access: by Telegram id. Someone listed in a cabinet's `allow` is connected to it on /start; anyone
// else is told to ask the owner (ANB_OWNER_ID), who gets the request with one button per cabinet.
// Subscribers from before cabinets existed (no `cabinets` field) belong to the bot's defaultCabinet;
// a cabinet's allowSubsOf also admits the subscribers of a retired bot (AVITO_RETIRED_BOTS).
// The owner may connect to every cabinet himself and gets /users (who is connected where).
//
// KV keys (binding "AGENCY_DASHBOARD_KV", "avitobot:<bot>:" prefix):
//   setup                    -> ANB_SETUP_VERSION once the Telegram webhook is set
//   setup:<cabinet>          -> ANB_SETUP_VERSION once that cabinet's Avito webhook is set
//   subs                     -> [{ id, name, username, cabinets, off, addedAt }]
//   ask:<tgUserId>           -> { name, username }  (a stranger waiting for the owner's decision)
//   chat:<avitoChatId>       -> { cab, name, item, open: [{ c, m, body }] }  (open = 🔴 notifications)
//   msg:<tgChatId>:<msgId>   -> avitoChatId  (notification / reply prompt → chat, for replies)
//   await:<tgChatId>         -> avitoChatId  (the chat whose «Ответить» was pressed last)
//   seen:<avitoMessageId>    -> "1"  (de-dup between webhook and poll)
//   poll / poll:<cabinet>    -> unix seconds of the newest message the poll has handled
//                               (the default cabinet keeps the old unsuffixed keys)

const AVITO_NOTIFY_BOTS = {
  cantor: {
    tokenEnv: 'AVITO_BOT_TOKEN_CANTOR', // @cantor_agency_avito_message_bot
    name: 'Авито · сообщения клиентов',
    defaultCabinet: null, // every cabinet has its own suffixed keys and webhook URL
    cabinets: {
      romashova: {
        accountId: 'e54ce32a0dd0', // AVITO_KV account:<id>
        name: 'Лариса Ромашова',
        owner: 'Ларисы', // «от имени …»
        allow: ['349677180'], // Telegram ids connected on /start (@LariRoma7)
        // her people from the old single-cabinet bot: its subscribers are connected here on /start
        allowSubsOf: 'romashova',
      },
      okuneva: {
        accountId: '4784fc8f45b0',
        name: 'Елена Окунева',
        owner: 'Елены',
        allow: ['5420238976'], // @OkunevaElena10
      },
      valiullova: {
        accountId: '19486c6a0713',
        name: 'Наталья Валиуллова',
        owner: 'Натальи',
        allow: ['1179375006'], // @valiullova
      },
      karientidi: {
        accountId: 'f2ca9c67750c',
        name: 'Иван Кариентиди',
        owner: 'Ивана',
        allow: ['8145598581', '5993133996'],
      },
    },
  },
};
// Bots taken out of service: once the new bot is set up, every subscriber gets one «we moved»
// message, the cabinet's Avito webhook to the old bot is dropped, and whatever is written to the
// old bot is answered with a link to the new one. Its KV (subs) stays — allowSubsOf reads it.
const AVITO_RETIRED_BOTS = {
  romashova: {
    tokenEnv: 'AVITO_BOT_TOKEN_ROMASHOVA',
    movedTo: 'cantor',
    link: 'https://t.me/cantor_agency_avito_message_bot',
    avito: [{ accountId: 'e54ce32a0dd0' }], // webhook URL of the old bot: …/avito/<secret> (no suffix)
  },
};
const ANB_SETUP_VERSION = '3';
const ANB_OWNER_ID = '1326867567';
const ANB_OWNER_LINK = '<a href="https://t.me/oleg_ezhkov">Олегу Ежкову (@oleg_ezhkov)</a>';
const ANB_TTL_DAY = 60 * 60 * 24;

function anbKey(bot, rest) {
  return `avitobot:${bot}:${rest}`;
}
// The default cabinet keeps the keys it had before cabinets existed.
function anbCabKey(bot, cfg, cab, rest) {
  return anbKey(bot, cab === cfg.defaultCabinet ? rest : `${rest}:${cab}`);
}
async function anbHash(text, len) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}
function anbSecrets(token) {
  return Promise.all([
    anbHash(`cantor-avito-bot:tg:${token}`, 48),
    anbHash(`cantor-avito-bot:avito:${token}`, 32),
  ]).then(([tg, avito]) => ({ tg, avito }));
}
function anbAvitoHookUrl(bot, cfg, cab, secret) {
  return `${BOT_WORKER_ORIGIN}/api/avitobot/${bot}/avito/${secret}${cab === cfg.defaultCabinet ? '' : `/${cab}`}`;
}

async function anbApi(token, method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(10000),
    });
    return (await res.json().catch(() => null)) || { ok: false, description: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, description: String(err && err.message) };
  }
}

async function anbAccount(env, cabinet) {
  const account = await env.AVITO_KV.get(`account:${cabinet.accountId}`, 'json');
  if (!account || !account.userId) throw new Error('avito_account_not_found');
  return account;
}

function anbChatLink(chatId) {
  return `https://www.avito.ru/profile/messenger/channel/${encodeURIComponent(chatId)}`;
}

function anbMessageText(m) {
  const content = m.content || {};
  if (m.type === 'appCall' || m.type === 'call') return '📞 Звонок через Авито';
  if (m.type === 'image') return '🖼 Фото (откройте чат в Авито)';
  if (m.type === 'voice') return '🎤 Голосовое сообщение (откройте чат в Авито)';
  if (m.type === 'system') {
    const t = String(content.text || '');
    if (/создал\s+чат/i.test(t)) return '✏️ Создал чат, но пока ничего не написал — напишите первыми';
    if (/заинтересовало\s+ваше\s+предложение/i.test(t)) return '💚 Заинтересовался предложением из рассылки — напишите первыми';
    if (/ознакомился\s+с\s+вашим\s+предложением/i.test(t)) return '📨 Открыл(а) предложение из рассылки';
    return '';
  }
  return avitoMessageText(m);
}
// System messages worth a notification: an empty chat, an opened promo offer and an interested
// buyer (the green chat) are leads too. Avito puts non-breaking spaces in them — hence \s.
function anbIsLeadSystem(m) {
  const t = String((m.content && m.content.text) || '');
  return /создал\s+чат|ознакомился\s+с\s+вашим\s+предложением|заинтересовало\s+ваше\s+предложение/i.test(t);
}

function anbTrim(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function anbButtons(chatId, again) {
  return { inline_keyboard: [[{ text: again ? '✍️ Написать ещё' : '✍️ Ответить', callback_data: `r:${chatId}` }]] };
}

async function anbSubs(env, bot) {
  return (await env.AGENCY_DASHBOARD_KV.get(anbKey(bot, 'subs'), 'json')) || [];
}
function anbSaveSubs(env, bot, subs) {
  return env.AGENCY_DASHBOARD_KV.put(anbKey(bot, 'subs'), JSON.stringify(subs));
}
function anbSubCabinets(cfg, sub) {
  return (sub.cabinets || [cfg.defaultCabinet]).filter((cab) => cfg.cabinets[cab]);
}
function anbUserName(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id);
}
function anbCabinetNames(cfg, cabs) {
  return cabs.map((cab) => cfg.cabinets[cab].name).join(', ');
}

function anbInstruction(cfg, cabs) {
  const many = cabs.length > 1;
  return `👋 Здравствуйте! Это бот уведомлений с Авито.\n${many ? 'Ваши кабинеты' : 'Ваш кабинет'}: <b>${escapeHtml(anbCabinetNames(cfg, cabs))}</b>.\n\n`
    + '<b>Как это работает</b>\n'
    + '• Клиент пишет в Авито — сообщение сразу приходит сюда: имя клиента (ссылка на чат в Авито), объявление и текст.\n'
    + '• Ещё приходят: 📞 звонки через Авито, ✏️ «создал чат, но ничего не написал», 📨 «открыл предложение из рассылки» и 💚 «заинтересовало предложение из рассылки» — в этих случаях напишите клиенту первыми.\n'
    + '• 🔴 — клиенту ещё не ответили, 🟢 — уже ответили (здесь или в приложении Авито). Значок меняется сам.\n\n'
    + '<b>Как ответить клиенту</b>\n'
    + '• Нажмите «✍️ Ответить» под сообщением и напишите текст — он уйдёт клиенту в Авито от имени кабинета.\n'
    + '• Отправить можно только текст. Фото, голосовые и файлы — в приложении Авито (ссылка на чат — в имени клиента).\n\n'
    + '<b>Команды</b>\n'
    + '/help — эта инструкция\n'
    + '/stop — отключить уведомления (/start — включить снова)';
}

// ── incoming Avito message (from the webhook or the poll) ──
async function anbChatState(env, bot, cab, token, account, chatId) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const state = (await kv.get(anbKey(bot, `chat:${chatId}`), 'json')) || { open: [] };
  state.cab = cab;
  if (!state.name) {
    try {
      const info = await avitoJson(token, `/messenger/v2/accounts/${account.userId}/chats/${encodeURIComponent(chatId)}`);
      const user = (info.users || []).find((u) => String(u.id) !== String(account.userId));
      const value = (info.context && info.context.value) || {};
      state.name = (user && user.name) || 'Клиент';
      const place = value.location && value.location.title;
      state.item = [value.title, place].filter(Boolean).join(' · ');
    } catch (err) {
      state.name = state.name || 'Клиент';
      state.item = state.item || '';
    }
  }
  return state;
}

async function anbHandleAvitoMessage(env, bot, cfg, cab, token, account, v) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!v || !v.chat_id || !v.id) return;
  const seenKey = anbKey(bot, `seen:${v.id}`);
  if (await kv.get(seenKey)) return;
  await kv.put(seenKey, '1', { expirationTtl: ANB_TTL_DAY * 7 });

  const avitoToken = await avitoGetToken(env, account);
  if (String(v.author_id) === String(account.userId)) {
    // The cabinet itself wrote (on Avito, or our own reply coming back) — the chat is answered.
    await anbMarkAnswered(env, bot, token, v.chat_id, { via: 'avito', text: avitoMessageText(v) });
    return;
  }
  if (v.type === 'system' && !anbIsLeadSystem(v)) return;
  const text = anbMessageText(v);
  if (!text) return;

  const subs = (await anbSubs(env, bot)).filter((s) => !s.off && anbSubCabinets(cfg, s).includes(cab));
  if (!subs.length) return;
  const state = await anbChatState(env, bot, cab, avitoToken, account, v.chat_id);
  const body = `<a href="${anbChatLink(v.chat_id)}">${escapeHtml(state.name)}</a>`
    + (state.item ? `\n<i>${escapeHtml(anbTrim(state.item, 150))}</i>` : '')
    + `\n\n${escapeHtml(anbTrim(text, 3000))}`;
  for (const sub of subs) {
    // Someone connected to several cabinets needs to see which one the client wrote to.
    const subBody = anbSubCabinets(cfg, sub).length > 1 ? `[${escapeHtml(cfg.cabinets[cab].name)}] ${body}` : body;
    const res = await anbApi(token, 'sendMessage', {
      chat_id: sub.id,
      text: `🔴 ${subBody}`,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: anbButtons(v.chat_id, false),
    });
    if (res.ok && res.result) {
      state.open.push({ c: sub.id, m: res.result.message_id, body: subBody });
      await kv.put(anbKey(bot, `msg:${sub.id}:${res.result.message_id}`), v.chat_id, { expirationTtl: ANB_TTL_DAY * 30 });
    }
  }
  state.open = state.open.slice(-30);
  await kv.put(anbKey(bot, `chat:${v.chat_id}`), JSON.stringify(state), { expirationTtl: ANB_TTL_DAY * 90 });
}

async function anbMarkAnswered(env, bot, token, chatId, { via, by, text }) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const key = anbKey(bot, `chat:${chatId}`);
  const state = await kv.get(key, 'json');
  if (!state || !state.open || !state.open.length) return;
  const where = via === 'tg' ? `в Telegram${by ? ` (${escapeHtml(by)})` : ''}` : 'на Авито';
  const footer = `\n\n🟢 <b>Ответили ${where}</b>${text ? `:\n${escapeHtml(anbTrim(text, 600))}` : ''}`;
  for (const n of state.open) {
    await anbApi(token, 'editMessageText', {
      chat_id: n.c,
      message_id: n.m,
      text: `🟢 ${n.body}${footer}`,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: anbButtons(chatId, true),
    });
  }
  state.open = [];
  await kv.put(key, JSON.stringify(state), { expirationTtl: ANB_TTL_DAY * 90 });
}

// ── Telegram side ──
// To the owner through this bot if he has started it, otherwise through the control bot.
async function anbNotifyOwner(env, token, text, extra) {
  const body = { chat_id: ANB_OWNER_ID, text, parse_mode: 'HTML', ...(extra || {}) };
  const sent = await anbApi(token, 'sendMessage', body);
  if (!sent.ok && env.CONTROL_BOT_TOKEN) {
    // The buttons only work in this bot — through the control bot just say how to get them.
    const hint = body.reply_markup ? '\n\nЧтобы выдать доступ кнопками, запустите этого бота и попросите человека написать ему ещё раз.' : '';
    await anbApi(env.CONTROL_BOT_TOKEN, 'sendMessage', { chat_id: ANB_OWNER_ID, text: text + hint, parse_mode: 'HTML' });
  }
  return sent;
}

// Connects a Telegram user to cabinets (keeping the ones they already have) and turns them back on.
async function anbConnect(env, bot, cfg, subs, user, cabs) {
  let sub = subs.find((s) => String(s.id) === String(user.id));
  if (!sub) {
    sub = { id: user.id, name: user.name, username: user.username || null, cabinets: [], addedAt: new Date().toISOString() };
    subs.push(sub);
  }
  sub.cabinets = [...new Set([...anbSubCabinets(cfg, sub), ...cabs])];
  delete sub.off;
  await anbSaveSubs(env, bot, subs);
  return sub;
}

async function anbOnTelegram(env, bot, cfg, token, update) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const subs = await anbSubs(env, bot);
  const findSub = (id) => subs.find((s) => String(s.id) === String(id));
  const isOwner = (id) => String(id) === ANB_OWNER_ID;

  if (update.callback_query) {
    const q = update.callback_query;
    const data = String(q.data || '');
    const sub = q.from && findSub(q.from.id);

    // Owner's decision on an access request: g:<tgUserId>:<cabinet> / x:<tgUserId>
    if ((data.startsWith('g:') || data.startsWith('x:')) && isOwner(q.from.id)) {
      const [kind, userId, cab] = data.split(':');
      const ask = (await kv.get(anbKey(bot, `ask:${userId}`), 'json')) || {};
      const who = `<b>${escapeHtml(ask.name || userId)}</b>${ask.username ? ` (@${escapeHtml(ask.username)})` : ''}, id <code>${escapeHtml(userId)}</code>`;
      let result;
      if (kind === 'g' && cfg.cabinets[cab]) {
        const added = await anbConnect(env, bot, cfg, subs, { id: Number(userId), name: ask.name || userId, username: ask.username }, [cab]);
        await anbApi(token, 'sendMessage', { chat_id: added.id, text: anbInstruction(cfg, anbSubCabinets(cfg, added)), parse_mode: 'HTML' });
        result = `✅ ${who} подключён(а) к кабинету «${escapeHtml(cfg.cabinets[cab].name)}».`;
      } else {
        result = `🚫 ${who} — доступ не выдан.`;
      }
      await kv.delete(anbKey(bot, `ask:${userId}`));
      await anbApi(token, 'answerCallbackQuery', { callback_query_id: q.id });
      if (q.message) await anbApi(token, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: result, parse_mode: 'HTML' });
      return;
    }

    if (data.startsWith('r:')) {
      const chatId = data.slice(2);
      const state = (await kv.get(anbKey(bot, `chat:${chatId}`), 'json')) || {};
      const cab = state.cab || cfg.defaultCabinet;
      if (!sub || sub.off || !anbSubCabinets(cfg, sub).includes(cab)) {
        await anbApi(token, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа к этому кабинету', show_alert: true });
        return;
      }
      await anbApi(token, 'answerCallbackQuery', { callback_query_id: q.id });
      const tgChat = q.message ? q.message.chat.id : q.from.id;
      const prompt = await anbApi(token, 'sendMessage', {
        chat_id: tgChat,
        text: `✍️ Ответ для <b>${escapeHtml(state.name || 'клиента')}</b>\nНапишите текст — он уйдёт клиенту в Авито от имени ${escapeHtml(cfg.cabinets[cab].owner)}.`,
        parse_mode: 'HTML',
        reply_markup: { force_reply: true, input_field_placeholder: 'Ответ клиенту' },
      });
      if (prompt.ok && prompt.result) {
        await kv.put(anbKey(bot, `msg:${tgChat}:${prompt.result.message_id}`), chatId, { expirationTtl: ANB_TTL_DAY * 30 });
      }
      await kv.put(anbKey(bot, `await:${tgChat}`), chatId, { expirationTtl: 60 * 60 });
      return;
    }
    await anbApi(token, 'answerCallbackQuery', { callback_query_id: q.id });
    return;
  }

  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return;
  const from = msg.from || {};
  const text = String(msg.text || '').trim();
  const reply = (t) => anbApi(token, 'sendMessage', { chat_id: msg.chat.id, text: t, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  let sub = findSub(from.id);
  const user = { id: from.id, name: anbUserName(from), username: from.username };

  if (isOwner(from.id) && text === '/users') {
    const lines = subs.map((s) => `• ${escapeHtml(s.name)}${s.username ? ` (@${escapeHtml(s.username)})` : ''}, <code>${s.id}</code> — `
      + `${escapeHtml(anbCabinetNames(cfg, anbSubCabinets(cfg, s)) || '—')}${s.off ? ' (отключил уведомления)' : ''}`);
    return reply(lines.length ? `👥 <b>Пользователи бота</b>\n${lines.join('\n')}` : 'Пока никто не подключён.');
  }

  // Cabinets this person may have: listed in `allow` (or among a retired bot's subscribers), or
  // all of them for the owner.
  const allowed = [];
  for (const [cab, c] of Object.entries(cfg.cabinets)) {
    if (isOwner(from.id) || (c.allow || []).map(String).includes(String(from.id))) allowed.push(cab);
    else if (!sub && c.allowSubsOf && (await anbSubs(env, c.allowSubsOf)).some((s) => String(s.id) === String(from.id))) allowed.push(cab);
  }
  const missing = allowed.filter((cab) => !sub || !anbSubCabinets(cfg, sub).includes(cab));

  // A cabinet added to `allow` later joins quietly, so the message itself (maybe a reply) still goes through.
  if (sub && missing.length && !text.startsWith('/start')) sub = await anbConnect(env, bot, cfg, subs, user, allowed);
  if (!sub || (text.startsWith('/start') && (sub.off || missing.length))) {
    if (!sub && !allowed.length) {
      // A stranger: point them to the owner, and ask the owner once per person.
      const askKey = anbKey(bot, `ask:${from.id}`);
      if (!(await kv.get(askKey))) {
        await kv.put(askKey, JSON.stringify({ name: user.name, username: user.username || null }), { expirationTtl: ANB_TTL_DAY * 30 });
        const buttons = Object.entries(cfg.cabinets).map(([cab, c]) => [{ text: `➕ ${c.name}`, callback_data: `g:${from.id}:${cab}` }]);
        buttons.push([{ text: '🚫 Не давать доступ', callback_data: `x:${from.id}` }]);
        await anbNotifyOwner(env, token, `🔐 Просит доступ к боту «${escapeHtml(cfg.name)}»: <b>${escapeHtml(user.name)}</b>`
          + `${from.username ? ` (@${escapeHtml(from.username)})` : ''}, id <code>${from.id}</code>.\nК какому кабинету подключить?`,
        { reply_markup: { inline_keyboard: buttons } });
      }
      return reply('Здравствуйте! Этот бот присылает уведомления о новых сообщениях клиентов с Авито.\n\n'
        + `Чтобы получить доступ к уведомлениям, напишите ${ANB_OWNER_LINK} — он подключит вас к вашему кабинету, и сообщения начнут приходить сюда.`);
    }
    const isNew = !sub;
    sub = await anbConnect(env, bot, cfg, subs, user, allowed);
    if (isNew && !isOwner(from.id)) {
      await anbNotifyOwner(env, token, `👤 Новый пользователь бота «${escapeHtml(cfg.name)}»: <b>${escapeHtml(user.name)}</b>`
        + `${from.username ? ` (@${escapeHtml(from.username)})` : ''}, id <code>${from.id}</code> — ${escapeHtml(anbCabinetNames(cfg, anbSubCabinets(cfg, sub)))}.`);
    }
    return reply(anbInstruction(cfg, anbSubCabinets(cfg, sub)));
  }
  if (text.startsWith('/start') || text === '/help') return reply(anbInstruction(cfg, anbSubCabinets(cfg, sub)));
  if (text === '/stop') {
    sub.off = true;
    await anbSaveSubs(env, bot, subs);
    return reply('Уведомления отключены. Чтобы вернуть — напишите боту /start.');
  }
  if (!text) return reply('Пока можно отправлять клиенту только текст. Фото и файлы — в приложении Авито.');

  let chatId = null;
  if (msg.reply_to_message) chatId = await kv.get(anbKey(bot, `msg:${msg.chat.id}:${msg.reply_to_message.message_id}`));
  if (!chatId) chatId = await kv.get(anbKey(bot, `await:${msg.chat.id}`));
  if (!chatId) return reply('Чтобы ответить клиенту, нажмите «✍️ Ответить» под его сообщением. Как работает бот — /help.');

  const state = (await kv.get(anbKey(bot, `chat:${chatId}`), 'json')) || {};
  const cab = state.cab || cfg.defaultCabinet;
  if (!anbSubCabinets(cfg, sub).includes(cab)) return reply('Нет доступа к кабинету этого чата.');
  const account = await anbAccount(env, cfg.cabinets[cab]);
  const avitoToken = await avitoGetToken(env, account);
  const res = await avitoRequest(avitoToken, `/messenger/v1/accounts/${account.userId}/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message: { text }, type: 'text' }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return reply(`❌ Не отправилось (Авито ответил ${res.status}). Ответьте в приложении Авито.\n<code>${escapeHtml(err.slice(0, 200))}</code>`);
  }
  const sent = await res.json().catch(() => null);
  if (sent && sent.id) await kv.put(anbKey(bot, `seen:${sent.id}`), '1', { expirationTtl: ANB_TTL_DAY * 7 });
  await avitoRequest(avitoToken, `/messenger/v1/accounts/${account.userId}/chats/${encodeURIComponent(chatId)}/read`, { method: 'POST' }).catch(() => null);
  await kv.delete(anbKey(bot, `await:${msg.chat.id}`));
  await anbMarkAnswered(env, bot, token, chatId, { via: 'tg', by: from.first_name || from.username, text });
  return reply(`✅ Отправлено: <a href="${anbChatLink(chatId)}">${escapeHtml(state.name || 'клиент')}</a>`);
}

// ── setup: Telegram webhook and bot profile, then each cabinet's Avito messenger webhook ──
async function anbSetup(env, bot, cfg, token, force) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const secrets = await anbSecrets(token);
  const results = { avito: {} };
  if (force || (await kv.get(anbKey(bot, 'setup'))) !== ANB_SETUP_VERSION) {
    results.telegram = await anbApi(token, 'setWebhook', {
      url: `${BOT_WORKER_ORIGIN}/api/avitobot/${bot}/tg`,
      secret_token: secrets.tg,
      allowed_updates: ['message', 'callback_query'],
    });
    results.description = await anbApi(token, 'setMyDescription', {
      description: 'Уведомления о новых сообщениях клиентов на Авито с ответом прямо из Telegram. Нажмите «Старт», чтобы подключиться.',
    });
    results.commands = await anbApi(token, 'setMyCommands', {
      commands: [
        { command: 'help', description: 'Как работает бот' },
        { command: 'stop', description: 'Отключить уведомления' },
      ],
    });
    if (results.telegram && results.telegram.ok) await kv.put(anbKey(bot, 'setup'), ANB_SETUP_VERSION);
  }
  let ok = !results.telegram || !!results.telegram.ok;
  for (const [cab, cabinet] of Object.entries(cfg.cabinets)) {
    const setupKey = anbCabKey(bot, cfg, cab, 'setup');
    if (!force && (await kv.get(setupKey)) === ANB_SETUP_VERSION) continue;
    try {
      const account = await anbAccount(env, cabinet);
      const avitoToken = await avitoGetToken(env, account);
      const res = await avitoRequest(avitoToken, '/messenger/v3/webhook', {
        method: 'POST',
        body: JSON.stringify({ url: anbAvitoHookUrl(bot, cfg, cab, secrets.avito) }),
      });
      results.avito[cab] = { status: res.status, body: (await res.text().catch(() => '')).slice(0, 300) };
      if (res.status === 200) await kv.put(setupKey, ANB_SETUP_VERSION);
      else ok = false;
    } catch (err) {
      results.avito[cab] = { error: String(err && err.message) };
      ok = false;
    }
  }
  const me = force ? await anbApi(token, 'getMe', {}) : null;
  const username = me && me.ok && me.result && me.result.username;
  return { ok, link: username ? `https://t.me/${username}` : null, results };
}

// ── poll: safety net for missed webhooks ──
async function anbPoll(env, bot, cfg, cab, token) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const account = await anbAccount(env, cfg.cabinets[cab]);
  const avitoToken = await avitoGetToken(env, account);
  const pollKey = anbCabKey(bot, cfg, cab, 'poll');
  const since = Number(await kv.get(pollKey)) || 0;
  const data = await avitoJson(avitoToken, `/messenger/${AVITO_CHATS_VERSION}/accounts/${account.userId}/chats?chat_types=u2i&limit=20`);
  const chats = data.chats || [];
  let newest = since;
  for (const c of chats) {
    const last = c.last_message || {};
    const created = Number(last.created || c.updated || 0);
    if (created > newest) newest = created;
    if (!since || created <= since) continue; // first run only sets the baseline — no backlog flood
    const res = await avitoJson(avitoToken, `/messenger/${AVITO_MESSAGES_VERSION}/accounts/${account.userId}/chats/${encodeURIComponent(c.id)}/messages?limit=20&offset=0`);
    const msgs = (Array.isArray(res) ? res : res.messages || []).filter((m) => Number(m.created) > since);
    msgs.sort((a, b) => Number(a.created) - Number(b.created));
    for (const m of msgs) await anbHandleAvitoMessage(env, bot, cfg, cab, token, account, { ...m, chat_id: c.id });
  }
  if (newest > since) await kv.put(pollKey, String(newest));
}

// ── retired bots ──
function anbMovedText(retired) {
  return '📦 <b>Бот уведомлений Авито переехал.</b>\n\n'
    + `Новые сообщения клиентов теперь приходят в новый бот: ${retired.link}\n`
    + 'Откройте его и нажмите «Старт» — подключение произойдёт автоматически. Сюда уведомления больше не придут.';
}

async function anbRetire(env, bot, retired, token) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const doneKey = anbKey(bot, 'retired');
  if (await kv.get(doneKey)) return { already: true };
  // Not before the new bot is live — otherwise people would be sent to a bot that doesn't answer yet.
  if ((await kv.get(anbKey(retired.movedTo, 'setup'))) !== ANB_SETUP_VERSION) return { waiting: retired.movedTo };
  await kv.put(doneKey, new Date().toISOString());
  const results = { notified: [], avito: [] };
  for (const sub of (await anbSubs(env, bot)).filter((s) => !s.off)) {
    const res = await anbApi(token, 'sendMessage', { chat_id: sub.id, text: anbMovedText(retired), parse_mode: 'HTML' });
    results.notified.push(`${sub.name}: ${res.ok ? 'ok' : res.description}`);
  }
  const secrets = await anbSecrets(token);
  for (const cabinet of retired.avito) {
    try {
      const account = await anbAccount(env, cabinet);
      const avitoToken = await avitoGetToken(env, account);
      const res = await avitoRequest(avitoToken, '/messenger/v1/webhook/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ url: `${BOT_WORKER_ORIGIN}/api/avitobot/${bot}/avito/${secrets.avito}` }),
      });
      results.avito.push({ status: res.status });
    } catch (err) {
      results.avito.push({ error: String(err && err.message) });
    }
  }
  await anbApi(token, 'setMyDescription', { description: `Бот переехал: ${retired.link}` });
  await anbApi(token, 'setMyCommands', { commands: [] });
  return results;
}

async function avitoNotifyCron(env) {
  for (const [bot, cfg] of Object.entries(AVITO_NOTIFY_BOTS)) {
    const token = env[cfg.tokenEnv];
    if (!token) continue;
    try {
      await anbSetup(env, bot, cfg, token, false);
    } catch (err) {
      console.error(`avito notify bot ${bot} setup failed`, err && err.stack);
    }
    for (const cab of Object.keys(cfg.cabinets)) {
      try {
        await anbPoll(env, bot, cfg, cab, token);
      } catch (err) {
        console.error(`avito notify bot ${bot}/${cab} poll failed`, err && err.stack);
      }
    }
  }
  // After the live bots: a retired bot waits for its replacement's setup.
  for (const [bot, retired] of Object.entries(AVITO_RETIRED_BOTS)) {
    const token = env[retired.tokenEnv];
    if (!token) continue;
    try {
      await anbRetire(env, bot, retired, token);
    } catch (err) {
      console.error(`avito notify bot ${bot} retirement failed`, err && err.stack);
    }
  }
}

async function handleAvitoBotApi(request, env, url, ctx) {
  const m = url.pathname.match(/^\/api\/avitobot\/([a-z0-9-]+)\/(tg|avito|setup)(?:\/([a-f0-9]+))?(?:\/([a-z0-9-]+))?$/);
  const bot = m && m[1];
  const cfg = bot && AVITO_NOTIFY_BOTS[bot];
  const retired = !cfg && bot && AVITO_RETIRED_BOTS[bot];
  if (retired) return handleRetiredAvitoBot(request, env, url, m, bot, retired);
  if (!cfg) return json({ error: 'not_found' }, 404);
  const token = env[cfg.tokenEnv];
  if (!token) return json({ error: `${cfg.tokenEnv} is not set` }, 503);
  const secrets = await anbSecrets(token);

  if (m[2] === 'setup') {
    if (url.searchParams.get('key') !== DASHBOARD_PASSWORD) return json({ error: 'unauthorized' }, 401);
    const result = await anbSetup(env, bot, cfg, token, true);
    result.subscribers = (await anbSubs(env, bot)).map((s) => `${s.name}: ${anbCabinetNames(cfg, anbSubCabinets(cfg, s))}${s.off ? ' (off)' : ''}`);
    return json(result);
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (m[2] === 'tg') {
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secrets.tg) return json({ ok: false }, 403);
    const update = await readJson(request);
    try {
      if (update) await anbOnTelegram(env, bot, cfg, token, update);
    } catch (err) {
      console.error(`avito notify bot ${bot} telegram update failed`, err && err.stack);
    }
    return json({ ok: true }); // always 200, so Telegram doesn't redeliver the same update forever
  }

  // Avito messenger webhook: {payload: {type: 'message', value: {id, chat_id, author_id, type, content, …}}}
  const cab = m[4] || cfg.defaultCabinet;
  if (m[3] !== secrets.avito || !cfg.cabinets[cab]) return json({ ok: false }, 403);
  const event = await readJson(request);
  const value = event && event.payload && event.payload.type === 'message' ? event.payload.value : null;
  if (value) {
    const work = anbAccount(env, cfg.cabinets[cab])
      .then((account) => anbHandleAvitoMessage(env, bot, cfg, cab, token, account, value))
      .catch((err) => console.error(`avito notify bot ${bot}/${cab} avito event failed`, err && err.stack));
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  }
  return json({ ok: true });
}

async function handleRetiredAvitoBot(request, env, url, m, bot, retired) {
  const token = env[retired.tokenEnv];
  if (!token) return json({ error: `${retired.tokenEnv} is not set` }, 503);
  if (m[2] === 'setup') {
    if (url.searchParams.get('key') !== DASHBOARD_PASSWORD) return json({ error: 'unauthorized' }, 401);
    return json(await anbRetire(env, bot, retired, token));
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secrets = await anbSecrets(token);
  if (m[2] === 'tg') {
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secrets.tg) return json({ ok: false }, 403);
    const update = await readJson(request);
    const q = update && update.callback_query;
    const chatId = q ? q.from.id : update && update.message && update.message.chat.type === 'private' && update.message.chat.id;
    if (q) await anbApi(token, 'answerCallbackQuery', { callback_query_id: q.id });
    if (chatId) await anbApi(token, 'sendMessage', { chat_id: chatId, text: anbMovedText(retired), parse_mode: 'HTML' });
    return json({ ok: true });
  }
  return json({ ok: true }); // Avito events that still arrive before the unsubscribe — dropped
}

// ── /academy: 14-day training course for Avito trainees ──
// The API lives under /api/dashboard/academy/* on purpose: the dashboard's Yandex Cloud proxy
// function (yc-dashboard-api-proxy, lets through /api/dashboard/* only) then carries it too, so
// the page works in Russia without a VPN and no extra function has to be deployed. handleApi
// routes it before the dashboard's password check: trainees sign in with just a name and a
// Telegram username (no password — the owner's call), and signing up as "admin" / "admin" opens
// the admin view instead (set the ACADEMY_ADMIN_KEY secret to require that value in the
// Telegram field rather than "admin").
// Storage: AGENCY_DASHBOARD_KV, one "academy:u:<username>" record per trainee. A summary goes in
// the key's metadata so the admin list is a single kv.list call instead of one get per trainee.
const ACADEMY_MODULES = 14;
const ACADEMY_USER_PREFIX = 'academy:u:';
const ACADEMY_ADMIN_PREFIX = 'academy:admin:';
const ACADEMY_ADMIN_TTL = 60 * 60 * 24 * 30;
const ACADEMY_SEEN_EVERY_MS = 6 * 60 * 60 * 1000;
const ACADEMY_ANSWER_MAX = 10000;

function academyUsername(raw) {
  const tg = String(raw || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{3,32}$/.test(tg) ? tg : '';
}

function academyMeta(user) {
  const subs = user.submissions || {};
  const pending = Object.keys(subs).filter((id) => subs[id].status === 'pending').map(Number);
  const count = (status) => Object.values(subs).filter((s) => s.status === status).length;
  return {
    name: String(user.name || '').slice(0, 80),
    blocked: !!user.blocked,
    submitted: Object.keys(subs).length,
    accepted: count('accepted'),
    revise: count('revise'),
    pending,
    pendingSince: pending.map((id) => subs[id].submittedAt).sort()[0] || null,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
  };
}

async function academyGetUser(kv, tg) {
  return tg ? kv.get(ACADEMY_USER_PREFIX + tg, 'json') : null;
}

async function academyPutUser(kv, user) {
  await kv.put(ACADEMY_USER_PREFIX + user.tg, JSON.stringify(user), { metadata: academyMeta(user) });
}

// Signed-in trainee from body.tg: 404 when unknown, 403 when the admin switched access off.
async function academyTrainee(kv, body) {
  const user = await academyGetUser(kv, academyUsername(body.tg));
  if (!user) return { error: json({ error: 'not_found' }, 404) };
  if (user.blocked) return { error: json({ error: 'blocked' }, 403) };
  return { user };
}

async function academyTouch(kv, user) {
  const now = Date.now();
  if (now - Date.parse(user.lastSeenAt || 0) < ACADEMY_SEEN_EVERY_MS) return;
  user.lastSeenAt = new Date(now).toISOString();
  await academyPutUser(kv, user);
}

function academyIsAdminLogin(env, name, tg) {
  const key = String(env.ACADEMY_ADMIN_KEY || 'admin').toLowerCase();
  return name.toLowerCase() === 'admin' && tg.replace(/^@+/, '').toLowerCase() === key;
}

function academyCleanAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (!keys.length || keys.length > 30) return null;
  const answers = {};
  for (const key of keys) {
    const value = typeof raw[key] === 'string' ? raw[key].trim() : '';
    if (!/^[A-Za-z0-9._-]{1,24}$/.test(key) || !value || value.length > ACADEMY_ANSWER_MAX) return null;
    answers[key] = value;
  }
  return answers;
}

async function handleAcademyApi(request, env, url) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (!kv) return json({ error: 'kv_not_configured' }, 500);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = (await readJson(request)) || {};
  const action = url.pathname.slice('/api/dashboard/academy/'.length);
  const now = new Date().toISOString();

  if (action === 'register') {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const rawTg = String(body.tg || '').trim();
    if (academyIsAdminLogin(env, name, rawTg)) {
      const token = crypto.randomUUID();
      await kv.put(ACADEMY_ADMIN_PREFIX + token, now, { expirationTtl: ACADEMY_ADMIN_TTL });
      return json({ admin: true, token });
    }
    const tg = academyUsername(rawTg);
    if (name.length < 2 || name.toLowerCase() === 'admin') return json({ error: 'bad_name' }, 400);
    if (!tg || tg === 'admin') return json({ error: 'bad_username' }, 400);
    const existing = await academyGetUser(kv, tg);
    if (existing) {
      if (existing.blocked) return json({ error: 'blocked' }, 403);
      await academyTouch(kv, existing);
      return json({ user: existing, existing: true });
    }
    const user = { tg, name, createdAt: now, lastSeenAt: now, blocked: false, submissions: {} };
    await academyPutUser(kv, user);
    return json({ user });
  }

  if (action === 'login' || action === 'me') {
    const { user, error } = await academyTrainee(kv, body);
    if (error) return error;
    await academyTouch(kv, user);
    return json({ user });
  }

  if (action === 'submit') {
    const { user, error } = await academyTrainee(kv, body);
    if (error) return error;
    const moduleId = Number(body.moduleId);
    if (!Number.isInteger(moduleId) || moduleId < 1 || moduleId > ACADEMY_MODULES) return json({ error: 'bad_module' }, 400);
    const subs = user.submissions || (user.submissions = {});
    // Modules go strictly in order: a module opens once the previous one's task is handed in.
    if (moduleId > 1 && !subs[moduleId - 1]) return json({ error: 'locked' }, 409);
    const prev = subs[moduleId];
    if (prev && prev.status === 'accepted') return json({ error: 'already_accepted' }, 409);
    const answers = academyCleanAnswers(body.answers);
    if (!answers) return json({ error: 'bad_answers' }, 400);
    const history = (prev && prev.history) || [];
    if (prev && prev.status === 'revise') history.push({ feedback: prev.feedback || '', reviewedAt: prev.reviewedAt || null });
    subs[moduleId] = { answers, status: 'pending', submittedAt: now, firstSubmittedAt: (prev && prev.firstSubmittedAt) || now, history };
    user.lastSeenAt = now;
    await academyPutUser(kv, user);
    return json({ user });
  }

  if (!action.startsWith('admin/')) return json({ error: 'not_found' }, 404);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token || !(await kv.get(ACADEMY_ADMIN_PREFIX + token))) return json({ error: 'unauthorized' }, 401);

  if (action === 'admin/users') {
    const users = [];
    let cursor;
    for (;;) {
      const list = await kv.list({ prefix: ACADEMY_USER_PREFIX, cursor });
      list.keys.forEach((k) => users.push({ tg: k.name.slice(ACADEMY_USER_PREFIX.length), ...(k.metadata || {}) }));
      if (list.list_complete || !list.cursor) break;
      cursor = list.cursor;
    }
    return json({ users });
  }

  const target = await academyGetUser(kv, academyUsername(body.tg));
  if (!target) return json({ error: 'not_found' }, 404);

  if (action === 'admin/user') return json({ user: target });

  if (action === 'admin/review') {
    const sub = (target.submissions || {})[Number(body.moduleId)];
    if (!sub) return json({ error: 'not_submitted' }, 404);
    if (body.status !== 'accepted' && body.status !== 'revise') return json({ error: 'bad_status' }, 400);
    const feedback = String(body.feedback || '').trim();
    if (feedback.length > ACADEMY_ANSWER_MAX) return json({ error: 'too_long' }, 400);
    if (body.status === 'revise' && !feedback) return json({ error: 'feedback_required' }, 400);
    Object.assign(sub, { status: body.status, feedback, reviewedAt: now });
    await academyPutUser(kv, target);
    return json({ user: target });
  }

  if (action === 'admin/block') {
    target.blocked = !!body.blocked;
    await academyPutUser(kv, target);
    return json({ user: target });
  }

  if (action === 'admin/delete') {
    await kv.delete(ACADEMY_USER_PREFIX + target.tg);
    return json({ ok: true });
  }

  return json({ error: 'not_found' }, 404);
}

// ── /mba-otchet: the editable progress report for the MBA "Личный бренд" project ──
// The page computes progress live from the CRM (/api/crm/clients); everything a person types
// into it (dates, notes, problems, finance, percent overrides) is one JSON document in KV
// ("report:mba-otchet"). Reading is open (the page is a shared link); writing needs the
// "x-dashboard-password" header — env.MBA_REPORT_PASSWORD when set (Cloudflare dashboard ->
// Variables and Secrets), otherwise the shared dashboard password.
const MBA_REPORT_KEY = 'report:mba-otchet';
const MBA_REPORT_MAX_BYTES = 200000;

async function handleMbaReportApi(request, env) {
  const kv = env.MBA_MYBRAND_KV;
  if (request.method === 'GET') {
    const report = await kv.get(MBA_REPORT_KEY, 'json');
    return json({ report: report || null });
  }
  if (request.method === 'PUT') {
    const password = env.MBA_REPORT_PASSWORD || DASHBOARD_PASSWORD;
    if (request.headers.get('x-dashboard-password') !== password) return json({ error: 'unauthorized' }, 401);
    const body = await readJson(request);
    if (!body || !body.report || typeof body.report !== 'object' || Array.isArray(body.report)) {
      return json({ error: 'bad_request' }, 400);
    }
    const text = JSON.stringify({ ...body.report, updatedAt: new Date().toISOString() });
    if (text.length > MBA_REPORT_MAX_BYTES) return json({ error: 'too_large' }, 413);
    await kv.put(MBA_REPORT_KEY, text);
    return json({ ok: true, updatedAt: JSON.parse(text).updatedAt });
  }
  return json({ error: 'method_not_allowed' }, 405);
}

async function handleApi(request, env, url, ctx) {
  const { pathname } = url;
  const kv = env.MBA_MYBRAND_KV;

  if (pathname.startsWith('/api/serp/')) {
    return handleSerpApi(request, env, url);
  }

  if (pathname.startsWith('/api/crm/')) {
    return handleCrmApi(request, env, url);
  }

  if (pathname === '/api/mba-report') {
    return handleMbaReportApi(request, env);
  }

  // /avito-export's API reads every cabinet's Avito chats (parents' emails, children's names) and adds or
  // deletes cabinets — it was open to anyone who knew the URL. Now it takes the password the page's gate
  // asks for: the AVITO_API_PASSWORD secret, or, until that is set, the dashboard password.
  if (pathname.startsWith('/api/avito/')) {
    if (request.headers.get('x-dashboard-password') !== (env.AVITO_API_PASSWORD || DASHBOARD_PASSWORD)) return json({ error: 'unauthorized' }, 401);
    return handleAvitoApi(request, env, url);
  }

  if (pathname.startsWith('/api/salescrm/')) {
    return handleSalesCrmApi(request, env, url);
  }

  // Before the dashboard's own routes: the academy has its own sign-in (see handleAcademyApi).
  if (pathname.startsWith('/api/dashboard/academy/')) {
    return handleAcademyApi(request, env, url);
  }

  // Same for Avito Tasks: per-person invite links instead of the dashboard password.
  // Under /api/dashboard/ so the Yandex Cloud proxy (yc-dashboard-api-proxy) lets it through.
  if (pathname === '/api/dashboard/feeds' || pathname.startsWith('/api/dashboard/feeds/')) {
    return handleFeedsApi(request, env, url);
  }

  if (pathname.startsWith('/api/dashboard/avito-tasks/')) {
    return handleAvitoTasksApi(request, env, url, ctx);
  }

  if (pathname.startsWith('/api/dashboard/finance/')) {
    return handleFinanceApi(request, env, url);
  }

  if (pathname.startsWith('/api/dashboard/')) {
    return handleDashboardApi(request, env, url, ctx);
  }

  if (pathname.startsWith('/api/tgbot/')) {
    return handleBotApi(request, env, url);
  }

  if (pathname.startsWith('/api/avitobot/')) {
    return handleAvitoBotApi(request, env, url, ctx);
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

// Only the homepage and the three public questionnaire pages should be indexable by search
// engines — everything else (knowledge base, dashboards, CRM, client pages, internal tools)
// gets an explicit noindex header here as a second layer on top of robots.txt and the
// per-page <meta name="robots"> tags, since this Worker also serves a live copy of the whole
// site at mainweb.oxion-ezhkov.workers.dev (production cantor.agency is a separate nginx
// host — see corsHeaders() above — where only the static HTML tags and robots.txt apply).
const NOINDEX_ALLOWED_PATHS = new Set(['/', '/index.html', '/adviser-anketa', '/avito-anketa', '/club-anketa']);

// Most pages here are extensionless files (/mba-otchet, /dashboard, /client/<slug>, …): nginx on
// cantor.agency serves them as text/html, but the assets binding sends no Content-Type at all,
// so on the workers.dev domain browsers may show them as text or download them. Label them.
function withHtmlContentType(response) {
  if (!response.ok || response.headers.get('Content-Type')) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/* ═══════════════ Avito feeds: Google Sheets → Avito autoload XML (like BananLab) ═══════════════
 *
 * Replaces BananLab's autoload for /avito-feeds. Each client ("feed") is a Google Sheet built on the
 * BananLab template; existing client sheets work unchanged:
 *   row 2 — the Avito tag of the column (Title, Price, Images, ServiceType…),
 *   row 3 — «Грузим в xml» / «Не грузим» (only the former reach the XML),
 *   row 4 — type hint; «Одно или несколько значений…» / «Много значений, Option» → <Option> list,
 *   rows 5+ — ads, one per row, keyed by the `id` column.
 * Several tabs of one sheet merge into one feed. Rows with «Товар доступен?» = «Нет» are skipped.
 * Russian-named service columns (Папка на Яндекс Диск, Переразмещаем как новые?, …) never reach the XML.
 *
 * Photos: the Images cell holds one link per line. Links copied from the Yandex.Disk web app
 * (disk.yandex.ru/client/disk/…, private) are fetched with the OAuth token the sheet already keeps in
 * cell A2 of its «Яндекс.Диск.Доступ» tab; public links (disk.yandex.ru/i/…, yadi.sk) need no token;
 * any other http(s) link goes into the XML as is. Yandex links become /feed/<slug>/img/<sig>/<src>.<ext>
 * on this worker: <src> is the base64url of the Disk path, <sig> an HMAC with the feed's own secret, so
 * nobody can use the endpoint to read other files from the client's Disk.
 *
 * Reading the sheet: with the GOOGLE_SERVICE_ACCOUNT_JSON secret (a Google service-account key, set in
 * the Cloudflare dashboard → Variables and Secrets, "Encrypt") the sheet only has to be shared with that
 * service account's e-mail; without it the sheet must be open to «anyone with the link» and is read as CSV.
 *
 * Avito fetches GET /feed/<slug>/avito.xml on its own schedule (hourly). feedsCron rebuilds every enabled
 * feed about once an hour; «Обновить XML» rebuilds one now, «Обновить в Авито» asks Avito to fetch now
 * (POST /autoload/v1/upload, Avito allows it once an hour), «Подключить на Авито» writes our feed URL into
 * the linked Avito account's autoload profile (POST /autoload/v2/profile).
 *
 * KV keys (binding "AVITO_KV"):
 *   feed:<slug>     -> { slug, name, sheetId, tabs, enabled, avitoAccountId, secret, createdAt, updatedAt }
 *   feedxml:<slug>  -> the last built XML
 *   feedstat:<slug> -> { builtAt, ms, ads, tabs: [{ name, ads, error }], problems: [{ tab, row, id, msg }], yandexToken }
 *   feedytok:<slug> -> the Yandex.Disk OAuth token copied from the sheet (never sent to the page)
 *
 * Staff API (/api/dashboard/feeds/…, the /avito-feeds page) requires the x-dashboard-password header
 * (FEEDS_PASSWORD secret, else the dashboard password). It sits under /api/dashboard/ so the page also
 * works through the Yandex Cloud proxy from Russia without a VPN.
 *
 * *.workers.dev is throttled by some Russian ISPs. If Avito's autoload report says it can't download the
 * feed or photos, set the FEEDS_PROXY_URL variable to the yc-dashboard-api-proxy function URL: every feed
 * and photo link is then given as <proxy>?p=/feed/… (the proxy passes GET /feed/* through).
 */

const FEEDS_BASE_URL = 'https://mainweb.oxion-ezhkov.workers.dev';
const FEEDS_YD_TAB = 'Яндекс.Диск.Доступ';
const FEEDS_REBUILD_MS = 55 * 60 * 1000;
const FEEDS_MAX_TABS = 10;
// Columns marked «Грузим в xml» in the template that the service handles itself instead of copying.
const FEEDS_SERVICE_COLS = new Set(['Товар доступен?', 'Переразмещаем как новые? (Да/Нет)', 'Папка на Яндекс Диск', 'Место, куда накладывается накладка']);

// Public URL of a /feed/… path — straight on the worker, or through the Yandex Cloud proxy.
function feedsPublicUrl(env, path) {
  if (env.FEEDS_PROXY_URL) return `${String(env.FEEDS_PROXY_URL).replace(/\/+$/, '')}?p=${encodeURIComponent(path)}`;
  return String(env.FEEDS_BASE_URL || FEEDS_BASE_URL).replace(/\/+$/, '') + path;
}

function feedsAuth(request, env) {
  return request.headers.get('x-dashboard-password') === (env.FEEDS_PASSWORD || DASHBOARD_PASSWORD);
}

function feedsSheetId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}

function feedsSlug(name) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' };
  const base = String(name || '').toLowerCase().split('').map((c) => (map[c] !== undefined ? map[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'client';
  return base + '-' + randomHex(3);
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function feedsB64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function feedsB64urlDecode(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function feedsSign(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return [...sig.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ── Reading the sheet ── */

let feedsGoogleTokenCache = null;

async function feedsGoogleToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  if (feedsGoogleTokenCache && feedsGoogleTokenCache.exp > Date.now() + 60000) return feedsGoogleTokenCache.token;
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const enc = (obj) => feedsB64url(JSON.stringify(obj));
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  const jwt = unsigned + '.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Google не выдал токен сервисного аккаунта: ' + (data.error_description || data.error || res.status));
  feedsGoogleTokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

function feedsServiceEmail(env) {
  try { return env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email || '' : ''; } catch { return ''; }
}

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
function feedsParseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const FEEDS_CLOSED = 'Таблица закрыта. Откройте доступ «Все, у кого есть ссылка» (просмотр) или добавьте сервисный аккаунт.';

// Names of all tabs: [{ name, gid }].
async function feedsListTabs(env, sheetId) {
  const token = await feedsGoogleToken(env);
  if (token) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(title,sheetId)`, { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || res.status === 404) throw new Error(`Нет доступа к таблице. Добавьте ${feedsServiceEmail(env)} в «Настройки доступа» таблицы как читателя.`);
    if (!res.ok) throw new Error('Google Sheets: ' + ((data.error && data.error.message) || res.status));
    return (data.sheets || []).map((s) => ({ name: s.properties.title, gid: String(s.properties.sheetId) }));
  }
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, { redirect: 'manual' });
  if (res.status !== 200) throw new Error(FEEDS_CLOSED);
  const html = await res.text();
  const tabs = [];
  const re = /items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g;
  let m;
  // Names come as JS string literals: Google escapes & < > ' as \xHH, which JSON doesn't accept.
  while ((m = re.exec(html))) tabs.push({ name: JSON.parse('"' + m[1].replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1') + '"'), gid: m[2] });
  if (!tabs.length) throw new Error(FEEDS_CLOSED);
  return tabs;
}

// { [tabName]: rows[][] } for the requested tabs; missing tabs come back in `missing`.
async function feedsReadTabs(env, sheetId, names) {
  const all = await feedsListTabs(env, sheetId);
  const byName = new Map(all.map((t) => [t.name, t]));
  const found = names.filter((n) => byName.has(n));
  const missing = names.filter((n) => !byName.has(n));
  const tabs = {};
  const token = await feedsGoogleToken(env);
  if (token && found.length) {
    const qs = found.map((n) => 'ranges=' + encodeURIComponent("'" + n.replace(/'/g, "''") + "'")).join('&');
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Google Sheets: ' + ((data.error && data.error.message) || res.status));
    (data.valueRanges || []).forEach((vr, i) => { tabs[found[i]] = vr.values || []; });
  } else {
    for (const n of found) {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${byName.get(n).gid}`);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/csv|text\/plain/.test(type)) throw new Error(FEEDS_CLOSED);
      tabs[n] = feedsParseCsv(await res.text());
    }
  }
  return { tabs, missing, allTabs: all.map((t) => t.name) };
}

/* ── Sheet rows → ads → XML ── */

function feedsParseTab(rows) {
  const tags = rows[1] || [], marks = rows[2] || [], types = rows[3] || [];
  const cols = [];
  let idCol = -1, availCol = -1;
  for (let i = 0; i < tags.length; i++) {
    const tag = String(tags[i] || '').trim();
    if (/^id$/i.test(tag) && idCol < 0) idCol = i;
    if (tag === 'Товар доступен?') availCol = i;
    if (String(marks[i] || '').trim().toLowerCase() !== 'грузим в xml') continue;
    if (FEEDS_SERVICE_COLS.has(tag) || !/^[A-Za-z][A-Za-z0-9]*$/.test(tag)) continue;
    cols.push({ i, tag, multi: /нескольк|много значений|option/i.test(String(types[i] || '')) });
  }
  const ads = [], problems = [];
  if (idCol < 0) {
    problems.push({ row: 2, msg: 'Во второй строке нет колонки id — это не таблица по шаблону BananLab' });
    return { ads, problems };
  }
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r] || [];
    const id = String(row[idCol] == null ? '' : row[idCol]).trim();
    if (!id || id.toLowerCase() === 'подробнее о параметре') continue;
    if (availCol >= 0 && /^нет$/i.test(String(row[availCol] || '').trim())) continue;
    const fields = [];
    for (const c of cols) {
      const raw = String(row[c.i] == null ? '' : row[c.i]);
      if (raw.trim()) fields.push({ tag: c.tag, multi: c.multi, value: raw });
    }
    ads.push({ row: r + 1, id, fields });
  }
  return { ads, problems };
}

function feedsXmlText(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function feedsDate(v) {
  const s = String(v).trim();
  let m = s.match(/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d)(:\d\d)?$/);
  if (m) return `${m[1]}T${m[2]}${m[3] || ':00'}+03:00`;
  m = s.match(/^(\d\d)\.(\d\d)\.(\d{4})(?:[ T](\d\d?):(\d\d)(?::(\d\d))?)?$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}+03:00`;
  return s;
}

function feedsValue(tag, v) {
  let s = String(v).trim();
  if (tag === 'Price') s = s.replace(/[\s\u00a0]/g, '');
  // BananLab writes Russian mobile numbers as 8XXXXXXXXXX; keep the feed identical to theirs.
  if (tag === 'ContactPhone' && /^7\d{10}$/.test(s)) s = '8' + s.slice(1);
  return s;
}

const feedsLines = (v) => String(v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const feedsOptions = (v) => String(v).split(/\s*\|\s*|\r?\n/).map((s) => s.trim()).filter(Boolean);

// imageUrl(src) → URL for the XML, or null when the link isn't understood.
function feedsBuildXml(ads, imageUrl) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<Ads formatVersion="3" target="Avito.ru">'];
  const problems = [];
  for (const ad of ads) {
    out.push('  <Ad>');
    for (const f of ad.fields) {
      const t = f.tag;
      if (t === 'Images') {
        const urls = [];
        for (const src of feedsLines(f.value)) {
          const u = imageUrl(src);
          if (u) urls.push(u);
          else problems.push({ tab: ad.tab, row: ad.row, id: ad.id, msg: 'Не понятна ссылка на фото: ' + src.slice(0, 120) });
        }
        if (!urls.length) continue;
        out.push('    <Images>');
        for (const u of urls.slice(0, 30)) out.push(`      <Image url="${feedsXmlText(u)}"/>`);
        out.push('    </Images>');
      } else if (t === 'Description') {
        out.push(`    <Description><![CDATA[${String(f.value).replace(/]]>/g, ']]]]><![CDATA[>')}]]></Description>`);
      } else if (f.multi) {
        out.push(`    <${t}>`);
        for (const o of feedsOptions(f.value)) out.push(`      <Option>${feedsXmlText(o)}</Option>`);
        out.push(`    </${t}>`);
      } else if (t === 'DateBegin' || t === 'DateEnd') {
        out.push(`    <${t}>${feedsXmlText(feedsDate(f.value))}</${t}>`);
      } else {
        out.push(`    <${t}>${feedsXmlText(feedsValue(t, f.value))}</${t}>`);
      }
    }
    out.push('  </Ad>');
  }
  out.push('</Ads>', '');
  return { xml: out.join('\n'), problems };
}

// A Yandex.Disk link → { kind: 'p', path } (private, needs the token) or { kind: 'u', key } (public).
function feedsYandexSource(src) {
  let u;
  try { u = new URL(src.trim()); } catch { return null; }
  if (!/(^|\.)disk\.yandex\.(ru|com)$|^disk\.360\.yandex\.ru$|^yadi\.sk$/.test(u.hostname)) return null;
  if (u.hostname === 'yadi.sk' || /^\/(i|d)\//.test(u.pathname)) return { kind: 'u', key: u.origin + u.pathname };
  const dlg = u.searchParams.get('idDialog');
  if (dlg && dlg.startsWith('/disk/')) return { kind: 'p', path: 'disk:' + dlg.slice(5) };
  const m = decodeURIComponent(u.pathname).match(/^\/client\/disk(\/.+\.[A-Za-z0-9]{2,5})$/);
  if (m) return { kind: 'p', path: 'disk:' + m[1] };
  return null;
}

async function feedsBuild(env, feed) {
  const t0 = Date.now();
  const kv = env.AVITO_KV;
  const stat = { builtAt: new Date().toISOString(), ads: 0, tabs: [], problems: [], yandexToken: false };
  let ads = [];
  try {
    const { tabs, missing, allTabs } = await feedsReadTabs(env, feed.sheetId, [...feed.tabs, FEEDS_YD_TAB]);
    for (const name of feed.tabs) {
      if (missing.includes(name)) {
        stat.tabs.push({ name, ads: 0, error: 'Нет такой вкладки. В таблице есть: ' + allTabs.join(', ') });
        continue;
      }
      const parsed = feedsParseTab(tabs[name]);
      parsed.ads.forEach((a) => { a.tab = name; });
      parsed.problems.forEach((p) => stat.problems.push({ tab: name, ...p }));
      stat.tabs.push({ name, ads: parsed.ads.length });
      ads = ads.concat(parsed.ads);
    }
    const ydRows = tabs[FEEDS_YD_TAB];
    const ytok = ydRows && ydRows[1] && String(ydRows[1][0] || '').trim();
    if (ytok && /^[A-Za-z0-9_.-]{20,}$/.test(ytok)) {
      stat.yandexToken = true;
      if ((await kv.get('feedytok:' + feed.slug)) !== ytok) await kv.put('feedytok:' + feed.slug, ytok);
    }
  } catch (err) {
    stat.error = String(err && err.message || err);
    stat.ms = Date.now() - t0;
    await kv.put('feedstat:' + feed.slug, JSON.stringify(stat));
    return stat;
  }

  const seen = new Map();
  ads = ads.filter((a) => {
    if (seen.has(a.id)) {
      const first = seen.get(a.id);
      stat.problems.push({ tab: a.tab, row: a.row, id: a.id, msg: `Повтор id — уже есть на вкладке «${first.tab}», строка ${first.row}. Строка пропущена.` });
      return false;
    }
    seen.set(a.id, a);
    return true;
  });

  // Sign every Yandex link up front (crypto is async), then build the XML synchronously.
  const signed = new Map();
  for (const a of ads) for (const f of a.fields) if (f.tag === 'Images') {
    for (const src of feedsLines(f.value)) {
      if (signed.has(src)) continue;
      const y = feedsYandexSource(src);
      if (!y) { signed.set(src, /^https?:\/\//i.test(src) ? src : null); continue; }
      if (y.kind === 'p' && !stat.yandexToken) { signed.set(src, null); continue; }
      const enc = feedsB64url(y.kind === 'p' ? 'p:' + y.path : 'u:' + y.key);
      const name = (y.path || y.key).split('/').pop();
      const ext = ((name.match(/\.(jpe?g|png|webp|heic)$/i) || [])[1] || 'jpg').toLowerCase();
      signed.set(src, feedsPublicUrl(env, `/feed/${feed.slug}/img/${await feedsSign(feed.secret, enc)}/${enc}.${ext}`));
    }
  }
  const { xml, problems } = feedsBuildXml(ads, (src) => signed.get(src) || null);
  if (!stat.yandexToken && [...signed.entries()].some(([src, u]) => !u && feedsYandexSource(src))) {
    stat.problems.unshift({ msg: `Ссылки на закрытые файлы Яндекс.Диска есть, а токена нет: вставьте его в ячейку A2 вкладки «${FEEDS_YD_TAB}».` });
  }
  stat.problems = stat.problems.concat(problems).slice(0, 300);
  stat.ads = ads.length;
  stat.ms = Date.now() - t0;
  await kv.put('feedxml:' + feed.slug, xml);
  await kv.put('feedstat:' + feed.slug, JSON.stringify(stat));
  return stat;
}

/* ── Public endpoints: the feed and its photos ── */

async function handleFeedPublic(request, env, url) {
  const m = url.pathname.match(/^\/feed\/([a-z0-9-]{4,60})\/(?:avito\.xml|img\/([0-9a-f]{20})\/([A-Za-z0-9_-]+)\.[a-z]{3,4})$/);
  if (!m || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response('Not found', { status: 404 });
  const [, slug, sig, enc] = m;
  const feed = await env.AVITO_KV.get('feed:' + slug, 'json');
  if (!feed) return new Response('Not found', { status: 404 });

  if (!sig) {
    let xml = await env.AVITO_KV.get('feedxml:' + slug);
    if (xml == null) {
      await feedsBuild(env, feed);
      xml = await env.AVITO_KV.get('feedxml:' + slug);
    }
    if (xml == null) return new Response('Feed is not built yet', { status: 503 });
    return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }

  if ((await feedsSign(feed.secret, enc)) !== sig) return new Response('Not found', { status: 404 });
  const src = feedsB64urlDecode(enc);
  let api;
  const headers = {};
  if (src.startsWith('p:')) {
    const tok = await env.AVITO_KV.get('feedytok:' + slug);
    if (!tok) return new Response('No Yandex.Disk token', { status: 404 });
    headers.Authorization = 'OAuth ' + tok;
    api = 'https://cloud-api.yandex.net/v1/disk/resources/download?path=' + encodeURIComponent(src.slice(2));
  } else {
    api = 'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=' + encodeURIComponent(src.slice(2));
  }
  const link = await fetch(api, { headers });
  const data = await link.json().catch(() => ({}));
  if (!link.ok || !data.href) return new Response('Photo not found on Yandex.Disk', { status: 404 });
  const file = await fetch(data.href);
  if (!file.ok) return new Response('Photo not available', { status: 502 });
  return new Response(file.body, {
    headers: { 'Content-Type': file.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=2592000', 'X-Robots-Tag': 'noindex' },
  });
}

/* ── Staff API ── */

function feedsPublicView(env, feed, stat) {
  const { secret, ...rest } = feed;
  return { ...rest, feedUrl: feedsPublicUrl(env, `/feed/${feed.slug}/avito.xml`), sheetUrl: `https://docs.google.com/spreadsheets/d/${feed.sheetId}/edit`, stat: stat || null };
}

function feedsCleanTabs(tabs) {
  const list = (Array.isArray(tabs) ? tabs : String(tabs || '').split(/\r?\n|,/)).map((t) => String(t).trim()).filter(Boolean);
  return [...new Set(list)].slice(0, FEEDS_MAX_TABS);
}

async function feedsAvitoAccount(env, feed) {
  if (!feed.avitoAccountId) throw new Error('К клиенту не привязан аккаунт Авито. Выберите его в «Редактировать».');
  const account = await env.AVITO_KV.get('account:' + feed.avitoAccountId, 'json');
  if (!account) throw new Error('Привязанный аккаунт Авито удалён. Выберите другой.');
  return { account, token: await avitoGetToken(env, account) };
}

async function handleFeedsApi(request, env, url) {
  if (!feedsAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  const kv = env.AVITO_KV;
  const parts = url.pathname.replace(/^\/api\/dashboard\/feeds\/?/, '').split('/').filter(Boolean);

  if (!parts.length && request.method === 'GET') {
    const feeds = [];
    let cursor;
    do {
      const page = await kv.list({ prefix: 'feed:', cursor });
      for (const k of page.keys) {
        const feed = await kv.get(k.name, 'json');
        if (feed) feeds.push(feedsPublicView(env, feed, await kv.get('feedstat:' + feed.slug, 'json')));
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    feeds.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    const accounts = [];
    const acc = await kv.list({ prefix: 'account:' });
    for (const k of acc.keys) {
      const a = await kv.get(k.name, 'json');
      if (a) accounts.push({ id: a.id, name: a.name });
    }
    return json({ feeds, accounts, serviceAccount: feedsServiceEmail(env) || null });
  }

  if (parts[0] === 'tabs' && request.method === 'GET') {
    const sheetId = feedsSheetId(url.searchParams.get('sheet'));
    if (!sheetId) return json({ error: 'Это не ссылка на Google Таблицу' }, 400);
    try {
      return json({ tabs: (await feedsListTabs(env, sheetId)).map((t) => t.name) });
    } catch (err) {
      return json({ error: String(err.message || err) }, 400);
    }
  }

  if (!parts.length && request.method === 'POST') {
    const body = (await readJson(request)) || {};
    const name = String(body.name || '').trim().slice(0, 60);
    const sheetId = feedsSheetId(body.sheetUrl);
    const tabs = feedsCleanTabs(body.tabs);
    if (!name) return json({ error: 'Укажите имя клиента' }, 400);
    if (!sheetId) return json({ error: 'Вставьте ссылку на Google Таблицу из адресной строки' }, 400);
    if (!tabs.length) return json({ error: 'Укажите хотя бы одну вкладку с объявлениями' }, 400);
    const now = new Date().toISOString();
    const feed = { slug: feedsSlug(name), name, sheetId, tabs, enabled: true, avitoAccountId: String(body.avitoAccountId || '') || null, secret: randomHex(16), createdAt: now, updatedAt: now };
    await kv.put('feed:' + feed.slug, JSON.stringify(feed));
    const stat = await feedsBuild(env, feed);
    return json({ feed: feedsPublicView(env, feed, stat) });
  }

  const slug = parts[0];
  const feed = slug && (await kv.get('feed:' + slug, 'json'));
  if (!feed) return json({ error: 'not_found' }, 404);

  if (parts.length === 1 && request.method === 'PUT') {
    const body = (await readJson(request)) || {};
    if (body.name !== undefined) feed.name = String(body.name).trim().slice(0, 60) || feed.name;
    if (body.sheetUrl !== undefined) {
      const id = feedsSheetId(body.sheetUrl);
      if (!id) return json({ error: 'Вставьте ссылку на Google Таблицу из адресной строки' }, 400);
      feed.sheetId = id;
    }
    if (body.tabs !== undefined) {
      const tabs = feedsCleanTabs(body.tabs);
      if (!tabs.length) return json({ error: 'Укажите хотя бы одну вкладку с объявлениями' }, 400);
      feed.tabs = tabs;
    }
    if (body.enabled !== undefined) feed.enabled = !!body.enabled;
    if (body.avitoAccountId !== undefined) feed.avitoAccountId = String(body.avitoAccountId || '') || null;
    feed.updatedAt = new Date().toISOString();
    await kv.put('feed:' + slug, JSON.stringify(feed));
    return json({ feed: feedsPublicView(env, feed, await kv.get('feedstat:' + slug, 'json')) });
  }

  if (parts.length === 1 && request.method === 'DELETE') {
    await Promise.all(['feed:', 'feedxml:', 'feedstat:', 'feedytok:'].map((p) => kv.delete(p + slug)));
    return json({ ok: true });
  }

  if (parts[1] === 'build' && request.method === 'POST') {
    const stat = await feedsBuild(env, feed);
    return json({ feed: feedsPublicView(env, feed, stat) });
  }

  if (parts[1] === 'avito-upload' && request.method === 'POST') {
    try {
      const { token } = await feedsAvitoAccount(env, feed);
      const res = await avitoRequest(token, '/autoload/v1/upload', { method: 'POST' });
      const text = await res.text();
      if (!res.ok) return json({ error: `Авито не запустил загрузку (${res.status}). Обновлять можно не чаще раза в час. ${text.slice(0, 200)}` }, 400);
      return json({ ok: true });
    } catch (err) {
      return json({ error: String(err.message || err) }, 400);
    }
  }

  if (parts[1] === 'avito-connect' && request.method === 'POST') {
    try {
      const { token } = await feedsAvitoAccount(env, feed);
      const input = (await readJson(request)) || {};
      const before = await avitoJson(token, '/autoload/v2/profile').catch(() => null);
      const reportEmail = String(input.reportEmail || (before && before.report_email) || '').trim();
      if (!isValidEmail(reportEmail)) return json({ error: 'Укажите почту, на которую Авито будет присылать отчёты автозагрузки' }, 400);
      const feedUrl = feedsPublicUrl(env, `/feed/${feed.slug}/avito.xml`);
      const body = {
        autoload_enabled: true,
        report_email: reportEmail,
        feeds_data: [{ feed_name: 'Cantor', feed_url: feedUrl }],
        schedule: (before && Array.isArray(before.schedule) && before.schedule.length)
          ? before.schedule
          : [{ rate: 20000, weekdays: [0, 1, 2, 3, 4, 5, 6], time_slots: [...Array(24).keys()] }],
      };
      const res = await avitoRequest(token, '/autoload/v2/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await res.text();
      if (!res.ok) return json({ error: `Авито не сохранил настройки автозагрузки (${res.status}): ${text.slice(0, 300)}` }, 400);
      return json({ ok: true, feedUrl, previousFeeds: (before && before.feeds_data) || (before && before.upload_url ? [{ feed_url: before.upload_url }] : []) });
    } catch (err) {
      return json({ error: String(err.message || err) }, 400);
    }
  }

  return json({ error: 'not_found' }, 404);
}

// Rebuilds enabled feeds older than ~an hour, a few per tick so one run stays well inside the limits.
async function feedsCron(env) {
  const kv = env.AVITO_KV;
  const page = await kv.list({ prefix: 'feed:' });
  let done = 0;
  for (const k of page.keys) {
    if (done >= 5) break;
    const feed = await kv.get(k.name, 'json');
    if (!feed || !feed.enabled) continue;
    const stat = await kv.get('feedstat:' + feed.slug, 'json');
    if (stat && Date.now() - Date.parse(stat.builtAt) < FEEDS_REBUILD_MS) continue;
    await feedsBuild(env, feed).catch((err) => console.error('feed build failed', feed.slug, err && err.stack));
    done++;
  }
}

function withNoIndexHeader(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    avitoProxySetup(env);

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
    // Asking the assets binding for /mba-mybrand/index.html answers with a 307 back to
    // /mba-mybrand/ (its html_handling strips "index.html"), which this branch would then
    // rewrite again — an endless redirect on the workers.dev domain. Ask for the directory.
    if (url.pathname === '/mba-mybrand' || url.pathname === '/mba-mybrand/') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/mba-mybrand/';
      return withNoIndexHeader(withHtmlContentType(await env.ASSETS.fetch(new Request(assetUrl, request))));
    }

    // Avito autoload feeds and their photos (see "Avito feeds"): Avito fetches these itself.
    if (url.pathname.startsWith('/feed/')) {
      try {
        return await handleFeedPublic(request, env, url);
      } catch (err) {
        return new Response(`Server error: ${String(err && err.message)}`, { status: 500 });
      }
    }

    if (!url.pathname.startsWith('/api/')) {
      const response = withHtmlContentType(await env.ASSETS.fetch(request));
      return NOINDEX_ALLOWED_PATHS.has(url.pathname) ? response : withNoIndexHeader(response);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      return await handleApi(request, env, url, ctx);
    } catch (err) {
      return json({ error: 'server_error', message: String(err && err.message) }, 500);
    }
  },

  // Cron trigger (wrangler.jsonc "triggers") — drives the control bot: AI queue, deadline checks, summaries.
  async scheduled(event, env, ctx) {
    avitoProxySetup(env);
    if (!(await cronClaimTick(env, event && event.scheduledTime))) return;
    ctx.waitUntil(botScheduled(env).catch((err) => console.error('control bot cron failed', err && err.stack)));
    ctx.waitUntil(avitoPullCron(env).catch((err) => console.error('avito pull cron failed', err && err.stack)));
    ctx.waitUntil(avitoNotifyCron(env).catch((err) => console.error('avito notify cron failed', err && err.stack)));
    ctx.waitUntil(atKbCron(env).catch((err) => console.error('knowledge-base cron failed', err && err.stack)));
    ctx.waitUntil(waiCron(env).catch((err) => console.error('workers ai jobs cron failed', err && err.stack)));
    ctx.waitUntil(feedsCron(env).catch((err) => console.error('avito feeds cron failed', err && err.stack)));
    ctx.waitUntil(finRemindCron(env).catch((err) => console.error('finance reminders cron failed', err && err.stack)));
  },
};
