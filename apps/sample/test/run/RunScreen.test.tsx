import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunScreen } from "../../src/run/RunScreen";
import { agentJson, event, fakeAgentsApi, fakeRunApi, openStream, progress, runView, streamOf } from "../support/fakes";
import type { RunProvenance, RunRequest } from "../../src/api/types";

// The viewer is mocked at the module boundary: the test checks which session the pane asks for, not the viewer.
vi.mock("@cm/computer-viewer/react", () => ({
  ComputerViewer: ({ session, onRelease }: { session: { mode: string }; onRelease?: () => void }) => (
    <div data-testid="viewer" data-mode={session.mode}>
      {onRelease ? <button type="button" onClick={onRelease}>Release viewer</button> : null}
    </div>
  ),
}));

afterEach(() => cleanup());

const takeover: RunRequest = {
  id: "req-takeover",
  kind: "takeover",
  title: "Enter the one-time code",
  options: [],
  meta: { reason: "The page asks for a code." },
  expires_at: "2026-10-19T11:00:00Z",
};

const approval: RunRequest = {
  id: "req-approval",
  kind: "approval",
  title: "Run the installer?",
  options: [{ id: "opt-allow", name: "Allow once", kind: "allow_once" }],
  meta: {},
  expires_at: "2026-10-19T11:00:00Z",
};

