/**
 * A stand-in for noVNC's RFB class. The real one needs a real canvas, ResizeObserver and a
 * server; the tests need to see what the client configured and to simulate a disconnect.
 */
export class FakeRfb extends EventTarget {
  static instances: FakeRfb[] = [];
  viewOnly = false;
  scaleViewport = false;
  resizeSession = false;
  focusOnClick = true;
  disconnected = false;
  readonly target: HTMLElement;
  readonly channel: unknown;
  readonly options: unknown;

  constructor(target: HTMLElement, channel: unknown, options?: unknown) {
    super();
    this.target = target;
    this.channel = channel;
    this.options = options;
    FakeRfb.instances.push(this);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Simulates noVNC reporting a disconnect. `clean` mirrors noVNC's `detail.clean`. */
  drop(clean: boolean): void {
    this.dispatchEvent(new CustomEvent("disconnect", { detail: { clean } }));
  }
}
