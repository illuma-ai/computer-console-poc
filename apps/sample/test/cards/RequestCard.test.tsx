import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cardLabel, RequestCard } from "../../src/cards/RequestCard";
import type { RequestCardProps } from "../../src/cards/RequestCard";
import type { RunRequest } from "../../src/api/types";

afterEach(() => cleanup());

const takeover: RunRequest = {
  id: "req-takeover",
  kind: "takeover",
  title: "Enter the one-time code",
  options: [],
  meta: { reason: "The page asks for a code only a person has." },
  expires_at: "2026-10-19T11:00:00Z",
};

const approval: RunRequest = {
  id: "req-approval",
  kind: "approval",
  title: "Run the installer?",
  options: [
    { id: "opt-allow", name: "Allow once", kind: "allow_once" },
    { id: "opt-deny", name: "Deny", kind: "reject_once" },
  ],
  meta: {},
  expires_at: "2026-10-19T11:00:00Z",
};

const question: RunRequest = {
  id: "req-question",
  kind: "question",
  title: "Which folder?",
  options: [{ id: "opt-default", name: "Default", kind: "allow_once" }],
  meta: {},
  expires_at: "2026-10-19T11:00:00Z",
};

/** Props with every callback as a spy and nothing held. */
function props(overrides: Partial<RequestCardProps>): RequestCardProps {
  return {
    request: approval,
    held: false,
    canTakeControl: false,
    busy: false,
    onAnswer: vi.fn(),
    onTakeControl: vi.fn(),
    onRelease: vi.fn(),
    ...overrides,
  };
}

describe("cardLabel", () => {
  it("names each kind, and a kind the sample does not know", () => {
    expect(cardLabel("takeover")).toBe("Take-over request");
    expect(cardLabel("approval")).toBe("Approval request");
    expect(cardLabel("question")).toBe("Question");
    expect(cardLabel("something-new")).toBe("Request");
  });
});

describe("take-over card", () => {
  it("shows the agent's reason, and Take control when nobody holds the computer", async () => {
    const onTakeControl = vi.fn();
    render(<RequestCard {...props({ request: takeover, canTakeControl: true, onTakeControl })} />);
    const card = screen.getByLabelText("Take-over request");
    expect(card).toBeTruthy();
    expect(screen.getByText("The page asks for a code only a person has.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Take control" }));
    expect(onTakeControl).toHaveBeenCalledOnce();
  });

  it("offers Done and Can't do it to the person who holds the lease", async () => {
    const onRelease = vi.fn();
    render(<RequestCard {...props({ request: takeover, held: true, onRelease })} />);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Can't do it" }));
    expect(onRelease.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByRole("button", { name: "Take control" })).toBeNull();
  });

  it("says another person has the computer, with no control", () => {
    render(<RequestCard {...props({ request: takeover, held: false, canTakeControl: false })} />);
    expect(screen.getByText("Another person has the computer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take control" })).toBeNull();
  });

  it("shows a link only for a web address", () => {
    const { unmount } = render(
      <RequestCard {...props({ request: { ...takeover, meta: { url: "https://example.test/signin" } } })} />,
    );
    expect(screen.getByRole("link", { name: "Open page" }).getAttribute("href")).toBe("https://example.test/signin");
    unmount();
    render(<RequestCard {...props({ request: { ...takeover, meta: { url: "javascript:alert(1)" } } })} />);
    expect(screen.queryByRole("link", { name: "Open page" })).toBeNull();
  });
});

describe("approval card", () => {
  it("answers with the option the person picks", async () => {
    const onAnswer = vi.fn();
    render(<RequestCard {...props({ onAnswer })} />);
    await userEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onAnswer).toHaveBeenCalledWith({ option_id: "opt-allow" });
  });

  it("disables every option while a call is in flight", () => {
    render(<RequestCard {...props({ busy: true })} />);
    expect((screen.getByRole("button", { name: "Allow once" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no text answer", () => {
    render(<RequestCard {...props({})} />);
    expect(screen.queryByRole("form", { name: "Answer the question" })).toBeNull();
  });
});

describe("question card", () => {
  it("answers with a typed text, and not with an empty one", async () => {
    const onAnswer = vi.fn();
    render(<RequestCard {...props({ request: question, onAnswer })} />);
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "  ~/projects  ");
    await userEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith({ text: "~/projects" });
  });

  it("still offers the options beside the text answer", async () => {
    const onAnswer = vi.fn();
    render(<RequestCard {...props({ request: question, onAnswer })} />);
    await userEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(onAnswer).toHaveBeenCalledWith({ option_id: "opt-default" });
  });
});
