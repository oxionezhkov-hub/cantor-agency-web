import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { AdminAccess } from "@/features/cabinet-admin/AdminAccess";
import { CabinetHistory } from "@/features/cabinet-admin/CabinetHistory";
import { CommentQueue } from "@/features/comments/CommentQueue";
import { CabinetAccess } from "@/features/cabinet-admin/CabinetAccess";
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
  return <CabinetAccess section={section ?? "today"} focus={focus} view={view} />;
}
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminAccess,
});
const adminCommentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/comments",
  component: () => <AdminAccess comments={<CommentQueue />} />,
});
const adminHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/history",
  component: () => <AdminAccess history={<CabinetHistory />} />,
});
const cabinetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cabinet",
  component: () => <CabinetAccess entry section="today" />,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    adminRoute,
    adminCommentsRoute,
    adminHistoryRoute,
    cabinetRoute,
  ]),
});
const target = document.getElementById("root");
if (!target) throw new Error("Preview root is missing");
createRoot(target).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
