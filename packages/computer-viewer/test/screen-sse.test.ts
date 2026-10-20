import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewerClient } from "../src/client/client";
import { buttonMask, chunkText, InputQueue, keyName, parseFrame, toFramePoint, MAX_EVENTS_PER_POST } from "../src/client/screen/sse";
import type { ScreenInputEvent } from "../src/client/types";
import { FakeWebSocketCtor, makeSession, openSseResponse, recordingFetch, stubCanvasContext, TOKEN, flush } from "./helpers";
import type { RecordedCall } from "./helpers";

/** A frame event as the server sends it. */
function frameEvent(seq: number, width: number, height: number): string {
  return `event: frame\ndata: ${JSON.stringify({ seq, width, height, format: "jpeg", data_b64: "AAAA" })}\n\n`;
}

/** The canvas's on-screen rectangle, as a browser reports it. */
function displayRect(width: number, height: number): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) } as DOMRect;
}

/**
 * Opens an SSE screen on a fake stream and returns what the test needs. The stream is held open.
 */
async function openSse(mode: "view" | "control") {
  const held = openSseResponse();
  const posts: RecordedCall[] = [];
  const { fetch, calls } = recordingFetch((_url, call) => {
    if (call.method === "POST") {
      posts.push(call);
      return new Response(null, { status: 204 });
    }
    return held.response;
  });
  const client = createViewerClient(makeSession({ mode, transports: ["sse"] }), {
    fetch,
    WebSocket: FakeWebSocketCtor,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const source = await client.openScreen({ transport: "sse", container });
  return { client, held, source, container, posts, calls };
}

describe("SSE screen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("sizes the canvas from each frame", async () => {
    stubCanvasContext();
    const { client, held, container } = await openSse("view");
    held.push(frameEvent(1, 800, 600));
    await vi.advanceTimersByTimeAsync(1);
    const canvas = container.querySelector("canvas");
    expect(canvas?.width).toBe(800);
    expect(canvas?.height).toBe(600);

    held.push(frameEvent(2, 1024, 768));
    await vi.advanceTimersByTimeAsync(1);
    expect(canvas?.width).toBe(1024);
    expect(canvas?.height).toBe(768);
    held.end();
    client.close();
  });

  it("sends no input at all in view mode, and attaches no input element", async () => {
    stubCanvasContext();
    const { client, held, container, posts } = await openSse("view");
    held.push(frameEvent(1, 800, 600));
    await vi.advanceTimersByTimeAsync(1);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(displayRect(400, 300));
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, buttons: 1, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 20, buttons: 1, bubbles: true }));
    container.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.advanceTimersByTimeAsync(100);

    expect(container.querySelector("textarea")).toBeNull();
    expect(posts).toHaveLength(0);
    held.end();
    client.close();
  });

  it("scales pointer coordinates from the displayed size to the frame size", async () => {
    stubCanvasContext();
    const { client, held, container, posts } = await openSse("control");
    held.push(frameEvent(1, 800, 600));
    await vi.advanceTimersByTimeAsync(1);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    // The canvas is shown at half size: a click at (100, 50) on screen is (200, 100) in the frame.
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(displayRect(400, 300));
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 50, buttons: 1, bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);

    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ events: [{ type: "pointer", x: 200, y: 100, buttons: 1 }] });
    expect(posts[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    held.end();
    client.close();
  });

  it("batches input in order and sends a key once, typed through the text input", async () => {
    stubCanvasContext();
    const { client, held, container, posts } = await openSse("control");
    held.push(frameEvent(1, 800, 600));
    await vi.advanceTimersByTimeAsync(1);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(displayRect(800, 600));

    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5, buttons: 1, bubbles: true }));
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); // typed: no key event, the input event sends it
    area.value = "a";
    area.dispatchEvent(new Event("input"));
    area.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
    await vi.advanceTimersByTimeAsync(20);

    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]?.body ?? "{}").events).toEqual([
      { type: "pointer", x: 5, y: 5, buttons: 1 },
      { type: "key", key: "Enter", down: true },
      { type: "text", text: "a" },
      { type: "key", key: "Enter", down: false },
    ]);
    expect(area.value).toBe("");
    held.end();
    client.close();
  });

  it("paste becomes text events and does not also insert the text", async () => {
    stubCanvasContext();
    const { client, held, container, posts } = await openSse("control");
    held.push(frameEvent(1, 800, 600));
    await vi.advanceTimersByTimeAsync(1);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    const paste = new Event("paste", { cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "hi there" } });
    area.dispatchEvent(paste);
    await vi.advanceTimersByTimeAsync(20);

    expect(paste.defaultPrevented).toBe(true);
    expect(JSON.parse(posts[0]?.body ?? "{}").events).toEqual([{ type: "text", text: "hi there" }]);
    held.end();
    client.close();
  });
});

