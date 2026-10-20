import { errorFromResponse, runEventStream, DEFAULT_RECONNECT_MS } from "./sse";
import { openScreen } from "./screen/open";
import type { ScreenContext, ScreenSource } from "./screen/types";
import { ViewerError, toViewerError } from "./types";
import type {
  FetchLike,
  FileEntry,
  ProcessEvent,
  ProcessInfo,
  ScreenTransport,
  SessionInfo,
  TransportChoice,
  ViewerEvent,
  ViewerSession,
  WebSocketLike,
} from "./types";

/**
 * The framework-free viewer client. It takes a {@link ViewerSession} from the host and talks to the
 * public viewer listener of the computer manager (`docs/CONTRACT.md`, "Viewing a computer").
 *
 * Rules this module enforces:
 * - The token goes in an `Authorization: Bearer` header, never in a URL path or query. The
 *   WebSocket is the one exception and carries the token as its first message (screen/websocket.ts).
 * - The token is held in memory only. Nothing here logs, stores or serialises it.
 * - When `expiresAt` passes, every stream and screen is closed and `expired` is emitted.
 */

/** Options of {@link createViewerClient}. All are optional; the defaults use the platform's globals. */
export interface ViewerClientOptions {
  /** Injected `fetch`. Tests pass a fake; browsers use the global. */
  fetch?: FetchLike;
  /** Injected `WebSocket` constructor. Tests pass a fake; browsers use the global. */
  WebSocket?: WebSocketLike;
  /** First SSE reconnect delay in ms (tests shorten it). */
  reconnectDelayMs?: number;
}

/** Options of {@link ViewerClient.openScreen}. */
export interface OpenScreenOptions {
  /** Which transport to use. `auto` tries the session's offered transports in order. */
  transport: TransportChoice;
  /** The element the screen is drawn into. Keep it free of host-managed children. */
  container: HTMLElement;
}

/** The client a host (or `ComputerViewer`) holds for one session. */
export interface ViewerClient {
  readonly session: ViewerSession;
  /** Subscribes to status, transport, error and expiry events. Returns the unsubscribe function. */
  on(listener: (event: ViewerEvent) => void): () => void;
  /** `GET /view/v1/session`. */
  getSession(): Promise<SessionInfo>;
  /** `GET /view/v1/processes`. */
  listProcesses(): Promise<ProcessInfo[]>;
  /**
   * Follows a process's output (`GET /view/v1/processes/{pid}/events`, SSE over fetch). It ends by
   * itself after `exited` or `error`. Returns a function that stops the follow.
   */
  followProcess(pid: string, onEvent: (event: ProcessEvent) => void): () => void;
  /** `GET /view/v1/files?path=`: the entries of a folder. */
  listFiles(path: string): Promise<FileEntry[]>;
  /** `GET /view/v1/files?path=`: a file's bytes, as a Blob. */
  downloadFile(path: string): Promise<Blob>;
  /** Opens the screen into `container`, resolving with the transport that is in use. */
  openScreen(options: OpenScreenOptions): Promise<ScreenSource>;
  /** Closes every stream and screen and emits `closed`. Idempotent. */
  close(): void;
}

/** The transports this package knows how to open; anything else in a session is ignored. */
const KNOWN_TRANSPORTS: readonly ScreenTransport[] = ["websocket", "sse"];
/** `setTimeout` cannot wait longer than this; the expiry timer re-arms when it fires early. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Creates a client for one session and arms its expiry timer.
 *
 * @param session The host-provided session. Validated here; an invalid one throws.
 * @param options Injected fetch, WebSocket and reconnect delay, for tests.
 * @returns The client. Call `close()` when the viewer unmounts.
 * @throws {ViewerError} `invalid_request` when the session is incomplete or malformed.
 */
