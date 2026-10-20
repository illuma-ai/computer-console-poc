import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readSampleDevConfig } from "./dev/config.ts";
import { API_MOUNTS, runTokenPlugin } from "./dev/run-token-plugin.ts";

// WHY the dev settings are read only for `serve`: `vite build` must not need run service settings, and
// the signing secret is needed only where the dev proxy runs.
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig(({ command, mode }) => {
  if (command !== "serve") {
    return {
      base: "./",
      plugins: [react(), tailwindcss()],
      resolve: { alias },
      build: { outDir: "dist", emptyOutDir: true },
    };
  }
  const env = loadEnv(mode, process.cwd(), "");
  const config = readSampleDevConfig({ ...process.env, ...env });
  return {
    plugins: [react(), tailwindcss(), runTokenPlugin(config)],
    resolve: { alias },
    server: {
      port: 5173,
      proxy: {
        // Same-origin for the browser. Each rule maps the browser path onto the run service's /v1 routes.
        ...Object.fromEntries(
          API_MOUNTS.map(({ mount, upstream }) => [
            mount,
            {
              target: config.runServiceUrl,
              changeOrigin: true,
              rewrite: (path: string) => path.replace(mount, upstream),
            },
          ]),
        ),
        // The viewer's own calls (screen, processes, files). They carry the viewer token, not a run token.
        ...(config.viewerBaseUrl
          ? { "/view": { target: config.viewerBaseUrl, changeOrigin: true, ws: true } }
          : {}),
      },
    },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
