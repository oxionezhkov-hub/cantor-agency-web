export type AiSettings = {
  selfCheck?: boolean;
  model: string;
  system: string;
  knowledge: string;
  scripts: string;
  slots: string;
};
export let settings: AiSettings | null = null;
export let modelOptions = [
  { value: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 · 70B" },
];
export async function loadAiSettings() {
  if (settings) return settings;
  const r = await fetch("/api/demo/ai-manager", { cache: "no-store" });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Не удалось загрузить настройки");
  settings = data.settings;
  modelOptions = data.models;
  return settings!;
}
export async function generateAi(messages: { role: string; content: string }[], feedback: string) {
  const s = await loadAiSettings();
  const r = await fetch("/api/demo/ai-manager", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings: s, messages: messages.slice(-60), feedback }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Не удалось подготовить ответ");
  return data.text as string;
}

export function updateAiSettings(next: AiSettings) {
  settings = next;
}
