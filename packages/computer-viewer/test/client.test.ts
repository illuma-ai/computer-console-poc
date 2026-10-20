import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewerClient, validateSession } from "../src/client/client";
import type { ViewerEvent } from "../src/client/types";
import { ViewerError } from "../src/client/types";
import {
  BASE,
  FakeWebSocket,
  FakeWebSocketCtor,
  jsonResponse,
  makeSession,
  openSseResponse,
  recordingFetch,
  sseResponse,
  TOKEN,
  flush,
} from "./helpers";
import type { RecordedCall } from "./helpers";

/** Routes the viewer endpoints to canned answers. The frame stream is held open until the test ends it. */
function route(held: { frames?: ReturnType<typeof openSseResponse>; events?: ReturnType<typeof openSseResponse> }) {
  return (url: string): Response | Promise<Response> => {
    const parsed = new URL(url);
    if (parsed.pathname === "/view/v1/session") {
      return jsonResponse({
        computer_id: "e2b:abc",
        mode: "view",
        expires_at: new Date(Date.now() + 900_000).toISOString(),
        transports: ["sse"],
      });
    }
    if (parsed.pathname === "/view/v1/processes") return jsonResponse([{ pid: "7", cmd: ["make", "test"] }]);
    if (parsed.pathname === "/view/v1/processes/7/events") {
      if (held.events) return held.events.response;
      return sseResponse(['event: exited\ndata: {"exit_code":0}\n\n']);
    }
    if (parsed.pathname === "/view/v1/files") {
      if (parsed.searchParams.get("path") === "/home/user/a.txt") return new Response("file bytes");
      return jsonResponse({ entries: [{ name: "a.txt", type: "file" }] });
    }
    if (parsed.pathname === "/view/v1/screen/frames") {
      if (!held.frames) held.frames = openSseResponse();
      return held.frames.response;
    }
    return jsonResponse({ error: { code: "not_found", message: "No such route" } }, 404);
  };
}

