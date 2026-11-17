import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, FileText, GraduationCap, Search, TrendingUp, MessageCircle, Users, X } from "lucide-react";
import { knowledgeLessons, type KnowledgeLesson, type KnowledgeTrack } from "./content";
import { highlightedParts, materialCount, matchesLesson, normalizeSearch, searchExcerpt } from "./search.ts";
import "./knowledge.css";

const PROGRESS_KEY = "cantor-knowledge-progress-v1";
const TRACKS: { id: KnowledgeTrack; title: string; description: string; icon: typeof TrendingUp }[] = [
  { id: "promotion", title: "Продвижение на Авито", description: "От первого объявления до управления результатом", icon: TrendingUp },
  { id: "dialogues", title: "Диалоги и продажи", description: "От первого ответа до диагностики и оплаты", icon: MessageCircle },
  { id: "team", title: "Работа с командой", description: "Подготовка, обратная связь и совместные решения", icon: Users },
];
const courses = knowledgeLessons.filter(lesson => lesson.kind === "course").sort((a, b) => a.order - b.order);
const references = knowledgeLessons.filter(lesson => lesson.kind === "reference").sort((a, b) => a.order - b.order);

function readProgress(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && knowledgeLessons.some(lesson => lesson.id === id)) : [];
  } catch { return []; }
}

