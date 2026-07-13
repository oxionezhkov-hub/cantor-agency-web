/**
 * Cantor Agency — mba-mybrand brief worker.
 * Stores the questionnaire schema and client answers in KV.
 *
 * KV keys:
 *   schema                -> { blocks: [...] }
 *   client:<email-lower>  -> { email, createdAt, updatedAt, currentBlock, answers, notes, shareId }
 *   share:<shareId>       -> "<email-lower>"
 */

const ALLOWED_ORIGINS = [
  'https://cantor.agency',
  'https://www.cantor.agency',
];

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

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowed = origin && (ALLOWED_ORIGINS.includes(origin) || origin === 'null') ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
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
  const stored = await env.KV.get(SCHEMA_KEY, 'json');
  return stored || DEFAULT_SCHEMA;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      // ── Public schema (read) ──
      if (pathname === '/api/schema' && request.method === 'GET') {
        return json(request, await getSchema(env));
      }

      // ── Admin: schema (write) ──
      if (pathname === '/api/admin/schema' && request.method === 'PUT') {
        const body = await readJson(request);
        if (!body || !Array.isArray(body.blocks)) {
          return json(request, { error: 'invalid_schema' }, 400);
        }
        await env.KV.put(SCHEMA_KEY, JSON.stringify(body));
        return json(request, { ok: true });
      }

      // ── Client: get-or-create ──
      if (pathname === '/api/client' && request.method === 'POST') {
        const body = await readJson(request);
        const email = normalizeEmail(body && body.email);
        if (!isValidEmail(email)) return json(request, { error: 'invalid_email' }, 400);

        const key = `client:${email}`;
        let client = await env.KV.get(key, 'json');
        if (!client) {
          client = emptyClient(email);
          await env.KV.put(key, JSON.stringify(client));
        }
        return json(request, { client, schema: await getSchema(env) });
      }

      // ── Client: autosave ──
      if (pathname === '/api/client/save' && request.method === 'POST') {
        const body = await readJson(request);
        const email = normalizeEmail(body && body.email);
        if (!isValidEmail(email)) return json(request, { error: 'invalid_email' }, 400);

        const key = `client:${email}`;
        const existing = (await env.KV.get(key, 'json')) || emptyClient(email);
        const updated = {
          ...existing,
          answers: body.answers && typeof body.answers === 'object' ? body.answers : existing.answers,
          currentBlock: Number.isInteger(body.currentBlock) ? body.currentBlock : existing.currentBlock,
          updatedAt: new Date().toISOString(),
        };
        await env.KV.put(key, JSON.stringify(updated));
        return json(request, { ok: true, updatedAt: updated.updatedAt });
      }

      // ── Admin: list all clients (full records) ──
      if (pathname === '/api/admin/clients' && request.method === 'GET') {
        const list = await env.KV.list({ prefix: 'client:' });
        const records = await Promise.all(list.keys.map((k) => env.KV.get(k.name, 'json')));
        const clients = records.filter(Boolean).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return json(request, { clients });
      }

      // ── Admin: update one client's answers/notes ──
      if (pathname === '/api/admin/client' && request.method === 'PUT') {
        const body = await readJson(request);
        const email = normalizeEmail(body && body.email);
        if (!isValidEmail(email)) return json(request, { error: 'invalid_email' }, 400);

        const key = `client:${email}`;
        const existing = await env.KV.get(key, 'json');
        if (!existing) return json(request, { error: 'not_found' }, 404);

        const updated = {
          ...existing,
          answers: body.answers && typeof body.answers === 'object' ? body.answers : existing.answers,
          notes: typeof body.notes === 'string' ? body.notes : existing.notes,
          updatedAt: new Date().toISOString(),
        };
        await env.KV.put(key, JSON.stringify(updated));
        return json(request, { ok: true, client: updated });
      }

      // ── Admin: create or rotate a public share link for a client ──
      if (pathname === '/api/admin/client/share' && request.method === 'POST') {
        const body = await readJson(request);
        const email = normalizeEmail(body && body.email);
        if (!isValidEmail(email)) return json(request, { error: 'invalid_email' }, 400);

        const key = `client:${email}`;
        const existing = await env.KV.get(key, 'json');
        if (!existing) return json(request, { error: 'not_found' }, 404);

        if (existing.shareId) {
          await env.KV.delete(`share:${existing.shareId}`);
        }
        const shareId = crypto.randomUUID().replace(/-/g, '');
        await env.KV.put(`share:${shareId}`, email);
        const updated = { ...existing, shareId };
        await env.KV.put(key, JSON.stringify(updated));
        return json(request, { ok: true, shareId });
      }

      // ── Admin: revoke a client's share link ──
      if (pathname === '/api/admin/client/unshare' && request.method === 'POST') {
        const body = await readJson(request);
        const email = normalizeEmail(body && body.email);
        if (!isValidEmail(email)) return json(request, { error: 'invalid_email' }, 400);

        const key = `client:${email}`;
        const existing = await env.KV.get(key, 'json');
        if (!existing) return json(request, { error: 'not_found' }, 404);

        if (existing.shareId) await env.KV.delete(`share:${existing.shareId}`);
        const updated = { ...existing, shareId: null };
        await env.KV.put(key, JSON.stringify(updated));
        return json(request, { ok: true });
      }

      // ── Public: read a shared client's answers ──
      if (pathname === '/api/share' && request.method === 'GET') {
        const shareId = url.searchParams.get('id');
        if (!shareId) return json(request, { error: 'missing_id' }, 400);

        const email = await env.KV.get(`share:${shareId}`);
        if (!email) return json(request, { error: 'not_found' }, 404);

        const client = await env.KV.get(`client:${email}`, 'json');
        if (!client) return json(request, { error: 'not_found' }, 404);

        return json(request, { client, schema: await getSchema(env) });
      }

      return json(request, { error: 'not_found' }, 404);
    } catch (err) {
      return json(request, { error: 'server_error', message: String(err && err.message) }, 500);
    }
  },
};