describe("createViewerClient", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the bearer header on every request and never puts the token in a URL", async () => {
    const held: { frames?: ReturnType<typeof openSseResponse>; events?: ReturnType<typeof openSseResponse> } = {};
    const { fetch, calls } = recordingFetch(route(held));
    const client = createViewerClient(makeSession({ transports: ["sse"] }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
      reconnectDelayMs: 1,
    });
    const container = document.createElement("div");

    await client.getSession();
    await client.listProcesses();
    const stop = client.followProcess("7", () => undefined);
    await client.listFiles("/home/user");
    await client.downloadFile("/home/user/a.txt");
    await client.openScreen({ transport: "auto", container });
    await flush(10);
    stop();
    client.close();
    held.frames?.end();

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/view/v1/session",
      "/view/v1/processes",
      "/view/v1/processes/7/events",
      "/view/v1/files",
      "/view/v1/files",
      "/view/v1/screen/frames",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
      expect(call.url.startsWith(BASE)).toBe(true);
    }
  });

  it("sends the screen input POST with the header and without the token in the URL", async () => {
    vi.useFakeTimers();
    const held: { frames?: ReturnType<typeof openSseResponse> } = {};
    const { fetch, calls } = recordingFetch((url, call) => {
      if (call.method === "POST") return new Response(null, { status: 204 });
      return route(held)(url);
    });
    const client = createViewerClient(makeSession({ mode: "control", transports: ["sse"] }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const container = document.createElement("div");
    await client.openScreen({ transport: "sse", container });
    container.querySelector("canvas")?.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 1, clientY: 1, buttons: 1, bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(20);

    const post = calls.find((c) => c.method === "POST") as RecordedCall;
    expect(new URL(post.url).pathname).toBe("/view/v1/screen/input");
    expect(post.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(post.url).not.toContain(TOKEN);
    expect(JSON.parse(post.body ?? "{}")).toEqual({ events: [{ type: "pointer", x: 1, y: 1, buttons: 1 }] });
    held.frames?.end();
    client.close();
  });

  it("reports a fixed, contract-coded error for a rejected token and never includes the token", async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse({ error: { code: "unauthorized", message: "Viewer token is not valid" } }, 401),
    );
    const client = createViewerClient(makeSession({ transports: ["sse"] }), { fetch, WebSocket: FakeWebSocketCtor });
    const error = await client.getSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ViewerError);
    expect((error as ViewerError).code).toBe("unauthorized");
    expect((error as ViewerError).message).not.toContain(TOKEN);
    client.close();
  });

  it("maps a network failure to a fixed message that names no host", async () => {
    const fetch = (() => Promise.reject(new TypeError(`Failed to fetch ${BASE}`))) as unknown as typeof globalThis.fetch;
    const client = createViewerClient(makeSession({ transports: ["sse"] }), { fetch, WebSocket: FakeWebSocketCtor });
    const error = (await client.listProcesses().catch((e: unknown) => e)) as ViewerError;
    expect(error.code).toBe("network");
    expect(error.message).not.toContain("example.test");
    client.close();
  });

  it("rejects an incomplete or malformed session before any request", () => {
    const bad = (overrides: object) => () =>
      createViewerClient({ ...makeSession(), ...overrides } as ReturnType<typeof makeSession>);
    expect(bad({ token: "" })).toThrow(ViewerError);
    expect(bad({ baseUrl: "ftp://files.example.test" })).toThrow(ViewerError);
    expect(bad({ mode: "admin" })).toThrow(ViewerError);
    expect(bad({ expiresAt: "soon" })).toThrow(ViewerError);
  });

  it("normalises the session: no trailing slash, known transports only, each once", () => {
    const checked = validateSession({
      ...makeSession(),
      baseUrl: `${BASE}//`,
      transports: ["sse", "websocket", "sse", "carrier-pigeon" as "sse"],
    });
    expect(checked.baseUrl).toBe(BASE);
    expect(checked.transports).toEqual(["sse", "websocket"]);
  });
});

describe("expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes the screen and the follow, emits expired, and refuses later calls", async () => {
    const held: { frames?: ReturnType<typeof openSseResponse>; events?: ReturnType<typeof openSseResponse> } = {
      events: openSseResponse(),
    };
    const { fetch, calls } = recordingFetch(route(held));
    const expiresAt = new Date(Date.now() + 1_000).toISOString();
    const client = createViewerClient(makeSession({ transports: ["sse"], expiresAt }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
    });
    const events: ViewerEvent[] = [];
    client.on((e) => events.push(e));

    const container = document.createElement("div");
    await client.openScreen({ transport: "auto", container });
    client.followProcess("7", () => undefined);
    await flush(5);
    expect(container.querySelector("canvas")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toContainEqual({ type: "expired" });
    expect(events).toContainEqual({ type: "status", status: "expired" });
    expect(container.querySelector("canvas")).toBeNull();
    const frames = calls.find((c) => new URL(c.url).pathname === "/view/v1/screen/frames");
    const follow = calls.find((c) => new URL(c.url).pathname.endsWith("/events"));
    expect(frames?.signal?.aborted).toBe(true);
    expect(follow?.signal?.aborted).toBe(true);
    const error = (await client.listProcesses().catch((e: unknown) => e)) as ViewerError;
    expect(error.code).toBe("expired");
  });

  it("reports an already-expired session as expired, after the host has subscribed, without opening anything", async () => {
    const { fetch, calls } = recordingFetch(route({}));
    const expiresAt = new Date(Date.now() - 5_000).toISOString();
    const events: ViewerEvent[] = [];
    const client = createViewerClient(makeSession({ transports: ["sse"], expiresAt }), {
      fetch,
      WebSocket: FakeWebSocketCtor,
    });
    client.on((e) => events.push(e));
    await flush(3);
    expect(events).toContainEqual({ type: "expired" });
    expect(calls).toHaveLength(0);
  });
});
