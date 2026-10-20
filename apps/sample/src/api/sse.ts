/**
 * Server-Sent Events parsing for the run event stream. Pure functions over async iterables, so the
 * parser is tested without a network.
 */

/** One SSE message: the optional `id`, the `event` name (default `message`) and the joined `data`. */
export interface SseMessage {
  readonly id: string | null;
  readonly event: string;
  readonly data: string;
}

/**
 * Turn text chunks into SSE messages. A chunk may end in the middle of a line, so the parser keeps the
 * partial line until the next chunk arrives. Comment lines (starting with `:`) are skipped. A message is
 * sent on the blank line that ends it; an unfinished message at the end of the stream is dropped, as the
 * SSE format requires.
 *
 * @param chunks The decoded text of the response body, in order.
 */
export async function* parseSse(chunks: AsyncIterable<string>): AsyncGenerator<SseMessage> {
  let pending = "";
  let id: string | null = null;
  let event = "message";
  let data: string[] = [];
  for await (const chunk of chunks) {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      let line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        if (data.length > 0) yield { id, event, data: data.join("\n") };
        id = null;
        event = "message";
        data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
  }
}

/**
 * Decode a byte stream (a fetch response body) into text chunks, keeping multi-byte characters whole
 * across chunk boundaries.
 *
 * @param body The response body stream.
 */
export async function* decodeText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) yield text;
    }
    const tail = decoder.decode();
    if (tail.length > 0) yield tail;
  } finally {
    reader.releaseLock();
  }
}
