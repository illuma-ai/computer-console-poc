/**
 * The wire shapes of the run API the sample uses (agent-bridge-runs `src/runs/runs.dto.ts`,
 * `src/runs/agents/agents.dto.ts` and `src/runs/run-event-stream.service.ts`). Snake_case, as the service
 * sends them. Unknown fields are ignored, so the service can add fields without breaking this app.
 *
 * Fields the service does not send yet are optional here and the screens show a dash for them. See the
 * gaps list in docs/SAMPLE.md.
 */

/** A run's status, as `runJson` reports it. */
export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

/** Every run status, in the order the status filter shows them. */
export const RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "starting",
  "running",
  "waiting_input",
  "completed",
  "failed",
  "cancelled",
  "blocked",
];

/** The statuses after which a run has ended and its stream closes. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled", "blocked"];

/** The statuses in which the run's computer exists. */
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ["starting", "running", "waiting_input"];

/** One option a request offers (`PendingRequestOption`). */
export interface RequestOption {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

/**
 * A pending request as the event stream and `GET /v1/runs/{id}` show it. `kind` is `takeover`, `question`
 * or `approval` today; a future `input` kind (docs/plans/request-input-contract.md) is not sent yet.
 */
export interface RunRequest {
  readonly id: string;
  readonly kind: "question" | "approval" | "takeover" | (string & {});
  readonly title: string;
  readonly options: readonly RequestOption[];
  /** For a take-over, `{ reason }` from the agent. A `url` is read when present; the service does not send one today. */
  readonly meta: Readonly<Record<string, unknown>>;
  readonly expires_at: string;
}

/** A run as `runJson` returns it. The task (`prompt`) is never returned. */
export interface RunView {
  readonly id: string;
  readonly agent_id: string;
  readonly status: RunStatus;
  readonly computer_id: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly max_wait_s: number;
  readonly requests?: readonly RunRequest[];
  /** Not sent today: the list and the detail show a dash when absent. */
  readonly runtime?: string | null;
  readonly created_at?: string | null;
  readonly started_at?: string | null;
  readonly ended_at?: string | null;
}

/** One page of `GET /v1/runs`. `next_cursor` is null on the last page. */
export interface RunsPageJson {
  readonly runs: readonly RunView[];
  readonly next_cursor: string | null;
}

/** A view session as `viewJson` returns it. `viewer_url` is "" unless the manager has a public URL. */
export interface ViewJson {
  readonly token: string;
  readonly expires_at: string;
  readonly mode: "view" | "control";
  readonly transports: readonly string[];
  readonly viewer_url: string;
}

/** A take-over lease as `leaseJson` returns it. */
export interface LeaseJson {
  readonly id: string;
  readonly run_id: string;
  readonly request_id: string;
  readonly holder: string;
  readonly expires_at: string;
  readonly released_at: string | null;
  readonly release_reason: string | null;
}

/** `POST .../lease`: a lease and a control session for it. */
export interface LeaseGrant {
  readonly lease: LeaseJson;
  readonly view: ViewJson;
}

/** An artifact with its fresh download link. The link fields are absent when the store cannot sign one. */
export interface ArtifactJson {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly download_url?: string;
  readonly download_expires_at?: string;
}

/** One event of the run's stream: the envelope of spec section 5 (`sseFrame` in the service). */
export interface RunEvent {
  readonly run_id: string;
  readonly seq: number;
  readonly type: string;
  readonly at: string;
  readonly tenant: string;
  readonly agent_id: string;
  readonly origin: unknown;
  readonly data: Readonly<Record<string, unknown>>;
}

/** The error body every route returns: `{ "error": { "code", "message" } }`. */
export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

/** How the harness lists an MCP server's tools to the model. Unset means the harness default (`indexed`). */
export type ToolsMode = "full" | "indexed";

/** The computer profile of an agent (`computer` in the agent body). `egress` is `open`, `none` or a host list. */
export interface AgentComputer {
  readonly runtime: string;
  readonly template: string;
  readonly egress: string;
  readonly timeout_s: number;
}

/** An MCP server as an agent read shows it: env entries carry their names only, never their values. */
export interface AgentMcpServerJson {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string }[];
  readonly tools?: ToolsMode | null;
}

/** An agent as `agentJson` returns it. */
export interface AgentJson {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly owner: string;
  readonly team: string | null;
  readonly instructions: string;
  readonly model: string | null;
  readonly harness: string;
  readonly computer: AgentComputer;
  readonly max_wait_s: number;
  readonly takeover_allowed: boolean;
  /** Absent from services that predate recording. */
  readonly recording?: boolean;
  readonly recording_retention_days?: number;
  readonly recording_required?: boolean;
  readonly recording_pause_on_text?: boolean;
  readonly mcp_servers: readonly AgentMcpServerJson[];
  readonly setup_commands: readonly (readonly string[])[];
  readonly ready_check: readonly string[] | null;
  readonly allowed_channels: readonly string[];
  readonly enabled: boolean;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** An MCP server as an agent write sends it. The env values are sent again on every write that includes them. */
export interface AgentMcpServerWrite {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string; readonly value: string }[];
  /** Omitted when unset, so the harness default applies. */
  readonly tools?: ToolsMode;
}

/** The body of `POST /v1/agents` and `PATCH /v1/agents/{id}` (a PATCH sends any subset). Strict on the service. */
export interface AgentWrite {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly model: string | null;
  readonly computer: AgentComputer;
  readonly max_wait_s: number;
  readonly takeover_allowed: boolean;
  /** Each is sent only when set, so a service that predates recording keeps accepting the write. */
  readonly recording?: boolean;
  readonly recording_retention_days?: number;
  readonly recording_required?: boolean;
  readonly recording_pause_on_text?: boolean;
  readonly mcp_servers: readonly AgentMcpServerWrite[];
  readonly setup_commands: readonly (readonly string[])[];
  readonly ready_check: readonly string[] | null;
  readonly allowed_channels: readonly string[];
}

/** One page of `GET /v1/agents`. `next_cursor` is null on the last page. */
export interface AgentPageJson {
  readonly agents: readonly AgentJson[];
  readonly next_cursor: string | null;
}
