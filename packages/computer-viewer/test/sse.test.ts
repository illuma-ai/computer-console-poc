import { afterEach, describe, expect, it } from "vitest";
import { SseParser, runEventStream } from "../src/client/sse";
import type { SseMessage } from "../src/client/sse";
import { ViewerError } from "../src/client/types";
import { jsonResponse, recordingFetch, sseResponse, TOKEN } from "./helpers";

describe("SseParser", () => {
  it("joins multi-line data with newlines and reads event and id", () => {
    const p = new SseParser();
    const msgs = p.push("event: stdout\nid: 12\ndata: first line\ndata: second line\n\n");
    expect(msgs).toEqual([{ event: "stdout", data: "first line\nsecond line", id: "12" }]);
    expect(p.lastEventId).toBe("12");
  });

  it("ignores comments and dispatches nothing for an empty data buffer", () => {
    const p = new SseParser();
    expect(p.push(": keep-alive\n\n")).toEqual([]);
    expect(p.push("event: frame\n\n")).toEqual([]);
  });

  it("keeps the last id across messages and reads retry", () => {
    const p = new SseParser();
    const msgs = p.push("id: 3\ndata: a\n\ndata: b\n\nretry: 2500\n\n");
    expect(msgs.map((m) => m.id)).toEqual(["3", "3"]);
    expect(p.retry).toBe(2500);
  });

  it("handles a line split across chunks and CRLF endings", () => {
    const p = new SseParser();
    expect(p.push("event: fra")).toEqual([]);
    expect(p.push("me\r\ndata: {\"x\":1}\r")).toEqual([]);
    const msgs = p.push("\n\r\n");
    expect(msgs).toEqual([{ event: "frame", data: '{"x":1}', id: "" }]);
  });

  it("defaults the event type to message and strips one leading space only", () => {
    const p = new SseParser();
    const [msg] = p.push("data:  two spaces\n\n");
    expect(msg?.event).toBe("message");
    expect(msg?.data).toBe(" two spaces");
  });
});

describe("runEventStream", () => {
  const controllers: AbortController[] = [];
  afterEach(() => {
    for (const c of controllers) c.abort();
    controllers.length = 0;
  });

  it("reconnects after a dropped stream with Last-Event-ID and resolves on the terminal event", async () => {
    const { fetch, calls } = recordingFetch((_url, call) =>
      call.headers["Last-Event-ID"] === "5"
        ? sseResponse(["id: 6\nevent: exited\ndata: {\"exit_code\":0}\n\n"])
        : sseResponse(["id: 5\nevent: stdout\ndata: hello\n\n"]),
    );
    const controller = new AbortController();
    controllers.push(controller);
    const seen: SseMessage[] = [];
    let reconnects = 0;
    await runEventStream({
      fetch,
      url: "https://view.example.test/view/v1/processes/1/events",
      token: TOKEN,
      signal: controller.signal,
      reconnectDelayMs: 1,
      onOpen: () => undefined,
      onReconnect: () => {
        reconnects += 1;
      },
      onMessage: (msg) => {
        seen.push(msg);
        return msg.event === "exited";
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers["Last-Event-ID"]).toBeUndefined();
    expect(calls[1]?.headers["Last-Event-ID"]).toBe("5");
    expect(reconnects).toBe(1);
    expect(seen.map((m) => m.event)).toEqual(["stdout", "exited"]);
    for (const call of calls) expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("rejects with the contract code for a fatal status and does not retry", async () => {
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse({ error: { code: "unauthorized", message: "Viewer token is not valid" } }, 401),
    );
    const controller = new AbortController();
    controllers.push(controller);
    await expect(
      runEventStream({
        fetch,
        url: "https://view.example.test/view/v1/screen/frames",
        token: TOKEN,
        signal: controller.signal,
        reconnectDelayMs: 1,
        onOpen: () => undefined,
        onReconnect: () => undefined,
        onMessage: () => false,
      }),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("rejects when the first attempt fails before it ever opened", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({ error: { code: "provider_unavailable", message: "x" } }, 502));
    const controller = new AbortController();
    controllers.push(controller);
    const error = await runEventStream({
      fetch,
      url: "https://view.example.test/view/v1/screen/frames",
      token: TOKEN,
      signal: controller.signal,
      reconnectDelayMs: 1,
      onOpen: () => undefined,
      onReconnect: () => undefined,
      onMessage: () => false,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ViewerError);
  });
});
