import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsScreen } from "../../src/settings/SettingsScreen";

afterEach(() => cleanup());

describe("SettingsScreen", () => {
  it("marks the current theme and reports a change", async () => {
    const onThemeChange = vi.fn();
    render(
      <SettingsScreen
        theme="light"
        onThemeChange={onThemeChange}
        transport="auto"
        viewerBaseUrl="http://localhost:5173"
        runApiBase="/api/runs"
        agentsApiBase="/api/agents"
      />,
    );
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("shows the endpoints the page uses, and says same origin for an empty viewer base", () => {
    render(
      <SettingsScreen
        theme="system"
        onThemeChange={vi.fn()}
        transport="sse"
        viewerBaseUrl=""
        runApiBase="/api/runs"
        agentsApiBase="/api/agents"
      />,
    );
    expect(screen.getByText("/api/runs")).toBeTruthy();
    expect(screen.getByText("/api/agents")).toBeTruthy();
    expect(screen.getByText("same origin")).toBeTruthy();
    expect(screen.getByText("sse")).toBeTruthy();
  });
});
