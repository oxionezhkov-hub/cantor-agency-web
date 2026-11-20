import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/features/service/Shell";
import { validateServiceSearch } from "@/features/service/sections";

export const Route = createFileRoute("/")({
  validateSearch: validateServiceSearch,
  component: Home,
});

function Home() {
  const { section, focus, view } = Route.useSearch();
  return <Shell section={section ?? "today"} focus={focus} view={view} />;
}
