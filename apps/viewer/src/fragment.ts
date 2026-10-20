import type { ScreenTransport, ViewerMode, ViewerSession } from "@cm/computer-viewer";

/**
 * Reads the viewer session from a URL fragment:
 * `#token=<token>&base=<public listener URL>&mode=view|control&transports=websocket,sse&exp=<epoch seconds>`.
 *
 * WHY the fragment: browsers never send it to a server, so the token stays out of access logs and
 * Referer headers. The fragment is cleared from the address bar as soon as it is read
 * ({@link clearFragment}).
 *
 * @param hash The fragment, with or without its leading `#`.
 * @returns The session, or `null` when the fragment carries no token. A malformed field is not
 *   rejected here: the client validates the whole session when it is created.
 */
export function parseViewerFragment(hash: string): ViewerSession | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("token");
  if (!token) return null;
  const exp = Number(params.get("exp"));
  return {
    baseUrl: params.get("base") ?? "",
    token,
    // Least privilege: a link that does not say control is a view link.
    mode: (params.get("mode") ?? "view") as ViewerMode,
    transports: (params.get("transports") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0) as ScreenTransport[],
    // An unparseable expiry becomes an empty string, which the client rejects as invalid.
    expiresAt: Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : "",
  };
}

/**
 * Removes the fragment from the address bar (and history entry) without reloading the page. The
 * path and query stay, so a reload keeps the page but not the token.
 *
 * @param win The window whose location is cleaned. Tests pass their own.
 */
export function clearFragment(win: Window = window): void {
  win.history.replaceState(null, "", win.location.pathname + win.location.search);
}
