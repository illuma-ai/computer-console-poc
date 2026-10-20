/**
 * `@cm/computer-viewer`: the framework-free client. Import the React components from
 * `@cm/computer-viewer/react`.
 */
export { createViewerClient, validateSession } from "./client";
export type { OpenScreenOptions, ViewerClient, ViewerClientOptions } from "./client";
export type { ScreenSource } from "./screen/types";
export { ViewerError, toViewerError } from "./types";
export type {
  FetchLike,
  FileEntry,
  ProcessEvent,
  ProcessInfo,
  ScreenFrame,
  ScreenInputEvent,
  ScreenTransport,
  SessionInfo,
  TransportChoice,
  ViewerEvent,
  ViewerMode,
  ViewerSession,
  ViewerStatus,
  WebSocketLike,
} from "./types";