describe("screen helpers", () => {
  it("maps key names: named keys and single characters, and nothing else", () => {
    expect(keyName("Enter")).toBe("Enter");
    expect(keyName("ArrowLeft")).toBe("ArrowLeft");
    expect(keyName("a")).toBe("a");
    expect(keyName("é")).toBe("é");
    expect(keyName("Dead")).toBeNull();
    expect(keyName("Unidentified")).toBeNull();
    expect(keyName("ab")).toBeNull();
  });

  it("maps the DOM button mask to the RFB mask", () => {
    expect(buttonMask(1)).toBe(1); // primary: left
    expect(buttonMask(4)).toBe(2); // auxiliary: middle
    expect(buttonMask(2)).toBe(4); // secondary: right
    expect(buttonMask(0)).toBe(0);
  });

  it("clamps pointer positions to the frame and rounds", () => {
    const rect = { left: 10, top: 10, width: 200, height: 100 };
    expect(toFramePoint(110, 60, rect, { width: 400, height: 200 })).toEqual({ x: 200, y: 100 });
    expect(toFramePoint(-500, -500, rect, { width: 400, height: 200 })).toEqual({ x: 0, y: 0 });
    expect(toFramePoint(9999, 9999, rect, { width: 400, height: 200 })).toEqual({ x: 399, y: 199 });
  });

  it("splits text into pieces of at most 1000 characters without splitting a code point", () => {
    const pieces = chunkText("a".repeat(2_500));
    expect(pieces.map((p) => p.length)).toEqual([1000, 1000, 500]);
    const emoji = "😀".repeat(1_001);
    const parts = chunkText(emoji);
    expect(parts).toHaveLength(2);
    expect(parts.join("")).toBe(emoji);
  });

  it("parses a frame and rejects one without a usable size", () => {
    expect(parseFrame('{"seq":1,"width":10,"height":5,"format":"jpeg","data_b64":"AA=="}')).toMatchObject({ seq: 1 });
    expect(parseFrame('{"seq":1,"width":0,"height":5,"data_b64":"AA=="}')).toBeNull();
    expect(parseFrame("not json")).toBeNull();
  });
});

describe("InputQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends at most 200 events per call, in order, one call at a time", async () => {
    const batches: ScreenInputEvent[][] = [];
    const queue = new InputQueue(async (events) => {
      batches.push(events);
    }, () => undefined);
    for (let i = 0; i < MAX_EVENTS_PER_POST + 50; i++) queue.push({ type: "pointer", x: i, y: 0, buttons: 0 });
    await vi.advanceTimersByTimeAsync(20);
    await flush();
    expect(batches.map((b) => b.length)).toEqual([200, 50]);
    expect(batches[1]?.[0]).toEqual({ type: "pointer", x: 200, y: 0, buttons: 0 });
    queue.dispose();
  });

  it("keeps going after a failed call and reports the failure", async () => {
    const failures: unknown[] = [];
    const sent: number[] = [];
    const queue = new InputQueue(
      async (events) => {
        if (events[0]?.type === "text") throw new Error("boom");
        sent.push(events.length);
      },
      (err) => failures.push(err),
    );
    queue.push({ type: "text", text: "x" });
    queue.flush();
    queue.push({ type: "key", key: "a", down: true });
    queue.flush();
    await flush(10);
    expect(failures).toHaveLength(1);
    expect(sent).toEqual([1]);
    queue.dispose();
  });
});
