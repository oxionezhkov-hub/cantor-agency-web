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
 * It also powers /sales-crm: a one-screen, spreadsheet-style CRM for Avito sales leads —
 * every client is a table row (name, Telegram handle with a jump-to-dialog button, priority
 * color, dialog-stage status, free-text comment) edited inline, no client-detail page. Every
 * cell edit is timestamped and diffed into a history log (never rendered in the table, only
 * pulled by the "download full history" export). Rows with a stale updatedAt are highlighted
 * client-side so leads don't go cold unnoticed. Shares the AVITO_KV namespace since it's the
 * same Avito sales-leads domain, under its own key prefix:
 *
 * KV keys (binding "AVITO_KV", sales-crm prefix):
 *   salescrm:client:<id>              -> { id, name, telegram, priority, status, group, comment, createdAt, updatedAt }
 *                                          (group: one of РЕПБИЗ / ВЕБИНАР / НОВЫЕ — lead source)
 *   salescrm:history:<id>:<ts>:<rand> -> { clientId, clientName, ts, action, field, oldValue, newValue }
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
 *                                     one "📄 Ежедневный отчёт" request; the Claude Code routine
 *                                     (REPORT_ROUTINE_ID) reads/answers it via /api/report-jobs/<id>
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
const SALES_CRM_FIELDS = ['name', 'telegram', 'priority', 'status', 'group', 'comment'];

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
      if (value === existing[field]) continue;
      historyEntries.push({ action: 'update', field, oldValue: existing[field] ?? null, newValue: value });
      updated[field] = value;
    }

    if (!historyEntries.length) return json({ client: existing });

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
    await salesCrmHistoryAppend(kv, id, existing.name, [{ action: 'delete', field: null, oldValue: null, newValue: null }]);
    return json({ ok: true });
  }

  if (pathname === '/api/salescrm/history' && request.method === 'GET') {
    const list = await kv.list({ prefix: 'salescrm:history:' });
    const records = await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')));
    const history = records.filter(Boolean).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return json({ history });
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
      avitoAccountId: existing.avitoAccountId || null,
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
    return json({ task });
  }

  if (pathname === '/api/dashboard/task' && request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'missing_id' }, 400);
    await kv.delete(`task:${id}`);
    return json({ ok: true });
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
    await kv.put(`project:${projectId}`, JSON.stringify({ ...project, avitoAccountId: accountId, updatedAt: new Date().toISOString() }));
    return json(await dashboardAvitoLinks(env, kv));
  }

  if (pathname === '/api/dashboard/avito-import' && request.method === 'POST') {
    const body = await readJson(request);
    const text = body && String(body.text || '');
    if (!text.trim()) return json({ error: 'empty' }, 400);
    const results = await importAvitoCredentials(env, kv, text);
    return json({ results, ...(await dashboardAvitoLinks(env, kv)) });
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

  // ── Daily report via the Claude Code routine ──
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
    await fireReportRoutine(env, kv, job, url.origin);
    return json({ job: publicReportJob(job) });
  }

  if (pathname === '/api/dashboard/report-job' && request.method === 'GET') {
    const job = await kv.get(`reportJob:${url.searchParams.get('id')}`, 'json');
    if (!job) return json({ error: 'not_found' }, 404);
    return json({ job: publicReportJob(job) });
  }

  if (pathname === '/api/dashboard/report-last' && request.method === 'GET') {
    return json({ lastTo: await kv.get('reportLastTo'), yesterday: mskYesterday() });
  }

  if (pathname === '/api/dashboard/report-job/file' && request.method === 'GET') {
    const job = await kv.get(`reportJob:${url.searchParams.get('id')}`, 'json');
    if (!job) return json({ error: 'not_found' }, 404);
    // Without the routine's observations (not configured / still running / failed) the
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

/* ═══════════════ Dashboard: Avito auto-pull + daily report routine ═══════════════ */

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
// endpoint being unavailable on a cabinet doesn't blank out the rest of the row.
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

  // 3) Spend fallback: the wallet's operations history for that day (everything that isn't
  // a top-up / refund is money written off for placement or promotion).
  if (out.spend == null) {
    try {
      const data = await avitoJson(token, '/core/v1/accounts/operations_history/', {
        method: 'POST',
        body: JSON.stringify({ dateTimeFrom: `${date}T00:00:00`, dateTimeTo: `${date}T23:59:59` }),
      });
      const ops = (data.result && data.result.operations) || data.operations || [];
      const spent = ops
        .filter((op) => !/пополн|возврат|зачисл|refund|deposit/i.test(`${op.operationType || ''} ${op.operationName || ''}`))
        .reduce((sum, op) => sum + Math.abs(Number(op.amountTotal ?? (Number(op.amountRub || 0) + Number(op.amountBonus || 0))) || 0), 0);
      out.spend = Math.round(spent);
      sources.spend = 'operations_history';
    } catch (e) {
      errors.push(`История операций: ${String(e.message).slice(0, 160)}`);
    }
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

// Rule-based "Текущие наблюдения" — the routine rewrites it in natural wording, and this
// is also what the file falls back to if the routine isn't configured or hasn't answered.
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
    .filter((p) => !REPORT_WOUND_DOWN.has(p.id))
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

/* ── Report jobs + the Claude Code routine callback ── */

const REPORT_JOB_TTL = 14 * 24 * 3600;

async function putReportJob(kv, job) {
  await kv.put(`reportJob:${job.id}`, JSON.stringify(job), { expirationTtl: REPORT_JOB_TTL });
}

function publicReportJob(job) {
  const { token, report, observations, ...rest } = job;
  return {
    ...rest,
    periodLabel: report.periodLabel,
    clientsCount: report.clients.length,
    warnings: report.warnings,
    hasObservations: Boolean(observations),
    fileName: reportFileName(job),
  };
}

// Fires the "Ежедневный отчёт" routine (see README note in wrangler.jsonc): its saved
// prompt tells it to GET the job below, write "Текущие наблюдения" for each client and
// POST them back. REPORT_ROUTINE_ID is a plain var, REPORT_ROUTINE_TOKEN an encrypted secret.
async function fireReportRoutine(env, kv, job, origin) {
  if (!env.REPORT_ROUTINE_ID || !env.REPORT_ROUTINE_TOKEN) {
    job.status = 'not_configured';
    job.error = 'Рутина Claude Code не подключена (нет REPORT_ROUTINE_ID / REPORT_ROUTINE_TOKEN) — можно скачать отчёт с автоматическими наблюдениями.';
    job.updatedAt = new Date().toISOString();
    await putReportJob(kv, job);
    return;
  }
  const base = `${origin}/api/report-jobs/${job.id}`;
  const text = [
    'Запрос из дашборда Cantor Agency: ежедневный отчёт по клиентам Авито.',
    `JOB_ID: ${job.id}`,
    `PERIOD: ${job.dateFrom} — ${job.dateTo}`,
    `DATA_URL: ${base}?token=${job.token}`,
    `SUBMIT_URL: ${base}/observations?token=${job.token}`,
  ].join('\n');
  try {
    const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${env.REPORT_ROUTINE_ID}/fire`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.REPORT_ROUTINE_TOKEN}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`routine_fire_${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    job.status = 'sent';
    job.sessionUrl = (data && data.claude_code_session_url) || null;
  } catch (e) {
    job.status = 'failed';
    job.error = `Не удалось запустить рутину: ${String(e && e.message)}`;
  }
  job.updatedAt = new Date().toISOString();
  await putReportJob(kv, job);
}

// Called by the routine's cloud session — authorised by the per-job random token that was
// only ever sent inside the routine fire payload (not by the dashboard password).
async function handleReportJobCallback(request, env, url) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const match = url.pathname.match(/^\/api\/report-jobs\/([a-f0-9]{12})(\/observations)?$/);
  if (!match) return json({ error: 'not_found' }, 404);
  const job = await kv.get(`reportJob:${match[1]}`, 'json');
  if (!job || !url.searchParams.get('token') || url.searchParams.get('token') !== job.token) {
    return json({ error: 'not_found' }, 404);
  }

  if (!match[2] && request.method === 'GET') {
    if (job.status === 'sent') {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      await putReportJob(kv, job);
    }
    return json({
      jobId: job.id,
      instructions: 'Для каждого клиента из clients[] напиши одно предложение «Текущие наблюдения» по правилам из промпта рутины (опираясь на month.conversionPct, month.cpl и last3). draftObservation — механический черновик, его можно улучшить формулировкой, но не менять факты. Отправь POST на SUBMIT_URL: {"observations": {"<projectId>": "<текст>", ...}}.',
      report: job.report,
    });
  }

  if (match[2] && request.method === 'POST') {
    const body = await readJson(request);
    const obs = body && body.observations;
    if (!obs || typeof obs !== 'object') return json({ error: 'missing_observations' }, 400);
    const known = new Set(job.report.clients.map((c) => c.projectId));
    const clean = {};
    Object.entries(obs).forEach(([id, text]) => {
      if (known.has(id) && typeof text === 'string' && text.trim()) clean[id] = text.trim().slice(0, 600);
    });
    job.observations = clean;
    job.status = 'done';
    job.error = null;
    job.updatedAt = new Date().toISOString();
    await putReportJob(kv, job);
    return json({ ok: true, accepted: Object.keys(clean).length, missing: [...known].filter((id) => !clean[id]) });
  }

  return json({ error: 'not_found' }, 404);
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
//   bot:log:<chatId>:<threadId>:<YYYY-MM-DD> -> [{ id, t, from, fromId, text, reply }]  (MSK day, 180-day TTL)
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

const BOT_SETUP_VERSION = '1';
const BOT_WORKER_ORIGIN = 'https://mainweb.oxion-ezhkov.workers.dev';
const BOT_AI_MODEL_DEFAULT = '@cf/qwen/qwen3-30b-a3b-fp8';
const BOT_LOG_TTL = 60 * 60 * 24 * 180;
const BOT_MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const BOT_WORK_START_H = 10;
const BOT_WORK_END_H = 18;
const BOT_NO_DUE_AFTER_WMIN = 120;      // task without a deadline after 2 working hours
const BOT_CLIENT_REPLY_WMIN = 30;       // client message unanswered for 30 working minutes
const BOT_NOT_INFORMED_WMIN = 8 * 60;   // done but not reported to the client after 1 working day
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
  { command: 'tasks', description: 'Открытые задачи по клиентам' },
  { command: 'overdue', description: 'Просроченные задачи' },
  { command: 'metrics', description: 'Проверка метрик из дашборда' },
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
async function botNotifyOwner(env, text, extra = {}) {
  const chunks = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if ((cur + '\n' + line).length > 3800 && cur) { chunks.push(cur); cur = line; } else { cur = cur ? cur + '\n' + line : line; }
  }
  if (cur) chunks.push(cur);
  for (const id of botOwnerIds(env)) {
    for (const chunk of chunks) {
      await botApi(env, 'sendMessage', { chat_id: id, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    }
  }
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
    allowed_updates: ['message', 'edited_message', 'my_chat_member'],
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
  return bySurname.length === 1 ? bySurname[0] : null;
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
async function botSetTopicName(kv, chatId, threadId, name) {
  const key = `bot:topic:${chatId}:${threadId}`;
  const prev = (await kv.get(key, 'json')) || {};
  const project = botMatchProject(name, await botProjects(kv));
  const rec = { name, projectId: prev.projectLocked ? prev.projectId : project ? project.id : null, projectLocked: !!prev.projectLocked };
  await kv.put(key, JSON.stringify(rec));
  return rec;
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
    else if (update && update.message) await botOnMessage(env, update.message, false);
    else if (update && update.edited_message) await botOnMessage(env, update.edited_message, true);
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
    await botNotifyOwner(env, `ℹ️ Бота убрали из чата «${title}» (${escapeHtml(botUserName(upd.from))}).`);
    return;
  }
  if (!botIsOwner(env, upd.from && upd.from.id) && !(await kv.get(`bot:chat:${chat.id}`))) {
    await botApi(env, 'leaveChat', { chat_id: chat.id });
    await botNotifyOwner(env, `⚠️ ${escapeHtml(botUserName(upd.from))} добавил(а) бота в «${title}». Бот вышел: добавлять его может только владелец.`);
    return;
  }
  const rec = await botGetChat(kv, chat);
  const adminHint = status === 'administrator' ? '' : '\nСделайте бота администратором группы — иначе он видит не все сообщения.';
  const kindText = rec.kind === 'work' ? 'рабочий чат (топики = клиенты)' : `чат клиента${rec.projectId ? ` → ${escapeHtml(rec.projectId)}` : ' (клиент не определён — см. /topics)'}`;
  await botNotifyOwner(env, `✅ Бот подключён к «${title}»: ${kindText}.${adminHint}`);
}

async function botOnMessage(env, msg, edited) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const chat = msg.chat;
  if (!chat) return;

  if (chat.type === 'private') {
    if (edited) return;
    if (botIsOwner(env, msg.from && msg.from.id)) return botOnOwnerMessage(env, msg);
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
    await botSetTopicName(kv, chat.id, msg.message_thread_id || msg.message_id, msg.forum_topic_created.name);
    return;
  }
  if (msg.forum_topic_edited && msg.forum_topic_edited.name) {
    await botSetTopicName(kv, chat.id, msg.message_thread_id || threadId, msg.forum_topic_edited.name);
    return;
  }
  // Learn a topic's name from the topic root a message replies to.
  const root = msg.reply_to_message && msg.reply_to_message.forum_topic_created;
  if (root && threadId) {
    const known = await kv.get(`bot:topic:${chat.id}:${threadId}`, 'json');
    if (!known || known.name !== root.name) await botSetTopicName(kv, chat.id, threadId, root.name);
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

  if (chatRec.kind === 'client' && !edited) {
    const pendingKey = `bot:pending:${chat.id}`;
    if (isTeam) {
      if (await kv.get(pendingKey)) await kv.delete(pendingKey);
      const { date, hh } = botMsk(t);
      const reportKey = `bot:report:${chat.id}:${date}`;
      if (hh < 13 && /отч[её]т|бюджет[\s\S]*контакт/i.test(text) && !(await kv.get(reportKey))) {
        await kv.put(reportKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });
      }
    } else if (!(await kv.get(pendingKey))) {
      await kv.put(pendingKey, JSON.stringify({ since: t, msgId: msg.message_id, text: text.slice(0, 300) }));
    }
  }
}

// ── owner's private chat ──
async function botOnOwnerMessage(env, msg) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const text = String(msg.text || '').trim();
  const reply = (body) => botApi(env, 'sendMessage', { chat_id: msg.chat.id, text: body, parse_mode: 'HTML', disable_web_page_preview: true });
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.startsWith('/') ? cmdRaw.slice(1).split('@')[0].toLowerCase() : null;

  if (cmd === 'start' || cmd === 'help') {
    return reply([
      '<b>Помощник Cantor Agency</b>',
      'Я молча читаю рабочий чат (и чаты клиентов, куда меня добавят), сам нахожу задачи, сроки и выполнение и пишу только вам.',
      '',
      '/summary — просрочено, без срока, сделано но не сообщили клиенту',
      '/tasks — открытые задачи по клиентам',
      '/overdue — просроченные',
      '/metrics — проверка метрик из дашборда',
      '/topics — какие чаты и топики к каким клиентам привязаны',
      '/ai — статус ИИ и очереди',
      '/done &lt;id&gt; · /informed &lt;id&gt; · /cancel &lt;id&gt; — поправить задачу вручную',
      '/map &lt;чат:топик&gt; &lt;id клиента&gt; — привязать топик или чат к клиенту',
      '',
      'Любой другой текст — вопрос по переписке, например: «что мы обещали Агешиной на этой неделе?»',
    ].join('\n'));
  }
  if (cmd === 'summary') return reply(await botBuildSummary(env, Date.now()));
  if (cmd === 'tasks') return reply(await botBuildTaskList(env, 'open'));
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
    return reply(`Привязал ${escapeHtml(target)} → ${escapeHtml(projectId)}.`);
  }
  if (cmd) return reply('Не знаю такой команды. /help — список.');
  if (!text) return;
  return reply(await botAnswerQuestion(env, text));
}

function botStatusLabel(task) {
  return { open: 'открыта', done: 'сделана, клиенту не сообщили', closed: 'закрыта', cancelled: 'отменена' }[task.status] || task.status;
}
async function botAllTasks(kv) {
  return (await listByPrefix(kv, 'task:')).filter((t) => t.source === 'bot');
}
function botTaskLine(task, projectsById, nowMs) {
  const due = botDueMs(task);
  const client = task.projectId && projectsById[task.projectId] ? projectsById[task.projectId].name : task.topicName || 'без клиента';
  const parts = [`• <b>${escapeHtml(client)}</b>: ${escapeHtml(task.text)}`];
  if (task.owner) parts.push(`— ${escapeHtml(task.owner)}`);
  if (due) parts.push(due < nowMs ? `⏰ был срок ${botFmtDate(due)}` : `срок ${botFmtDate(due)}`);
  else parts.push('без срока');
  if (task.link) parts.push(`<a href="${escapeHtml(task.link)}">сообщение</a>`);
  parts.push(`<code>${escapeHtml(task.id)}</code>`);
  return parts.join(' ');
}
async function botProjectsById(kv) {
  const byId = {};
  for (const p of await botProjects(kv)) byId[p.id] = p;
  return byId;
}
async function botBuildTaskList(env, mode) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const now = Date.now();
  const byId = await botProjectsById(kv);
  let tasks = (await botAllTasks(kv)).filter((t) => t.status === 'open');
  if (mode === 'overdue') tasks = tasks.filter((t) => botDueMs(t) && botDueMs(t) < now);
  if (!tasks.length) return mode === 'overdue' ? 'Просроченных задач нет 👌' : 'Открытых задач нет.';
  tasks.sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || (botDueMs(a) || Infinity) - (botDueMs(b) || Infinity));
  const title = mode === 'overdue' ? `🔴 Просрочено: ${tasks.length}` : `📋 Открытые задачи: ${tasks.length}`;
  return [title, ...tasks.map((t) => botTaskLine(t, byId, now))].join('\n');
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
  lines.push('', 'Клиенты в дашборде: ' + Object.values(byId).map((p) => `${escapeHtml(p.name)} <code>${escapeHtml(p.id)}</code>`).join(', '));
  return lines.join('\n');
}

