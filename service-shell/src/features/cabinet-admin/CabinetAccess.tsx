import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { ServiceLoading } from "../service/ServiceLoading";
import { PreviewAccess } from "../service/PreviewAccess";
import { PREVIEW_EVENT, setPreviewData, type PreviewSnapshot } from "../service/preview-data";
import type { SectionId } from "../service/sections";
import { CabinetError, cabinetRequest } from "./client";
import "./cabinet-admin.css";

const Shell = lazy(() => import("../service/Shell").then((m) => ({ default: m.Shell })));
type Identity = {
  role: "tester";
  workspaceId: string;
  employeeId: string;
  name: string;
  mustChangePassword: boolean;
};
type ViewProps = { section: SectionId; focus?: string; view?: "crm" | "ai" };
type Snapshot = PreviewSnapshot & {
  importStatus?: { status: "queued" | "running" | "partial" | "ready" | "failed" };
};

export function CabinetAccess({ entry = false, ...props }: ViewProps & { entry?: boolean }) {
  const invite = new URLSearchParams(location.search).get("workspace") || "";
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    cabinetRequest<Identity>("/api/cabinet/session", undefined, controller.signal)
      .then((session) => {
        if (!invite || session.workspaceId === invite) setIdentity(session);
      })
      .catch((e) => {
        if (!controller.signal.aborted && !(e instanceof CabinetError && e.status === 401))
          setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [invite]);
  useEffect(() => {
    if (!identity || identity.mustChangePassword) return;
    if (entry) {
      location.replace("/");
      return;
    }
    const controller = new AbortController();
    const read = () => {
      cabinetRequest<Snapshot>("/api/cabinet/bootstrap", undefined, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setPreviewData(data, "");
          setSnapshot(data);
          setError("");
          window.dispatchEvent(new Event(PREVIEW_EVENT));
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          if (e instanceof CabinetError && [401, 403].includes(e.status)) {
            setSnapshot(null);
            setIdentity(null);
            setSessionEnded(true);
          }
          setError(e.message);
        });
    };
    read();
    const refresh = setInterval(read, 15000);
    return () => {
      controller.abort();
      clearInterval(refresh);
    };
  }, [identity, entry]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setWorking(true);
    try {
      const url = identity?.mustChangePassword ? "/api/cabinet/password" : "/api/cabinet/login";
      setIdentity(await cabinetRequest<Identity>(url, Object.fromEntries(form)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  if (checking) return <ServiceLoading />;
  if (!identity && !entry && !sessionEnded) return <PreviewAccess {...props} />;
  if (identity && !identity.mustChangePassword) {
    if (snapshot)
      return (
        <Suspense fallback={<ServiceLoading />}>
          <Shell
            {...props}
            testSession={{
              workspaceId: identity.workspaceId,
              employeeId: identity.employeeId,
              loading: ["queued", "running"].includes(snapshot.importStatus?.status || ""),
              error,
              logout: () => {
                cabinetRequest("/api/cabinet/logout", {})
                  .then(() => {
                    location.replace(`/cabinet?workspace=${identity.workspaceId}`);
                  })
                  .catch((e) => setError(e.message));
              },
            }}
          />
        </Suspense>
      );
    if (!error) return <ServiceLoading />;
    return (
      <main className="cabinet-auth">
        <h1>Кабинет Cantor</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }
  const changing = identity?.mustChangePassword;
  return (
    <main className="cabinet-auth">
      <h1>{changing ? "Задайте личный пароль" : "Вход в кабинет Cantor"}</h1>
      {changing && <p>После сохранения временный пароль перестанет действовать.</p>}
      <form key={changing ? "change" : "login"} className="cabinet-form" onSubmit={submit}>
        {!changing && (
          <>
            {invite ? (
              <input type="hidden" name="workspaceId" value={invite} />
            ) : (
              <label>
                Код кабинета
                <input name="workspaceId" required pattern="[a-f0-9]{12}" autoComplete="off" />
              </label>
            )}
            <label>
              Логин
              <input name="login" required autoComplete="username" autoCapitalize="none" />
            </label>
          </>
        )}
        <label>
          {changing ? "Новый пароль" : "Пароль"}
          <input
            name="password"
            required
            type="password"
            autoComplete={changing ? "new-password" : "current-password"}
            minLength={changing ? 12 : undefined}
            maxLength={256}
          />
        </label>
        <button className="cabinet-button primary" disabled={working}>
          {changing ? "Сохранить и войти" : "Войти"}
        </button>
        {error && (
          <p className="cabinet-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
