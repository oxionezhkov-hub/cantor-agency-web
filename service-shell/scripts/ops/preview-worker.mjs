import { readDobrynina } from "./dobrynina-source.mjs";
// The demo source exposes only fixed-account KV reads. No external API or writes.
async function authorized(request, expected) {
  if (!expected) return false;
  const password = request.headers.get("x-demo-password") || "";
  if (!password || password.length > 1024) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  const actual = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  if (expected.length !== actual.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const headers = {
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    };
    if (path.startsWith("/api/demo/")) {
      const privateHeaders = {
        ...headers,
        "cache-control": "no-store, private",
        vary: "x-demo-password",
      };
      if (request.method !== "GET")
        return Response.json(
          { error: "read_only" },
          { status: 405, headers: { ...privateHeaders, allow: "GET" } },
        );
      if (!(await authorized(request, env.DEMO_PASSWORD_SHA256)))
        return Response.json({ error: "unauthorized" }, { status: 401, headers: privateHeaders });
      if (!["/api/demo/bootstrap", "/api/demo/chat"].includes(path))
        return Response.json({ error: "not_found" }, { status: 404, headers: privateHeaders });
      if (path === "/api/demo/bootstrap" && url.search)
        return Response.json({ error: "invalid_query" }, { status: 400, headers: privateHeaders });
      const id = url.searchParams.get("id");
      if (
        path === "/api/demo/chat" &&
        (!id || id.length > 150 || [...url.searchParams.keys()].some((k) => k !== "id"))
      )
        return Response.json({ error: "invalid_query" }, { status: 400, headers: privateHeaders });
      try {
        const data = await readDobrynina(env, path === "/api/demo/chat" ? id : null);
        return Response.json(data || { error: "not_found" }, {
          status: data ? 200 : 404,
          headers: privateHeaders,
        });
      } catch {
        return Response.json(
          { error: "source_unavailable" },
          { status: 503, headers: privateHeaders },
        );
      }
    }
    if (path.startsWith("/api/") || path.startsWith("/_serverFn")) {
      return Response.json(
        {
          error: "preview_only",
          message: "Рабочие операции отключены. В демо доступны только защищённые маршруты чтения.",
        },
        { status: 503, headers: { ...headers, "cache-control": "no-store" } },
      );
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    if (response.headers.get("content-type")?.includes("text/html") || path === "/__preview.json")
      response.headers.set("cache-control", "no-store");
    return response;
  },
};
