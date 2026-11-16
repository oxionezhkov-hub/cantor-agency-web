import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/features/service/Shell";
import { isSection, type SectionId } from "@/features/service/sections";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { section?: SectionId } => {
    const value = search.section;
    if (typeof value === "string" && isSection(value)) return { section: value };
    return {};
  },
  component: Home,
});

function Home() {
  const { section } = Route.useSearch();
  return <Shell section={section ?? "today"} />;
}
