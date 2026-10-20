import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// WHY base "./": the page must work at any path the channel links to, since the URL is minted per session.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
