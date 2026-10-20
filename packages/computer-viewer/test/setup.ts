import { vi } from "vitest";

// Every test runs against the RFB double, never the real noVNC (it needs a real canvas and server).
vi.mock("@novnc/novnc", async () => {
  const double = await import("./rfb-double");
  return { default: double.FakeRfb };
});
