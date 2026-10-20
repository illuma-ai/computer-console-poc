import type { ScreenTransport, ViewerSession } from "@cm/computer-viewer";
import type { ViewJson } from "./types";

const SCREEN_TRANSPORTS: readonly ScreenTransport[] = ["websocket", "sse"];

/**
 * Map a run API view session to the viewer's session. The run API returns `expires_at` and no base
 * URL; the base is this origin, because the dev server proxies the viewer's `/view` calls to the
 * manager's public listener.
 *
 * @param view The `view` object of a view or lease response.
 * @param baseUrl The origin the viewer calls (the page's own origin).
 */
export function toViewerSession(view: ViewJson, baseUrl: string): ViewerSession {
  return {
    baseUrl,
    token: view.token,
    mode: view.mode,
    transports: view.transports.filter((name): name is ScreenTransport =>
      SCREEN_TRANSPORTS.some((known) => known === name),
    ),
    expiresAt: view.expires_at,
  };
}
