import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewerClient } from "../src/client/client";
import type { ViewerEvent } from "../src/client/types";
import { ViewerError } from "../src/client/types";
import { WS_FIRST_BYTES_TIMEOUT_MS } from "../src/client/screen/websocket";
import { FakeRfb } from "./rfb-double";
import {
  FakeWebSocket,
  FakeWebSocketCtor,
  makeSession,
  openSseResponse,
  recordingFetch,
  TOKEN,
  flush,
} from "./helpers";

/** A container attached to the document, as the React screen provides. */
function container(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

describe("WebSocket screen", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeRfb.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("sends the token as the first message, never in the URL, and runs noVNC view-only in view mode", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 404 }));
    const client = createViewerClient(makeSession({ mode: "view", transports: ["websocket"] }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const pending = client.openScreen({ transport: "auto", container: container() });

    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe("wss://view.example.test/view/v1/screen/ws");
    expect(ws?.url).not.toContain(TOKEN);
    expect(ws?.sent).toEqual([]);
    ws?.open();
    expect(ws?.sent).toEqual([TOKEN]);
    ws?.serverBytes();

    const source = await pending;
    expect(source.transport).toBe("websocket");
    expect(ws?.sent).toEqual([TOKEN]);
    const rfb = FakeRfb.instances[0];
    expect(rfb?.viewOnly).toBe(true);
    expect(rfb?.scaleViewport).toBe(true);
    expect(rfb?.channel).toBe(ws);
    expect(calls).toHaveLength(0);
    client.close();
  });

  it("leaves input enabled for noVNC only in control mode", async () => {
    const client = createViewerClient(makeSession({ mode: "control", transports: ["websocket"] }), {
      fetch: recordingFetch(() => new Response(null, { status: 404 })).fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const pending = client.openScreen({ transport: "websocket", container: container() });
    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.serverBytes();
    await pending;
    expect(FakeRfb.instances[0]?.viewOnly).toBe(false);
    client.close();
  });

  it("fails with no SSE attempt when the only offered transport is websocket and the socket fails", async () => {
    const { fetch, calls } = recordingFetch(() => openSseResponse().response);
    const client = createViewerClient(makeSession({ transports: ["websocket"] }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const events: ViewerEvent[] = [];
    client.on((e) => events.push(e));
    const pending = client.openScreen({ transport: "auto", container: container() });
    FakeWebSocket.instances[0]?.fail();

    const error = (await pending.catch((e: unknown) => e)) as ViewerError;
    expect(error).toBeInstanceOf(ViewerError);
    expect(error.code).toBe("transport_failed");
    expect(calls).toHaveLength(0);
    expect(events.some((e) => e.type === "error")).toBe(true);
    client.close();
  });

  it("falls back to SSE when the WebSocket fails, and reports the transport in use", async () => {
    const held = openSseResponse();
    const { fetch, calls } = recordingFetch(() => held.response);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const client = createViewerClient(makeSession({ transports: ["websocket", "sse"] }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const events: ViewerEvent[] = [];
    client.on((e) => events.push(e));
    const box = container();
    const pending = client.openScreen({ transport: "auto", container: box });
    FakeWebSocket.instances[0]?.fail();

    const source = await pending;
    expect(source.transport).toBe("sse");
    expect(events).toContainEqual({ type: "transport", transport: "sse" });
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/view/v1/screen/frames"]);
    expect(box.querySelector("canvas")).not.toBeNull();
    expect(FakeRfb.instances).toHaveLength(0);
    held.end();
    client.close();
  });

  it("falls back to SSE when the socket sends nothing within five seconds", async () => {
    vi.useFakeTimers();
    const held = openSseResponse();
    const { fetch, calls } = recordingFetch(() => held.response);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const client = createViewerClient(makeSession({ transports: ["websocket", "sse"] }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const pending = client.openScreen({ transport: "auto", container: container() });
    const ws = FakeWebSocket.instances[0];
    ws?.open();
    await vi.advanceTimersByTimeAsync(WS_FIRST_BYTES_TIMEOUT_MS);

    expect(ws?.closed).toBe(true);
    const source = await pending;
    expect(source.transport).toBe("sse");
    expect(calls).toHaveLength(1);
    held.end();
    client.close();
  });

  it("reports a screen that was live and then dropped, once, without retrying the socket", async () => {
    const client = createViewerClient(makeSession({ mode: "control", transports: ["websocket"] }), {
      fetch: recordingFetch(() => new Response(null, { status: 404 })).fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const events: ViewerEvent[] = [];
    client.on((e) => events.push(e));
    const pending = client.openScreen({ transport: "auto", container: container() });
    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.serverBytes();
    await pending;

    FakeRfb.instances[0]?.drop(false);
    await flush(2);
    expect(events).toContainEqual({ type: "status", status: "closed" });
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    client.close();
  });
});
