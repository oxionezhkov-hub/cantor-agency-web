// Server-to-server only. Telegram credentials live in Yandex and are never persisted here.
const reply = (status, body) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/telegram') return reply(404, { error: 'not_found' });
    if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    if (!env.TELEGRAM_RELAY_SECRET) return reply(503, { error: 'relay_not_configured' });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.TELEGRAM_RELAY_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const challenge = encoder.encode('karlova-telegram-relay');
    const provided = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    const providedKey = await crypto.subtle.importKey('raw', encoder.encode(provided || 'missing'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', providedKey, challenge);
    if (!await crypto.subtle.verify('HMAC', key, signature, challenge)) return reply(401, { error: 'unauthorized' });

    // Bound the body while streaming; content-length alone is not trustworthy.
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: 'invalid_body' });
    let size = 0;
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 60000) { await reader.cancel(); return reply(413, { error: 'body_too_large' }); }
      parts.push(value);
    }
    let body;
    try { body = await new Response(new Blob(parts)).json(); }
    catch { return reply(400, { error: 'invalid_json' }); }
    const { token, chatIds, text } = body || {};
    if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)
      || !Array.isArray(chatIds) || !chatIds.length || chatIds.length > 10
      || !chatIds.every(id => typeof id === 'string' && /^-?\d{1,20}$/.test(id))
      || typeof text !== 'string' || !text.trim() || text.length > 40000) {
      return reply(400, { error: 'invalid_payload' });
    }
    // Plain text and short chunks avoid Telegram HTML and message-length failures.
    const chars = Array.from(text);
    const chunks = [];
    for (let i = 0; i < chars.length; i += 1800) chunks.push(chars.slice(i, i + 1800).join(''));
    const deadline = AbortSignal.timeout(17000);
    const results = await Promise.allSettled([...new Set(chatIds)].map(async chatId => {
      for (const chunk of chunks) {
        let res;
        try { res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
          signal: deadline,
        }); } catch (error) { throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'telegram_timeout' : 'telegram_unreachable'); }
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const description = String(data?.description || '').toLowerCase();
          const code = res.status === 401 ? 'bot_unauthorized'
            : description.includes('chat not found') ? 'chat_not_found'
            : description.includes('blocked by the user') ? 'bot_blocked'
            : res.status === 403 ? 'telegram_forbidden'
            : res.status === 429 ? 'telegram_rate_limited' : 'telegram_rejected';
          throw new Error(code);
        }
      }
    }));
    const delivered = results.filter(result => result.status === 'fulfilled').length;
    // Do not return or log Telegram responses: they contain recipient details.
    const failureCodes = [...new Set(results.filter(result => result.status === 'rejected').map(result => result.reason.message))];
    return reply(delivered ? 200 : 502, { ok: delivered > 0, delivered, failed: results.length - delivered, ...(failureCodes.length ? { failureCodes } : {}) });
  },
};