export function KnowledgeSection({ focus }: { focus?: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState<KnowledgeTrack | "all">("all");
  const [tab, setTab] = useState<"course" | "reference">("course");
  const [completed, setCompleted] = useState<string[]>(readProgress);
  const [storageError, setStorageError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingAnchor = useRef<string | null>(null);
  const active = knowledgeLessons.find(lesson => lesson.id === focus);
  const finished = courses.filter(lesson => completed.includes(lesson.id)).length;
  const next = courses.find(lesson => !completed.includes(lesson.id)) || courses[0];
  const normalized = normalizeSearch(query);
  const visible = (normalized ? knowledgeLessons : tab === "course" ? courses : references).filter(lesson =>
    (track === "all" || lesson.track === track) && (!normalized || matchesLesson(lesson, query)),
  );

  useEffect(() => {
    const sync = () => setCompleted(readProgress());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    if (pendingAnchor.current) {
      document.getElementById(pendingAnchor.current)?.scrollIntoView({ block: "start", behavior: "instant" });
      pendingAnchor.current = null;
    }
  }, [focus]);

  function openLesson(id?: string) {
    void navigate({ to: "/", search: { section: "learn", ...(id ? { focus: id } : {}) } });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function toggleComplete(id: string) {
    const updated = completed.includes(id) ? completed.filter(item => item !== id) : [...completed, id];
    setCompleted(updated);
    try { window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(updated)); setStorageError(false); }
    catch { setStorageError(true); }
  }
  function handleContentLink(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a");
    const lessonId = link?.getAttribute("data-knowledge-lesson");
    const anchor = link?.getAttribute("data-knowledge-anchor");
    if (lessonId && knowledgeLessons.some(lesson => lesson.id === lessonId)) {
      event.preventDefault();
      if (lessonId === active?.id && anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "instant" });
      else { pendingAnchor.current = anchor || null; openLesson(lessonId); }
    }
    else if (anchor) { event.preventDefault(); document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "instant" }); }
  }

  if (active) {
    const list = active.kind === "course" ? courses : references;
    const index = list.findIndex(lesson => lesson.id === active.id);
    const before = list[index - 1];
    const after = list[index + 1];
    const isComplete = completed.includes(active.id);
    const activeTrack = TRACKS.find(item => item.id === active.track)!;
    return <div className="knowledge">
      <button className="knowledge-back" type="button" onClick={() => openLesson()}><ArrowLeft size={17} />К программе и материалам</button>
      <div className="knowledge-reader-layout">
        <article className="knowledge-reader">
          <header className="knowledge-lesson-head">
            <div className="knowledge-eyebrow">{active.kind === "course" ? `Модуль ${index + 1} из ${courses.length}` : "Подсказка для репетитора"}<span />{activeTrack.title}</div>
            <h2 ref={headingRef} tabIndex={-1}>{active.title}</h2>
            <p>{active.description}</p>
            <div className="knowledge-lesson-meta"><span><Clock3 size={15} />{active.minutes} мин чтения</span>{isComplete ? <span className="knowledge-done"><CheckCircle2 size={15} />Изучено</span> : null}</div>
          </header>
          <div className="knowledge-prose" onClick={handleContentLink} dangerouslySetInnerHTML={{ __html: active.html }} />
          {active.tasks.length ? <section className="knowledge-practice" aria-label="Самопроверка">
            <div className="knowledge-section-label"><GraduationCap size={20} /><div><h3>Проверьте себя на практике</h3><p>Сначала сформулируйте ответ, затем сверьтесь с критериями. Ответы никуда не отправляются.</p></div></div>
            {active.tasks.map((task, taskIndex) => <div className="knowledge-task" key={task.id}><h4>{taskIndex + 1}. {task.title}</h4><div className="knowledge-prose" onClick={handleContentLink} dangerouslySetInnerHTML={{ __html: task.html }} />{task.answerHtml ? <details><summary>Посмотреть критерии ответа</summary><div className="knowledge-prose knowledge-answer" dangerouslySetInnerHTML={{ __html: task.answerHtml }} /></details> : null}</div>)}
          </section> : null}
          {storageError ? <p className="knowledge-storage-error" role="alert">Не удалось сохранить отметку в браузере. Она доступна до перезагрузки страницы.</p> : null}
          <nav className="knowledge-lesson-nav" aria-label="Действия с материалом">{before ? <button type="button" className="knowledge-previous" onClick={() => openLesson(before.id)}><ArrowLeft size={17} /><span><small>Предыдущий материал</small>{before.title}</span></button> : <span className="knowledge-nav-spacer" />}<button type="button" className={`knowledge-button knowledge-mark ${isComplete ? "secondary" : ""}`} aria-pressed={isComplete} onClick={() => toggleComplete(active.id)}>{isComplete ? <CheckCircle2 size={17} /> : <Check size={17} />}{isComplete ? "Изучено" : "Отметить изученным"}</button>{after ? <button type="button" className="knowledge-next" onClick={() => openLesson(after.id)}><span><small>Следующий материал</small>{after.title}</span><ArrowRight size={17} /></button> : <button type="button" className="knowledge-next" onClick={() => openLesson()}>Вернуться к программе<ArrowRight size={17} /></button>}</nav>
        </article>
        <aside className="knowledge-toc"><div className="knowledge-toc-inner"><span className="knowledge-label">В этом материале</span><nav aria-label="Содержание урока">{active.headings.map(item => <a key={item.id} href={`#${item.id}`} onClick={event => { event.preventDefault(); document.getElementById(item.id)?.scrollIntoView({ block: "start", behavior: "instant" }); }}>{item.title}</a>)}</nav><div className="knowledge-toc-progress"><span>{finished} из {courses.length} модулей изучено</span><progress value={finished} max={courses.length} aria-label="Прогресс курса" /><small>На этом устройстве</small></div></div></aside>
      </div>
    </div>;
  }

  return <div className="knowledge">
    {focus ? <p className="knowledge-storage-error" role="status">Этот материал не найден. Выберите модуль из программы.</p> : null}
    <section className="knowledge-start" aria-label="Ваш курс"><div className="knowledge-start-copy"><span className="knowledge-label">Практический курс</span><h2 ref={headingRef} tabIndex={-1}>От объявления до ученика</h2><p>Пройдите путь по порядку или откройте нужную тему.</p><button type="button" className="knowledge-button" onClick={() => openLesson(next.id)}>{finished === courses.length ? "Повторить курс" : finished ? "Продолжить обучение" : "Начать обучение"}<ArrowRight size={17} /></button></div><div className="knowledge-course-progress"><div className="knowledge-progress-number">{finished}<span> / {courses.length}</span></div><p>модулей изучено</p><progress value={finished} max={courses.length} aria-label="Прогресс курса" /><small>Прогресс сохраняется на этом устройстве</small></div></section>
    <div className="knowledge-track-grid">{TRACKS.map(item => { const Icon = item.icon; const count = knowledgeLessons.filter(lesson => lesson.track === item.id).length; return <button type="button" className={`knowledge-track ${track === item.id ? "selected" : ""}`} key={item.id} aria-pressed={track === item.id} onClick={() => setTrack(track === item.id ? "all" : item.id)}><Icon size={21} strokeWidth={1.5} /><strong>{item.title}</strong><span>{item.description}</span><small>{materialCount(count)}<ArrowDown size={14} /></small></button>; })}</div>
    <div className="knowledge-catalog-head"><div className="knowledge-tabs" role="group" aria-label="Тип материалов"><button type="button" aria-pressed={tab === "course"} className={tab === "course" ? "active" : ""} onClick={() => setTab("course")}>Программа курса<span>{courses.length}</span></button><button type="button" aria-pressed={tab === "reference"} className={tab === "reference" ? "active" : ""} onClick={() => setTab("reference")}>Подсказки<span>{references.length}</span></button></div><label className="knowledge-search"><Search size={17} /><span className="sr-only">Поиск по всем материалам</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск по словам или фразе" aria-describedby="knowledge-search-status" />{query ? <button type="button" className="knowledge-search-clear" aria-label="Очистить поиск" onClick={() => setQuery("")}><X size={15} /></button> : null}</label></div>
    <div className="knowledge-filter-line"><p id="knowledge-search-status" role="status" aria-live="polite" aria-atomic="true">{normalized ? `По запросу «${query.trim()}» найдено: ${materialCount(visible.length)}` : tab === "course" ? "Теория, примеры и задания для самостоятельной проверки" : "Практические подсказки для работы с объявлениями, обращениями и командой"}</p>{track !== "all" ? <button type="button" onClick={() => setTrack("all")}>{TRACKS.find(item => item.id === track)?.title}<X size={13} /><span className="sr-only">Сбросить фильтр</span></button> : null}</div>
    <ol className="knowledge-lessons" aria-label={normalized ? "Результаты поиска" : tab === "course" ? "Программа курса" : "Подсказки для репетитора"}>{visible.map(lesson => <LessonRow key={lesson.id} lesson={lesson} query={normalized ? query : ""} done={completed.includes(lesson.id)} onOpen={() => openLesson(lesson.id)} />)}</ol>
    {!visible.length ? <div className="knowledge-empty"><Search size={26} /><h3>Материалов не найдено</h3><p>Попробуйте «ставка», «цена» или «диагностика».</p><button type="button" className="knowledge-button secondary" onClick={() => { setQuery(""); setTrack("all"); }}>Сбросить поиск и фильтры</button></div> : null}
  </div>;
}

