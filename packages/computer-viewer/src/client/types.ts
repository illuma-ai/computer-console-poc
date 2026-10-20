/**
 * Public types of the computer viewer client.
 *
 * These mirror the viewer half of `docs/CONTRACT.md` ("Viewing a computer"). The package never
 * mints a token; the host passes a {@link ViewerSession} in.
 */

/** `view` is read-only; `control` may send screen input. The manager decides this from the token. */
export type ViewerMode = "view" | "control";

/** A screen transport the server can offer. */
export type ScreenTransport = "websocket" | "sse";

/** What a host may ask for. `auto` tries the offered transports in order. */
export type TransportChoice = ScreenTransport | "auto";

/**
 * The session as the viewer sees it. `expiresAt` is an ISO 8601 instant, the contract's
 * `expires_at`. The token is held in memory only and is never placed in a URL.
 */
export interface ViewerSession {
  baseUrl: string;
  token: string;
  mode: ViewerMode;
  transports: readonly ScreenTransport[];
  expiresAt: string;
}

/** The body of `GET /view/v1/session`. Unknown fields are ignored (contract: additive only). */
export interface SessionInfo {
  computer_id: string;
  mode: ViewerMode;
  expires_at: string;
  transports: ScreenTransport[];
  screen?: { width: number; height: number };
}

/** A process as listed by `GET /view/v1/processes`. */
export interface ProcessInfo {
  pid: string;
  cmd?: string[];
  state?: string;
  exit_code?: number | null;
  started_at?: string;
}

/**
 * One entry of a folder listing from `GET /view/v1/files?path=`. The contract says "a folder's
 * entries" without fixing the shape; this is the shape the client expects and the open point is
 * recorded in `docs/VIEWER.md`.
 */
export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

/**
 * A process event from `GET /view/v1/processes/{pid}/events`. `type` is `started`, `stdout`,
 * `stderr`, `exited` or `error`; unknown types are passed through, so newer servers do not break
 * the viewer.
 */
export interface ProcessEvent {
  type: string;
  id?: string;
  payload: Record<string, unknown>;
}

/** Connection status of the viewer. */
export type ViewerStatus = "connecting" | "connected" | "reconnecting" | "closed" | "expired";

/** Everything the client reports, through `ViewerClient.on`. */
export type ViewerEvent =
  | { type: "status"; status: ViewerStatus }
  | { type: "transport"; transport: ScreenTransport }
  | { type: "error"; error: ViewerError }
  | { type: "expired" };

/** A screen input event, as the body of `POST /view/v1/screen/input`. */
export type ScreenInputEvent =
  | { type: "pointer"; x: number; y: number; buttons: number }
  | { type: "key"; key: string; down: boolean }
  | { type: "text"; text: string };

/** One frame of `event: frame` on `/view/v1/screen/frames`. */
export interface ScreenFrame {
  seq: number;
  width: number;
  height: number;
  format: "jpeg";
  data_b64: string;
}

/** Injectable `fetch`, so tests run offline. */
export type FetchLike = typeof fetch;

/** Injectable `WebSocket` constructor, so tests run offline. */
export type WebSocketLike = typeof WebSocket;

/** A viewer error. `code` is a contract error code, or one of the client codes below. */
export class ViewerError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  /**
   * @param code Contract code (`unauthorized`, `not_found`, `unsupported`, ...) or a client code
   *   (`expired`, `transport_failed`, `network`).
   * @param message Fixed, human text. It never contains the token, a URL or server detail.
   * @param status HTTP status when the error came from a response.
   */
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ViewerError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Turns anything thrown into a ViewerError, keeping an existing one. A stranger error becomes a
 * `network` error with a fixed message, so no provider or browser text reaches the host.
 */
export function toViewerError(err: unknown): ViewerError {
  if (err instanceof ViewerError) return err;
  return new ViewerError("network", "The viewer connection failed");
}
