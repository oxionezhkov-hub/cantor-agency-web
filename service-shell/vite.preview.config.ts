import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A separate client entry keeps the review site independent of SSR/auth hosting.
// The real TanStack Start application and its server configuration are unchanged.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist/client", emptyOutDir: true, rollupOptions: { input: "preview.html" } },
});