// ── Workers AI ──
function botIsLimitError(err) {
  const s = String((err && (err.message || err)) || '');
  return /neuron|allocation|quota|limit|exceeded|4006|capacity|429/i.test(s);
}
async function botAi(env, system, user, maxTokens) {
  if (!env.AI) throw new Error('AI binding is not configured');
  const res = await env.AI.run(env.CONTROL_BOT_AI_MODEL || BOT_AI_MODEL_DEFAULT, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: `${user}\n\n/no_think` }],
    max_tokens: maxTokens || 1500,
    temperature: 0.1,
  });
  let out = '';
  if (typeof res === 'string') out = res;
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
  'статистика без просьбы — не задачи.',
  'Тебе дают новые сообщения из одного топика/чата, контекст до них и список открытых задач этого клиента.',
  'Верни ТОЛЬКО JSON без пояснений:',
  '{"events":[',
  ' {"type":"new_task","msg":<id сообщения>,"text":"<суть задачи до 15 слов>","assignee":"<имя исполнителя или null>","due":"<YYYY-MM-DD HH:MM или null>"},',
  ' {"type":"update","task":"<id открытой задачи>","msg":<id сообщения>,"status":"taken|done|informed|cancelled","assignee":"<имя или null>","due":"<YYYY-MM-DD HH:MM или null>"}',
  ']}',
  'taken — кто-то взял задачу или назвал срок; done — сообщили, что сделано; informed — КМ/Олег сообщили клиенту результат;',
  'cancelled — задача больше не нужна. Сроки переводи в абсолютные дату и время по Москве («до завтра» = завтра 18:00,',
  '«сегодня» = сегодня 18:00, «через час» = время сообщения + 1 час). Не выдумывай: если срока нет — null.',
  'Если сообщение продолжает уже известную задачу — используй update, а не new_task. Если событий нет — {"events":[]}.',
].join('\n');

