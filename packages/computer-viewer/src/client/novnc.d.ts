// Minimal typing for the parts of @novnc/novnc (1.7.0, ESM, default export RFB) that this package uses.
// The package ships no types. Keep this to the surface we call; do not widen it.
declare module "@novnc/novnc" {
  export interface RfbOptions {
    shared?: boolean;
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RfbOptions);
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    disconnect(): void;
  }
}