export function createViewerClient(session: ViewerSession, options: ViewerClientOptions = {}): ViewerClient {
  const checked = validateSession(session);
  // WHY wrap: calling a browser's global fetch unbound throws "Illegal invocation".
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const WebSocketCtor: WebSocketLike = options.WebSocket ?? globalThis.WebSocket;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_MS;
  const expiresMs = Date.parse(checked.expiresAt);

  const listeners = new Set<(event: ViewerEvent) => void>();
  const streams = new Set<AbortController>();
  const sources = new Set<ScreenSource>();
  let state: "open" | "closed" | "expired" = "open";
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  function emit(event: ViewerEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  function assertLive(): void {
    if (state === "expired") throw new ViewerError("expired", "The viewer session has expired");
    if (state === "closed") throw new ViewerError("closed", "The viewer has been closed");
  }

  function url(path: string): string {
    return checked.baseUrl + path;
  }

  function wsUrl(path: string): string {
    return checked.baseUrl.replace(/^http/, "ws") + path;
  }

  async function request(path: string, init: { method: string; body?: string }): Promise<Response> {
    assertLive();
    const headers: Record<string, string> = { Authorization: `Bearer ${checked.token}` };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetchFn(url(path), { method: init.method, headers, body: init.body, cache: "no-store" });
    } catch {
      // The browser's error text can name the host; the fixed message does not.
      throw new ViewerError("network", "The viewer could not reach the server");
    }
    if (!res.ok) throw await errorFromResponse(res);
    return res;
  }

  const ctx: ScreenContext = {
    session: checked,
    fetch: fetchFn,
    WebSocket: WebSocketCtor,
    reconnectDelayMs,
    url,
    wsUrl,
    assertLive,
    request,
    emit,
  };

  function stopAll(): void {
    for (const stream of streams) stream.abort();
    streams.clear();
    for (const source of sources) source.close();
    sources.clear();
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  }

  function expire(): void {
    if (state !== "open") return;
    state = "expired";
    stopAll();
    emit({ type: "status", status: "expired" });
    emit({ type: "expired" });
  }

  function armExpiry(): void {
    if (state !== "open") return;
    const remaining = expiresMs - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    expiryTimer = setTimeout(armExpiry, Math.min(remaining, MAX_TIMER_MS));
  }

  async function getJson(path: string): Promise<unknown> {
    const res = await request(path, { method: "GET" });
    return res.json();
  }

  const client: ViewerClient = {
    session: checked,

    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async getSession() {
      return (await getJson("/view/v1/session")) as SessionInfo;
    },

    async listProcesses() {
      return listingOf<ProcessInfo>(await getJson("/view/v1/processes"), "processes");
    },

    followProcess(pid, onEvent) {
      if (state !== "open") {
        // A follow started after expiry or close reports why, and streams nothing.
        const reason = state === "expired" ? "expired" : "closed";
        queueMicrotask(() => emit({ type: "error", error: new ViewerError(reason, "The viewer is no longer live") }));
        return () => undefined;
      }
      const controller = new AbortController();
      streams.add(controller);
      runEventStream({
        fetch: fetchFn,
        url: url(`/view/v1/processes/${encodeURIComponent(pid)}/events`),
        token: checked.token,
        signal: controller.signal,
        reconnectDelayMs,
        onOpen: () => undefined,
        onReconnect: () => undefined,
        onMessage: (msg) => {
          const terminal = msg.event === "exited" || msg.event === "error";
          onEvent({ type: msg.event, id: msg.id || undefined, payload: parsePayload(msg.data) });
          return terminal;
        },
      })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) emit({ type: "error", error: toViewerError(err) });
        })
        .finally(() => {
          streams.delete(controller);
        });
      return () => {
        controller.abort();
        streams.delete(controller);
      };
    },

    async listFiles(path) {
      const res = await request(`/view/v1/files?path=${encodeURIComponent(path)}`, { method: "GET" });
      return listingOf<FileEntry>(await res.json(), "entries");
    },

    async downloadFile(path) {
      const res = await request(`/view/v1/files?path=${encodeURIComponent(path)}`, { method: "GET" });
      return res.blob();
    },

    async openScreen(opts) {
      assertLive();
      const source = await openScreen(ctx, { transport: opts.transport, container: opts.container }, (reason) => {
        // The screen was live and then lost; the viewer reports it and does not reconnect by itself.
        emit({ type: "status", status: "closed" });
        if (reason) emit({ type: "error", error: toViewerError(reason) });
      });
      // A closed screen removes itself, so a host that re-opens the screen does not accumulate entries.
      const tracked: ScreenSource = {
        transport: source.transport,
        close() {
          sources.delete(tracked);
          source.close();
        },
      };
      sources.add(tracked);
      return tracked;
    },

    close() {
      if (state !== "open") return;
      state = "closed";
      stopAll();
      emit({ type: "status", status: "closed" });
    },
  };

  // WHY a microtask: an already-expired session would otherwise report expiry before the host has
  // subscribed to the events, and the host would never learn why its screen stays empty.
  queueMicrotask(armExpiry);
  return client;
}

/**
 * Checks the host's session and returns a normalised copy (no trailing slash on the base URL,
 * known transports only, each once).
 *
 * @throws {ViewerError} `invalid_request` for a missing token, a non-http(s) base URL, an unknown
 *   mode, or an expiry that is not a time.
 */
export function validateSession(session: ViewerSession): ViewerSession {
  if (!session || typeof session !== "object") throw invalidSession();
  let parsed: URL;
  try {
    parsed = new URL(session.baseUrl);
  } catch {
    throw invalidSession();
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw invalidSession();
  if (typeof session.token !== "string" || session.token.length === 0) throw invalidSession();
  if (session.mode !== "view" && session.mode !== "control") throw invalidSession();
  if (!Number.isFinite(Date.parse(session.expiresAt))) throw invalidSession();
  const transports = [...new Set(session.transports)].filter((t) => KNOWN_TRANSPORTS.includes(t));
  return {
    baseUrl: session.baseUrl.replace(/\/+$/, ""),
    token: session.token,
    mode: session.mode,
    transports,
    expiresAt: session.expiresAt,
  };
}

/** The error for a session the client cannot use. The message names no field value. */
function invalidSession(): ViewerError {
  return new ViewerError("invalid_request", "The viewer session is incomplete or malformed");
}

/** Reads a listing that is either a bare array or an object holding one under `key`. */
function listingOf<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

/** Parses an event's JSON data. A malformed payload becomes an empty object, never an exception. */
function parsePayload(data: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(data);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
