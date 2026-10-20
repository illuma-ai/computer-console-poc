import { toViewerError, ViewerError } from "../types";
import type { ScreenTransport, TransportChoice } from "../types";
import { connectSseScreen } from "./sse";
import { connectWebSocketScreen } from "./websocket";
import type { ScreenContext, ScreenLostHandler, ScreenSource } from "./types";

/** Options of {@link openScreen}. */
export interface OpenScreenRequest {
  transport: TransportChoice;
  container: HTMLElement;
}

/**
 * Opens the screen with the requested transport, or with the first one that connects for `auto`.
 *
 * The candidates are the session's offered transports, in the session's order (the server's
 * preference). `auto` tries each in turn; a failed WebSocket falls back to the next offered
 * transport, and the `transport` event names the one in use. A transport the session did not offer
 * is never tried, so with `["websocket"]` only, a failing socket is an error and SSE is not
 * attempted.
 *
 * @param ctx The client context.
 * @param request The requested transport and the element to draw into.
 * @param onLost Called once if a live screen later closes for good.
 * @returns The live source.
 * @throws {ViewerError} `unsupported` when the session offers no usable transport for the request,
 *   or the last failure when every candidate failed.
 */
export async function openScreen(
  ctx: ScreenContext,
  request: OpenScreenRequest,
  onLost: ScreenLostHandler,
): Promise<ScreenSource> {
  const offered = ctx.session.transports;
  const candidates: ScreenTransport[] =
    request.transport === "auto"
      ? [...offered]
      : offered.includes(request.transport)
        ? [request.transport]
        : [];
  if (candidates.length === 0) {
    const err = new ViewerError("unsupported", "This computer has no screen for this session");
    ctx.emit({ type: "error", error: err });
    throw err;
  }

  ctx.emit({ type: "status", status: "connecting" });
  let lastError = new ViewerError("transport_failed", "The screen could not be opened");
  for (const transport of candidates) {
    try {
      const source =
        transport === "websocket"
          ? await connectWebSocketScreen(ctx, request.container, onLost)
          : await connectSseScreen(ctx, request.container, onLost);
      ctx.emit({ type: "transport", transport });
      ctx.emit({ type: "status", status: "connected" });
      return source;
    } catch (err) {
      // The failed attempt has already cleaned up its own socket or canvas; drop anything it drew.
      request.container.replaceChildren();
      lastError = toViewerError(err);
    }
  }
  ctx.emit({ type: "error", error: lastError });
  throw lastError;
}
