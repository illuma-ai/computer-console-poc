import { ViewerError } from "./types";
import type { FetchLike } from "./types";

/**
 * Server-Sent Events over `fetch`, so the Authorization header can be sent. `EventSource` cannot
 * set headers, and the viewer must not put the token in a query string.
 *
 * WHY our own parser: the stream needs `Last-Event-ID` reconnects and the `retry` field, and the
 * events the viewer reads are small. The parser follows the WHATWG event-stream rules.
 */

/** One dispatched SSE message. `id` is the last event id seen on the stream (it persists across messages). */
export interface SseMessage {
  event: string;
  data: string;
  id: string;
}

/**
 * Incremental SSE parser. Feed it text as it arrives; it returns the messages that completed.
 * Handles multi-line `data:`, `id:`, `retry:`, comments (`:`), CRLF, LF and CR line endings, and
 * a line split across chunks.
 */
export class SseParser {
  private buffer = "";
  private dataLines: string[] = [];
  private eventType = "";
  private lastId = "";
  private retryMs: number | undefined;

  /** The last event id the server sent, to be echoed as `Last-Event-ID` on reconnect. */
  get lastEventId(): string {
    return this.lastId;
  }

  /** The server's `retry:` hint in milliseconds, when it sent one. */
  get retry(): number | undefined {
    return this.retryMs;
  }

  /**
   * @param chunk Text decoded from the response body (may end in the middle of a line).
   * @returns The messages completed by this chunk, in order.
   */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // A CR at the very end of the buffer may be the first half of CRLF; wait for the next chunk.
      if (ch === "\r" && i + 1 === this.buffer.length) break;
      const line = this.buffer.slice(start, i);
      if (ch === "\r" && this.buffer[i + 1] === "\n") i++;
      start = i + 1;
      const msg = this.line(line);
      if (msg) out.push(msg);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  private line(line: string): SseMessage | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null; // comment, often a keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        this.dataLines.push(value);
        break;
      case "event":
        this.eventType = value;
        break;
      case "id":
        // A NUL in an id is ignored by the spec, so it cannot be echoed back.
        if (!value.includes("\0")) this.lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retryMs = Number(value);
        break;
      default:
        break; // unknown fields are ignored
    }
    return null;
  }

  private dispatch(): SseMessage | null {
    if (this.dataLines.length === 0) {
      this.eventType = "";
      return null;
    }
    const msg: SseMessage = {
      event: this.eventType || "message",
      data: this.dataLines.join("\n"),
      id: this.lastId,
    };
    this.dataLines = [];
    this.eventType = "";
    return msg;
  }
}

/** Options of {@link runEventStream}. */
export interface EventStreamOptions {
  fetch: FetchLike;
  url: string;
  token: string;
  signal: AbortSignal;
  /** Called once the server has answered 200 with a stream. */
  onOpen: () => void;
  /** Return `true` to end the stream (for example after a process's terminal event). */
  onMessage: (msg: SseMessage) => boolean;
  /** Called before each reconnect after the stream had opened. */
  onReconnect: () => void;
  /** Base reconnect delay in ms. Doubles per failed attempt, capped at {@link MAX_RECONNECT_MS}. */
  reconnectDelayMs?: number;
}

/** Upper bound of the reconnect backoff. */
export const MAX_RECONNECT_MS = 10_000;
/** Default first reconnect delay. */
export const DEFAULT_RECONNECT_MS = 1_000;

/** HTTP statuses that will not succeed on a retry; the stream rejects instead of reconnecting. */
const FATAL_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Runs an SSE stream with the bearer header, reconnecting with `Last-Event-ID` after it opened.
 *
 * Failure rule: before the first successful open any failure rejects. After it, a retryable
 * failure (network error, 5xx, 429, a stream that ends early) reconnects with backoff, and a fatal
 * HTTP status (see FATAL_STATUSES) rejects. The promise resolves when `onMessage` returns true or
 * the signal aborts.
 *
 * @throws {ViewerError} the contract code of a fatal status (`unauthorized`, `not_found`, ...), or
 *   `network` when a stream cannot be established before it opened.
 */
export async function runEventStream(opts: EventStreamOptions): Promise<void> {
  const parser = new SseParser();
  let everOpened = false;
  let attempt = 0;
  let lastId = "";
  const baseDelay = opts.reconnectDelayMs ?? DEFAULT_RECONNECT_MS;

  while (!opts.signal.aborted) {
    let failure: ViewerError | null = null;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${opts.token}`,
        Accept: "text/event-stream",
      };
      if (lastId) headers["Last-Event-ID"] = lastId;
      const res = await opts.fetch(opts.url, { headers, signal: opts.signal, cache: "no-store" });
      if (!res.ok) {
        const err = await errorFromResponse(res);
        if (FATAL_STATUSES.has(res.status) || !everOpened) throw err;
        failure = err;
      } else {
        if (!res.body) throw new ViewerError("network", "The stream had no body");
        everOpened = true;
        attempt = 0;
        opts.onOpen();
        const done = await readStream(res.body, parser, opts.onMessage, () => {
          attempt = 0;
        });
        lastId = parser.lastEventId;
        if (done) return;
        failure = new ViewerError("network", "The stream ended");
      }
    } catch (err) {
      if (opts.signal.aborted) return;
      if (!(err instanceof ViewerError)) throw new ViewerError("network", "The stream could not be read");
      if (!everOpened || FATAL_STATUSES.has(err.status ?? 0) || err.code === "unauthorized") throw err;
      failure = err;
    }
    if (!failure) return;
    attempt += 1;
    opts.onReconnect();
    // A server `retry:` hint, when present, replaces the base delay.
    const hint = parser.retry ?? baseDelay;
    const delay = Math.min(hint * 2 ** (attempt - 1), MAX_RECONNECT_MS);
    await sleep(delay, opts.signal);
  }
}

/** Reads a body stream, feeding the parser. Resolves `true` when `onMessage` asks to stop. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  parser: SseParser,
  onMessage: (msg: SseMessage) => boolean,
  onProgress: () => void,
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      const tail = decoder.decode();
      if (tail) {
        for (const msg of parser.push(tail)) if (onMessage(msg)) return true;
      }
      return false;
    }
    const text = decoder.decode(value, { stream: true });
    for (const msg of parser.push(text)) {
      onProgress();
      if (onMessage(msg)) {
        await reader.cancel().catch(() => undefined);
        return true;
      }
    }
  }
}

/** The contract's status-to-code table, used when a body carries no code. */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "invalid_request",
  401: "unauthorized",
  404: "not_found",
  409: "conflict",
  422: "unsupported",
  429: "quota",
  504: "timeout",
};

/** Maps a non-2xx response to a {@link ViewerError} using the contract's error body. */
export async function errorFromResponse(res: Response): Promise<ViewerError> {
  let code = CODE_BY_STATUS[res.status] ?? "provider_unavailable";
  let message = "The viewer request failed";
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Not a JSON body: keep the status-based code and the fixed message.
  }
  return new ViewerError(code, message, res.status);
}

/** Resolves after `ms`, or at once when the signal aborts (the timer is cleared). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onDone = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onDone);
      resolve();
    };
    const timer = setTimeout(onDone, ms);
    signal.addEventListener("abort", onDone, { once: true });
  });
}
