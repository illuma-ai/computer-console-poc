import type {
  ArtifactJson,
  ErrorBody,
  LeaseGrant,
  RunEvent,
  RunsPageJson,
  RunStatus,
  RunView,
  ViewJson,
} from "./types";
import { decodeText, parseSse } from "./sse";
import type { InputAnswer } from "../cards/inputRequest";

/**
 * The browser's client for the run API. It calls only the same-origin mount (`/api/runs`); the dev
 * server rewrites it to the run service's `/v1/runs` and adds the service token. No credential is held
 * here.
 */

/** The same-origin mount the dev proxy serves. */
export const RUN_API_BASE = "/api/runs";

/** A failed call. `code` and `message` come from the service's error body, or are fixed text. */
export class RunApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RunApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * The inline text for a failed call: the HTTP status and the API's message, e.g. "Error 409: the run has
 * ended". A failure that never reached the service (a network error) has no status, so only its message
 * is shown.
 *
 * @param err The value a failed call threw.
 */
export function failureText(err: unknown): string {
  if (err instanceof RunApiError) return `Error ${err.status}: ${err.message}`;
  return err instanceof Error && err.message !== "" ? err.message : "The request failed";
}

/** The body of `POST /v1/runs`. Only these fields exist on the service's strict body. */
export interface CreateRunInput {
  readonly agent_id: string;
  readonly prompt: string;
}

/**
 * The answer to a request: one of its options, a text (a question accepts text), or for an `input` request the
 * accept (with its values), decline or cancel.
 */
export type AnswerBody = { readonly option_id: string } | { readonly text: string } | InputAnswer;

/** The filters of `GET /v1/runs`. An empty status means every status. */
export interface RunsQuery {
  readonly status?: RunStatus | "";
  readonly agent_id?: string;
  readonly limit?: number;
  /** The `next_cursor` of the previous page. Absent for the first page. */
  readonly cursor?: string;
}

/** The calls the screens make. The screens depend on this interface, so tests substitute a fake. */
export interface RunApi {
  listRuns(query: RunsQuery): Promise<RunsPageJson>;
  createRun(input: CreateRunInput): Promise<RunView>;
  getRun(runId: string): Promise<RunView>;
  cancel(runId: string): Promise<RunView>;
  steer(runId: string, text: string): Promise<unknown>;
  streamEvents(runId: string, afterSeq: number, signal: AbortSignal): AsyncGenerator<RunEvent>;
  answer(runId: string, requestId: string, body: AnswerBody): Promise<unknown>;
  lease(runId: string, requestId: string): Promise<LeaseGrant>;
  release(runId: string, leaseId: string, done: boolean): Promise<unknown>;
  view(runId: string): Promise<ViewJson>;
  artifacts(runId: string): Promise<readonly ArtifactJson[]>;
  /** The recording's manifest, as the dev server's mount addresses it (`GET /v1/runs/{id}/recording`). */
  recordingUrl(runId: string): string;
}

/** Options for {@link createRunApi}. */
export interface RunApiOptions {
  /** Defaults to {@link RUN_API_BASE}. */
  readonly baseUrl?: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Build the run API client.
 *
 * @param options The base URL and an injectable `fetch`.
 */
export function createRunApi(options: RunApiOptions = {}): RunApi {
  const base = options.baseUrl ?? RUN_API_BASE;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const call = <T>(method: string, path: string, body?: unknown): Promise<T> =>
    callJson<T>(doFetch, base, method, path, body);
  const at = (runId: string): string => `/${encodeURIComponent(runId)}`;

  return {
    listRuns: (query) => call<RunsPageJson>("GET", `?${queryString(query)}`),
    createRun: (input) => call<RunView>("POST", "", input),
    getRun: (runId) => call<RunView>("GET", at(runId)),
    cancel: (runId) => call<RunView>("POST", `${at(runId)}/cancel`),
    steer: (runId, text) => call("POST", `${at(runId)}/steer`, { text }),
    async *streamEvents(runId, afterSeq, signal) {
      const headers: Record<string, string> = {};
      if (afterSeq > 0) headers["Last-Event-ID"] = String(afterSeq);
      const response = await doFetch(`${base}${at(runId)}/events`, { method: "GET", headers, signal });
      if (!response.ok) throw await errorOf(response);
      if (!response.body) throw new RunApiError(response.status, "stream_missing", "The event stream is empty");
      for await (const message of parseSse(decodeText(response.body))) {
        if (message.event !== "message") continue;
        yield JSON.parse(message.data) as RunEvent;
      }
    },
    answer: (runId, requestId, body) =>
      call("POST", `${at(runId)}/requests/${encodeURIComponent(requestId)}/answer`, body),
    lease: (runId, requestId) =>
      call<LeaseGrant>("POST", `${at(runId)}/requests/${encodeURIComponent(requestId)}/lease`),
    release: (runId, leaseId, done) =>
      call("POST", `${at(runId)}/leases/${encodeURIComponent(leaseId)}/release`, { done }),
    view: (runId) => call<ViewJson>("POST", `${at(runId)}/view`),
    async artifacts(runId) {
      const body = await call<{ artifacts: ArtifactJson[] }>("GET", `${at(runId)}/artifacts`);
      return body.artifacts;
    },
    recordingUrl: (runId) => `${base}${at(runId)}/recording`,
  };
}

/**
 * The query string of a run list. Empty filters are left out, so the service applies its defaults.
 *
 * @param query The filters as the screen holds them.
 */
export function queryString(query: RunsQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.agent_id) params.set("agent_id", query.agent_id);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

/**
 * One JSON call under a same-origin API mount. Shared by the run API and the agent registry client, so both
 * fail the same way.
 *
 * @param doFetch The fetch to call (injectable for tests).
 * @param base The mount, e.g. `/api/runs`.
 * @param method The HTTP method.
 * @param path The path below the mount, starting with `/` or `?` (or empty).
 * @param body A JSON body, when there is one.
 * @throws {RunApiError} when the service answers with a non-2xx status.
 */
export async function callJson<T>(
  doFetch: typeof fetch,
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, headers: {} as Record<string, string> };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await doFetch(`${base}${path}`, init);
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as T;
}

async function errorOf(response: Response): Promise<RunApiError> {
  let body: Partial<ErrorBody> = {};
  try {
    body = (await response.json()) as Partial<ErrorBody>;
  } catch {
    // A non-JSON failure keeps the fixed message below; the body is not shown.
  }
  const code = body.error?.code ?? "http_error";
  const message = body.error?.message ?? `The run service answered ${response.status}`;
  return new RunApiError(response.status, code, message);
}