function botFormatLogLines(entries) {
  return entries.map((e) => `[${e.id}] ${botFmtDate(e.t)} ${e.from}${e.team === false ? ' (клиент)' : ''}${e.reply ? ` (ответ на ${e.reply})` : ''}: ${String(e.text).replace(/\s+/g, ' ').slice(0, 700)}`).join('\n');
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
    const unseen = logs.filter((e) => e.id > cursor);
    if (!unseen.length) continue;
    const fresh = unseen.slice(0, BOT_AI_BATCH_MESSAGES);
    if (unseen.length > fresh.length) await kv.put(k.name, '1'); // the rest goes next run
    const context = logs.filter((e) => e.id <= cursor).slice(-15);

    if (!allTasks) allTasks = await botAllTasks(kv);
    const openTasks = allTasks.filter((t) => (t.status === 'open' || t.status === 'done')
      && ((topic.projectId && t.projectId === topic.projectId) || (String(t.chatId) === String(chatId) && String(t.threadId) === String(threadId))));
    const projectName = topic.projectId && projectsById[topic.projectId] ? projectsById[topic.projectId].name : topic.name;
    const user = [
      `Сейчас: ${botFmtDate(now)}.${botMsk(now).date.slice(0, 4)} (МСК). Сегодня ${['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][botMsk(now).dow]}.`,
      `Чат: ${chatRec.kind === 'work' ? 'рабочий чат агентства, топик клиента' : 'чат с клиентом'} «${projectName}».`,
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
        await kv.put(cursorKey, String(fresh[fresh.length - 1].id));
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
    await botApplyEvents(env, parsed.events || [], { chatRec, topic, threadId, fresh, openTasks });
    await kv.put(cursorKey, String(fresh[fresh.length - 1].id));
    processed += fresh.length;
  }
  return { processed };
}

