import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const { createCrmHttpHandler } = await import("@/features/service/server/http.server");
  return createCrmHttpHandler({
    authenticate: async () => {
      const { getSessionUser } = await import("@/lib/auth/verify.server");
      // Unlike requireUserId(), getSessionUser() never returns a shared dev user.
      return getSessionUser();
    },
    repository: async () => {
      const [{ getSql, dbSource }, { createCrmRepository }] = await Promise.all([
        import("@/lib/db"),
        import("@/features/service/server/repository.server"),
      ]);
      if (dbSource === "pglite" && process.env.NODE_ENV === "production") {
        throw new Error("service_crm_requires_persistent_database");
      }
      return createCrmRepository(await getSql());
    },
    reportError: () => console.error("[service-crm] request failed"),
  })(request);
}
export const Route = createFileRoute("/api/service/crm")({
  server: { handlers: { GET: handle, POST: handle } },
});
