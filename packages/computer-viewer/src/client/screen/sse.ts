import { runEventStream } from "../sse";
import { toViewerError } from "../types";
import type { ScreenFrame, ScreenInputEvent } from "../types";
import type { ScreenContext, ScreenLostHandler, ScreenSource } from "./types";

/** The SSE frame stream and the input POST (`docs/CONTRACT.md`, "Viewing a computer"). */
export const FRAMES_PATH = "/view/v1/screen/frames";
export const INPUT_PATH = "/view/v1/screen/input";

/** The contract's limits: at most 200 events per call, and 1000 characters per text event. */
export const MAX_EVENTS_PER_POST = 200;
export const MAX_TEXT_CHARS = 1000;
/** Input is coalesced over this window, so a pointer move does not cost one request each. */
export const INPUT_FLUSH_MS = 16;

/** Key names the contract accepts besides a single character (`docs/SUPERVISOR.md`, "Frames and input"). */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Shift",
  "Control",
  "Alt",
  "Meta",
]);

/**
 * The contract key name for a DOM `KeyboardEvent.key`, or `null` when the key has no name the
 * server accepts. Only the key's name is returned; nothing is logged.
 */
export function keyName(key: string): string | null {
  if (NAMED_KEYS.has(key)) return key;
  // A single character, counted by code point so an astral character is one key.
  if ([...key].length === 1) return key;
  return null;
}

/**
 * Maps the DOM `buttons` bit mask (1 primary, 2 secondary, 4 auxiliary) to the RFB mask the
 * contract sends (1 left, 2 middle, 4 right).
 */
export function buttonMask(buttons: number): number {
  return (buttons & 1 ? 1 : 0) | (buttons & 4 ? 2 : 0) | (buttons & 2 ? 4 : 0);
}

/** The rectangle of the element the pointer is over, as `getBoundingClientRect` reports it. */
export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps a pointer position on the displayed canvas to the frame's pixel grid, clamped to the frame.
 * The scale is the frame size over the displayed size, so a letterboxed or resized canvas still
 * lands on the right pixel.
 */
export function toFramePoint(
  clientX: number,
  clientY: number,
  rect: DisplayRect,
  frame: { width: number; height: number },
): { x: number; y: number } {
  const sx = rect.width > 0 ? frame.width / rect.width : 1;
  const sy = rect.height > 0 ? frame.height / rect.height : 1;
  const x = Math.round((clientX - rect.left) * sx);
  const y = Math.round((clientY - rect.top) * sy);
  return {
    x: Math.min(Math.max(x, 0), Math.max(frame.width - 1, 0)),
    y: Math.min(Math.max(y, 0), Math.max(frame.height - 1, 0)),
  };
}

/** Splits text into pieces of at most {@link MAX_TEXT_CHARS} characters, never splitting a code point. */
export function chunkText(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let count = 0;
  for (const ch of text) {
    if (count === MAX_TEXT_CHARS) {
      out.push(current);
      current = "";
      count = 0;
    }
    current += ch;
    count += 1;
  }
  if (current) out.push(current);
  return out;
}

/**
 * Serial, batched input. Events keep their order; calls to the server never overlap, so a key
 * release cannot overtake its press. Each POST carries at most {@link MAX_EVENTS_PER_POST} events.
 */
