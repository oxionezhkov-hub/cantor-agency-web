import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { PreviewAccess } from "@/features/service/PreviewAccess";
import { validateServiceSearch } from "@/features/service/sections";
import "./styles.css";

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateServiceSearch,
  component: Preview,
});
export function Preview() {
  const { section, focus, view } = indexRoute.useSearch();
  return <PreviewAccess section={section ?? "today"} focus={focus} view={view} />;
}
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
const target = document.getElementById("root");
if (!target) throw new Error("Preview root is missing");
createRoot(target).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
