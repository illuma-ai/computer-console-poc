import { vi } from "vitest";
import type { FetchLike, ViewerSession, WebSocketLike } from "../src/client/types";

/** A view token that no test expects to see in a URL, a log or a header other than Authorization. */
export const TOKEN = "view-token-test-7f3a9c";
export const BASE = "https://view.example.test";

/** A session that expires in 15 minutes unless the test overrides the expiry. */
export function makeSession(overrides: Partial<ViewerSession> = {}): ViewerSession {
  return {
    baseUrl: BASE,
    token: TOKEN,
    mode: "view",
    transports: ["websocket", "sse"],
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    ...overrides,
  };
}

/** One request the client made through the injected fetch. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | undefined;
}

/** A fetch that records every call and answers with `handler`. */
export function recordingFetch(
  handler: (url: string, call: RecordedCall) => Response | Promise<Response>,
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      headers: headersOf(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    return handler(url, call);
  };
  return { fetch: fn as unknown as FetchLike, calls };
}

/** Normalises `HeadersInit` into a plain record. */
function headersOf(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (Array.isArray(init)) {
    for (const [k, v] of init) out[k] = v;
  } else if (init instanceof Headers) {
    init.forEach((v, k) => {
      out[k] = v;
    });
  } else {
    for (const [k, v] of Object.entries(init)) out[k] = v;
  }
  return out;
}

/** A JSON response with the given status. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A finished SSE response carrying `chunks` in order, then ending. */
export function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** An SSE response that stays open until the test calls `end()`, and lets the test push chunks. */
export function openSseResponse(): { response: Response; push(text: string): void; end(): void } {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      /* the client aborted the stream */
    },
  });
  return {
    response: new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    push(text) {
      controller.enqueue(enc.encode(text));
    },
    end() {
      try {
        controller.close();
      } catch {
        /* already closed by a cancel */
      }
    },
  };
}

/** A WebSocket test double. The test drives its open, message, error and close events. */
export class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readonly protocols: string | string[] | undefined;
  binaryType: BinaryType = "blob";
  readyState = 0;
  /** Every message the client sent, in order. */
  readonly sent: unknown[] = [];
  closed = false;

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.url = String(url);
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  /** The server accepted the connection. */
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  /** The server sent bytes (the RFB version, in a real session). */
  serverBytes(): void {
    this.dispatchEvent(new MessageEvent("message", { data: new ArrayBuffer(12) }));
  }

  /** The connection failed. Browsers fire `error` and then `close`. */
  fail(): void {
    this.dispatchEvent(new Event("error"));
    this.close();
  }
}

/** The WebSocket constructor to inject. */
export const FakeWebSocketCtor = FakeWebSocket as unknown as WebSocketLike;

/** Stubs `canvas.getContext` so drawing code runs in jsdom, and records the draw calls. */
export function stubCanvasContext(): { drawImage: ReturnType<typeof vi.fn> } {
  const drawImage = vi.fn();
  const context = { drawImage } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
  return { drawImage };
}

/** Waits for pending promise callbacks to run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
