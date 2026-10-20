import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunsScreen } from "../../src/runs/RunsScreen";
import { startBlockedReason, NewRunDialog } from "../../src/runs/NewRunDialog";
import { PROMPTS_STORAGE_KEY } from "../../src/runs/promptStore";
import { RunApiError } from "../../src/api/runApi";
import { agentJson, fakeAgentsApi, fakeRunApi, memoryStorage, runView } from "../support/fakes";
import { SCENARIOS } from "../../src/catalog/catalog";

afterEach(() => cleanup());

const page = [
  runView({ id: "run-a", status: "running", agent_id: "agent-1", created_at: "2026-10-19T10:00:00Z", started_at: "2026-10-19T10:00:00Z" }),
  runView({ id: "run-b", status: "failed", agent_id: "agent-1" }),
];

describe("RunsScreen", () => {
  it("lists the runs with their agent name and a status badge", async () => {
    const api = fakeRunApi({ listRuns: vi.fn(async () => ({ runs: page, next_cursor: null })) });
    const agents = fakeAgentsApi({ listAgents: vi.fn(async () => [agentJson({ id: "agent-1", name: "Desk agent" })]) });
    render(<RunsScreen api={api} agents={agents} storage={null} refreshMs={60_000} />);

    const table = await screen.findByRole("table", { name: "Runs" });
    // Both runs belong to the same agent, so its name shows once per row.
    expect(within(table).getAllByText("Desk agent")).toHaveLength(2);
    expect(within(table).getAllByText("Running").length).toBeGreaterThan(0);
    expect(within(table).getByRole("link", { name: "run-a" }).getAttribute("href")).toBe("#/runs/run-a");
    // The service sends no runtime yet, so the column shows a dash.
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("asks the service for the chosen status and shows only those runs", async () => {
    const listRuns = vi.fn(async (query: { status?: string }) => ({
      runs: query.status === "failed" ? [page[1]!] : page,
      next_cursor: null,
    }));
    render(<RunsScreen api={fakeRunApi({ listRuns })} agents={fakeAgentsApi()} storage={null} refreshMs={60_000} />);
    await screen.findByRole("table", { name: "Runs" });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "failed");
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({ status: "failed", limit: 50 }));
    const table = await screen.findByRole("table", { name: "Runs" });
    await waitFor(() => expect(within(table).queryByRole("link", { name: "run-a" })).toBeNull());
    expect(within(table).getByRole("link", { name: "run-b" })).toBeTruthy();
  });

  it("says so when no run has the chosen status", async () => {
    render(<RunsScreen api={fakeRunApi()} agents={fakeAgentsApi()} storage={null} refreshMs={60_000} />);
    expect(await screen.findByText("No runs yet")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Status"), "blocked");
    expect(await screen.findByText("No runs with this status")).toBeTruthy();
  });

  it("loads the next page with the cursor, and offers it only when there is one", async () => {
    const listRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [page[0]], next_cursor: "cursor-2" })
      .mockResolvedValueOnce({ runs: [page[1]], next_cursor: null });
    render(<RunsScreen api={fakeRunApi({ listRuns })} agents={fakeAgentsApi()} storage={null} refreshMs={60_000} />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({ limit: 50, cursor: "cursor-2" }));
    expect(await screen.findByRole("link", { name: "run-b" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
  });

  it("shows a failed list with the service's status and message", async () => {
    const listRuns = vi.fn(async () => {
      throw new RunApiError(503, "unavailable", "the run service is restarting");
    });
    render(<RunsScreen api={fakeRunApi({ listRuns })} agents={fakeAgentsApi()} storage={null} refreshMs={60_000} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Error 503: the run service is restarting");
  });

  it("refreshes the first page on a timer", async () => {
    const listRuns = vi.fn(async () => ({ runs: page, next_cursor: null }));
    render(<RunsScreen api={fakeRunApi({ listRuns })} agents={fakeAgentsApi()} storage={null} refreshMs={15} />);
    await waitFor(() => expect(listRuns.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 2000 });
  });
});

describe("startBlockedReason", () => {
  it("names why a run cannot start, in the order the form is filled", () => {
    expect(startBlockedReason("", "", false)).toBe("Create or enable an agent to start a run");
    expect(startBlockedReason("", "text", true)).toBe("Choose an agent to start a run");
    expect(startBlockedReason("agent-1", "   ", true)).toBe("Add a prompt to start a run");
    expect(startBlockedReason("agent-1", "go", true)).toBeNull();
  });
});

describe("NewRunDialog", () => {
  const agent = agentJson({ id: "agent-1", name: "Desk agent" });

  it("fills the prompt from a scenario and starts the run on the chosen agent", async () => {
    const api = fakeRunApi({ createRun: vi.fn(async () => runView({ id: "run-new" })) });
    const storage = memoryStorage();
    const onStarted = vi.fn();
    render(<NewRunDialog open onOpenChange={vi.fn()} api={api} agents={[agent]} storage={storage} onStarted={onStarted} />);

    const github = SCENARIOS.find((entry) => entry.title === "Sign in to GitHub");
    if (!github) throw new Error("the scenario catalog must ship the GitHub scenario");
    await userEvent.selectOptions(screen.getByLabelText("Scenario"), github.id);
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe(github.prompt);

    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run-new"));
    expect(api.createRun).toHaveBeenCalledWith({ agent_id: "agent-1", prompt: github.prompt });
    expect(JSON.parse(storage.data[PROMPTS_STORAGE_KEY] ?? "{}")).toEqual({ "agent-1": github.prompt });
  });

  it("offers the prompt last used with the agent, and keeps the start button disabled until a prompt is there", () => {
    const storage = memoryStorage({ [PROMPTS_STORAGE_KEY]: JSON.stringify({ "agent-1": "Last time" }) });
    render(<NewRunDialog open onOpenChange={vi.fn()} api={fakeRunApi()} agents={[agent]} storage={storage} onStarted={vi.fn()} />);
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("Last time");
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("starts on the agent the form shows when the agent list arrives after the dialog opened", async () => {
    const api = fakeRunApi({ createRun: vi.fn(async () => runView({ id: "run-new" })) });
    const onStarted = vi.fn();
    const { rerender } = render(<NewRunDialog open onOpenChange={vi.fn()} api={api} agents={[]} storage={null} onStarted={onStarted} />);
    expect(screen.getByText("Create or enable an agent to start a run")).toBeTruthy();

    rerender(
      <NewRunDialog
        open
        onOpenChange={vi.fn()}
        api={api}
        agents={[agentJson({ id: "agent-1", name: "Desk agent" }), agentJson({ id: "agent-2", name: "Web agent" })]}
        storage={null}
        onStarted={onStarted}
      />,
    );
    expect((screen.getByLabelText("Agent") as HTMLSelectElement).value).toBe("agent-1");
    await userEvent.type(screen.getByLabelText("Prompt"), "go");
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run-new"));
    expect(api.createRun).toHaveBeenCalledWith({ agent_id: "agent-1", prompt: "go" });
  });

  it("offers the prompt last used with the agent the form shows, once the list arrives", async () => {
    const storage = memoryStorage({ [PROMPTS_STORAGE_KEY]: JSON.stringify({ "agent-1": "Last time" }) });
    const { rerender } = render(<NewRunDialog open onOpenChange={vi.fn()} api={fakeRunApi()} agents={[]} storage={storage} onStarted={vi.fn()} />);
    rerender(
      <NewRunDialog open onOpenChange={vi.fn()} api={fakeRunApi()} agents={[agent]} storage={storage} onStarted={vi.fn()} />,
    );
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("Last time");
  });

  it("says why it cannot start when there is no enabled agent", () => {
    render(<NewRunDialog open onOpenChange={vi.fn()} api={fakeRunApi()} agents={[]} storage={null} onStarted={vi.fn()} />);
    expect(screen.getByText("Create or enable an agent to start a run")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a refused start inline with its status", async () => {
    const api = fakeRunApi({
      createRun: vi.fn(async () => {
        throw new RunApiError(409, "agent_disabled", "the agent is disabled");
      }),
    });
    render(<NewRunDialog open onOpenChange={vi.fn()} api={api} agents={[agent]} storage={null} onStarted={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Prompt"), "go");
    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Error 409: the agent is disabled");
  });
});
