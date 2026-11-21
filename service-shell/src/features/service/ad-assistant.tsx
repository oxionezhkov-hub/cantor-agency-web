import { useState } from "react";
import { ArrowLeft, ImagePlus, Sparkles } from "lucide-react";
import { AdsSelect } from "./ads-controls";
import { adVariants, checkAdVariants, recommendAdSettings } from "./ad-assistant-model";
import { createAdCover } from "./ad-cover";
import type { CampaignDraft } from "./ad-campaign";
import "./ad-campaign.css";

type Source = CampaignDraft & { id: string; views?: number; contacts?: number; status?: string };
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
  const [photo, setPhoto] = useState("");
  const [previewCity, setPreviewCity] = useState("");
  const [reviewed, setReviewed] = useState("");
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
  const historical = sources.filter((item) => item.status !== "draft");
  const recommendations = recommendAdSettings(historical);
  const texts = adVariants(draft?.text ?? "", cities.length ? cities : [""]);
  const checks = checkAdVariants(draft?.title.trim() ?? "", texts, price, cities, historical);
  const preview = texts[Math.max(0, cities.indexOf(previewCity))] ?? "";
  const availablePhotos = [
    ...new Set([...(draft?.photos ?? []), ...references.flatMap((item) => item.photos)]),
  ].slice(0, 8);
  const valid = !!(
    draft?.title.trim() &&
    draft?.text.trim() &&
    draft.price.trim() &&
    Number.isFinite(price) &&
    price > 0 &&
    cities.length > 0 &&
    cities.length <= 100
  );

  async function prepare() {
    setBusy("draft");
    setError("");
    const terms = new Set(words(request));
    const candidates = historical
      .filter((item) => item.text.trim())
      .map((item) => ({
        item,
        score: [...new Set(words(item.title + " " + item.text))].filter((word) => terms.has(word))
          .length,
      }))
      .sort((a, b) => b.score - a.score || (b.item.contacts || 0) - (a.item.contacts || 0));
    const examples =
      selected && mode === "template"
        ? [selected]
        : candidates
            .filter((x) => x.score > 0)
            .filter((x, index, all) => all.findIndex((y) => y.item.text === x.item.text) === index)
            .slice(0, 3)
            .map((x) => x.item);
    try {
      const result = await generate({
        action: "draft",
        request,
        examples: examples.map(({ title, text, city, price }) => ({
          title: title.slice(0, 250),
          text: text.slice(0, 1250),
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
      setPhoto("");
      setReviewed("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подготовить черновик.");
    } finally {
      setBusy("");
    }
  }
  async function createImage(reference = photo || availablePhotos[0]) {
    if (!draft || !reference) return;
    setBusy("image");
    setError("");
    setPhoto(reference);
    setImage("");
    try {
      const format = /онлайн|дистанцион/i.test(draft.title + " " + draft.text)
        ? "Онлайн-занятия"
        : "Репетитор";
      setImage(await createAdCover(reference, draft.title, format));
    } catch {
      setError("Не удалось собрать обложку из этого фото. Выберите другое или загрузите файл.");
    } finally {
      setBusy("");
    }
  }
  function save(photos: string[]) {
    if (!draft || !approved || !valid || checks.errors.length) return;
    if (
      onAdd(
        cities.map((city, index) => ({
          city,
          price,
          photos,
          title: draft.title.trim().replaceAll("{город}", city),
          text: texts[index],
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
          <div className="ac-advice">
            <strong>Рекомендации по объявлениям кабинета</strong>
            {recommendations.cities.length ? (
              <div className="ac-ai-row">
                {recommendations.cities.map((item) => (
                  <button
                    key={item.city}
                    className="aw-btn"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        cities: [...new Set([...cities, item.city])].join(", "),
                      })
                    }
                  >
                    {item.city} · {item.contacts} конт.
                  </button>
                ))}
              </div>
            ) : (
              <p>В истории пока нет городов с подтверждёнными контактами.</p>
            )}
            {recommendations.price !== null && (
              <p>
                <button
                  className="aw-btn"
                  onClick={() => setDraft({ ...draft, price: String(recommendations.price) })}
                >
                  Подставить {recommendations.price.toLocaleString("ru-RU")} ₽
                </button>{" "}
                Медиана по {recommendations.samples} ценам кабинета. Диапазон{" "}
                {recommendations.low.toLocaleString("ru-RU")}–
                {recommendations.high?.toLocaleString("ru-RU")} ₽.
              </p>
            )}
            <small>
              Города ранжированы по числу контактов за доступный период. Это собственная история,
              без оценки рынка.
            </small>
          </div>
          <div className="ac-advice">
            <strong>
              Предпросмотр описания · вариантов {checks.unique} из {texts.length}
            </strong>
            {cities.length > 1 && (
              <AdsSelect
                label="Город предпросмотра"
                value={cities.includes(previewCity) ? previewCity : cities[0]}
                options={cities.map((value) => ({ value, label: value }))}
                onChange={setPreviewCity}
              />
            )}
            {preview.split(/\n\s*\n/).map((paragraph, index) =>
              index === 0 ? (
                <p key={index}>
                  <strong>{paragraph}</strong>
                </p>
              ) : (
                <p key={index}>{paragraph}</p>
              ),
            )}
            <small>
              Для вариантов фраз используйте {"{Напишите в чат|Расскажите о задаче в чате}"}.
            </small>
          </div>
          <div className="ac-advice">
            <strong>Проверка перед согласованием</strong>
            {checks.errors.length + checks.warnings.length ? (
              <ul className="aw-preflight">
                {[...checks.errors, ...checks.warnings].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>Проверки длины, цены, формата, контактов и совпадений пройдены.</p>
            )}
            {checks.warnings.length > 0 && (
              <label className="ac-confirm">
                <input
                  type="checkbox"
                  checked={reviewed === checks.warnings.join("\n")}
                  onChange={(e) => setReviewed(e.target.checked ? checks.warnings.join("\n") : "")}
                />
                Я проверил замечания
              </label>
            )}
          </div>
          <button
            className="aw-btn aw-primary"
            disabled={
              !valid ||
              !!checks.errors.length ||
              (!!checks.warnings.length && reviewed !== checks.warnings.join("\n"))
            }
            onClick={() => {
              setApproved(true);
              setImage("");
              setError("");
              if (availablePhotos[0]) void createImage(availablePhotos[0]);
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
          <div className="ac-advice">
            <strong>Исходные фото из ваших объявлений</strong>
            {availablePhotos.length > 0 ? (
              <div className="ac-cover-options">
                {availablePhotos.map((url, index) => (
                  <button
                    key={url}
                    type="button"
                    className="aw-btn"
                    aria-label={`Обложка из фото ${index + 1}`}
                    aria-pressed={photo === url}
                    disabled={!!busy}
                    onClick={() => void createImage(url)}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            ) : (
              <p>Выберите фото репетитора. На его основе соберём обложку с заголовком.</p>
            )}
            <label>
              Загрузить своё фото
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!!busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 12_000_000) {
                    setError("Выберите фото до 12 МБ.");
                    return;
                  }
                  const url = URL.createObjectURL(file);
                  void createImage(url).finally(() => URL.revokeObjectURL(url));
                }}
              />
            </label>
          </div>
          <div className="ac-ai-row">
            {busy && (
              <p role="status">
                <ImagePlus size={16} /> Собираем обложку…
              </p>
            )}
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
