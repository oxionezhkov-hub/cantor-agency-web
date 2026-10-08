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
      avitoProfileUrl: existing.avitoProfileUrl || null,
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
    return json({ pull: await kv.get(`avitoPull:${date}`, 'json') });
  }

  if (pathname === '/api/dashboard/avito-pull' && request.method === 'POST') {
    const body = await readJson(request);
    const date = (body && body.date) || mskYesterday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'bad_date' }, 400);
    const pull = await startAvitoPull(env, date, Boolean(body && body.force));
    // Only the request that created this pull processes it — a repeat click on a running
    // pull must not start a second parallel pass (Avito allows 1 stats call/min per cabinet).
    if (pull.created && pull.pending.length && ctx) ctx.waitUntil(processAvitoPull(env, date));
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

  // Recent report requests (reportJob records live 14 days) — the "Готовые отчёты" list in
  // the export modal, so a finished file can be re-downloaded after a page reload.
  if (pathname === '/api/dashboard/report-jobs' && request.method === 'GET') {
    const jobs = (await listByPrefix(kv, 'reportJob:'))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 10)
      .map(publicReportJob);
    return json({ jobs });
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

/* ── Background Avito pull (one KV record per day, results for every linked cabinet) ── */

const AVITO_PULL_TTL = 7 * 24 * 3600;
const AVITO_PULL_BUDGET_MS = 25000; // stay inside waitUntil's ~30s; the cron finishes the rest
const AVITO_PULL_CONCURRENCY = 4; // different cabinets — Avito's 1/min stats limit is per cabinet
const AVITO_PULL_AUTOSTART_HOUR_MSK = 7; // cron prepares yesterday's numbers every morning

async function startAvitoPull(env, date, force) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const existing = await kv.get(`avitoPull:${date}`, 'json');
  const fresh = existing && Date.now() - Date.parse(existing.startedAt) < 10 * 60 * 1000;
  if (existing && (!force || (existing.status === 'running' && fresh))) return existing;
  const projects = await listByPrefix(kv, 'project:');
  const pull = {
    date,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pending: projects.filter((p) => p.avitoAccountId && !p.inactive).map((p) => p.id),
    results: {},
  };
  if (!pull.pending.length) { pull.status = 'done'; pull.finishedAt = pull.startedAt; }
  await kv.put(`avitoPull:${date}`, JSON.stringify(pull), { expirationTtl: AVITO_PULL_TTL });
  return { ...pull, created: true };
}

async function processAvitoPull(env, date) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const pull = await kv.get(`avitoPull:${date}`, 'json');
  if (!pull || pull.status !== 'running' || !pull.pending.length) return;
  const deadline = Date.now() + AVITO_PULL_BUDGET_MS;
  const queue = [...pull.pending];
  let profilesFound = false;
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const projectId = queue.shift();
      const project = await kv.get(`project:${projectId}`, 'json');
      const account = project && project.avitoAccountId && (await env.AVITO_KV.get(`account:${project.avitoAccountId}`, 'json'));
      let result;
      if (!account) result = { linked: false };
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
    }
  };
  await Promise.all(Array.from({ length: AVITO_PULL_CONCURRENCY }, worker));
  if (profilesFound) await atTouch(kv, ['#projects']);
  if (!pull.pending.length) { pull.status = 'done'; pull.finishedAt = new Date().toISOString(); }
  await kv.put(`avitoPull:${date}`, JSON.stringify(pull), { expirationTtl: AVITO_PULL_TTL });
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
  for (const k of keys) await processAvitoPull(env, k.name.slice('avitoPull:'.length));
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

const BOT_SETUP_VERSION = '4'; // 2: callback buttons + employees' private chats (Avito Tasks); 3: /activity in the owner's menu; 4: reactions
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
  if (task) {
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
  if (cmd) return reply('Не знаю такой команды. /help — список.');
  if (!text) return;
  return reply(await botAnswerQuestion(env, text));
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
  'статистика без просьбы — не задачи. Новости и отчёты клиента о результатах («пришла заявка», «была продажа», «ученик',
  'записался»), приветствия и ответы «спасибо/хорошо/ок» — тоже НЕ задачи: в том числе не заводи задач вида «подтвердить',
  'получение», «ответить клиенту», «поблагодарить», «отреагировать». Задача из чата клиента — только конкретная просьба',
  'клиента что-то сделать или вопрос, на который команда ещё не ответила в этих же сообщениях.',
  'Реакции (👍 и т.п.) показаны в квадратных скобках после текста: реакция команды на просьбу = её приняли/взяли.',
  'Тебе дают новые сообщения из одного топика/чата, контекст до них и список открытых задач этого клиента.',
  'Верни ТОЛЬКО JSON без пояснений:',
  '{"events":[',
  ' {"type":"new_task","msg":<id сообщения>,"text":"<суть задачи до 15 слов>","assignee":"<имя исполнителя или null>","due":"<YYYY-MM-DD HH:MM или null>"},',
  ' {"type":"update","task":"<id открытой задачи>","msg":<id сообщения>,"status":"taken|done|informed|cancelled","assignee":"<имя или null>","due":"<YYYY-MM-DD HH:MM или null>"}',
  ']}',
  'assignee — ТОЛЬКО если в сообщении человек прямо назван (имя, @username) или сам пишет, что сделает. Не угадывай по роли',
  'или по контексту: если явно не назван — null. due — только если в сообщении прямо назван срок, иначе null.',
  'taken — кто-то взял задачу или назвал срок; done — сообщили, что сделано; informed — КМ/Олег сообщили клиенту результат;',
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
    const fresh = unseen.slice(0, BOT_AI_BATCH_MESSAGES);
    if (unseen.length > fresh.length) await kv.put(k.name, '1'); // the rest goes next run
    const context = logs.filter((e) => e.imported || e.id <= cursor).slice(-15);

    if (!allTasks) allTasks = await botAllTasks(kv);
    const openTasks = allTasks.filter((t) => (t.status === 'open' || t.status === 'done')
      && ((topic.projectId && t.projectId === topic.projectId) || (String(t.chatId) === String(chatId) && String(t.threadId) === String(threadId))));
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
    await botApplyEvents(env, parsed.events || [], { chatRec, topic, threadId, fresh, openTasks, team, projectsById });
    await kv.put(cursorKey, String(fresh[fresh.length - 1].id));
    processed += fresh.length;
  }
  return { processed };
}

// The bot only puts a task on someone the message itself names — by name, alias or @username — or
// on the person who wrote it ("сделаю"). A guess from context leaves the task unclaimed: it waits at
// the top of the tracker for someone to take it and set the deadline.
function botNamedIn(src, who) {
  if (!src || !who) return false;
  if (atMatchUser(src.from, [who])) return true;
  const text = String(src.text || '');
  if (who.tgUsername && text.toLowerCase().includes(`@${String(who.tgUsername).toLowerCase()}`)) return true;
  return !!atMatchUser(text, [who]);
}