export class InputQueue {
  private pending: ScreenInputEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  /**
   * @param post Sends one batch. A rejection is passed to `onError`.
   * @param onError Receives a failed batch's error. The queue keeps going.
   */
  constructor(
    private readonly post: (events: ScreenInputEvent[]) => Promise<void>,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** Queues an event; it is sent within {@link INPUT_FLUSH_MS}. */
  push(event: ScreenInputEvent): void {
    if (this.disposed) return;
    this.pending.push(event);
    this.timer ??= setTimeout(() => this.flush(), INPUT_FLUSH_MS);
  }

  /** Sends everything queued now, in batches. */
  flush(): void {
    this.timer = undefined;
    const batch = this.pending;
    this.pending = [];
    for (let i = 0; i < batch.length; i += MAX_EVENTS_PER_POST) {
      const chunk = batch.slice(i, i + MAX_EVENTS_PER_POST);
      this.chain = this.chain.then(() => this.post(chunk)).catch((err: unknown) => this.onError(err));
    }
  }

  /** Drops queued events and stops the timer. Calls already in flight finish. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
  }
}

/** Parses one `event: frame` payload. Returns `null` for anything that is not a usable frame. */
export function parseFrame(data: string): ScreenFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const f = value as Partial<ScreenFrame>;
  if (
    typeof f.seq !== "number" ||
    typeof f.width !== "number" ||
    typeof f.height !== "number" ||
    f.width <= 0 ||
    f.height <= 0 ||
    typeof f.data_b64 !== "string"
  ) {
    return null;
  }
  return { seq: f.seq, width: f.width, height: f.height, format: "jpeg", data_b64: f.data_b64 };
}

/**
 * Connects the SSE screen into `container`: frames are drawn to a canvas, and in control mode
 * pointer, key and text input is sent with POST.
 *
 * WHY a hidden textarea for text: a mobile virtual keyboard types into the focused editable
 * element, and a canvas is not one. The textarea takes the typing; its `input` events become text
 * events, and its key events become key events. Printable keys without a modifier are left to the
 * `input` event, so one keystroke is not sent twice.
 *
 * @param ctx The client context.
 * @param container Where the canvas and the input element are added.
 * @param onLost Called once if the stream was live and then failed for good.
 * @returns A live source once the server has answered the frame stream request.
 * @throws {ViewerError} the contract code of the failure when the stream never opened.
 */
export function connectSseScreen(
  ctx: ScreenContext,
  container: HTMLElement,
  onLost: ScreenLostHandler,
): Promise<ScreenSource> {
  return new Promise<ScreenSource>((resolve, reject) => {
    const doc = container.ownerDocument;
    const controller = new AbortController();
    const canvas = doc.createElement("canvas");
    canvas.setAttribute("aria-label", "Computer screen");
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    canvas.style.touchAction = "none";
    container.appendChild(canvas);

    let detachInput: () => void = () => undefined;
    let phase: "connecting" | "live" | "done" = "connecting";
    let lastSeq = 0;
    let drawnSeq = 0;

    const source: ScreenSource = {
      transport: "sse",
      close() {
        if (phase === "done") return;
        phase = "done";
        controller.abort();
        detachInput();
        canvas.remove();
      },
    };

    const draw = (frame: ScreenFrame): void => {
      if (frame.seq < lastSeq) return;
      lastSeq = frame.seq;
      if (canvas.width !== frame.width) canvas.width = frame.width;
      if (canvas.height !== frame.height) canvas.height = frame.height;
      const g = canvas.getContext("2d");
      if (!g) return;
      const img = new Image();
      img.onload = () => {
        // Decoding can finish out of order; an older frame must not paint over a newer one.
        if (frame.seq < drawnSeq) return;
        drawnSeq = frame.seq;
        g.drawImage(img, 0, 0, frame.width, frame.height);
      };
      img.src = `data:image/jpeg;base64,${frame.data_b64}`;
    };

    const stream = runEventStream({
      fetch: ctx.fetch,
      url: ctx.url(FRAMES_PATH),
      token: ctx.session.token,
      signal: controller.signal,
      reconnectDelayMs: ctx.reconnectDelayMs,
      onOpen: () => {
        if (phase !== "connecting") return;
        phase = "live";
        resolve(source);
      },
      onReconnect: () => {
        if (phase === "live") ctx.emit({ type: "status", status: "reconnecting" });
      },
      onMessage: (msg) => {
        if (msg.event !== "frame") return false;
        const frame = parseFrame(msg.data);
        if (frame) draw(frame);
        return false;
      },
    });

    stream.then(
      () => undefined,
      (err: unknown) => {
        if (phase === "connecting") {
          source.close();
          reject(toViewerError(err));
          return;
        }
        if (phase === "live") {
          source.close();
          onLost(toViewerError(err));
        }
      },
    );

    if (ctx.session.mode === "control") {
      detachInput = attachInput(ctx, canvas, container, controller.signal);
    }
  });
}

/**
 * Adds pointer and keyboard handling for control mode. Returns a function that removes it.
 * Nothing is attached in view mode, so no input can leave the page in that mode.
 */
function attachInput(ctx: ScreenContext, canvas: HTMLCanvasElement, container: HTMLElement, signal: AbortSignal): () => void {
  const doc = container.ownerDocument;
  const queue = new InputQueue(
    (events) =>
      ctx.request(INPUT_PATH, { method: "POST", body: JSON.stringify({ events }) }).then(() => undefined),
    (err) => ctx.emit({ type: "error", error: toViewerError(err) }),
  );

  const area = doc.createElement("textarea");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  area.autocapitalize = "off";
  area.setAttribute("autocomplete", "off");
  area.spellcheck = false;
  area.style.position = "absolute";
  area.style.opacity = "0";
  area.style.width = "1px";
  area.style.height = "1px";
  area.style.pointerEvents = "none";
  container.appendChild(area);

  const pointer = (event: Event, reportButtons: boolean): void => {
    const e = event as MouseEvent;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width <= 0 || canvas.height <= 0) return;
    const at = toFramePoint(e.clientX, e.clientY, rect, { width: canvas.width, height: canvas.height });
    queue.push({ type: "pointer", x: at.x, y: at.y, buttons: buttonMask(reportButtons ? e.buttons : 0) });
  };

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      area.focus({ preventScroll: true });
      pointer(event, true);
    },
    { signal },
  );
  canvas.addEventListener("pointermove", (event) => pointer(event, true), { signal });
  canvas.addEventListener("pointerup", (event) => pointer(event, false), { signal });

  // A named key or a chord (Ctrl, Meta, Alt with a character) is a key event. A plain character
  // is typed through the `input` event instead, so it is sent once.
  const keyEvent = (event: KeyboardEvent, down: boolean): void => {
    const chord = event.ctrlKey || event.metaKey || event.altKey;
    if (!NAMED_KEYS.has(event.key) && !chord) return;
    const name = keyName(event.key);
    if (!name) return;
    event.preventDefault();
    queue.push({ type: "key", key: name, down });
  };
  area.addEventListener("keydown", (event) => keyEvent(event, true), { signal });
  area.addEventListener("keyup", (event) => keyEvent(event, false), { signal });

  area.addEventListener(
    "input",
    () => {
      const text = area.value;
      area.value = "";
      for (const piece of chunkText(text)) queue.push({ type: "text", text: piece });
    },
    { signal },
  );

  area.addEventListener(
    "paste",
    (event) => {
      const text = (event as ClipboardEvent).clipboardData?.getData("text") ?? "";
      if (!text) return;
      event.preventDefault();
      for (const piece of chunkText(text)) queue.push({ type: "text", text: piece });
    },
    { signal },
  );

  signal.addEventListener("abort", () => {
    queue.dispose();
    area.remove();
  });
  return () => {
    queue.dispose();
    area.remove();
  };
}
