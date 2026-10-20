import { defineConfig } from "vitest/config";

// WHY jsdom: the fragment reader works on window.location and window.history.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
