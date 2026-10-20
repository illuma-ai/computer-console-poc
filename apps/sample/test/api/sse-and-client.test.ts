import { describe, expect, it, vi } from "vitest";
import { createRunApi, RunApiError } from "../../src/api/runApi";
import type { RunEvent } from "../../src/api/types";
import { decodeText, parseSse } from "../../src/api/sse";
import { toViewerSession } from "../../src/api/viewerSession";

async function* chunksOf(parts: readonly string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function streamResponse(parts: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("parseSse", () => {
  it("joins a message split across chunks and reads id, event and data", async () => {
    const messages = await collect(
      parseSse(chunksOf(["id: 4\nev", "ent: message\ndata: {\"seq\":4", "}\n\n"])),
    );
    expect(messages).toEqual([{ id: "4", event: "message", data: '{"seq":4}' }]);
  });

  it("skips comments, handles CRLF, and drops an unfinished message at the end", async () => {
    const messages = await collect(
      parseSse(chunksOf([": keep-alive\r\ndata: one\r\n\r\n", "data: two\n"])),
    );
    expect(messages).toEqual([{ id: null, event: "message", data: "one" }]);
  });

  it("joins several data lines of one message with newlines", async () => {
    const messages = await collect(parseSse(chunksOf(["data: a\ndata: b\n\n"])));
    expect(messages[0]?.data).toBe("a\nb");
  });
});

describe("decodeText", () => {
  it("keeps a multi-byte character whole when it is split across chunks", async () => {
    const bytes = new TextEncoder().encode("héllo");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    expect((await collect(decodeText(body))).join("")).toBe("héllo");
  });
});

describe("createRunApi", () => {
  it("posts only agent_id and prompt to the same-origin mount", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(201, { id: "run-1", status: "queued" }));
    const api = createRunApi({ fetch: fetchSpy as unknown as typeof fetch });
    const run = await api.createRun({ agent_id: "agent-1", prompt: "Check the portal" });
    expect(run.id).toBe("run-1");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ agent_id: "agent-1", prompt: "Check the portal" });
  });

  it("resumes a stream after the last sequence with Last-Event-ID, and yields each event", async () => {
    const event: RunEvent = {
      run_id: "run-1",
      seq: 13,
      type: "run.progress",
      at: "2026-10-19T12:00:00.000Z",
      tenant: "t",
      agent_id: "b",
      origin: {},
      data: { kind: "message", text: "hi" },
    };
    const fetchSpy = vi.fn(async () =>
      streamResponse([`id: 13\nevent: message\ndata: ${JSON.stringify(event)}\n\n`]),
    );
    const api = createRunApi({ fetch: fetchSpy as unknown as typeof fetch });
    const events = await collect(api.streamEvents("run-1", 12, new AbortController().signal));
    expect(events).toEqual([event]);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs/run-1/events");
    expect((init.headers as Record<string, string>)["Last-Event-ID"]).toBe("12");
  });

  it("turns an error body into a RunApiError with the service's code", async () => {
    const api = createRunApi({
      fetch: (async () =>
        jsonResponse(409, { error: { code: "LEASE_CONFLICT", message: "A lease is already held" } })) as unknown as typeof fetch,
    });
    const failure = await api.lease("run-1", "req-1").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(RunApiError);
    expect(failure).toMatchObject({ status: 409, code: "LEASE_CONFLICT", message: "A lease is already held" });
  });
});

describe("toViewerSession", () => {
  it("maps the service's view to the viewer's session and drops unknown transports", () => {
    const session = toViewerSession(
      {
        token: "tok",
        expires_at: "2026-10-19T13:00:00.000Z",
        mode: "control",
        transports: ["websocket", "carrier-pigeon", "sse"],
        viewer_url: "",
      },
      "http://localhost:5173",
    );
    expect(session).toEqual({
      baseUrl: "http://localhost:5173",
      token: "tok",
      mode: "control",
      transports: ["websocket", "sse"],
      expiresAt: "2026-10-19T13:00:00.000Z",
    });
  });
});