async function botApplyEvents(env, events, ctx) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const byMsg = new Map(ctx.fresh.map((e) => [e.id, e]));
  const openById = new Map(ctx.openTasks.map((t) => [t.id, t]));
  const nowIso = new Date().toISOString();
  const users = ctx.team ? ctx.team.users : [];
  const touched = [];
  const assigned = []; // [task, source message] — the person gets a (quiet) heads-up in Avito Tasks / Telegram
  const hinted = []; // tasks the chat suggests are done / reported / cancelled — a person confirms
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
        owner: null,
        assigneeId: null,
        priority: 'normal',
        // No deadline from the bot: whoever takes the task sets it. A date the message names is kept
        // as a hint for the «Взять задачу» form.
        due: null,
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
      if (who && botNamedIn(src, who)) {
        Object.assign(task, { assigneeId: who.id, owner: who.name });
        if (dueMs) task.due = task.suggestedDue; // the person was asked directly, with a date
      }
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
      // The bot never closes a task itself: "done" / "клиенту сообщили" / "отменена" read from the chat
      // only mark it (task.hint) and ask the person to confirm with a button.
      const closes = (ev.status === 'done' || ev.status === 'cancelled') ? task.status === 'open'
        : ev.status === 'informed' ? task.status === 'open' || task.status === 'done' : false;
      if (closes && (!task.hint || task.hint.status !== ev.status)) {
        task.hint = { status: ev.status, at: src ? new Date(src.t).toISOString() : nowIso, msgId: src ? src.id : null, from: src ? src.from : null, text: src ? String(src.text).slice(0, 200) : null };
        hinted.push(task);
      }
      task.updatedAt = nowIso;
      const label = { taken: 'взяли в работу', done: 'похоже, сделано — ждёт подтверждения', informed: 'похоже, клиенту сообщили — ждёт подтверждения', cancelled: 'похоже, не нужна — ждёт подтверждения' }[ev.status];
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
  // "Похоже, сделано": the assignee (for «клиенту сообщили» — the client manager) confirms with a button.
  for (const task of hinted) {
    const h = task.hint;
    const projectName = task.projectId && ctx.projectsById && ctx.projectsById[task.projectId] ? ctx.projectsById[task.projectId].name : task.topicName;
    const to = h.status === 'informed'
      ? users.filter((u) => u.role === 'manager' && u.active).map((u) => u.id)
      : [atAssigneeId(task, users)].filter(Boolean);
    if (!to.length) continue;
    const what = { done: 'сделана', informed: 'уже сообщили клиенту', cancelled: 'больше не нужна' }[h.status];
    const action = { done: ['✅ Да, готово', 'done'], informed: ['✅ Да, закрыть', 'close'], cancelled: ['✖️ Да, отменить', 'cancel'] }[h.status];
    await atNotify(env, ctx.team, to, { kind: 'edited', taskId: task.id, text: `Бот: похоже, задача ${what} — подтвердите: ${task.text}`, by: 'Бот' }, {
      text: `🤖 <b>Похоже, задача ${what}</b> — подтвердите, если так (сам бот статус не меняет)\n${atTgTaskBlock(task, projectName)}${h.text ? `\n<i>${escapeHtml(h.from || '')}: «${escapeHtml(h.text)}»</i>` : ''}`,
      extra: { reply_markup: { inline_keyboard: [[{ text: action[0], callback_data: `at:${action[1]}:${task.id}` }], atOpenTaskRow(task.id)] }, disable_notification: true },
    });
  }
}

