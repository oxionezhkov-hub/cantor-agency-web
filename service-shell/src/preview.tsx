import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Shell } from "@/features/service/Shell";
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
  const { section, focus } = indexRoute.useSearch();
  return <Shell section={section ?? "today"} focus={focus} />;
}
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
const target = document.getElementById("root");
if (!target) throw new Error("Preview root is missing");
createRoot(target).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
