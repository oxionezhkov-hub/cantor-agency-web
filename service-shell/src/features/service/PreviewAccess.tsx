import { lazy, Suspense, useEffect, useState } from "react";
import { setPreviewData } from "./preview-data";
import type { SectionId } from "./sections";
const Shell = lazy(() => import("./Shell").then((m) => ({ default: m.Shell })));
export function PreviewAccess({ section, focus }: { section: SectionId; focus?: string }) {
  const [ready, setReady] = useState(false);
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
      .catch(() => {});
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
      <Suspense fallback={<p role="status">Загрузка…</p>}>
        <Shell section={section} focus={focus} />
      </Suspense>
    );
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
