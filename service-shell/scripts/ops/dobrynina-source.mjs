// Deliberately no fetch(), KV writes, account credentials, or production API proxy.
const ACCOUNT = "6c974a5d5326";
const PROJECT = "elena-dobrynina";
export async function readDobrynina(env, chatId = null) {
  const index = await env.DEMO_AVITO.get(`aisales:index:${ACCOUNT}`, "json");
  if (!index?.chats) throw new Error("source_unavailable");
  if (chatId !== null) {
    if (!Object.hasOwn(index.chats, chatId)) return null;
    const chat = await env.DEMO_AVITO.get(`aisales:chat:${ACCOUNT}:${chatId}`, "json");
    if (!chat) return null;
    return {
      id: chatId,
      syncedAt: chat.syncedAt,
      messages: (chat.messages || []).map((m) => ({
        id: m.id,
        at: m.at,
        author: m.author,
        type: m.type,
        text: m.text,
      })),
    };
  }
  const catalog = await env.DEMO_AVITO.get(`mbids:catalog:${ACCOUNT}`, "json");
  if (!catalog?.items) throw new Error("catalog_unavailable");
  // Read only public ad content; contact details and feed credentials never leave the Worker.
  const xml = await env.DEMO_AVITO.get("feedxml:elena-dobryinina-eba937");
  const content = new Map();
  for (const match of (xml || "").matchAll(/<Ad(?:\s[^>]*)?>([\s\S]*?)<\/Ad>/g)) {
    const id = match[1].match(/<AvitoId>(\d+)<\/AvitoId>/)?.[1];
    const description = match[1].match(/<Description>([\s\S]*?)<\/Description>/)?.[1];
    if (id && description)
      content.set(
        id,
        description
          .replace(/<!\[CDATA\[|\]\]>/g, "")
          .replace(/<br\s*\/?>|<\/p>/gi, "\n")
          .replace(/<[^>]*>/g, ""),
      );
  }
  const dailyKeys = [];
  let cursor;
  do {
    const page = await env.DEMO_DASHBOARD.list({ prefix: `dailyMetrics:${PROJECT}:`, cursor });
    dailyKeys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
    if (!page.list_complete && !cursor) throw new Error("source_incomplete");
  } while (cursor);
  const daily = [];
  for (let i = 0; i < dailyKeys.length; i += 20) {
    const rows = await Promise.all(
      dailyKeys.slice(i, i + 20).map((k) => env.DEMO_DASHBOARD.get(k.name, "json")),
    );
    daily.push(
      ...rows
        .filter((r) => r?.projectId === PROJECT)
        .map((r) => ({
          date: r.date,
          budget: r.budget,
          views: r.views,
          contacts: r.contacts,
          diagnostics: r.diagnostics,
          sales: r.sales,
          updatedAt: r.updatedAt,
        })),
    );
  }
  const chats = [];
  const indexed = Object.values(index.chats);
  for (let i = 0; i < indexed.length; i += 20) {
    const batch = await Promise.all(
      indexed.slice(i, i + 20).map(async (c) => {
        const stored = await env.DEMO_AVITO.get(`aisales:chat:${ACCOUNT}:${c.chatId}`, "json");
        return {
          id: c.chatId,
          name: c.name,
          itemId: c.itemId,
          itemTitle: c.itemTitle,
          city: c.itemCity,
          lastAt: c.lastAt,
          lastText: c.lastText,
          lastAuthor: c.lastAuthor,
          messageCount: c.msgCount,
          messages: (stored?.messages || []).map((m) => ({
            id: m.id,
            at: m.at,
            author: m.author,
            type: m.type,
            text: m.text,
          })),
        };
      }),
    );
    chats.push(...batch);
  }
  return {
    mode: "read-only",
    tutor: "Елена Добрынина",
    subject: "Русский язык · ОГЭ и ЕГЭ",
    readAt: new Date().toISOString(),
    catalogAt: catalog?.at ?? null,
    chatsAt: index.lastSyncAt ?? null,
    ads: (catalog?.items || []).map((a) => ({
      id: a.id,
      title: a.title,
      city: a.city,
      price: a.price,
      status: a.status,
      url: a.url,
      description: content.get(String(a.id)) || null,
    })),
    daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    chats: chats.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)),
  };
}
