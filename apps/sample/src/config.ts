import type { TransportChoice } from "@cm/computer-viewer";

/** The transports the build-time setting may name. */
const TRANSPORT_CHOICES: readonly TransportChoice[] = ["auto", "websocket", "sse"];

/**
 * Reads the screen transport from the build-time setting `VITE_VIEWER_TRANSPORT`.
 *
 * @param value The raw setting. Anything unknown falls back to `auto`, so a typo cannot break the page.
 */
export function readTransport(value: string | undefined): TransportChoice {
  return TRANSPORT_CHOICES.find((choice) => choice === value) ?? "auto";
}
