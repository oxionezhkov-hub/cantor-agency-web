import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, Sparkles, X } from "lucide-react";
import { AdsSelect } from "./ads-controls";
import { getAdPreflightWarnings } from "./ad-preflight";
import "./ad-campaign.css";

type Source = {
  id: string;
  title: string;
  text: string;
  price: number;
  photos: string[];
  city: string;
};
export type CampaignDraft = {
  title: string;
  text: string;
  city: string;
  price: number;
  photos: string[];
};
const popular = [
  "Москва",
  "Санкт-Петербург",
  "Казань",
  "Новосибирск",
  "Екатеринбург",
  "Краснодар",
  "Самара",
  "Омск",
  "Уфа",
  "Пермь",
];
const splitCities = (text: string) => [
  ...new Map(
    text
      .split(/[\n;,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => [x.toLocaleLowerCase("ru"), x]),
  ).values(),
];
export function AdCampaign({
  sources,
  onAdd,
  onSingle,
}: {
  sources: Source[];
  onAdd: (drafts: CampaignDraft[]) => boolean;
  onSingle: () => void;
}) {
  const [source, setSource] = useState("");
  const [facts, setFacts] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [price, setPrice] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [citiesInput, setCitiesInput] = useState("");
  const [variants, setVariants] = useState<{ title: string; text: string }[]>([]);
  const [count, setCount] = useState("1");
  const [drafts, setDrafts] = useState<CampaignDraft[]>([]);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  const cities = useMemo(() => splitCities(citiesInput), [citiesInput]);
  function invalidate() {
    setDrafts([]);
    setAccepted(false);
    setMessage("");
  }
  function useSource(id: string) {
    setSource(id);
    invalidate();
    const item = sources.find((x) => x.id === id);
    if (item) {
      setTitle(item.title);
      setText(item.text);
      setPrice(Number.isFinite(item.price) ? String(item.price) : "");
      setPhotos(item.photos);
      setVariants([]);
    }
  }
  async function suggest() {
    if (!facts.trim() && !text.trim()) {
      setMessage("Добавьте факты о преподавателе или выберите готовое объявление.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/campaign/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facts, title, text, count: Number(count) }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message ||
            "Не удалось подготовить варианты. Попробуйте позже или заполните текст самостоятельно.",
        );
      setVariants(result.variants);
      invalidate();
      setMessage(
        "Варианты готовы. Проверьте факты и отредактируйте тексты перед созданием партии.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Генерация недоступна");
    } finally {
      setBusy(false);
    }
  }
  function prepare() {
    const templates = variants.length ? variants : [{ title, text }];
    if (
      !cities.length ||
      cities.length > 100 ||
      !price.trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0 ||
      templates.some((x) => !x.title.trim() || !x.text.trim())
    ) {
      setMessage(
        "Укажите от 1 до 100 городов, цену и заполните заголовок и текст каждого варианта.",
      );
      return;
    }
    const next = cities.flatMap((city) =>
      templates.map((v) => ({
        title: v.title.trim().replaceAll("{город}", city),
        text: v.text.trim().replaceAll("{город}", city),
        city,
        price: Number(price),
        photos: [...photos],
      })),
    );
    setDrafts(next);
    setExcluded([]);
    setPage(0);
    setAccepted(false);
    setMessage("");
  }
  const active = drafts.filter((_, i) => !excluded.includes(i));
  const draftWarnings = useMemo(() => drafts.map(getAdPreflightWarnings), [drafts]);
  const flagged = draftWarnings.filter(
    (warnings, i) => !excluded.includes(i) && warnings.length,
  ).length;
  const duplicates = active.filter((d) =>
    sources.some(
      (s) =>
        s.city.toLocaleLowerCase("ru") === d.city.toLocaleLowerCase("ru") && s.title === d.title,
    ),
  ).length;
  return (
    <div className="ac">
      <div className="ac-top">
        <div>
          <h2>Партия объявлений</h2>
          <p>
            Одно предложение — несколько городов. Сначала проверьте варианты, затем добавьте
            черновики.
          </p>
        </div>
        <button className="aw-btn" onClick={onSingle}>
          Одно объявление
        </button>
      </div>
      <div className="ac-columns">
        <section className="ac-panel">
          <h3>
            <span>1</span> Предложение
          </h3>
          <label>
            Взять за основу
            <AdsSelect
              label="Основа партии"
              value={source}
              options={[
                { value: "", label: "Новое предложение" },
                ...sources.map((x) => ({ value: x.id, label: `${x.city} · ${x.title}` })),
              ]}
              onChange={useSource}
            />
          </label>
          <label>
            Что важно знать о преподавателе
            <textarea
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              placeholder="Предмет, классы, формат занятий, опыт и подход. Только подтверждённые факты."
              rows={3}
            />
          </label>
          <div className="ac-ai-row">
            <AdsSelect
              label="Количество вариантов текста"
              value={count}
              options={[1, 2, 3].map((n) => ({
                value: String(n),
                label: `${n} ${n === 1 ? "вариант" : "варианта"}`,
              }))}
              onChange={setCount}
            />
            <button className="aw-btn" disabled={busy} onClick={suggest}>
              <Sparkles size={15} />
              {busy ? "Готовим варианты…" : "Предложить с ИИ"}
            </button>
          </div>
          {(variants.length ? variants : [{ title, text }]).map((v, i) => (
            <div className="ac-variant" key={i}>
              {variants.length > 0 && <strong>Вариант {i + 1}</strong>}
              <label>
                Заголовок
                <input
                  value={v.title}
                  onChange={(e) => {
                    invalidate();
                    if (variants.length)
                      setVariants(
                        variants.map((x, j) => (i === j ? { ...x, title: e.target.value } : x)),
                      );
                    else setTitle(e.target.value);
                  }}
                />
              </label>
              <label>
                Текст
                <textarea
                  rows={5}
                  value={v.text}
                  onChange={(e) => {
                    invalidate();
                    if (variants.length)
                      setVariants(
                        variants.map((x, j) => (i === j ? { ...x, text: e.target.value } : x)),
                      );
                    else setText(e.target.value);
                  }}
                />
              </label>
            </div>
          ))}
          {variants.length > 0 && (
            <button
              className="aw-text-button"
              onClick={() => {
                setVariants([]);
                invalidate();
              }}
            >
              Не использовать ИИ-варианты
            </button>
          )}
          <small>
            Вставьте {"{город}"}, если нужно упомянуть город в тексте. Для онлайн-занятий не
            указывайте вымышленный местный адрес.
          </small>
          <label>
            Цена занятия, ₽
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                invalidate();
              }}
            />
          </label>
          {photos.length > 0 && (
            <div className="ac-photos">
              {photos.map((url, i) => (
                <div key={i}>
                  <img src={url} alt={`Фото ${i + 1}`} />
                  <button
                    aria-label={`Убрать фото ${i + 1}`}
                    onClick={() => {
                      setPhotos(photos.filter((_, j) => i !== j));
                      invalidate();
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label>
            Фотографии по ссылкам
            <textarea
              rows={2}
              placeholder="HTTPS-ссылка на каждой строке"
              value={photos.filter((x) => x.startsWith("https://")).join("\n")}
              onChange={(e) => {
                setPhotos(
                  e.target.value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter((x) => x.startsWith("https://")),
                );
                invalidate();
              }}
            />
          </label>
        </section>
        <section className="ac-panel">
          <h3>
            <span>2</span> Города
          </h3>
          <label>
            Добавьте списком
            <textarea
              rows={7}
              value={citiesInput}
              placeholder="Москва\nКазань\nКраснодар"
              onChange={(e) => {
                setCitiesInput(e.target.value);
                invalidate();
              }}
            />
          </label>
          <small>
            По одному городу на строку или через запятую. Повторы убираются автоматически.
          </small>
          <div className="ac-cities">
            {popular.map((city) => (
              <button
                key={city}
                aria-pressed={cities.includes(city)}
                onClick={() => {
                  setCitiesInput(
                    cities.includes(city)
                      ? cities.filter((x) => x !== city).join("\n")
                      : [...cities, city].join("\n"),
                  );
                  invalidate();
                }}
              >
                <Plus size={12} />
                {city}
              </button>
            ))}
          </div>
          <div className="ac-total">
            <strong>{cities.length * (variants.length || 1)}</strong>
            <span>
              черновиков · {cities.length} городов × {variants.length || 1} вариантов
            </span>
          </div>
          <button className="aw-btn aw-primary" onClick={prepare}>
            Проверить партию
          </button>
          <p>
            Создание черновиков не означает публикацию. Доступность размещения в городах и
            требования Авито нужно проверить перед отправкой.
          </p>
        </section>
      </div>
      {message && (
        <div className="aw-notice" role="status">
          {message}
        </div>
      )}
      {drafts.length > 0 && (
        <section className="ac-panel ac-review">
          <h3>
            <span>3</span> Проверка партии <small>{active.length} выбрано</small>
          </h3>
          {duplicates > 0 && (
            <p role="status">
              У {duplicates} черновиков уже есть объявление с таким же заголовком в этом городе.
              Исключите ненужные повторы.
            </p>
          )}
          {flagged > 0 && (
            <p role="status">
              Найдены расхождения в выбранных черновиках: {flagged}. Сверьте их в таблице.
            </p>
          )}
          {!photos.length && (
            <p>Фотографии не добавлены. Их можно добавить в объявлениях до публикации.</p>
          )}
          <div className="ac-review-scroll">
            <table>
              <thead>
                <tr>
                  <th>Выбор</th>
                  <th>Город</th>
                  <th>Заголовок</th>
                  <th>Цена</th>
                  {flagged > 0 && <th>Проверка</th>}
                </tr>
              </thead>
              <tbody>
                {drafts.slice(page * 15, page * 15 + 15).map((d, j) => {
                  const i = page * 15 + j;
                  return (
                    <tr key={i}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Включить ${d.city} вариант ${i + 1}`}
                          checked={!excluded.includes(i)}
                          onChange={(e) => {
                            setExcluded(
                              e.target.checked ? excluded.filter((x) => x !== i) : [...excluded, i],
                            );
                            setAccepted(false);
                          }}
                        />
                      </td>
                      <td>{d.city}</td>
                      <td>
                        <input
                          aria-label={`Заголовок ${i + 1}`}
                          value={d.title}
                          onChange={(e) => {
                            setDrafts(
                              drafts.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)),
                            );
                            setAccepted(false);
                          }}
                        />
                      </td>
                      <td>{d.price} ₽</td>
                      {flagged > 0 && (
                        <td>
                          {!excluded.includes(i) && draftWarnings[i].length > 0 && (
                            <ul className="aw-preflight ac-preflight">
                              {draftWarnings[i].map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ac-pagination">
            <button
              className="aw-btn"
              disabled={page === 0}
              aria-label="Предыдущая страница партии"
              onClick={() => setPage(page - 1)}
            >
              <ArrowLeft size={16} />
            </button>
            <span>
              {page + 1} / {Math.ceil(drafts.length / 15)}
            </span>
            <button
              className="aw-btn"
              disabled={(page + 1) * 15 >= drafts.length}
              aria-label="Следующая страница партии"
              onClick={() => setPage(page + 1)}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <label className="ac-confirm">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            Проверены тексты, города и цена. Подтверждаю создание выбранных черновиков.
          </label>
          <button
            className="aw-btn aw-primary"
            disabled={!accepted || !active.length || active.some((x) => !x.title.trim())}
            onClick={() => {
              if (onAdd(active)) {
                setDrafts([]);
                setAccepted(false);
                setMessage(
                  `Добавлено черновиков: ${active.length}. Они доступны в объявлениях до обновления страницы. В Авито ничего не отправлено.`,
                );
              }
            }}
          >
            <Check size={16} />
            Добавить {active.length} в объявления
          </button>
        </section>
      )}
    </div>
  );
}
