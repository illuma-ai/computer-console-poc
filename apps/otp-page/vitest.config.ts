import { defineConfig } from "vitest/config";

// WHY jsdom: the page renders a form and listens for its submit event. Nothing reaches the network.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
