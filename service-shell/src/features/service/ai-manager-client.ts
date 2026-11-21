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
export type AiExample = { id: string; question: string; original: string; answer: string };
export let aiExamples: AiExample[] = [];

export function rememberAiExample(question: string, original: string, answer: string) {
  aiExamples = [
    ...aiExamples.filter((example) => example.question !== question),
    { id: crypto.randomUUID(), question, original, answer },
  ].slice(-8);
}

export function removeAiExample(id: string) {
  aiExamples = aiExamples.filter((example) => example.id !== id);
}

export async function generateAi(messages: { role: string; content: string }[], feedback: string) {
  const s = await loadAiSettings();
  const examples: string[] = [];
  for (const { question, answer } of [...aiExamples].reverse()) {
    const example = JSON.stringify({ question, preferredAnswer: answer });
    if (examples.join("\n").length + example.length > 5200) break;
    examples.push(example);
  }
  const context = [...examples, feedback].filter(Boolean).join("\n").slice(0, 6000);
  const r = await fetch("/api/demo/ai-manager", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings: s, messages: messages.slice(-60), feedback: context }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Не удалось подготовить ответ");
  return data.text as string;
}

export function updateAiSettings(next: AiSettings) {
  settings = next;
}

export type AiBlock = { title: string; text: string; separator: string };
const headings =
  /^(?:Как пишет[^:\n]*|Правила[^:\n]*|С кем работает|Бесплатная диагностика|Форматы и стоимость|Контакты[^:\n]*):/i;

export function splitAiBlocks(text: string, firstTitle: string): AiBlock[] {
  const parts = text.split(/(\r?\n(?:[ \t]*\r?\n)*)/);
  const blocks: AiBlock[] = [{ title: firstTitle, text: parts[0], separator: "" }];
  for (let i = 1; i < parts.length; i += 2) {
    const [separator, line] = [parts[i], parts[i + 1]];
    const heading = line.match(headings)?.[0].slice(0, -1);
    if (heading || (separator.split("\n").length > 2 && line.trim())) {
      blocks.push({ title: heading || line.slice(0, 60), text: line, separator });
    } else {
      blocks.at(-1)!.text += separator + line;
    }
  }
  return blocks;
}
