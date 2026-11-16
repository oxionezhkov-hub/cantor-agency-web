// Isolated UI preview: no production databases, credentials, bot or Avito binding.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const headers = { "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };
    if (path.startsWith("/api/") || path.startsWith("/_serverFn")) {
      return Response.json({ error: "preview_only", message: "Это превью интерфейса на демоданных. Рабочее API не подключено." }, { status: 503, headers: { ...headers, "cache-control": "no-store" } });
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    if (response.headers.get("content-type")?.includes("text/html") || path === "/__preview.json") response.headers.set("cache-control", "no-store");
    return response;
  },
};