async function botApplyEvents(env, events, ctx) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byMsg = new Map(ctx.fresh.map((e) => [e.id, e]));
  const openById = new Map(ctx.openTasks.map((t) => [t.id, t]));
  const nowIso = new Date().toISOString();
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== 'object') continue;
    const src = byMsg.get(Number(ev.msg));
    const dueMs = botParseMskDateTime(ev.due);
    if (ev.type === 'new_task' && ev.text) {
      const msgId = src ? src.id : ctx.fresh[ctx.fresh.length - 1].id;
      const id = `bot${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const task = {
        id,
        text: String(ev.text).slice(0, 300),
        status: 'open',
        owner: ev.assignee && ev.assignee !== 'null' ? String(ev.assignee).slice(0, 80) : null,
        due: dueMs ? botIsoMsk(dueMs) : null,
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
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await kv.put(`task:${id}`, JSON.stringify(task));
      openById.set(id, task);
      ctx.openTasks.push(task);
    } else if (ev.type === 'update' && openById.has(String(ev.task))) {
      const task = openById.get(String(ev.task));
      if (ev.assignee && ev.assignee !== 'null') task.owner = String(ev.assignee).slice(0, 80);
      if (dueMs) task.due = botIsoMsk(dueMs);
      if (ev.status === 'taken' && !task.takenAt) task.takenAt = src ? new Date(src.t).toISOString() : nowIso;
      if (ev.status === 'done' && task.status === 'open') Object.assign(task, { status: 'done', doneAt: src ? new Date(src.t).toISOString() : nowIso });
      if (ev.status === 'informed') Object.assign(task, { status: 'closed', doneAt: task.doneAt || nowIso, informedAt: src ? new Date(src.t).toISOString() : nowIso });
      if (ev.status === 'cancelled') task.status = 'cancelled';
      task.updatedAt = nowIso;
      await kv.put(`task:${task.id}`, JSON.stringify(task));
    }
  }
}

// ── checks & summaries ──
async function botBuildSummary(env, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byId = await botProjectsById(kv);
  const tasks = await botAllTasks(kv);
  const open = tasks.filter((t) => t.status === 'open');
  const overdue = open.filter((t) => botDueMs(t) && botDueMs(t) < nowMs);
  const noDue = open.filter((t) => !botDueMs(t) && botWorkingMinutes(Date.parse(t.startedAt || t.createdAt), nowMs) >= BOT_NO_DUE_AFTER_WMIN);
  const notInformed = tasks.filter((t) => t.status === 'done' && t.doneAt && botWorkingMinutes(Date.parse(t.doneAt), nowMs) >= BOT_NOT_INFORMED_WMIN);
  const pending = [];
  for (const k of (await kv.list({ prefix: 'bot:pending:' })).keys) {
    const p = await kv.get(k.name, 'json');
    const chat = await kv.get(`bot:chat:${k.name.split(':').pop()}`, 'json');
    if (p && chat && botWorkingMinutes(p.since, nowMs) >= BOT_CLIENT_REPLY_WMIN) pending.push(`• <b>${escapeHtml(chat.title)}</b>: «${escapeHtml(p.text.slice(0, 120))}» — ждёт с ${botFmtDate(p.since)}`);
  }
  const perClient = {};
  for (const t of open) {
    const name = (t.projectId && byId[t.projectId] && byId[t.projectId].name) || t.topicName || 'без клиента';
    perClient[name] = (perClient[name] || 0) + 1;
  }
  const state = (await kv.get('bot:ai', 'json')) || {};
  const lines = [`<b>Сводка на ${botFmtDate(nowMs)}</b>`];
  if (state.limited) lines.push('🔴 ИИ на лимите — новые сообщения ещё не разобраны.');
  lines.push('', `🔴 <b>Просрочено: ${overdue.length}</b>`, ...overdue.map((t) => botTaskLine(t, byId, nowMs)));
  lines.push('', `⚪ <b>Без срока дольше 2 рабочих часов: ${noDue.length}</b>`, ...noDue.map((t) => botTaskLine(t, byId, nowMs)));
  lines.push('', `📨 <b>Сделано, но клиенту не сообщили: ${notInformed.length}</b>`, ...notInformed.map((t) => botTaskLine(t, byId, nowMs)));
  if (pending.length) lines.push('', `💬 <b>Клиент ждёт ответа: ${pending.length}</b>`, ...pending);
  lines.push('', `📋 Всего открыто: ${open.length}${Object.keys(perClient).length ? ' — ' + Object.entries(perClient).map(([n, c]) => `${escapeHtml(n)} ${c}`).join(', ') : ''}`);
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

async function botRunChecks(env, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byId = await botProjectsById(kv);
  const { date, hh, mm } = botMsk(nowMs);
  const workday = botIsWorkday(nowMs);
  const inHours = workday && hh >= BOT_WORK_START_H && hh < BOT_WORK_END_H;

  if (inHours) {
    // Newly overdue / still-without-deadline tasks, one message per kind per run.
    const overdue = [];
    const noDue = [];
    for (const task of (await botAllTasks(kv)).filter((t) => t.status === 'open')) {
      task.notified = task.notified || {};
      const due = botDueMs(task);
      let changed = false;
      if (due && due < nowMs && !task.notified.overdue) {
        overdue.push(botTaskLine(task, byId, nowMs));
        task.notified.overdue = new Date(nowMs).toISOString();
        changed = true;
      }
      if (!due && !task.notified.noDue && botWorkingMinutes(Date.parse(task.startedAt || task.createdAt), nowMs) >= BOT_NO_DUE_AFTER_WMIN) {
        noDue.push(botTaskLine(task, byId, nowMs));
        task.notified.noDue = new Date(nowMs).toISOString();
        changed = true;
      }
      if (changed) await kv.put(`task:${task.id}`, JSON.stringify(task));
    }
    if (overdue.length) await botNotifyOwner(env, [`🔴 <b>Срок вышел: ${overdue.length}</b>`, ...overdue].join('\n'));
    if (noDue.length) await botNotifyOwner(env, [`⚪ <b>Без срока уже 2+ рабочих часа: ${noDue.length}</b>`, ...noDue].join('\n'), { disable_notification: true });
    // Client waiting for an answer.
    for (const k of (await kv.list({ prefix: 'bot:pending:' })).keys) {
      const p = await kv.get(k.name, 'json');
      if (!p || botWorkingMinutes(p.since, nowMs) < BOT_CLIENT_REPLY_WMIN) continue;
      const chatId = k.name.split(':').pop();
      if (!(await botOnce(kv, `pending:${chatId}:${p.msgId}`, 60 * 60 * 24 * 7))) continue;
      const chat = await kv.get(`bot:chat:${chatId}`, 'json');
      const link = botMessageLink(chatId, null, p.msgId);
      await botNotifyOwner(env, `💬 <b>${escapeHtml(chat ? chat.title : chatId)}</b>: клиент ждёт ответа больше 30 рабочих минут\n«${escapeHtml(p.text)}»${link ? ` <a href="${link}">сообщение</a>` : ''}`);
    }
  }
  if (!workday) return;
  // 10:00 — morning summary.
  if (hh >= 10 && hh < 12 && (await botOnce(kv, `summary:${date}`, 60 * 60 * 36))) {
    await botNotifyOwner(env, await botBuildSummary(env, nowMs));
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

async function botScheduled(env) {
  if (!env.CONTROL_BOT_TOKEN || !env.AGENCY_DASHBOARD_KV) return;
  const kv = env.AGENCY_DASHBOARD_KV;
  if ((await kv.get('bot:setup')) !== BOT_SETUP_VERSION) {
    const res = await botSetup(env);
    if (res.ok) await botNotifyOwner(env, '👋 Бот запущен и настроен. Добавьте его администратором в рабочий чат — дальше я всё делаю сам. /help — что я умею.');
    else console.error('control bot setup failed', JSON.stringify(res));
  }
  try {
    await botProcessQueue(env);
  } catch (err) {
    console.error('control bot queue failed', err && err.stack);
  }
  await botRunChecks(env, Date.now());
}

// Free-text question from the owner, answered from the last two weeks of logs.
async function botAnswerQuestion(env, question) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const now = Date.now();
  const byId = await botProjectsById(kv);
  const chats = await listByPrefix(kv, 'bot:chat:');
  const sources = [];
  for (const c of chats) {
    if (c.isForum) {
      for (const k of (await kv.list({ prefix: `bot:topic:${c.id}:` })).keys) {
        const rec = await kv.get(k.name, 'json');
        sources.push({ chatId: c.id, threadId: k.name.split(':').pop(), name: (rec && rec.projectId && byId[rec.projectId] && byId[rec.projectId].name) || (rec && rec.name) || '' });
      }
      sources.push({ chatId: c.id, threadId: '0', name: 'Общий топик' });
    } else {
      sources.push({ chatId: c.id, threadId: '0', name: (c.projectId && byId[c.projectId] && byId[c.projectId].name) || c.title });
    }
  }
  const q = ` ${botNorm(question)} `;
  // Match on surname stems ("Агешиной" → "агешин") so declensions still hit.
  const focused = sources.filter((s) => botNorm(s.name).split(' ').some((w) => w.length > 3 && q.includes(w.slice(0, Math.max(4, w.length - 2)))));
  const picked = focused.length ? focused : sources;
  const days = focused.length ? 30 : 7;
  let transcript = '';
  for (const s of picked) {
    const logs = await botReadLogs(kv, s.chatId, s.threadId, now - days * 24 * 3600000, now);
    if (!logs.length) continue;
    transcript += `\n### ${s.name}\n${botFormatLogLines(logs)}\n`;
  }
  if (!transcript) return 'В сохранённой переписке пока ничего нет — бот видит только сообщения после того, как его добавили в чат.';
  if (transcript.length > 45000) transcript = transcript.slice(-45000);
  try {
    const answer = await botAi(env,
      'Ты помощник руководителя агентства Cantor Agency. Отвечай по-русски, коротко и по делу, только по переписке ниже. '
      + 'Ссылайся на сообщения в формате [id]. Если ответа в переписке нет — так и скажи.',
      `Вопрос: ${question}\n\nПереписка (формат: [id] дата автор: текст):\n${transcript}`, 900);
    return escapeHtml(answer || 'Не получилось сформулировать ответ.');
  } catch (err) {
    if (botIsLimitError(err)) { await botSetAiLimited(env, true); return '🔴 Лимит ИИ на сегодня исчерпан — отвечу, когда он обновится.'; }
    return `Ошибка ИИ: ${escapeHtml(err && err.message)}`;
  }
}

