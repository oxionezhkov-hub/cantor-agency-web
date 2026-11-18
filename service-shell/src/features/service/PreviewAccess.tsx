import { lazy, Suspense, useEffect, useState } from "react";
import { setPreviewData } from "./preview-data";
import type { SectionId } from "./sections";
import "./preview-loading.css";
const Shell = lazy(() => import("./Shell").then((m) => ({ default: m.Shell })));
function PreviewLoading() {
  return (
    <div className="preview-loading" role="status" aria-label="Загрузка кабинета">
      <div className="preview-loading-sidebar" aria-hidden="true">
        <div className="preview-skeleton preview-loading-logo" />
        <div className="preview-skeleton preview-loading-profile" />
        <div className="preview-loading-nav">{Array.from({ length: 6 }, (_, i) => <div className="preview-skeleton preview-loading-nav-item" key={i} />)}</div>
      </div>
      <div className="preview-loading-content" aria-hidden="true">
        <div className="preview-skeleton preview-loading-title" />
        <div className="preview-loading-cards">{Array.from({ length: 4 }, (_, i) => <div className="preview-skeleton preview-loading-card" key={i} />)}</div>
        <div className="preview-skeleton preview-loading-main" />
        <div className="preview-loading-bottom"><div className="preview-skeleton" /><div className="preview-skeleton" /></div>
      </div>
    </div>
  );
}
export function PreviewAccess({ section, focus }: { section: SectionId; focus?: string }) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/demo/bootstrap", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        setPreviewData(await response.json(), "");
        setReady(true);
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  async function login() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/demo/bootstrap", {
        headers: { "x-demo-password": password },
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 ? "Неверный пароль" : "Не удалось войти. Попробуйте ещё раз.",
        );
      setPreviewData(await response.json(), password);
      setPassword("");
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }
  if (ready)
    return (
      <Suspense fallback={<PreviewLoading />}>
        <Shell section={section} focus={focus} />
      </Suspense>
    );
  if (checking) return <PreviewLoading />;
  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <img src="/images/brand/logo.svg" alt="Авито" width="72" />
      <h1 className="mt-8 font-display text-2xl">Вход в кабинет</h1>
      <form
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void login();
        }}
      >
        <label className="grid gap-2 text-sm">
          Пароль
          <input
            className="rounded-xl border border-line bg-surface p-3"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="rounded-xl bg-ink p-3 text-white" disabled={loading}>
          {loading ? "Входим…" : "Войти"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-red">
          {error}
        </p>
      ) : null}
    </main>
  );
}
