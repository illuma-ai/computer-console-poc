/// <reference path="../novnc.d.ts" />
import RFB from "@novnc/novnc";
import { ViewerError } from "../types";
import type { ScreenContext, ScreenLostHandler, ScreenSource } from "./types";

/** The WebSocket screen path (`docs/CONTRACT.md`, "Viewing a computer"). */
export const WS_SCREEN_PATH = "/view/v1/screen/ws";

/**
 * How long the WebSocket has to open, accept the token and send its first byte. Past this the
 * `auto` selector falls back to the next transport.
 */
export const WS_FIRST_BYTES_TIMEOUT_MS = 5_000;

/**
 * Connects the WebSocket screen into `container` with noVNC.
 *
 * WHY the token is the first message: browsers cannot set headers on a WebSocket, so the server
 * reads the first client message as the view or control token and closes the socket if it is not
 * valid for this computer. The token is sent before noVNC takes the socket, so noVNC's handshake
 * (which starts with the server's RFB version) is the first thing it sees after that.
 *
 * WHY the socket is handed to noVNC at open rather than after the first byte: noVNC only sees
 * messages that arrive after it attaches. Attaching later would drop the RFB version bytes.
 *
 * @param ctx The client context (session, WebSocket constructor, emitter).
 * @param container The element noVNC draws into. Empty of host-managed children.
 * @param onLost Called once if the screen was live and then closed.
 * @returns A live source once the first server bytes arrive.
 * @throws {ViewerError} `transport_failed` when the socket fails to open, closes, or sends nothing
 *   within {@link WS_FIRST_BYTES_TIMEOUT_MS}. Nothing is left open on a throw.
 */
export function connectWebSocketScreen(
  ctx: ScreenContext,
  container: HTMLElement,
  onLost: ScreenLostHandler,
): Promise<ScreenSource> {
  return new Promise<ScreenSource>((resolve, reject) => {
    let phase: "handshake" | "live" | "done" = "handshake";
    let rfb: RFB | null = null;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const release = (): void => {
      phase = "done";
      clearTimeout(timer);
      // WHY try: disconnect() on a half-open session can throw in noVNC; the socket is closed either way.
      try {
        rfb?.disconnect();
      } catch {
        // already gone
      }
      rfb = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    };

    const fail = (message: string): void => {
      if (phase !== "handshake") return;
      release();
      reject(new ViewerError("transport_failed", message));
    };

    const source: ScreenSource = {
      transport: "websocket",
      close() {
        if (phase === "done") return;
        release();
      },
    };

    try {
      socket = new ctx.WebSocket(ctx.wsUrl(WS_SCREEN_PATH));
    } catch {
      reject(new ViewerError("transport_failed", "The screen connection could not be opened"));
      return;
    }
    socket.binaryType = "arraybuffer";
    timer = setTimeout(() => fail("The screen did not start in time"), WS_FIRST_BYTES_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      try {
        socket.send(ctx.session.token);
        rfb = new RFB(container, socket, { shared: true });
      } catch {
        fail("The screen could not start");
        return;
      }
      // View sessions are read-only on both sides: the server's view-only server drops input, and
      // noVNC sends none.
      rfb.viewOnly = ctx.session.mode === "view";
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.addEventListener("disconnect", (event: Event) => {
        const detail = (event as CustomEvent<{ clean?: boolean }>).detail;
        if (phase === "handshake") {
          fail("The screen closed before it started");
          return;
        }
        if (phase !== "live") return;
        const clean = detail?.clean !== false;
        release();
        onLost(clean ? null : new ViewerError("transport_failed", "The screen connection closed"));
      });
    });

    socket.addEventListener("message", () => {
      if (phase !== "handshake") return;
      phase = "live";
      clearTimeout(timer);
      resolve(source);
    });

    socket.addEventListener("error", () => fail("The screen connection failed"));

    socket.addEventListener("close", () => {
      if (phase === "handshake") fail("The screen closed before it started");
    });
  });
}