// One-time history import from a Telegram Desktop export (the bot can't read messages sent before
// it joined). Loads the logs, topic names and already-known open tasks, and moves each topic's AI
// cursor past the imported messages so the history isn't re-billed to the AI. Sent in chunks
// (one or a few topics per request) to stay within a Worker invocation's KV-operation limit.
//   POST /api/tgbot/import  (x-dashboard-password)
//   { chatId?, topics: { <threadId>: name }, entries: [{ thread, id, t, from, text, reply }], tasks: [...] }
function botRedactSecrets(text) {
  // API keys / client secrets pasted into chats: long unbroken letter+digit runs.
  return String(text || '').replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g, '[скрыто]');
}
async function handleBotImport(request, env) {
  if (!checkDashboardAuth(request)) return json({ error: 'unauthorized' }, 401);
  const kv = env.AGENCY_DASHBOARD_KV;
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_json' }, 400);
  let chatRec = body.chatId ? await kv.get(`bot:chat:${body.chatId}`, 'json') : null;
  if (!chatRec) {
    const forums = (await listByPrefix(kv, 'bot:chat:')).filter((c) => c.isForum);
    if (forums.length !== 1) return json({ error: 'chat_unknown', message: 'Добавьте бота в рабочий чат (или передайте chatId)', forums: forums.map((c) => ({ id: c.id, title: c.title })) }, 409);
    chatRec = forums[0];
  }
  const chatId = chatRec.id;
  const result = { chatId, topics: 0, days: 0, entries: 0, tasks: 0 };

  for (const [thread, name] of Object.entries(body.topics || {})) {
    const key = `bot:topic:${chatId}:${thread}`;
    const known = await kv.get(key, 'json');
    if (!known || /^Топик \d+$/.test(known.name)) { await botSetTopicName(kv, chatId, thread, name); result.topics += 1; }
  }

  const groups = new Map();
  for (const e of Array.isArray(body.entries) ? body.entries : []) {
    if (!e || !Number.isFinite(e.id) || !Number.isFinite(e.t)) continue;
    const thread = String(e.thread || 0);
    const k = `${thread}|${botMsk(e.t).date}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ id: e.id, t: e.t, from: String(e.from || '?'), fromId: null, team: true, text: botRedactSecrets(e.text).slice(0, 4000), reply: e.reply || null, imported: true });
  }
  const maxIdByThread = {};
  for (const [k, list] of groups) {
    const [thread, date] = k.split('|');
    const key = `bot:log:${chatId}:${thread}:${date}`;
    const existing = (await kv.get(key, 'json')) || [];
    const byId = new Map(existing.map((x) => [x.id, x]));
    for (const x of list) if (!byId.has(x.id)) byId.set(x.id, x);
    const merged = [...byId.values()].sort((a, b) => a.t - b.t);
    await kv.put(key, JSON.stringify(merged), { expirationTtl: BOT_LOG_TTL });
    result.days += 1;
    result.entries += list.length;
    maxIdByThread[thread] = Math.max(maxIdByThread[thread] || 0, ...list.map((x) => x.id));
  }
  for (const [thread, maxId] of Object.entries(maxIdByThread)) {
    const key = `bot:cursor:${chatId}:${thread}`;
    const cur = Number(await kv.get(key)) || 0;
    if (maxId > cur) await kv.put(key, String(maxId));
  }

  const nowIso = new Date().toISOString();
  for (const t of Array.isArray(body.tasks) ? body.tasks : []) {
    if (!t || !t.text || !t.importKey) continue;
    const id = `imp${t.importKey}`;
    if (await kv.get(`task:${id}`)) continue;
    const topic = await kv.get(`bot:topic:${chatId}:${t.thread || 0}`, 'json');
    const dueMs = botParseMskDateTime(t.due);
    await kv.put(`task:${id}`, JSON.stringify({
      id,
      text: String(t.text).slice(0, 300),
      status: 'open',
      owner: t.owner || null,
      due: dueMs ? botIsoMsk(dueMs) : null,
      projectId: (topic && topic.projectId) || null,
      topicName: topic ? topic.name : null,
      source: 'bot',
      origin: 'import',
      chatId,
      threadId: Number(t.thread || 0),
      msgId: t.msgId || null,
      link: t.msgId ? botMessageLink(chatId, t.thread, t.msgId) : null,
      author: t.author || null,
      note: t.note || null,
      startedAt: Number.isFinite(t.t) ? new Date(t.t).toISOString() : nowIso,
      // Old backlog: counted in /summary and /tasks, but no individual "no deadline" pings.
      notified: { noDue: nowIso, overdue: dueMs && dueMs < Date.now() ? nowIso : undefined },
      createdAt: nowIso,
      updatedAt: nowIso,
    }));
    result.tasks += 1;
  }
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

  if (pathname.startsWith('/api/salescrm/')) {
    return handleSalesCrmApi(request, env, url);
  }

  if (pathname.startsWith('/api/report-jobs/')) {
    return handleReportJobCallback(request, env, url);
  }

  if (pathname.startsWith('/api/dashboard/')) {
    return handleDashboardApi(request, env, url);
  }

  if (pathname.startsWith('/api/tgbot/')) {
    return handleBotApi(request, env, url);
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

function withNoIndexHeader(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
      return withNoIndexHeader(await env.ASSETS.fetch(new Request(assetUrl, request)));
    }

    if (!url.pathname.startsWith('/api/')) {
      const response = await env.ASSETS.fetch(request);
      return NOINDEX_ALLOWED_PATHS.has(url.pathname) ? response : withNoIndexHeader(response);
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

  // Cron trigger (wrangler.jsonc "triggers") — drives the control bot: AI queue, deadline checks, summaries.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(botScheduled(env).catch((err) => console.error('control bot cron failed', err && err.stack)));
  },
};
