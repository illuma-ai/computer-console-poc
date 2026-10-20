import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Timeline } from "../../src/run/TimelineView";
import { applyEvent, INITIAL_RUN_STATE } from "../../src/run/timeline";
import { event, progress } from "../support/fakes";

afterEach(() => cleanup());

describe("Timeline rows", () => {
  it("gives each kind of notice its own row, with the blocked reason as a banner", () => {
    const state = [
      event(1, "checkpoint.saved", { seq: 4 }),
      event(2, "computer.replaced", { new: { id: "c2" }, checkpoint_seq: 4 }),
      event(3, "tools.unavailable", { servers: [{ name: "browser" }] }),
      event(4, "run.reminder", { text: "Check the form" }),
      event(5, "run.blocked", { reason: "Egress refused" }),
    ].reduce(applyEvent, INITIAL_RUN_STATE);

    const { container } = render(<Timeline entries={state.timeline} result={null} />);
    const types = Array.from(container.querySelectorAll("[data-type]")).map((node) => node.getAttribute("data-type"));
    expect(types).toEqual(["checkpoint.saved", "computer.replaced", "tools.unavailable", "run.reminder", "run.blocked"]);
    expect(screen.getAllByText("Computer replaced").length).toBeGreaterThan(0);
    expect(screen.getByText("Check the form")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Egress refused");
  });

  it("shows a tool as one compact row and a message as its text", () => {
    const state = [
      progress(1, "message", { text: "Working" }),
      progress(2, "tool", { tool_call_id: "t1", title: "Open page", status: "completed" }),
    ].reduce(applyEvent, INITIAL_RUN_STATE);
    const { container } = render(<Timeline entries={state.timeline} result={null} />);
    expect(container.querySelectorAll('[data-kind="tool"]')).toHaveLength(1);
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Open page")).toBeTruthy();
  });

  it("offers a replay action on each row only when the host takes one, and sends the row's event", async () => {
    const state = [
      progress(1, "message", { text: "Working" }),
      progress(2, "tool", { tool_call_id: "t1", title: "Open page", status: "completed" }),
    ].reduce(applyEvent, INITIAL_RUN_STATE);

    const { rerender } = render(<Timeline entries={state.timeline} result={null} />);
    expect(screen.queryByRole("button", { name: /Replay from/ })).toBeNull();

    const onSeek = vi.fn();
    rerender(<Timeline entries={state.timeline} result={null} onSeek={onSeek} />);
    await userEvent.click(screen.getByRole("button", { name: "Replay from message" }));
    await userEvent.click(screen.getByRole("button", { name: "Replay from Open page" }));
    expect(onSeek.mock.calls).toEqual([[1], [2]]);
  });

  it("shows the result section only when there is a result", () => {
    const { rerender } = render(<Timeline entries={[]} result={null} />);
    expect(screen.queryByRole("region", { name: "Result" })).toBeNull();
    rerender(<Timeline entries={[]} result="All done" />);
    expect(screen.getByText("All done")).toBeTruthy();
  });
});
