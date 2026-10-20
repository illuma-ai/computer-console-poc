import { defineConfig } from "vite";

/** The code a correct sign-in needs. Defaults to 424242 so a bare build still works. */
export const DEFAULT_OTP_CODE = "424242";

// WHY `define` and not a runtime fetch: the page makes no network calls, and the code is fixed in the
// bundle that is served. Read at build time, so `OTP_CODE=... npm -w otp-page run serve` sets it.
export default defineConfig({
  base: "./",
  define: {
    __OTP_CODE__: JSON.stringify(process.env["OTP_CODE"]?.trim() || DEFAULT_OTP_CODE),
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