// ── checks & summaries ──
// ── plain-language lines for the owner's automatic messages ──
// (/tasks and /overdue keep botTaskLine with task ids — those are for /done <id>.)
const BOT_ACK_WORDS = new Set(('да нет ок окей ok хорошо понятно ясно спасибо благодарю отлично супер класс договорились '
  + 'принято принял приняла ага угу конечно согласна согласен жду ждем ждём поняла понял вас большое очень пожалуйста').split(/\s+/));
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

  const lines = [`☀️ <b>Сводка на ${wd}, ${botShortDate(botMskStartOfDay(nowMs) + 12 * 3600000).slice(0, 5)}</b>`];
  lines.push(`Открыто задач: <b>${open.length}</b> · просрочено: <b>${overdue.length}</b>${noDue.length ? ` · без срока: <b>${noDue.length}</b>` : ''}`);
  if (state.limited) lines.push('⚠️ ИИ бота на лимите — последние сообщения из чатов ещё не разобраны.');
  if (unclaimed.length) {
    lines.push('', `🙋 <b>Ничьи задачи из чатов: ${unclaimed.length}</b> — никто не взял, в трекере они наверху`);
    lines.push(...unclaimed.slice(0, 8).map((t) => botOwnerTaskLine(t, byId, nowMs, 'since')));
    if (unclaimed.length > 8) lines.push(`  …и ещё ${unclaimed.length - 8} — в трекере`);
  }
  if (overdue.length) lines.push('', `🔴 <b>Просрочено: ${overdue.length}</b> — у кого`, ...botTasksByPerson(overdue, team, byId, nowMs, 'overdue', ownerId));
  if (notInformed.length) {
    lines.push('', `📨 <b>Сделано, но клиенту не сообщили: ${notInformed.length}</b> — сообщает ${escapeHtml(managers)}`);
    lines.push(...notInformed.slice(0, 8).map((t) => botOwnerTaskLine(t, byId, nowMs, 'done')));
    if (notInformed.length > 8) lines.push(`  …и ещё ${notInformed.length - 8} — в трекере`);
  }
  if (notPassed.length) {
    lines.push('', `⏱ <b>Просьбы клиентов не переданы в рабочий чат: ${notPassed.length}</b>`);
    lines.push(...notPassed.slice(0, 8).map((t) => botOwnerTaskLine(t, byId, nowMs, 'since')));
  }
  if (pending.length || stalePending) {
    lines.push('', `💬 <b>Клиенты ждут ответа: ${pending.length}</b>`);
    for (const p of pending) {
      const name = p.projectId && byId[p.projectId] ? byId[p.projectId].name : p.title;
      const link = botMessageLink(p.chatId, null, p.msgId);
      lines.push(`• <b>${escapeHtml(name)}</b>: «${escapeHtml(String(p.text).slice(0, 100))}» — ждёт ${botHoursAgo(p.since, nowMs)}${link ? ` · <a href="${link}">открыть</a>` : ''}`);
    }
    if (stalePending) lines.push(`  ещё ${stalePending} — без ответа больше суток (видно во вкладке «Клиенты»)`);
  }
  if (noDue.length) {
    lines.push('', `⚪ <b>Без срока: ${noDue.length}</b> — поставьте срок в трекере`);
    lines.push(...noDue.slice(0, 6).map((t) => botOwnerTaskLine(t, byId, nowMs, 'since')));
    if (noDue.length > 6) lines.push(`  …и ещё ${noDue.length - 6} — в трекере`);
  }
  if (!unclaimed.length && !overdue.length && !notInformed.length && !notPassed.length && !pending.length && !noDue.length) lines.push('', 'Всё в порядке: просрочек нет, клиенты не ждут ✅');
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
    if (overdue.length && !morning) {
      await botNotifyOwner(env, [`🔴 <b>Только что вышел срок: ${overdue.length}</b>`, ...botTasksByPerson(overdue, team, byId, nowMs, 'overdue', ownerId)].join('\n'));
    }
    if (noDue.length && !morning) {
      await botNotifyOwner(env, [`⚪ <b>Задачи без срока уже 2+ рабочих часа: ${noDue.length}</b> — поставьте срок`, ...botTasksByPerson(noDue, team, byId, nowMs, 'since', ownerId)].join('\n'), { disable_notification: true });
    }
    // Client waiting for an answer. A message nobody answered for over a day is stale (the talk
    // moved on elsewhere, or it needed no answer) — nobody gets pinged about it.
    for (const k of (await kv.list({ prefix: 'bot:pending:' })).keys) {
      const p = await kv.get(k.name, 'json');
      if (!p || botWorkingMinutes(p.since, nowMs) < BOT_CLIENT_REPLY_WMIN) continue;
      if (nowMs - p.since > BOT_CLIENT_REPLY_STALE_MS || botIsAckText(p.text)) continue;
      const chatId = k.name.split(':').pop();
      if (!(await botOnce(kv, `pending:${chatId}:${p.msgId}`, 60 * 60 * 24 * 7))) continue;
      const chat = await kv.get(`bot:chat:${chatId}`, 'json');
      const link = botMessageLink(chatId, null, p.msgId);
      const note = `💬 <b>${escapeHtml(chat ? chat.title : chatId)}</b>: клиент ждёт ответа больше 30 рабочих минут\n«${escapeHtml(p.text)}»${link ? ` <a href="${link}">сообщение</a>` : ''}`;
      if (!morning) await botNotifyOwner(env, note); // in the morning it is in the summary
      // …and the client manager, whose job this is.
      for (const m of team.users.filter((u) => u.role === 'manager' && u.active && u.tgId)) await botSend(env, m.tgId, note);
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
    await atEnsureNewMembers(env);
  } catch (err) {
    console.error('team members seed failed', err && err.stack);
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

// History import from a Telegram Desktop export (the bot can't read messages sent before it joined):
// the work chat's topics or a client chat. The messages go into one bot:hist key per topic/chat
// (one KV write per chat, not one per day — writes are the scarce resource on the free plan); the
// AI treats them as context only, and the open tasks found in them come in as `tasks`. Sent one
// chat (or a few topics) per request.
//   POST /api/tgbot/import  (x-dashboard-password)
//   { chatId? | chatTitle?, topics: { <threadId>: name }, entries: [{ thread, id, t, from, team, text, reply }], tasks: [...] }
// chatTitle ("Авито — Ольга Агешина", as in the export) finds the client chat the bot is in; with
// neither, the work chat is used.
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

const AT_PAGE_URL = 'https://cantor.agency/avito-tasks';
const AT_OWNER_TG = 'oleg_ezhkov';
const AT_ROLES = {
  owner: 'Руководитель',
  manager: 'Клиентский менеджер',
  specialist: 'Специалист по Авито',
  trainee: 'Стажёр по Авито',
  assistant: 'Ассистент', // same access as the owner, except the owner's own record
};
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
];
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
    const first = atFirstName(user.name);
    const res = await botApi(env, 'sendMessage', {
      chat_id: Number(user.tgId),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: [
        `<b>${escapeHtml(first)}, вас добавили в Avito Tasks</b> — трекер задач команды Cantor Agency.`,
        '',
        'Откройте свою ссылку один раз — дальше трекер будет открываться на этом устройстве сам:',
        atInviteUrl(user),
        `Если без VPN не открывается: ${BOT_WORKER_ORIGIN}/avito-tasks?invite=${user.invite}`,
        '',
        'Telegram уже подключён: сюда будут приходить ваши задачи, напоминания о сроках и сводка в 10:00. /tasks — ваши задачи.',
      ].join('\n'),
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: atInviteUrl(user) }]] },
    });
    if (res && res.ok) await botApi(env, 'setMyCommands', { commands: AT_EMPLOYEE_COMMANDS, scope: { type: 'chat', chat_id: Number(user.tgId) } });
    await botNotifyOwner(env, [
      `👤 <b>В команду добавлена ${escapeHtml(user.name)}</b> — ${escapeHtml(user.roleLabel)}${user.tgUsername ? ` (@${escapeHtml(user.tgUsername)})` : ''}.`,
      res && res.ok
        ? 'Бот уже отправил ей ссылку и будет присылать задачи.'
        : `Бот не смог написать ей: она ещё не открывала бота. Отправьте ей ссылку:\n${atInviteUrl(user)}\nи попросите нажать Start у бота — тогда начнут приходить задачи.`,
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
    for (const a of u.aliases || []) {
      const an = norm(a);
      if (an && n.includes(` ${an} `)) score = Math.max(score, an.includes(' ') ? 3 : 2);
    }
    const first = norm(atFirstName(u.name));
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
    return `${u.name} — ${u.roleLabel}${aka.length ? ` (может подписываться: ${aka.join(', ')})` : ''}`;
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
  return (await listByPrefix(kv, 'project:')).map((p) => ({
    id: p.id,
    name: p.name,
    inactive: !!p.inactive,
    profileUrl: p.profileUrl || p.avitoProfileUrl || null,
    briefUrl: p.briefUrl || null,
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
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

// ── «Рефлексия»: weekly project ratings from the team ──
// Every Wednesday (00:00 MSK) a new week opens: each employee (client manager, specialists,
// trainees) rates every active client 1–10 with a comment of a sentence or two, one client at a
// time, and can leave and come back to the same place. Done — the tab is quiet until next Wednesday.
// The cron puts a «Заполнить рефлексию» task on each of them and closes it once they are done.
// The client manager's and the specialist's scores also land in the dashboard's weekly project
// ratings (projectRating:<project>:<monday>:<role>), so the Projects tab fills itself.
//   refl:<wed>:<userId> -> { week, userId, answers: { <projectId>: { score, comment, at } }, taskId, doneAt }
// One record per person and week, written only by that person; the page always sends every answer
// it knows, so a save from one Cloudflare location can't drop one made a moment ago from another.
const REFL_ROLES = new Set(['manager', 'specialist', 'trainee']);
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
function reflDone(rec, clientIds) {
  const a = (rec && rec.answers) || {};
  return clientIds.filter((id) => a[id] && a[id].score > 0).length;
}
// What the page needs: this week's open clients and my answers.
async function atReflectionState(kv, me, mem, nowMs) {
  if (!REFL_ROLES.has(me.role)) return null;
  const week = reflWeek(nowMs);
  const rec = (await kv.get(`refl:${week}:${me.id}`, 'json')) || { answers: {} };
  const clients = reflClients(mem.projects);
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
    const score = Number(a && a.score);
    if (!clientIds.has(pid) || !Number.isInteger(score) || score < 1 || score > 10) continue;
    const comment = atClean(a.comment, REFL_COMMENT_MAX);
    const prev = rec.answers[pid];
    if (prev && prev.score === score && prev.comment === comment) continue;
    rec.answers[pid] = { score, comment, at: new Date(nowMs).toISOString() };
    changed.push(pid);
  }
  const active = reflClients(mem.projects);
  const doneNow = reflDone(rec, active) >= active.length && active.length > 0;
  if (!changed.length && (!doneNow || rec.doneAt)) return { state: await atReflectionState(kv, me, mem, nowMs) };
  if (doneNow && !rec.doneAt) rec.doneAt = new Date(nowMs).toISOString();
  rec.updatedAt = new Date(nowMs).toISOString();
  await kv.put(key, JSON.stringify(rec), { expirationTtl: REFL_TTL });
  // The dashboard's weekly ratings (Monday-based weeks) get the manager's and the specialist's scores.
  const role = me.role === 'manager' ? 'manager' : me.role === 'specialist' ? 'specialist' : null;
  if (role) {
    const monday = reflAddDays(week, -2);
    await Promise.all(changed.map((pid) => kv.put(`projectRating:${pid}:${monday}:${role}`, JSON.stringify({
      projectId: pid, weekStart: monday, role, score: rec.answers[pid].score, comment: rec.answers[pid].comment, by: me.name, updatedAt: rec.updatedAt,
    }))));
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
// Owner / assistant: everyone's answers for a week.
async function atReflectionResults(env, team, week) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const people = team.users.filter((u) => u.active && REFL_ROLES.has(u.role));
  const recs = await Promise.all(people.map((u) => kv.get(`refl:${week}:${u.id}`, 'json')));
  const mem = await atSnapshot(env);
  const clients = reflClients(mem.projects);
  return {
    week,
    clients,
    people: people.map((u, i) => ({ id: u.id, name: u.name, role: u.role, answers: (recs[i] && recs[i].answers) || {}, done: reflDone(recs[i], clients), doneAt: (recs[i] && recs[i].doneAt) || null })),
  };
}
// Cron: from Wednesday 10:00, once a week per person — a task to fill it in, with a link.
async function atReflectionCron(env, team, nowMs) {
  const kv = env.AGENCY_DASHBOARD_KV;
  if (botMsk(nowMs).hh < 10 && botMsk(nowMs).dow === 3) return;
  const week = reflWeek(nowMs);
  const mem = await atSnapshot(env);
  const clients = reflClients(mem.projects);
  if (!clients.length) return;
  for (const u of team.users.filter((x) => x.active && REFL_ROLES.has(x.role))) {
    const key = `refl:${week}:${u.id}`;
    const rec = (await kv.get(key, 'json')) || { week, userId: u.id, answers: {} };
    if (rec.taskId || rec.doneAt) continue;
    if (!(await botOnce(kv, `refltask:${week}:${u.id}`, 60 * 60 * 24 * 9))) continue;
    // Due at the end of the working day it is set (or the next one, if set after 18:00).
    const due = atWorkdayAt(nowMs, BOT_WORK_END_H, botMsk(nowMs).hh < BOT_WORK_END_H);
    const id = `trrefl${atRandom(8)}`;
    const now = new Date(nowMs).toISOString();
    const task = {
      id, text: `Заполнить рефлексию по клиентам (неделя с ${week.slice(8, 10)}.${week.slice(5, 7)})`,
      note: 'Вкладка «Рефлексия» в трекере: оценка 1–10 и пара предложений по каждому активному клиенту. Можно выйти и продолжить потом — задача закроется сама, когда всё будет заполнено.',
      status: 'open', priority: 'normal', source: 'tracker', origin: 'tracker', author: 'Бот', createdById: null,
      assigneeId: u.id, owner: u.name, due: botIsoMsk(due), link: `${AT_PAGE_URL}#reflection`, startedAt: now,
      notified: {}, activity: [{ t: nowMs, by: 'Бот', what: 'поставил задачу на рефлексию' }], createdAt: now, updatedAt: now,
    };
    await kv.put(`task:${id}`, JSON.stringify(task));
    rec.taskId = id;
    await kv.put(key, JSON.stringify(rec), { expirationTtl: REFL_TTL });
    await atTouch(kv, [id]);
    await atNotify(env, team, [u.id], { kind: 'assigned', taskId: id, text: `Рефлексия за неделю: оцените клиентов (${clients.length})`, by: 'Бот' }, {
      text: `🪞 <b>Рефлексия за неделю</b>\nОцените каждого активного клиента по шкале 1–10 и коротко объясните почему — ${clients.length} ${clients.length % 10 === 1 && clients.length % 100 !== 11 ? 'клиент' : 'клиентов'}. Можно прерваться и продолжить потом.`,
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

// ── API: POST /api/dashboard/avito-tasks/<action>, token in the JSON body ──
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
  const seesClients = isAdmin || me.role === 'manager';

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
      me: { ...atPublicUser(me), roleLabel: me.roleLabel },
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
    if (!isAdmin) return json({ error: 'forbidden' }, 403);
    const week = /^\d{4}-\d{2}-\d{2}$/.test(String(body.week || '')) ? body.week : reflWeek(nowMs);
    return json({ results: await atReflectionResults(env, team, week), current: reflWeek(nowMs) });
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
    for (const key of ['profileUrl', 'briefUrl']) {
      if (!(key in body)) continue;
      if (body[key] && !link(body[key])) return json({ error: 'bad_url', field: key }, 400);
      project[key] = link(body[key]);
    }
    project.updatedAt = new Date(nowMs).toISOString();
    await kv.put(`project:${projectId}`, JSON.stringify(project));
    await atTouch(kv, ['#projects']);
    const pub = { id: project.id, name: project.name, inactive: !!project.inactive, profileUrl: project.profileUrl || project.avitoProfileUrl || null, briefUrl: project.briefUrl || null };
    if (AT_MEM && AT_MEM.projects) AT_MEM.projects = AT_MEM.projects.map((p) => (p.id === projectId ? pub : p));
    return json({ ok: true, project: pub });
  }

  // ── Команда и Активность (owner and assistant) ──
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  // «База знаний»: updates to cantor.agency/base through the Claude Code routine.
  if (action.startsWith('kb-')) return atKbApi(env, me, action, body);

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
      })),
      roles: AT_ROLES,
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
    const role = AT_ROLES[input.role] && input.role !== 'owner' ? input.role : 'specialist';
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

// ── Avito Tasks → «База знаний»: updates to cantor.agency/base via a Claude Code routine ──
// The owner and the assistant describe new knowledge on the tracker's «База знаний» tab: into a
// chosen regulation, into «общее» (Claude decides where it belongs) or as a new regulation —
// text plus files and pictures. The page uploads files in ≤1.5 MB parts (the Yandex Cloud proxy
// takes ≤3.5 MB per request), then «kb-send» fires the routine (KB_ROUTINE_ID var + KB_ROUTINE_TOKEN
// secret, same mechanism as the daily report's) and answers at once — nobody waits on the page.
// The routine's session reads the request from /api/kb-jobs/<id>?token=…, edits base/ in the repo,
// merges it to main (the GitHub Action deploys cantor.agency) and posts the result back; the worker
// then notifies the requester in the tracker and in Telegram, naming what changed where. The cron
// marks requests the routine never answered as stuck and tells the requester and the owner.
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
const KB_CALLBACK_PREFIX = `${BOT_WORKER_ORIGIN}/api/kb-jobs/`;
const KB_BASE_URL = 'https://cantor.agency/base';

function kbSlug(value) {
  const s = String(value || '').trim().replace(/^\/?base\//, '').replace(/\/+$/, '');
  return /^[a-z0-9][a-z0-9-]{1,79}$/.test(s) ? s : '';
}
async function kbPutJob(kv, job) {
  job.updatedAt = new Date().toISOString();
  await kv.put(`kb:job:${job.id}`, JSON.stringify(job), { expirationTtl: KB_JOB_TTL });
  if (job.status === 'draft') return;
  const index = ((await kv.get('kb:index', 'json')) || []).filter((x) => x.id !== job.id);
  index.unshift({ id: job.id, status: job.status, byId: job.byId, createdAt: job.createdAt, updatedAt: job.updatedAt });
  await kv.put('kb:index', JSON.stringify(index.slice(0, 60)));
}
function kbTargetLabel(job) {
  if (job.mode === 'reglament' && job.target) return job.target.title;
  if (job.mode === 'new') return `Новый регламент: ${job.newTitle}`;
  return 'Общее — Claude разберёт сам';
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
    createdAt: job.createdAt,
    sentAt: job.sentAt || null,
    finishedAt: job.finishedAt || null,
  };
}

// Tracker API actions kb-* (owner and assistant only — called from handleAvitoTasksApi).
async function atKbApi(env, me, action, body) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const nowIso = new Date().toISOString();

  if (action === 'kb-list') {
    const index = (await kv.get('kb:index', 'json')) || [];
    const jobs = (await Promise.all(index.slice(0, 30).map((x) => kv.get(`kb:job:${x.id}`, 'json')))).filter(Boolean);
    return json({ jobs: jobs.map(kbPublicJob), configured: Boolean(env.KB_ROUTINE_ID && env.KB_ROUTINE_TOKEN) });
  }

  if (action === 'kb-create') {
    const mode = ['reglament', 'general', 'new'].includes(body.mode) ? body.mode : null;
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
    await kbFireRoutine(env, job);
    return json({ job: kbPublicJob(job) });
  }

  return json({ error: 'not_found' }, 404);
}

// Fires the «База знаний» routine. Its saved prompt only accepts URLs under KB_CALLBACK_PREFIX;
// everything else (what to do, how to report back) comes from the job's DATA_URL.
async function kbFireRoutine(env, job) {
  const kv = env.AGENCY_DASHBOARD_KV;
  job.error = null;
  job.result = null;
  job.progress = null;
  if (!env.KB_ROUTINE_ID || !env.KB_ROUTINE_TOKEN) {
    job.status = 'not_configured';
    job.error = 'Рутина Claude Code для базы знаний ещё не подключена (нет KB_ROUTINE_ID / KB_ROUTINE_TOKEN). Запрос сохранён — его можно отправить снова, когда рутину подключат.';
    await kbPutJob(kv, job);
    if (await botOnce(kv, `kb-not-configured:${botMsk(Date.now()).date}`, 86400)) {
      await botNotifyOwner(env, `📚 ${escapeHtml(job.byName)} отправил(а) обновление базы знаний, но рутина Claude Code для базы ещё не подключена (KB_ROUTINE_ID / KB_ROUTINE_TOKEN в Cloudflare). Запрос сохранён в трекере, вкладка «База знаний».`);
    }
    return;
  }
  const text = [
    'Запрос из Avito Tasks: обновить базу знаний Cantor Agency (папка base/ репозитория, сайт cantor.agency/base).',
    `JOB_ID: ${job.id}`,
    `FROM: ${job.byName}`,
    `WHERE: ${kbTargetLabel(job)}`,
    `DATA_URL: ${KB_CALLBACK_PREFIX}${job.id}?token=${job.token}`,
  ].join('\n');
  try {
    const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${env.KB_ROUTINE_ID}/fire`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.KB_ROUTINE_TOKEN}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`routine_fire_${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    job.status = 'sent';
    job.sentAt = new Date().toISOString();
    job.sessionUrl = (data && data.claude_code_session_url) || null;
  } catch (e) {
    job.status = 'failed';
    job.error = `Не удалось запустить Claude: ${String(e && e.message)}`;
  }
  await kbPutJob(kv, job);
}

function kbInstructions(job) {
  const where = {
    reglament: `Добавь знания в регламент «${job.target && job.target.title}» — файл base/${job.target && job.target.slug}. Если часть материала явно относится к другому регламенту — внеси её туда и упомяни это в отчёте.`,
    general: 'Место не выбрано: сам реши, к каким регламентам из base/ это относится (смотри base/index.html и содержимое регламентов). Можно распределить по нескольким. Новый регламент создавай, только если знания не подходят ни к одному существующему.',
    new: `Создай новый регламент «${job.newTitle}»${job.newSection ? ` в разделе «${job.newSection}» каталога` : ''} и наполни его этими знаниями.`,
  }[job.mode];
  return [
    `Задача: внести новые знания в базу знаний агентства. ${where}`,
    'Материал — поле text и файлы из files[] (скачай каждый по url: curl -sS -o <файл> "<url>"; если ответ 503 not_ready — подожди минуту и повтори). Картинки посмотри, PDF/DOCX/таблицы прочитай. Скриншоты, которые помогают понять шаг, положи в images/base/<slug регламента>/ (латиница, без пробелов) и вставь в регламент тегом <img> с alt; остальные файлы используй только как источник текста.',
    'Как вносить:',
    '• Каждый регламент — HTML-файл без расширения в base/ (например base/reglament-4-vstrechi). Сохраняй его вёрстку и стиль: те же классы (.reg-card, .step, .step-title, .step-meta, списки, плашки), оглавление .toc со ссылками на #sN — новый шаг добавляй и в оглавление.',
    '• Пиши как в остальных регламентах: по-русски, коротко, конкретно, в повелительном наклонении. Не дублируй то, что уже есть, — дополни или поправь существующий пункт. Если новое противоречит старому — новое главнее, старое убери.',
    '• Не выдумывай факты сверх материала. Имена клиентов, телефоны, пароли и прочие личные данные в базу не переноси.',
    '• Новый регламент: файл base/<slug> (латиница через дефис, без расширения) по образцу соседних регламентов (шапка, .doc-title, .doc-meta, .toc, .reg-card), плюс карточка a.cat-card в нужном .cat-section в base/index.html (новый раздел — только если ни один не подходит). В base/index.html правь только каталог.',
    '• Меняй только base/ и images/base/. Больше ничего в репозитории не трогай.',
    'Публикация: сделай один коммит, запушь ветку, открой PR в main (не черновик) и сразу смержи его (squash) через GitHub — автомерж этих правок заранее разрешён владельцем; после мержа GitHub Action сам выложит сайт. Если мерж не удался из-за конфликта — подтяни свежий main, разреши и повтори. Если GitHub-инструментов для PR нет — попробуй git push origin HEAD:main; если и это запрещено — запушь ветку и отправь done с published=false и ссылкой на ветку (https://github.com/oxionezhkov-hub/cantor-agency-web/tree/<ветка>) в prUrl. На события PR не подписывайся.',
    `Перед началом отправь POST на callbacks.progress с {"note":"<что делаешь, коротко>"}. В конце — POST на callbacks.done с JSON: {"summary":"2–4 предложения для Софии простым языком: что именно добавлено","changes":[{"slug":"<slug>","title":"<название регламента>","what":"<что изменилось, конкретно: какой шаг/раздел добавлен или исправлен>","isNew":false}],"prUrl":"<ссылка на PR>","published":true}. published=false — если смержить не получилось и PR ждёт проверки. Если внести знания не получилось совсем — POST на callbacks.fail с {"error":"<понятная причина>"}.`,
    `Ссылка на страницу регламента: ${KB_BASE_URL}/<slug>.`,
  ].join('\n');
}

// Called by the routine's cloud session — authorised by the per-job random token that was only
// ever sent inside the routine fire payload (not by the tracker's tokens).
async function handleKbJobCallback(request, env, url) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const match = url.pathname.match(/^\/api\/kb-jobs\/([a-z0-9]{12})(?:\/(progress|done|fail|file\/([a-z0-9]{1,12})))?$/);
  if (!match) return json({ error: 'not_found' }, 404);
  const job = await kv.get(`kb:job:${match[1]}`, 'json');
  if (!job || job.status === 'draft' || !url.searchParams.get('token') || url.searchParams.get('token') !== job.token) {
    return json({ error: 'not_found' }, 404);
  }
  const base = `${KB_CALLBACK_PREFIX}${job.id}`;
  const q = `?token=${job.token}`;
  const action = match[2] ? match[2].split('/')[0] : null;

  if (!action && request.method === 'GET') {
    if (job.status === 'sent') {
      job.status = 'running';
      await kbPutJob(kv, job);
    }
    return json({
      jobId: job.id,
      instructions: kbInstructions(job),
      request: {
        mode: job.mode,
        target: job.target,
        newTitle: job.newTitle,
        newSection: job.newSection,
        text: job.text,
        from: job.byName,
        createdAt: job.createdAt,
        files: job.files.map((f) => ({ name: f.name, type: f.type, size: f.size, url: `${base}/file/${f.id}${q}` })),
      },
      callbacks: { progress: `${base}/progress${q}`, done: `${base}/done${q}`, fail: `${base}/fail${q}` },
    });
  }

  if (action === 'file' && request.method === 'GET') {
    const file = job.files.find((f) => f.id === match[3]);
    if (!file) return json({ error: 'not_found' }, 404);
    const parts = await Promise.all(Array.from({ length: file.parts }, (_, p) => kv.get(`kb:file:${job.id}:${file.id}:${p}`, 'arrayBuffer')));
    if (parts.some((p) => !p)) return json({ error: 'not_ready', message: 'Файл ещё не доступен (истёк срок хранения или KV не успел синхронизироваться) — повторите через минуту.' }, 503);
    const bytes = new Uint8Array(file.size);
    let off = 0;
    for (const p of parts) { bytes.set(new Uint8Array(p), off); off += p.byteLength; }
    return new Response(bytes, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        ...corsHeaders(),
      },
    });
  }

  if (request.method !== 'POST' || !action) return json({ error: 'not_found' }, 404);
  const body = (await readJson(request)) || {};
  if (job.status === 'done' && action !== 'done') return json({ error: 'already_done' }, 409);

  if (action === 'progress') {
    job.status = 'running';
    job.progress = atClean(body.note, 300) || null;
    await kbPutJob(kv, job);
    return json({ ok: true });
  }

  if (action === 'fail') {
    job.status = 'failed';
    job.error = atClean(body.error, 600) || 'Claude не смог внести изменения.';
    job.finishedAt = new Date().toISOString();
    await kbPutJob(kv, job);
    await kbNotify(env, job);
    return json({ ok: true });
  }

  // done
  const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 20).map((c) => {
    const slug = kbSlug(c && c.slug);
    return {
      slug: slug || null,
      title: atClean(c && c.title, 200) || slug || 'Регламент',
      what: atClean(c && c.what, 600),
      isNew: Boolean(c && c.isNew),
      url: slug ? `${KB_BASE_URL}/${slug}` : null,
    };
  }).filter((c) => c.slug || c.what);
  const summary = atClean(body.summary, 1500);
  if (!summary && !changes.length) return json({ error: 'missing_result', message: 'Нужны summary и changes[]' }, 400);
  const prUrl = atClean(body.prUrl, 300);
  job.result = {
    summary,
    changes,
    prUrl: /^https:\/\/github\.com\//.test(prUrl) ? prUrl : null,
    published: body.published !== false,
  };
  job.status = 'done';
  job.error = null;
  job.progress = null;
  job.finishedAt = new Date().toISOString();
  await kbPutJob(kv, job);
  await kbNotify(env, job);
  return json({ ok: true, changes: changes.length });
}

// The requester hears about the outcome in the tracker and in Telegram; the owner gets a quiet copy
// when someone else asked (and a loud one for anything that went wrong).
async function kbNotify(env, job) {
  const team = await atGetTeam(env);
  const requester = team.users.find((u) => u.id === job.byId);
  const owner = team.users.find((u) => u.role === 'owner');
  const when = botFmtDate(Date.parse(job.createdAt));
  const excerpt = String(job.text || (job.files[0] && job.files[0].name) || '').replace(/\s+/g, ' ').slice(0, 90);
  const about = `Запрос от ${when}${excerpt ? `: «${escapeHtml(excerpt)}${job.text && job.text.length > 90 ? '…' : ''}»` : ''}`;
  const kbPage = `${AT_PAGE_URL}#kb=${job.id}`;
  let inApp;
  let tg;
  if (job.status === 'done') {
    const r = job.result;
    const names = r.changes.map((c) => `«${c.title}»`).join(', ');
    inApp = `${r.published ? 'База знаний обновлена' : 'Правки базы знаний готовы, ждут публикации'}${names ? `: ${names}` : ''}. ${r.summary}`.trim();
    const lines = [r.published ? '📚 <b>База знаний обновлена</b>' : '📝 <b>Правки базы знаний готовы, но ещё не опубликованы</b>', `<i>${about}</i>`];
    if (r.changes.length) lines.push('', '<b>Что изменилось:</b>');
    for (const c of r.changes) lines.push(`• <b>${escapeHtml(c.title)}</b>${c.isNew ? ' (новый регламент)' : ''}${c.what ? ` — ${escapeHtml(c.what)}` : ''}`);
    if (r.summary) lines.push('', escapeHtml(r.summary));
    if (!r.published) lines.push('', 'PR ждёт проверки Олега — после мержа изменения появятся на сайте.');
    const rows = r.changes.filter((c) => c.url).slice(0, 4).map((c) => [{ text: `📖 ${c.title}`.slice(0, 60), url: c.url }]);
    rows.push([{ text: 'Открыть в трекере', url: kbPage }]);
    tg = { text: lines.join('\n'), extra: { reply_markup: { inline_keyboard: rows } } };
  } else {
    const reason = job.status === 'stuck' ? 'Claude не ответил больше двух часов' : job.error || 'неизвестная ошибка';
    inApp = `Не получилось обновить базу знаний (${kbTargetLabel(job)}): ${reason}. Можно отправить снова.`;
    tg = {
      text: ['⚠️ <b>Не получилось обновить базу знаний</b>', `<i>${about}</i>`, `Куда: ${escapeHtml(kbTargetLabel(job))}`, `Причина: ${escapeHtml(reason)}`, '', 'В трекере на вкладке «База знаний» можно отправить запрос снова.'].join('\n'),
      extra: { reply_markup: { inline_keyboard: [[{ text: 'Открыть в трекере', url: kbPage }]] } },
    };
  }
  if (requester) await atNotify(env, team, [requester.id], { kind: job.status === 'done' ? 'kb' : 'kbfail', ref: `kb:${job.id}`, text: inApp, by: 'Claude' }, tg);
  if (owner && owner.id !== job.byId && owner.tgId) {
    const head = job.status === 'done' ? `📚 <i>${escapeHtml(job.byName)} обновил(а) базу знаний.</i>` : `⚠️ <i>Не выполнен запрос в базу знаний (автор — ${escapeHtml(job.byName)}).</i>`;
    await botSend(env, owner.tgId, `${head}\n${tg.text}`, { ...tg.extra, disable_notification: job.status === 'done' });
  }
}

// Cron: requests the routine took but never answered (session died, limits) don't hang forever.
async function atKbCron(env) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const index = (await kv.get('kb:index', 'json')) || [];
  const now = Date.now();
  for (const x of index.filter((i) => KB_ACTIVE.has(i.status) && now - Date.parse(i.updatedAt) > KB_STUCK_MS)) {
    const job = await kv.get(`kb:job:${x.id}`, 'json');
    if (!job || !KB_ACTIVE.has(job.status) || now - Date.parse(job.updatedAt) <= KB_STUCK_MS) continue;
    job.status = 'stuck';
    job.error = 'Claude не ответил больше двух часов.';
    job.finishedAt = new Date().toISOString();
    await kbPutJob(kv, job);
    await kbNotify(env, job);
  }
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
      if (!a || !a.t || a.by === 'Бот' || a.by === 'Claude') continue;
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
async function atBuildMyTasks(env, user, digest) {
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
  if (!mine.length) lines.push('Открытых задач на вас нет 👌');
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
  if (unclaimed.length) {
    lines.push('', `🙋 <b>Ничьи задачи из чатов: ${unclaimed.length}</b> — посмотрите, нет ли среди них ваших, и возьмите в трекере:`);
    for (const t of unclaimed.slice(0, 8)) lines.push(`• <a href="${escapeHtml(atTaskUrl(t.id))}">${escapeHtml(t.text)}</a> — <i>${escapeHtml(clientOf(t))}</i>`);
    if (unclaimed.length > 8) lines.push(`…и ещё ${unclaimed.length - 8} — в трекере.`);
  }
  if (doneMine.length && !seesInform) { // the manager sees these in «сообщить клиентам» below
    lines.push('', `✅ <b>Сделано, ждёт сообщения клиенту: ${doneMine.length}</b>`);
    for (const t of doneMine) lines.push(`• ${escapeHtml(t.text)} — <i>${escapeHtml(clientOf(t))}</i>`);
  }
  if (user.role === 'manager' || user.role === 'owner' || user.role === 'assistant') {
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
    await botApi(env, 'editMessageReplyMarkup', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: atPersonalizeMarkup(atTgButtons(res.task, true).reply_markup, user),
    });
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
      if (kind === 'overdue' && (digestDue || user.role === 'owner')) continue;
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
  // 10:00 — each connected person's own list (the owner gets the full /summary instead).
  if (workday && hh >= 10 && hh < 12 && (await botOnce(kv, `atdigest:${date}`, 60 * 60 * 36))) {
    for (const user of team.users.filter((u) => u.active && u.tgId && u.role !== 'owner')) {
      const text = await atBuildMyTasks(env, user, true);
      await botSend(env, user.tgId, text, { reply_markup: { inline_keyboard: [[{ text: 'Открыть Avito Tasks', url: AT_PAGE_URL }]] } });
    }
  }
}

// ── Avito → Telegram: per-client notifier bots ──
// One Telegram bot per client cabinet (token in a Worker secret, never in wrangler.jsonc). Every
// new client message in the cabinet's Avito Messenger lands in the bot as 🔴 <name linked to the
// Avito chat> + text, with a «Ответить» button: the reply typed in Telegram goes to the client
// through the Avito API, from the cabinet itself. Once the chat is answered — from the bot or
// straight on Avito — every notification of that chat turns 🟢.
// Delivery: Avito's messenger webhook (subscribed by the setup below) plus a cron poll of the
// latest chats as a safety net; messages are de-duplicated by id.
// Access: open — anyone who writes to the bot is subscribed; every subscriber sees the same
// notifications and the same 🔴/🟢 state. The owner (ANB_OWNER_ID) is told about each new user.
//
// KV keys (binding "AGENCY_DASHBOARD_KV", "avitobot:<bot>:" prefix):
//   setup                    -> ANB_SETUP_VERSION once both webhooks are set
//   subs                     -> [{ id, name, addedAt }]  (Telegram users who get notifications)
//   chat:<avitoChatId>       -> { name, item, open: [{ c, m, body }] }  (open = 🔴 notifications)
//   msg:<tgChatId>:<msgId>   -> avitoChatId  (notification / reply prompt → chat, for replies)
//   await:<tgChatId>         -> avitoChatId  (the chat whose «Ответить» was pressed last)
//   seen:<avitoMessageId>    -> "1"  (de-dup between webhook and poll)
//   poll                     -> unix seconds of the newest message the poll has handled

const AVITO_NOTIFY_BOTS = {
  romashova: {
    accountId: 'e54ce32a0dd0', // AVITO_KV account:<id> — Лариса Ромашова
    tokenEnv: 'AVITO_BOT_TOKEN_ROMASHOVA',
    name: 'Авито · Лариса Ромашова',
    owner: 'Ларисы',
  },
};
const ANB_SETUP_VERSION = '2';
const ANB_OWNER_ID = '1326867567';
const ANB_TTL_DAY = 60 * 60 * 24;

function anbKey(bot, rest) {
  return `avitobot:${bot}:${rest}`;
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

async function anbAccount(env, cfg) {
  const account = await env.AVITO_KV.get(`account:${cfg.accountId}`, 'json');
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
    if (/создал чат/i.test(t)) return '✏️ Создал чат, но пока ничего не написал — напишите первыми';
    if (/ознакомился с вашим предложением/i.test(t)) return '📨 Открыл(а) предложение из рассылки';
    return '';
  }
  return avitoMessageText(m);
}
// System messages worth a notification: an empty chat and an opened promo offer are leads too.
function anbIsLeadSystem(m) {
  const t = String((m.content && m.content.text) || '');
  return /создал чат|ознакомился с вашим предложением/i.test(t);
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

async function anbChatState(env, bot, cfg, token, account, chatId) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const state = (await kv.get(anbKey(bot, `chat:${chatId}`), 'json')) || { open: [] };
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

// ── incoming Avito message (from the webhook or the poll) ──
async function anbHandleAvitoMessage(env, bot, cfg, token, account, v) {
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

  const subs = await anbSubs(env, bot);
  if (!subs.length) return;
  const state = await anbChatState(env, bot, cfg, avitoToken, account, v.chat_id);
  const body = `<a href="${anbChatLink(v.chat_id)}">${escapeHtml(state.name)}</a>`
    + (state.item ? `\n<i>${escapeHtml(anbTrim(state.item, 150))}</i>` : '')
    + `\n\n${escapeHtml(anbTrim(text, 3000))}`;
  for (const sub of subs) {
    const res = await anbApi(token, 'sendMessage', {
      chat_id: sub.id,
      text: `🔴 ${body}`,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: anbButtons(v.chat_id, false),
    });
    if (res.ok && res.result) {
      state.open.push({ c: sub.id, m: res.result.message_id, body });
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
async function anbAddSub(env, bot, cfg, token, subs, from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id);
  subs.push({ id: from.id, name, username: from.username || null, addedAt: new Date().toISOString() });
  await env.AGENCY_DASHBOARD_KV.put(anbKey(bot, 'subs'), JSON.stringify(subs));
  if (String(from.id) === ANB_OWNER_ID) return;
  const note = `👤 Новый пользователь бота «${escapeHtml(cfg.name)}»: <b>${escapeHtml(name)}</b>`
    + `${from.username ? ` (@${escapeHtml(from.username)})` : ''}, id <code>${from.id}</code>. Всего пользователей: ${subs.length}.`;
  // Through this bot if the owner has started it, otherwise through the control bot.
  const sent = await anbApi(token, 'sendMessage', { chat_id: ANB_OWNER_ID, text: note, parse_mode: 'HTML' });
  if (!sent.ok && env.CONTROL_BOT_TOKEN) await anbApi(env.CONTROL_BOT_TOKEN, 'sendMessage', { chat_id: ANB_OWNER_ID, text: note, parse_mode: 'HTML' });
}

async function anbOnTelegram(env, bot, cfg, token, update) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const subs = await anbSubs(env, bot);
  const isSub = (id) => subs.some((s) => String(s.id) === String(id));

  if (update.callback_query) {
    const q = update.callback_query;
    const data = String(q.data || '');
    if (q.from && !isSub(q.from.id)) await anbAddSub(env, bot, cfg, token, subs, q.from);
    if (data.startsWith('r:')) {
      const chatId = data.slice(2);
      const state = (await kv.get(anbKey(bot, `chat:${chatId}`), 'json')) || {};
      await anbApi(token, 'answerCallbackQuery', { callback_query_id: q.id });
      const tgChat = q.message ? q.message.chat.id : q.from.id;
      const prompt = await anbApi(token, 'sendMessage', {
        chat_id: tgChat,
        text: `✍️ Ответ для <b>${escapeHtml(state.name || 'клиента')}</b>\nНапишите текст — он уйдёт клиенту в Авито от имени ${escapeHtml(cfg.owner)}.`,
        parse_mode: 'HTML',
        reply_markup: { force_reply: true, input_field_placeholder: 'Ответ клиенту' },
      });
      if (prompt.ok && prompt.result) {
        await kv.put(anbKey(bot, `msg:${tgChat}:${prompt.result.message_id}`), chatId, { expirationTtl: ANB_TTL_DAY * 30 });
      }
      await kv.put(anbKey(bot, `await:${tgChat}`), chatId, { expirationTtl: 60 * 60 });
    }
    return;
  }

  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return;
  const from = msg.from || {};
  const text = String(msg.text || '').trim();
  const reply = (t) => anbApi(token, 'sendMessage', { chat_id: msg.chat.id, text: t, parse_mode: 'HTML' });

  if (!isSub(from.id)) {
    await anbAddSub(env, bot, cfg, token, subs, from);
    return reply(`Готово! Сюда будут приходить новые сообщения клиентов из Авито (${escapeHtml(cfg.name)}).\n\n`
      + '🔴 — ещё не ответили, 🟢 — ответили (здесь или на Авито).\n'
      + 'Нажмите «Ответить» под сообщением, напишите текст — он уйдёт клиенту в Авито.');
  }
  if (text.startsWith('/start')) return reply('Вы уже подключены. Новые сообщения клиентов из Авито будут приходить сюда.');
  if (text === '/stop') {
    await kv.put(anbKey(bot, 'subs'), JSON.stringify(subs.filter((s) => String(s.id) !== String(from.id))));
    return reply('Уведомления отключены. Чтобы вернуть — напишите боту /start.');
  }
  if (!text) return reply('Пока можно отправлять клиенту только текст. Фото и файлы — в приложении Авито.');

  let chatId = null;
  if (msg.reply_to_message) chatId = await kv.get(anbKey(bot, `msg:${msg.chat.id}:${msg.reply_to_message.message_id}`));
  if (!chatId) chatId = await kv.get(anbKey(bot, `await:${msg.chat.id}`));
  if (!chatId) return reply('Чтобы ответить клиенту, нажмите «✍️ Ответить» под его сообщением.');

  const account = await anbAccount(env, cfg);
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
  const state = (await kv.get(anbKey(bot, `chat:${chatId}`), 'json')) || {};
  await anbMarkAnswered(env, bot, token, chatId, { via: 'tg', by: from.first_name || from.username, text });
  return reply(`✅ Отправлено: <a href="${anbChatLink(chatId)}">${escapeHtml(state.name || 'клиент')}</a>`);
}

// ── setup: Telegram webhook, bot profile, Avito messenger webhook ──
async function anbSetup(env, bot, cfg, token) {
  const secrets = await anbSecrets(token);
  const results = {};
  results.telegram = await anbApi(token, 'setWebhook', {
    url: `${BOT_WORKER_ORIGIN}/api/avitobot/${bot}/tg`,
    secret_token: secrets.tg,
    allowed_updates: ['message', 'callback_query'],
  });
  results.name = await anbApi(token, 'setMyName', { name: cfg.name });
  results.description = await anbApi(token, 'setMyDescription', {
    description: 'Уведомления о новых сообщениях клиентов на Авито с ответом прямо из Telegram. Нажмите «Старт», чтобы подключиться.',
  });
  results.commands = await anbApi(token, 'setMyCommands', { commands: [{ command: 'stop', description: 'Отключить уведомления' }] });
  const me = await anbApi(token, 'getMe', {});
  try {
    const account = await anbAccount(env, cfg);
    const avitoToken = await avitoGetToken(env, account);
    const res = await avitoRequest(avitoToken, '/messenger/v3/webhook', {
      method: 'POST',
      body: JSON.stringify({ url: `${BOT_WORKER_ORIGIN}/api/avitobot/${bot}/avito/${secrets.avito}` }),
    });
    results.avito = { status: res.status, body: (await res.text().catch(() => '')).slice(0, 300) };
  } catch (err) {
    results.avito = { error: String(err && err.message) };
  }
  const ok = !!(results.telegram && results.telegram.ok) && !!(results.avito && results.avito.status === 200);
  if (ok) await env.AGENCY_DASHBOARD_KV.put(anbKey(bot, 'setup'), ANB_SETUP_VERSION);
  const username = me.ok && me.result && me.result.username;
  return { ok, link: username ? `https://t.me/${username}` : null, results };
}

// ── poll: safety net for missed webhooks ──
async function anbPoll(env, bot, cfg, token) {
  const kv = env.AGENCY_DASHBOARD_KV;
  const account = await anbAccount(env, cfg);
  const avitoToken = await avitoGetToken(env, account);
  const pollKey = anbKey(bot, 'poll');
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
    for (const m of msgs) await anbHandleAvitoMessage(env, bot, cfg, token, account, { ...m, chat_id: c.id });
  }
  if (newest > since) await kv.put(pollKey, String(newest));
}

async function avitoNotifyCron(env) {
  for (const [bot, cfg] of Object.entries(AVITO_NOTIFY_BOTS)) {
    const token = env[cfg.tokenEnv];
    if (!token) continue;
    try {
      if ((await env.AGENCY_DASHBOARD_KV.get(anbKey(bot, 'setup'))) !== ANB_SETUP_VERSION) await anbSetup(env, bot, cfg, token);
      await anbPoll(env, bot, cfg, token);
    } catch (err) {
      console.error(`avito notify bot ${bot} cron failed`, err && err.stack);
    }
  }
}

async function handleAvitoBotApi(request, env, url, ctx) {
  const m = url.pathname.match(/^\/api\/avitobot\/([a-z0-9-]+)\/(tg|avito|setup)(?:\/([a-f0-9]+))?$/);
  const bot = m && m[1];
  const cfg = bot && AVITO_NOTIFY_BOTS[bot];
  if (!cfg) return json({ error: 'not_found' }, 404);
  const token = env[cfg.tokenEnv];
  if (!token) return json({ error: `${cfg.tokenEnv} is not set` }, 503);
  const secrets = await anbSecrets(token);

  if (m[2] === 'setup') {
    if (url.searchParams.get('key') !== DASHBOARD_PASSWORD) return json({ error: 'unauthorized' }, 401);
    const result = await anbSetup(env, bot, cfg, token);
    result.subscribers = (await anbSubs(env, bot)).map((s) => s.name);
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
  if (m[3] !== secrets.avito) return json({ ok: false }, 403);
  const event = await readJson(request);
  const value = event && event.payload && event.payload.type === 'message' ? event.payload.value : null;
  if (value) {
    const work = anbAccount(env, cfg)
      .then((account) => anbHandleAvitoMessage(env, bot, cfg, token, account, value))
      .catch((err) => console.error(`avito notify bot ${bot} avito event failed`, err && err.stack));
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  }
  return json({ ok: true });
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

  if (pathname.startsWith('/api/avito/')) {
    return handleAvitoApi(request, env, url);
  }

  if (pathname.startsWith('/api/salescrm/')) {
    return handleSalesCrmApi(request, env, url);
  }

  if (pathname.startsWith('/api/report-jobs/')) {
    return handleReportJobCallback(request, env, url);
  }

  if (pathname.startsWith('/api/kb-jobs/')) {
    return handleKbJobCallback(request, env, url);
  }

  // Before the dashboard's own routes: the academy has its own sign-in (see handleAcademyApi).
  if (pathname.startsWith('/api/dashboard/academy/')) {
    return handleAcademyApi(request, env, url);
  }

  // Same for Avito Tasks: per-person invite links instead of the dashboard password.
  if (pathname.startsWith('/api/dashboard/avito-tasks/')) {
    return handleAvitoTasksApi(request, env, url, ctx);
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

function withNoIndexHeader(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
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
      return await handleApi(request, env, url, ctx);
    } catch (err) {
      return json({ error: 'server_error', message: String(err && err.message) }, 500);
    }
  },

  // Cron trigger (wrangler.jsonc "triggers") — drives the control bot: AI queue, deadline checks, summaries.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(botScheduled(env).catch((err) => console.error('control bot cron failed', err && err.stack)));
    ctx.waitUntil(avitoPullCron(env).catch((err) => console.error('avito pull cron failed', err && err.stack)));
    ctx.waitUntil(avitoNotifyCron(env).catch((err) => console.error('avito notify cron failed', err && err.stack)));
    ctx.waitUntil(atKbCron(env).catch((err) => console.error('knowledge-base cron failed', err && err.stack)));
  },
};
