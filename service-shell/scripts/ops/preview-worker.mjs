import { readDobrynina } from "./dobrynina-source.mjs";
import { passwordAuthorized, imageSessionCookie, sessionAuthorized } from "./demo-session.mjs";
// The demo source exposes only fixed-account KV reads. No external API or writes.
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
      const imageRequest = path === "/api/demo/image";
      if (
        !(await passwordAuthorized(request, env.DEMO_PASSWORD_SHA256)) &&
        !(await sessionAuthorized(request, env.DEMO_PASSWORD_SHA256))
      )
        return Response.json({ error: "unauthorized" }, { status: 401, headers: privateHeaders });
      if (!["/api/demo/bootstrap", "/api/demo/chat", "/api/demo/image"].includes(path))
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
        if (imageRequest) {
          const key = url.searchParams.get("key");
          const adId = url.searchParams.get("adId");
          const index = url.searchParams.get("index");
          if ([...url.searchParams.keys()].some((k) => !["adId", "index", "key"].includes(k)))
            return Response.json({ error: "invalid_query" }, { status: 400, headers: privateHeaders });
          let imageKey = key;
          if (!key && /^\d+$/.test(adId || "") && /^\d{1,2}$/.test(index || "")) {
            const data = await readDobrynina(env);
            const imageUrl = data.ads.find((a) => a.id === adId)?.photos?.[Number(index)];
            if (!imageUrl) return new Response(null, { status: 404, headers: privateHeaders });
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(imageUrl));
            imageKey = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
          }
          if (!/^[a-f0-9]{64}$/.test(imageKey || "") || (key && (adId || index)))
            return Response.json({ error: "invalid_query" }, { status: 400, headers: privateHeaders });
          const image = await env.DEMO_DATA.get(`image:${imageKey}`, "arrayBuffer");
          if (!image) return new Response(null, { status: 404, headers: privateHeaders });
          return new Response(image, { headers: { ...privateHeaders, "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
        }

        const data = await readDobrynina(env, path === "/api/demo/chat" ? id : null);
        if (path === "/api/demo/bootstrap") {
          privateHeaders["set-cookie"] = await imageSessionCookie(env.DEMO_PASSWORD_SHA256);
          const localAvatar = async (source) => {
            if (!source || !source.startsWith("https://")) return "";
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
            const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
            return `${url.origin}/api/demo/image?key=${key}`;
          };
          data.tutorAvatarUrl = await localAvatar(data.tutorAvatarUrl);
          await Promise.all(data.chats.map(async (chat) => {
            chat.avatarUrl = await localAvatar(chat.avatarUrl);
          }));
        }
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
