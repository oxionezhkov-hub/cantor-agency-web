// Uploaded as an UNDEPLOYED version of mainweb to reuse its existing bot secret.
// Never deploy this module as the production mainweb Worker.
export const MAX_BODY = 12_000;

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error("too_large"); }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(data);
}

export async function authorized(request, env, body, now = Date.now()) {
  const expires = Date.parse(env.CODEX_NOTIFY_EXPIRES_AT || "");
  if (!env.CODEX_NOTIFY_SIGNING_KEY || !Number.isFinite(expires) || now >= expires) return false;
  const timestamp = request.headers.get("x-cantor-timestamp") || "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300_000) return false;
  const signature = request.headers.get("x-cantor-signature") || "";
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.CODEX_NOTIFY_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${timestamp}\n${new URL(request.url).pathname}\n${body}`));
}

export default {
  async fetch(request, env) {
    const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };
    const reply = (data, status = 200) => Response.json(data, { status, headers });
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/identity", "/notify"].includes(path)) return reply({ error: "not_found" }, 404);
    let body;
    try { body = await readBody(request); } catch { return reply({ error: "body_too_large" }, 413); }
    if (!await authorized(request, env, body)) return reply({ error: "unauthorized" }, 401);
    if (!env.CONTROL_BOT_TOKEN || !/^\d+$/.test(env.CODEX_NOTIFY_OWNER || "")) return reply({ error: "not_configured" }, 503);
    let payload;
    try { payload = JSON.parse(body); } catch { return reply({ error: "invalid_json" }, 400); }
    if (path === "/notify" && (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 3500 || "chatId" in payload || "chat_id" in payload)) return reply({ error: "invalid_message" }, 422);
    try {
      const method = path === "/identity" ? "getMe" : "sendMessage";
      const res = await fetch(`https://api.telegram.org/bot${env.CONTROL_BOT_TOKEN}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(path === "/identity" ? {} : { chat_id: env.CODEX_NOTIFY_OWNER, text: payload.text, link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return reply({ error: "telegram_failed", code: data.error_code || res.status }, 502);
      if (path === "/identity") return reply({ ok: true, bot: { id: data.result.id, name: data.result.first_name, username: data.result.username }, recipient: env.CODEX_NOTIFY_OWNER });
      return reply({ ok: true, messageId: data.result.message_id, recipient: String(data.result.chat.id) });
    } catch { return reply({ error: "telegram_unavailable" }, 502); }
  },
};