describe("RunScreen", () => {
  it("shows the timeline and the result of a completed run, with cancel disabled", async () => {
    const api = fakeRunApi({
      streamEvents: () =>
        streamOf([
          event(1, "run.started", { computer: { runtime: "docker" } }),
          progress(2, "message", { text: "Hello" }),
          event(3, "run.completed", { result: "Done" }),
        ]),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);

    expect(await screen.findByRole("region", { name: "Result" })).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByRole("log", { name: "Timeline" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel run" }) as HTMLButtonElement).disabled).toBe(true);
    // The badge and the notice line both say Completed, so the badge is found by its status.
    expect(document.querySelector('[data-status="completed"]')?.textContent).toBe("Completed");
  });

  it("shows a block as a banner with its reason, and the computer as ended", async () => {
    const api = fakeRunApi({
      streamEvents: () => streamOf([event(1, "run.blocked", { reason: "The host is not on the egress list" })]),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText("The host is not on the egress list")).toBeTruthy();
    expect(screen.getByText(/The computer has ended/)).toBeTruthy();
  });

  it("answers an approval with the option the person picks", async () => {
    const api = fakeRunApi({
      streamEvents: () => streamOf([event(1, "run.waiting_input", { request: approval })]),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await userEvent.click(await screen.findByRole("button", { name: "Allow once" }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith("run-1", "req-approval", { option_id: "opt-allow" }));
  });

  it("takes control under a lease, shows the viewer in control, then hands back to view on Done", async () => {
    const api = fakeRunApi({
      streamEvents: () => streamOf([event(1, "run.waiting_input", { request: takeover })]),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);

    await userEvent.click(await screen.findByRole("button", { name: "Take control" }));
    await waitFor(() => expect(api.lease).toHaveBeenCalledWith("run-1", "req-takeover"));
    await waitFor(() => expect(screen.getByTestId("viewer").getAttribute("data-mode")).toBe("control"));

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(api.release).toHaveBeenCalledWith("run-1", "lease-1", true));
    await waitFor(() => expect(screen.getByTestId("viewer").getAttribute("data-mode")).toBe("view"));
  });

  it("opens the computer view-only while the run is live", async () => {
    const api = fakeRunApi({ streamEvents: () => openStream() });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await waitFor(() => expect(api.view).toHaveBeenCalledWith("run-1"));
    expect(await screen.findByTestId("viewer")).toBeTruthy();
    expect(screen.getByTestId("viewer").getAttribute("data-mode")).toBe("view");
  });

  it("cancels a live run", async () => {
    const api = fakeRunApi({ streamEvents: () => streamOf([event(1, "run.started", {})]) });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("run-1"));
  });

  it("sends a steer message while the run is live", async () => {
    const api = fakeRunApi({ streamEvents: () => streamOf([event(1, "run.started", {})]) });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await userEvent.type(await screen.findByLabelText("Steer message"), "focus the form");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.steer).toHaveBeenCalledWith("run-1", "focus the form"));
  });

  it("lists artifacts with a download link when the service signed one", async () => {
    const api = fakeRunApi({
      streamEvents: () => streamOf([event(1, "artifact.added", { id: "a1", name: "report.md", size: 2048 })]),
      artifacts: vi.fn(async () => [{ id: "a1", name: "report.md", size: 2048, sha256: "x", download_url: "https://example.test/a1" }]),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await userEvent.click(await screen.findByRole("tab", { name: /Artifacts/ }));
    const link = await screen.findByRole("link", { name: "Download report.md" });
    expect(link.getAttribute("href")).toBe("https://example.test/a1");
    expect(screen.getByText("2.0 KiB")).toBeTruthy();
  });

  it("does not pin a take-over once the run has ended, even when the stream left it open", async () => {
    const api = fakeRunApi({
      streamEvents: () =>
        streamOf([event(1, "run.waiting_input", { request: takeover }), event(2, "run.blocked", { reason: "egress" })]),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Requests" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Take control" })).toBeNull();
  });

  it("keeps the run's requests above the tabs", async () => {
    const api = fakeRunApi({ streamEvents: () => streamOf([event(1, "run.waiting_input", { request: approval })]) });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    const requests = await screen.findByRole("region", { name: "Requests" });
    expect(requests.textContent).toContain("Run the installer?");
  });
});

describe("RunScreen run id", () => {
  it("shows the run id as the page heading", async () => {
    const api = fakeRunApi({ getRun: vi.fn(async () => runView({ id: "run-9" })), streamEvents: () => streamOf([]) });
    render(<RunScreen runId="run-9" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    expect(await screen.findByRole("heading", { name: "run-9" })).toBeTruthy();
  });
});

describe("RunScreen agent", () => {
  it("shows the agent's name in the header, with its id as the hover title", async () => {
    const api = fakeRunApi({
      getRun: vi.fn(async () => runView({ id: "run-1", agent_id: "agent-aa226f26" })),
      streamEvents: () => streamOf([]),
    });
    const agents = fakeAgentsApi({
      listAgents: vi.fn(async () => [agentJson({ id: "agent-aa226f26", name: "Desk agent" })]),
    });
    render(<RunScreen runId="run-1" api={api} agents={agents} transport="auto" viewerBaseUrl="http://localhost" />);
    const name = await screen.findByText("Desk agent");
    expect(name.getAttribute("title")).toBe("agent-aa226f26");
  });

  it("falls back to the agent's id when the agent is not in the list", async () => {
    const api = fakeRunApi({
      getRun: vi.fn(async () => runView({ id: "run-1", agent_id: "agent-aa226f26" })),
      streamEvents: () => streamOf([]),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    expect(await screen.findByText("agent-aa226f26")).toBeTruthy();
  });
});

const inputRequest: RunRequest = {
  id: "req-input",
  kind: "input",
  title: "Sign in to the site",
  options: [],
  meta: {
    message: "The site needs your code.",
    fields: [
      { name: "account", title: "Account", type: "string", required: true },
      { name: "code", title: "One-time code", type: "string", required: true, secret: true },
    ],
  },
  expires_at: "2026-10-19T11:00:00Z",
};

describe("RunScreen input request", () => {
  it("mounts the input card and sends the values the person types", async () => {
    const api = fakeRunApi({ streamEvents: () => streamOf([event(1, "run.waiting_input", { request: inputRequest })]) });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await userEvent.type(await screen.findByLabelText("Account (required)"), "tester");
    await userEvent.type(screen.getByLabelText("One-time code (required)"), "424242");
    await userEvent.click(within(screen.getByRole("form", { name: "Values requested" })).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(api.answer).toHaveBeenCalledWith("run-1", "req-input", { action: "accept", values: { account: "tester", code: "424242" } }),
    );
  });

  it("sends decline without values", async () => {
    const api = fakeRunApi({ streamEvents: () => streamOf([event(1, "run.waiting_input", { request: inputRequest })]) });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await userEvent.click(await screen.findByRole("button", { name: "Decline" }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith("run-1", "req-input", { action: "decline" }));
  });
});

describe("RunScreen Details tab", () => {
  const provenance: RunProvenance = {
    agent: { id: "agent-1", version: 3 },
    harness: [{ name: "acp", version: "1.2", build: "abc123", computer: "c1", at: "2026-10-19T10:00:01Z" }],
    model: "model-x",
    computers: [
      {
        id: "c1",
        runtime: "docker",
        template: "agent-computer",
        image_digest: "sha256:abcd",
        started_at: "2026-10-19T10:00:00Z",
        ended_at: "2026-10-19T10:30:00Z",
        reason: "replaced",
      },
    ],
    session_id: "sess-9",
    service: { version: "2.4.0" },
    artifacts: { session_export: "https://example.test/export/sess-9", checkpoints: [{}] },
  };

  it("shows the agent, harness, computers, session and service of a run that has provenance", async () => {
    const api = fakeRunApi({
      getRun: vi.fn(async () => runView({ id: "run-1", agent_id: "agent-1", provenance })),
      streamEvents: () => openStream(),
    });
    const agents = fakeAgentsApi({ listAgents: vi.fn(async () => [agentJson({ name: "Browser agent" })]) });
    render(<RunScreen runId="run-1" api={api} agents={agents} transport="auto" viewerBaseUrl="http://localhost" />);

    await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
    const section = await screen.findByRole("region", { name: "Provenance" });
    expect(section.textContent).toContain("Browser agent · version 3");
    expect(within(section).getByRole("link", { name: "Agent definition" }).getAttribute("href")).toBe("#/agents");
    expect(section.textContent).toContain("acp 1.2 (abc123)");
    expect(section.textContent).toContain("model-x");
    expect(section.textContent).toContain("sha256:abcd");
    expect(section.textContent).toContain("replaced");
    expect(section.textContent).toContain("sess-9");
    expect(section.textContent).toContain("2.4.0");
    expect(section.textContent).toContain("1");
    expect(within(section).getByRole("link", { name: "Session export" }).getAttribute("href")).toBe(
      "https://example.test/export/sess-9",
    );
  });

  it("does not link a session export that is not a web address", async () => {
    const api = fakeRunApi({
      getRun: vi.fn(async () =>
        runView({ id: "run-1", provenance: { session_id: "sess-9", artifacts: { session_export: "javascript:alert(1)" } } }),
      ),
      streamEvents: () => openStream(),
    });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await userEvent.click(await screen.findByRole("tab", { name: "Details" }));
    const section = await screen.findByRole("region", { name: "Provenance" });
    expect(within(section).queryByRole("link", { name: "Session export" })).toBeNull();
  });

  it("is not shown when the run has no provenance", async () => {
    const api = fakeRunApi({ streamEvents: () => openStream() });
    render(<RunScreen runId="run-1" api={api} agents={fakeAgentsApi()} transport="auto" viewerBaseUrl="http://localhost" />);
    await screen.findByRole("tab", { name: "Timeline" });
    expect(screen.queryByRole("tab", { name: "Details" })).toBeNull();
  });
});

