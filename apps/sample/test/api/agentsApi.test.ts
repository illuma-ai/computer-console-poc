import { describe, expect, it, vi } from "vitest";
import { createAgentsApi } from "../../src/api/agentsApi";
import { RunApiError } from "../../src/api/runApi";
import type { AgentJson, AgentPageJson } from "../../src/api/types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function agent(id: string): AgentJson {
  return {
    id,
    name: `agent ${id}`,
    description: "",
    owner: "alice",
    team: null,
    instructions: "",
    model: null,
    harness: "illuma",
    computer: { runtime: "docker", template: "desktop", egress: "none", timeout_s: 3600 },
    max_wait_s: 900,
    takeover_allowed: true,
    mcp_servers: [],
    setup_commands: [],
    ready_check: null,
    allowed_channels: ["api"],
    enabled: true,
    version: 1,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  };
}

describe("createAgentsApi", () => {
  it("lists every page of the agents, following next_cursor, from the same-origin mount", async () => {
    const pages: AgentPageJson[] = [
      { agents: [agent("a"), agent("b")], next_cursor: "cursor-1" },
      { agents: [agent("c")], next_cursor: null },
    ];
    let served = 0;
    const fetchSpy = vi.fn(async () => jsonResponse(200, pages[served++]));
    const api = createAgentsApi({ fetch: fetchSpy as unknown as typeof fetch });

    const agents = await api.listAgents();

    expect(agents.map((b) => b.id)).toEqual(["a", "b", "c"]);
    const urls = fetchSpy.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(urls).toEqual(["/api/agents?limit=100", "/api/agents?limit=100&cursor=cursor-1"]);
  });

  it("creates a agent with a POST of the body, and returns the agent the service made", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(201, agent("new")));
    const api = createAgentsApi({ fetch: fetchSpy as unknown as typeof fetch });
    const body = {
      name: "Claims filer",
      description: "",
      instructions: "",
      model: null,
      computer: { runtime: "docker", template: "agent", egress: "none", timeout_s: 3600 },
      max_wait_s: 900,
      takeover_allowed: true,
      mcp_servers: [],
      setup_commands: [],
      ready_check: null,
      allowed_channels: ["api"],
    };

    const created = await api.createAgent(body);

    expect(created.id).toBe("new");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agents");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("PATCHes only the fields a change names, to the agent's own path", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ...agent("a"), version: 4 }));
    const api = createAgentsApi({ fetch: fetchSpy as unknown as typeof fetch });

    const saved = await api.updateAgent("a b", { name: "renamed" });

    expect(saved.version).toBe(4);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agents/a%20b");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "renamed" });
  });

  it("disables a agent with a POST to its disable route", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ...agent("a"), enabled: false, version: 2 }));
    const api = createAgentsApi({ fetch: fetchSpy as unknown as typeof fetch });

    const disabled = await api.disableAgent("a");

    expect(disabled.enabled).toBe(false);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agents/a/disable");
    expect(init.method).toBe("POST");
  });

  it("throws the service's code and message, with its status, on a refused call", async () => {
    const api = createAgentsApi({
      fetch: (async () =>
        jsonResponse(400, { error: { code: "AGENT_INVALID", message: "egress is not valid" } })) as unknown as typeof fetch,
    });

    const failure = await api.createAgent({} as never).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(RunApiError);
    expect(failure).toMatchObject({ status: 400, code: "AGENT_INVALID", message: "egress is not valid" });
  });
});
