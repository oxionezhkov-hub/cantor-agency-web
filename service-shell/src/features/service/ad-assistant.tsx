import { useState } from "react";
import { ArrowLeft, ImagePlus, Sparkles } from "lucide-react";
import { AdsSelect } from "./ads-controls";
import { getAdPreflightWarnings } from "./ad-preflight";
import type { CampaignDraft } from "./ad-campaign";
import "./ad-campaign.css";

type Source = CampaignDraft & { id: string };
type Draft = Omit<CampaignDraft, "city" | "price"> & { cities: string; price: string };
const words = (value: string) => value.toLocaleLowerCase("ru").match(/[\p{L}\d]{3,}/gu) ?? [];

async function generate(input: object) {
  const response = await fetch("/api/demo/campaign/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(data?.message || "Генерация недоступна. Попробуйте ещё раз.");
  return data;
}

export function AdAssistant({
  sources,
  onAdd,
  onBatch,
}: {
  sources: Source[];
  onAdd: (drafts: CampaignDraft[]) => boolean;
  onBatch: () => void;
}) {
  const [mode, setMode] = useState<"request" | "template">("request");
  const [sourceId, setSourceId] = useState("");
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [references, setReferences] = useState<Source[]>([]);
  const [approved, setApproved] = useState(false);
  const [image, setImage] = useState("");
  const [imageNote, setImageNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const selected = sources.find((item) => item.id === sourceId);
  const cities = [
    ...new Map(
      draft?.cities
        .split(/[,;\n]+/)
        .map((city) => city.trim())
        .filter(Boolean)
        .map((city) => [city.toLocaleLowerCase("ru"), city]),
    ).values(),
  ];
  const price = Number(draft?.price.replace(",", "."));
  const valid = !!(
    draft?.title.trim() &&
    draft?.text.trim() &&
    draft.price.trim() &&
    Number.isFinite(price) &&
    price > 0 &&
    cities.length > 0 &&
    cities.length <= 100
  );
  const warnings = draft
    ? getAdPreflightWarnings({ title: draft.title, text: draft.text, price })
    : [];

  async function prepare() {
    setBusy("draft");
    setError("");
    const terms = new Set(words(request));
    const candidates = sources
      .filter((item) => item.text.trim())
      .map((item) => ({
        item,
        score: [...new Set(words(item.title + " " + item.text))].filter((word) => terms.has(word))
          .length,
      }))
      .sort((a, b) => b.score - a.score);
    const examples =
      selected && mode === "template"
        ? [selected]
        : candidates
            .filter((x) => x.score > 0)
            .slice(0, 3)
            .map((x) => x.item);
    try {
      const result = await generate({
        action: "draft",
        request,
        examples: examples.map(({ title, text, city, price }) => ({
          title: title.slice(0, 250),
          text: text.slice(0, 850),
          city,
          price: Number.isFinite(price) ? price : null,
        })),
        template: mode === "template",
      });
      const baseline = mode === "template" ? selected : undefined;
      setDraft({
        title: result.draft.title,
        text: result.draft.text,
        cities: (result.draft.cities.length ? result.draft.cities : [baseline?.city || ""]).join(
          ", ",
        ),
        price: String(
          result.draft.price ?? (Number.isFinite(baseline?.price) ? baseline?.price : ""),
        ),
        photos: baseline?.photos ?? [],
      });
      setReferences(examples);
      setApproved(false);
      setImage("");
      setImageNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подготовить черновик.");
    } finally {
      setBusy("");
    }
  }
  async function createImage() {
    if (!draft) return;
    setBusy("image");
    setError("");
    try {
      const result = await generate({
        action: "image",
        title: draft.title.slice(0, 250),
        text: draft.text.slice(0, 800),
        note: imageNote,
      });
      setImage(result.image);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать изображение.");
    } finally {
      setBusy("");
    }
  }
  function save(photos: string[]) {
    if (!draft || !approved || !valid) return;
    if (
      onAdd(
        cities.map((city) => ({
          city,
          price,
          photos,
          title: draft.title.trim().replaceAll("{город}", city),
          text: draft.text.trim().replaceAll("{город}", city),
        })),
      )
    )
      setSaved(cities.length);
  }

  return (
    <div className="ac ac-assistant">
      {saved > 0 ? (
        <section className="ac-panel">
          <h2>Черновики добавлены</h2>
          <p>Объявлений: {saved}. Их можно открыть в списке. В Авито они не отправлены.</p>
          <button
            className="aw-btn aw-primary"
            onClick={() => {
              setSaved(0);
              setDraft(null);
              setError("");
            }}
          >
            Создать ещё
          </button>
        </section>
      ) : !draft ? (
        <section className="ac-panel">
          <div className="ac-top">
            <div>
              <h2>Создать объявление с ИИ</h2>
              <p>
                Опишите задачу или выберите прошлое объявление. ИИ предложит черновик на
                согласование.
              </p>
            </div>
          </div>
          <div className="ac-switch">
            <button
              className="aw-btn"
              aria-pressed={mode === "request"}
              onClick={() => setMode("request")}
            >
              Описать задачу
            </button>
            <button
              className="aw-btn"
              aria-pressed={mode === "template"}
              onClick={() => setMode("template")}
            >
              Взять прошлое объявление
            </button>
          </div>
          {mode === "template" && (
            <label>
              Шаблон из объявлений
              <AdsSelect
                label="Шаблон из объявлений"
                value={sourceId}
                options={[
                  { value: "", label: "Выберите объявление" },
                  ...sources
                    .filter((item) => item.text.trim())
                    .map((item) => ({
                      value: item.id,
                      label: [item.city, item.title].filter(Boolean).join(" · "),
                    })),
                ]}
                onChange={setSourceId}
              />
            </label>
          )}
          <label>
            {mode === "request" ? "Какое объявление нужно?" : "Что изменить в шаблоне?"}
            <textarea
              maxLength={1600}
              rows={4}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={
                mode === "request"
                  ? "Например: подготовка к ОГЭ по русскому онлайн, 1 500 ₽, Казань и Самара"
                  : "Например: сделать акцент на подготовке к ОГЭ. Можно оставить пустым."
              }
            />
          </label>
          <button
            className="aw-btn aw-primary"
            disabled={!!busy || (mode === "template" ? !selected : !request.trim())}
            onClick={prepare}
          >
            <Sparkles size={16} />
            {busy === "draft" ? "Готовим черновик…" : "Подготовить объявление"}
          </button>
          <button className="aw-text-button ac-batch-link" onClick={onBatch} disabled={!!busy}>
            Ручное создание и партии
          </button>
        </section>
      ) : !approved ? (
        <section className="ac-panel">
          <button
            className="aw-text-button"
            onClick={() => {
              setDraft(null);
              setError("");
            }}
          >
            <ArrowLeft size={15} />К задаче
          </button>
          <h2>Проверьте объявление</h2>
          {references.length > 0 && (
            <details className="ac-references">
              <summary>На основе прошлых объявлений · {references.length}</summary>
              <ul>
                {references.map((item) => (
                  <li key={item.id}>
                    {item.city} · {item.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <label>
            Заголовок
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Текст
            <textarea
              rows={6}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </label>
          <div className="ac-settings">
            <label>
              Города
              <input
                placeholder="Например, Казань, Самара"
                value={draft.cities}
                onChange={(e) => setDraft({ ...draft, cities: e.target.value })}
              />
            </label>
            <label>
              Цена занятия, ₽
              <input
                placeholder="Укажите цену"
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </label>
          </div>
          {!valid && (
            <p>
              Проверьте заголовок, текст, цену и список городов. Можно добавить до 100 городов через
              запятую.
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="aw-preflight">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <button
            className="aw-btn aw-primary"
            disabled={!valid}
            onClick={() => {
              setApproved(true);
              setImage("");
              void createImage();
            }}
          >
            Согласовать и перейти к картинкам
          </button>
        </section>
      ) : (
        <section className="ac-panel">
          <button
            className="aw-text-button"
            disabled={!!busy}
            onClick={() => {
              setApproved(false);
              setError("");
            }}
          >
            <ArrowLeft size={15} />К объявлению
          </button>
          <h2>Картинки для объявления</h2>
          <p>
            {draft.title} · {cities.join(", ")}
          </p>
          {image && (
            <img
              className="ac-generated-image"
              src={image}
              alt="Сгенерированная обложка объявления"
            />
          )}
          <details className="ac-references">
            <summary>Уточнить, что нарисовать</summary>
            <label>
              Пожелания к картинке
              <textarea
                rows={2}
                maxLength={400}
                value={imageNote}
                onChange={(e) => setImageNote(e.target.value)}
                placeholder="Например, тетрадь и учебники на светлом столе"
              />
            </label>
          </details>
          <div className="ac-ai-row">
            <button
              className={image ? "aw-btn" : "aw-btn aw-primary"}
              disabled={!!busy}
              onClick={createImage}
            >
              <ImagePlus size={16} />
              {busy
                ? "Создаём картинку…"
                : image
                  ? "Сгенерировать другую"
                  : "Сгенерировать картинку"}
            </button>
            {image && (
              <button
                className="aw-btn aw-primary"
                disabled={!!busy}
                onClick={() => save([image, ...draft.photos])}
              >
                Согласовать картинку и добавить
              </button>
            )}
            <button className="aw-btn" disabled={!!busy} onClick={() => save(draft.photos)}>
              {draft.photos.length ? "Оставить исходные фото" : "Добавить без картинки"}
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="aw-notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
