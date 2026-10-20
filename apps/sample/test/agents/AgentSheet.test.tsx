import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentSheet } from "../../src/agents/AgentSheet";
import { AgentsScreen } from "../../src/agents/AgentsScreen";
import { BLANK_FORM, formOf } from "../../src/agents/agentForm";
import { RunApiError } from "../../src/api/runApi";
import { agentJson, fakeAgentsApi } from "../support/fakes";
import type { AgentsApi } from "../../src/api/agentsApi";

afterEach(() => cleanup());

/** The body a spy was called with, as an object. */
function bodyOfCall(spy: unknown, argument = 0): Record<string, unknown> {
  return (spy as Mock).mock.calls[0]?.[argument] as Record<string, unknown>;
}

/** Opens the create sheet for a blank agent. */
function renderCreate(api: AgentsApi, onSaved = vi.fn(), onClose = vi.fn()): void {
  render(<AgentSheet mode="create" agent={null} initial={BLANK_FORM} api={api} onClose={onClose} onSaved={onSaved} />);
}

describe("AgentSheet: create", () => {
  it("names the required fields when saved empty, and sends nothing", async () => {
    const api = fakeAgentsApi();
    renderCreate(api);
    await userEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect(screen.getByText("Name is required")).toBeTruthy();
    expect(screen.getByText("Template is required")).toBeTruthy();
    expect(api.createAgent).not.toHaveBeenCalled();
  });

  it("creates the agent with its settings and the servers from the tool catalog", async () => {
    const api = fakeAgentsApi();
    const onSaved = vi.fn();
    renderCreate(api, onSaved);
    await userEvent.type(screen.getByLabelText("Name"), "Desk");
    await userEvent.type(screen.getByLabelText("Template"), "cm-desktop-agent");
    await userEvent.click(screen.getByRole("button", { name: "Add tool" }));
    expect(screen.getByRole("button", { name: "Remove browser" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const body = bodyOfCall(api.createAgent);
    expect(body).toMatchObject({
      name: "Desk",
      computer: { runtime: "docker", template: "cm-desktop-agent" },
      mcp_servers: [expect.objectContaining({ name: "browser", command: "playwright-mcp" })],
    });
  });

  it("sends the listing mode the person picks for a server", async () => {
    const api = fakeAgentsApi();
    renderCreate(api);
    await userEvent.type(screen.getByLabelText("Name"), "Desk");
    await userEvent.type(screen.getByLabelText("Template"), "cm-desktop-agent");
    await userEvent.click(screen.getByRole("button", { name: "Add tool" }));
    await userEvent.selectOptions(screen.getByLabelText("Listing for browser"), "indexed");
    await userEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(api.createAgent).toHaveBeenCalled());
    expect(bodyOfCall(api.createAgent)["mcp_servers"]).toEqual([expect.objectContaining({ tools: "indexed" })]);
  });

  it("refuses a custom server that is not JSON, and keeps the text for correction", async () => {
    renderCreate(fakeAgentsApi());
    const box = screen.getByLabelText(/Or a custom server/);
    await userEvent.type(box, "not json");
    await userEvent.click(screen.getByRole("button", { name: "Add custom server" }));
    expect(screen.getByRole("alert").textContent).toBe("The server must be valid JSON");
    expect((box as HTMLTextAreaElement).value).toBe("not json");
  });

  it("adds a custom server written as JSON", async () => {
    renderCreate(fakeAgentsApi());
    const box = screen.getByLabelText(/Or a custom server/);
    await userEvent.click(box);
    await userEvent.paste('{"name":"docs","command":"docs-mcp","tools":"indexed"}');
    await userEvent.click(screen.getByRole("button", { name: "Add custom server" }));
    expect(screen.getByRole("button", { name: "Remove docs" })).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the service's refusal with its status", async () => {
    const api = fakeAgentsApi({
      createAgent: vi.fn(async () => {
        throw new RunApiError(403, "forbidden", "only a tenant admin may create agents");
      }),
    });
    renderCreate(api);
    await userEvent.type(screen.getByLabelText("Name"), "Desk");
    await userEvent.type(screen.getByLabelText("Template"), "cm-desktop-agent");
    await userEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Error 403: only a tenant admin may create agents");
  });
});

describe("AgentSheet: edit", () => {
  const saved = agentJson({
    mcp_servers: [{ name: "api", command: "api-mcp", args: [], env: [{ name: "TOKEN" }], tools: null }],
  });

  it("sends no servers when the list is untouched, so the names-only read is not sent back", async () => {
    const api = fakeAgentsApi();
    render(<AgentSheet mode="edit" agent={saved} initial={formOf(saved)} api={api} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Version 1")).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Updated");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    const body = bodyOfCall(api.updateAgent, 1);
    expect(body).not.toHaveProperty("mcp_servers");
    expect(body["description"]).toBe("Updated");
  });

  it("asks for each env value again once the servers are changed, then sends them", async () => {
    const api = fakeAgentsApi();
    render(<AgentSheet mode="edit" agent={saved} initial={formOf(saved)} api={api} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Listing for api"), "full");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText(/enter a value for each env variable/)).toBeTruthy();
    expect(api.updateAgent).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Value for TOKEN"), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(bodyOfCall(api.updateAgent, 1)["mcp_servers"]).toEqual([
      expect.objectContaining({ name: "api", tools: "full", env: [{ name: "TOKEN", value: "s3cret" }] }),
    ]);
  });

  it("shows the saved idle settings and sends the ones the person changes", async () => {
    const api = fakeAgentsApi();
    const idle = agentJson({ idle_pause_s: 300, resume_on_answer: false });
    render(<AgentSheet mode="edit" agent={idle} initial={formOf(idle)} api={api} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect((screen.getByLabelText("Pause after idle (s)") as HTMLInputElement).value).toBe("300");
    await userEvent.clear(screen.getByLabelText("Pause after idle (s)"));
    await userEvent.type(screen.getByLabelText("Pause after idle (s)"), "-5");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText(/0 for never/)).toBeTruthy();
    expect(api.updateAgent).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Pause after idle (s)"));
    await userEvent.type(screen.getByLabelText("Pause after idle (s)"), "0");
    await userEvent.click(screen.getByRole("switch", { name: "Resume on answer" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(bodyOfCall(api.updateAgent, 1)).toMatchObject({ idle_pause_s: 0, resume_on_answer: true });
  });

  it("disables an enabled agent and reports the agent it got back", async () => {
    const api = fakeAgentsApi();
    const onSaved = vi.fn();
    render(<AgentSheet mode="edit" agent={saved} initial={formOf(saved)} api={api} onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("button", { name: "Disable agent" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
    expect(api.disableAgent).toHaveBeenCalledWith(saved.id);
  });
});

describe("AgentsScreen", () => {
  it("lists the agents and opens one for editing", async () => {
    const api = fakeAgentsApi({ listAgents: vi.fn(async () => [agentJson({ name: "Desk agent" })]) });
    render(<AgentsScreen agents={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Desk agent" }));
    expect(await screen.findByRole("form", { name: "Edit agent" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Desk agent");
  });

  it("starts a new agent from a template, with its name and tools filled", async () => {
    const api = fakeAgentsApi();
    render(<AgentsScreen agents={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "New from template" }));
    await userEvent.click(screen.getByRole("button", { name: "Use Browser agent" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Browser agent");
    expect(screen.getByRole("button", { name: "Remove browser" })).toBeTruthy();
  });
});
