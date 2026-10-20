import { vi } from "vitest";
import type { AgentsApi } from "../../src/api/agentsApi";
import type { RunApi } from "../../src/api/runApi";
import type { AgentJson, RunEvent, RunView, ViewJson } from "../../src/api/types";

/** Builders and fake clients for the screen tests. Nothing here reaches a network or a computer. */

/** A run as the list and the detail show it. */
export function runView(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    agent_id: "agent-1",
    status: "running",
    computer_id: null,
    result: null,
    error: null,
    max_wait_s: 900,
    ...overrides,
  };
}

/** An event of the run's stream, with the envelope fields the reducer reads. */
export function event(seq: number, type: string, data: Record<string, unknown> = {}, at = "2026-10-19T10:00:00Z"): RunEvent {
  return { run_id: "run-1", seq, type, at, tenant: "t", agent_id: "agent-1", origin: null, data };
}

/** A progress event of one kind (`message`, `tool`, `plan`, `setup`). */
export function progress(seq: number, kind: string, data: Record<string, unknown> = {}): RunEvent {
  return event(seq, "run.progress", { kind, ...data });
}

/** An agent as the registry returns it. */
export function agentJson(overrides: Partial<AgentJson> = {}): AgentJson {
  return {
    id: "agent-1",
    name: "Browser agent",
    description: "Works in a browser.",
    owner: "owner",
    team: null,
    instructions: "Do the task.",
    model: null,
    harness: "acp",
    computer: { runtime: "e2b", template: "cm-desktop-agent", egress: "open", timeout_s: 3600 },
    max_wait_s: 3600,
    takeover_allowed: true,
    mcp_servers: [],
    setup_commands: [],
    ready_check: null,
    allowed_channels: ["api"],
    enabled: true,
    version: 1,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

/** A view session as the service returns it. */
export function viewJson(overrides: Partial<ViewJson> = {}): ViewJson {
  return {
    token: "viewer-token",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    mode: "view",
    transports: ["websocket"],
    viewer_url: "",
    ...overrides,
  };
}

/** A stream that yields the events and then closes, as a finished run does. */
export function streamOf(events: readonly RunEvent[]): AsyncGenerator<RunEvent> {
  return (async function* (): AsyncGenerator<RunEvent> {
    for (const item of events) yield item;
  })();
}

/** A stream that stays open until the signal aborts, as a live run does. */
export function openStream(): AsyncGenerator<RunEvent> {
  return (async function* (): AsyncGenerator<RunEvent> {
    await new Promise<void>(() => undefined);
  })();
}

/**
 * A run API whose every call is a spy. Each test overrides the calls it cares about. The default stream is
 * empty and closed, and the default list is empty.
 */
export function fakeRunApi(overrides: Partial<RunApi> = {}): RunApi {
  return {
    listRuns: vi.fn(async () => ({ runs: [] as RunView[], next_cursor: null })),
    createRun: vi.fn(async () => runView({ id: "run-new" })),
    getRun: vi.fn(async (runId: string) => runView({ id: runId })),
    cancel: vi.fn(async () => runView({ status: "cancelled" })),
    steer: vi.fn(async () => ({})),
    streamEvents: vi.fn(() => streamOf([])),
    answer: vi.fn(async () => ({})),
    lease: vi.fn(async () => ({
      lease: {
        id: "lease-1",
        run_id: "run-1",
        request_id: "req-1",
        holder: "me",
        expires_at: "2026-10-19T11:00:00Z",
        released_at: null,
        release_reason: null,
      },
      view: viewJson({ mode: "control", token: "control-token" }),
    })),
    release: vi.fn(async () => ({})),
    view: vi.fn(async () => viewJson()),
    artifacts: vi.fn(async () => []),
    recordingUrl: vi.fn((runId: string) => `/api/runs/${runId}/recording`),
    ...overrides,
  };
}

/** The agent registry, as a spy. The default list is empty. */
export function fakeAgentsApi(overrides: Partial<AgentsApi> = {}): AgentsApi {
  return {
    listAgents: vi.fn(async () => [] as AgentJson[]),
    createAgent: vi.fn(async (body) => agentJson({ name: body.name })),
    updateAgent: vi.fn(async (id: string) => agentJson({ id })),
    disableAgent: vi.fn(async (id: string) => agentJson({ id, enabled: false })),
    ...overrides,
  };
}

/** A key-value store in memory, shaped like the browser's. */
export function memoryStorage(initial: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? (data[key] ?? null) : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}