function LessonRow({ lesson, query, done, onOpen }: { lesson: KnowledgeLesson; query: string; done: boolean; onOpen: () => void }) {
  const number = courses.findIndex(item => item.id === lesson.id) + 1;
  const excerpt = query ? searchExcerpt(lesson, query) : null;
  return <li><button type="button" className="knowledge-lesson-row" onClick={onOpen}><span className={`knowledge-lesson-number ${done ? "done" : ""}`}>{done ? <Check size={19} /> : lesson.kind === "course" ? String(number).padStart(2, "0") : <FileText size={19} />}</span><span className="knowledge-lesson-copy"><small>{TRACKS.find(item => item.id === lesson.track)?.title}{lesson.kind === "reference" ? " · Подсказка" : ""}</small><strong><SearchHighlight text={lesson.title} query={query} /></strong>{excerpt ? <span className="knowledge-match"><small>{excerpt.label}</small><span className="knowledge-snippet"><SearchHighlight text={excerpt.text} query={query} /></span></span> : <span>{lesson.description}</span>}</span><span className="knowledge-lesson-time">{done ? <span className="knowledge-done">Изучено</span> : `${lesson.minutes} мин`}<ArrowRight size={17} /></span></button></li>;
}

function SearchHighlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  return <>{highlightedParts(text, query).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</>;
}
