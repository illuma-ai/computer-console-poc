import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "../../src/routes";
import { navScreenOf } from "../../src/shell/AppShell";
import { applyTheme, isDark, loadTheme, readTheme, saveTheme, THEME_STORAGE_KEY } from "../../src/theme";
import { memoryStorage } from "../support/fakes";

describe("routes", () => {
  it("reads each screen from its hash", () => {
    expect(parseRoute("#/agents")).toEqual({ name: "agents" });
    expect(parseRoute("#/settings")).toEqual({ name: "settings" });
    expect(parseRoute("#/runs")).toEqual({ name: "runs" });
    expect(parseRoute("#/runs/run-1")).toEqual({ name: "run", runId: "run-1" });
  });

  it("falls back to the runs list for an unknown hash or an empty one", () => {
    expect(parseRoute("")).toEqual({ name: "runs" });
    expect(parseRoute("#/nope")).toEqual({ name: "runs" });
  });

  it("round-trips a run id that needs encoding", () => {
    const route = { name: "run" as const, runId: "run a/1" };
    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it("keeps the Runs link active on a run's view", () => {
    expect(navScreenOf({ name: "run", runId: "x" })).toBe("runs");
    expect(navScreenOf({ name: "agents" })).toBe("agents");
  });
});

describe("theme", () => {
  it("reads only the three names, and falls back to system", () => {
    expect(readTheme("dark")).toBe("dark");
    expect(readTheme("neon")).toBe("system");
    expect(readTheme(null)).toBe("system");
  });

  it("resolves system against the operating system's preference", () => {
    expect(isDark("system", true)).toBe(true);
    expect(isDark("system", false)).toBe(false);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("dark", false)).toBe(true);
  });

  it("saves the choice and reads it back", () => {
    const storage = memoryStorage();
    expect(saveTheme(storage, "dark")).toBe(true);
    expect(storage.data[THEME_STORAGE_KEY]).toBe("dark");
    expect(loadTheme(storage)).toBe("dark");
    expect(loadTheme(null)).toBe("system");
  });

  it("marks the page root with the dark class and the theme name", () => {
    const root = document.createElement("html");
    applyTheme("dark", root, false);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.dataset["theme"]).toBe("dark");
  });
});
