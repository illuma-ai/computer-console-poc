import type { FetchLike, ScreenTransport, ViewerEvent, ViewerSession, WebSocketLike } from "../types";

/**
 * One screen connection, whichever transport carries it. The WebSocket and SSE implementations
 * both satisfy this, so the caller never branches on the transport after {@link openScreen}.
 */
export interface ScreenSource {
  /** The transport that is actually in use (after `auto` fallback). */
  readonly transport: ScreenTransport;
  /** Stops the screen and removes what it drew into the container. Idempotent. */
  close(): void;
}

/**
 * What a screen implementation needs from the client. Kept as an interface so the screen code
 * never reaches into the client's internals and tests can build one directly.
 */
export interface ScreenContext {
  readonly session: ViewerSession;
  readonly fetch: FetchLike;
  readonly WebSocket: WebSocketLike;
  /** Base reconnect delay for the SSE frame stream, in ms. */
  readonly reconnectDelayMs: number;
  /** `baseUrl` + an absolute path. Never carries the token. */
  url(path: string): string;
  /** Like {@link url}, with the scheme changed to `ws`/`wss`. */
  wsUrl(path: string): string;
  /** Throws `expired` or `closed` once the client can no longer serve requests. */
  assertLive(): void;
  /** A request with the bearer header; maps non-2xx responses to a ViewerError. */
  request(path: string, init: { method: string; body?: string }): Promise<Response>;
  /** Reports a status, transport or error to the client's listeners. */
  emit(event: ViewerEvent): void;
}

/** A source failed after it had been live; the client reports it and marks the screen closed. */
export type ScreenLostHandler = (reason: Error | null) => void;
