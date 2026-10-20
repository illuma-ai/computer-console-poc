import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// WHY jsdom: the run panel and the agent form render into a DOM. Every test stubs the run API and the
// viewer component, so nothing reaches a real run service or computer.
// The `@` alias matches the app's build and tsconfig, so screens import their shadcn components the same way.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
