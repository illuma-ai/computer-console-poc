import { defineConfig } from "vitest/config";

// WHY jsdom: the React components and the WebSocket and canvas code run in a
// browser-like DOM. Every test stubs the network; nothing reaches a real host.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
