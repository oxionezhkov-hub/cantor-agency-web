import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Shell } from "@/features/service/Shell";
import { isSection, type SectionId } from "@/features/service/sections";
import "./styles.css";

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): { section?: SectionId } => {
    const section = search.section;
    return typeof section === "string" && isSection(section) ? { section } : {};
  },
  component: Preview,
});
function Preview() {
  const { section } = indexRoute.useSearch();
  return <Shell section={section ?? "today"} />;
}
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
const target = document.getElementById("root");
if (!target) throw new Error("Preview root is missing");
createRoot(target).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
