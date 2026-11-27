import { passwordAuthorized, sessionAuthorized } from "./demo-session.mjs";

export async function adSheetSync(request, env) {
  const reply = (data, status = 200) =>
    Response.json(data, { status, headers: { "cache-control": "no-store, private" } });
  if (!env.AD_SHEET_TEST_URL || !env.AD_SHEET_TEST_SECRET)
    return reply({ error: "not_connected" }, 404);
  if (
    !(await passwordAuthorized(request, env.DEMO_PASSWORD_SHA256)) &&
    !(await sessionAuthorized(request, env.DEMO_PASSWORD_SHA256))
  ) {
    return reply({ error: "unauthorized" }, 401);
  }
  if (!["GET", "POST"].includes(request.method)) return reply({ error: "method" }, 405);
  let input = { action: "list" };
  if (request.method === "POST") {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return reply({ error: "origin" }, 403);
    try {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      let json = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1048576) {
          await reader.cancel();
          return reply({ error: "batch_too_large" }, 413);
        }
        json += decoder.decode(value, { stream: true });
      }
      const data = JSON.parse(json + decoder.decode());
      if (!Array.isArray(data.edits) || !data.edits.length || data.edits.length > 300) {
        return reply({ error: "invalid_request" }, 400);
      }
      input = { action: "save", edits: data.edits };
    } catch {
      return reply({ error: "invalid_request" }, 400);
    }
  }
  try {
    const endpoint = new URL(env.AD_SHEET_TEST_URL);
    if (
      endpoint.origin !== "https://script.google.com" ||
      !/^\/macros\/s\/[\w-]+\/exec$/.test(endpoint.pathname)
    ) {
      return reply({ error: "invalid_configuration" }, 503);
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, token: env.AD_SHEET_TEST_SECRET }),
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
    });
    const redirect =
      response.status === 302 || response.status === 303
        ? new URL(response.headers.get("location"), endpoint)
        : null;
    if (redirect && redirect.origin !== "https://script.googleusercontent.com") {
      return reply({ error: "sheet_unavailable" }, 503);
    }
    const payload = redirect
      ? await fetch(redirect, { redirect: "error", signal: AbortSignal.timeout(10000) })
      : response;
    if (!payload.ok) return reply({ error: "sheet_unavailable" }, 503);
    const data = await payload.json();
    if (data.error)
      return reply(
        { error: data.error === "invalid_template" ? data.error : "sheet_unavailable" },
        503,
      );
    return reply(data);
  } catch {
    return reply({ error: "sheet_unavailable" }, 503);
  }
}
