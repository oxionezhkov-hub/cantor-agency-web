import { spawnSync, execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
// A static SPA preview of the UI: no migrations and no production bindings.
// Real APIs stay on the existing server; demo data must be labelled in the UI.
const result = spawnSync(process.execPath, ["scripts/with-app-env.mjs", "vite", "build", "--config", "vite.preview.config.ts"], {
  env: { ...process.env, CANTOR_PREVIEW: "1", VITE_SERVICE_PREVIEW: "true" },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
copyFileSync("dist/client/preview.html", "dist/client/index.html");
writeFileSync("dist/client/robots.txt", "User-agent: *\nDisallow: /\n");
writeFileSync("dist/client/__grok/manifest.webmanifest", JSON.stringify({ name: "Cantor · превью сервиса", short_name: "Cantor", start_url: "/", display: "standalone", theme_color: "#F4F3F0", background_color: "#F4F3F0", icons: [{ src: "/__grok/icon-180.png", sizes: "180x180", type: "image/png" }] }));

const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
writeFileSync("dist/client/__preview.json", JSON.stringify({ revision, builtAt: new Date().toISOString(), mode: "demo", productionApi: false }));
