// jsdom has no ResizeObserver. Radix primitives (the switch, the sheet) read it on mount, so the tests
// provide a no-op one. Nothing here measures layout: the tests check roles, text and calls.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
