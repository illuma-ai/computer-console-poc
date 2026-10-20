/**
 * The sample's screens, addressed by the URL hash, so a reload or a link from another browser lands on the
 * same screen. A run's route carries its id, and the run view attaches to its event stream from the start.
 */

/** The screens of the sample. */
export type Route =
  | { readonly name: "agents" }
  | { readonly name: "runs" }
  | { readonly name: "run"; readonly runId: string }
  | { readonly name: "settings" };

/** The screen a page opens on when the hash names none, or names one that does not exist. */
export const DEFAULT_ROUTE: Route = { name: "runs" };

/**
 * Reads a route from a location hash such as `#/runs/abc`. Unknown hashes fall back to the default screen.
 *
 * @param hash The `location.hash` value, with or without its leading `#`.
 */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter((part) => part !== "");
  const [head, id] = parts;
  switch (head) {
    case "agents":
      return { name: "agents" };
    case "settings":
      return { name: "settings" };
    case "runs":
      return id === undefined ? { name: "runs" } : { name: "run", runId: decodeURIComponent(id) };
    default:
      return DEFAULT_ROUTE;
  }
}

/**
 * The hash that addresses a route.
 *
 * @param route The screen to address.
 */
export function routeHash(route: Route): string {
  switch (route.name) {
    case "agents":
      return "#/agents";
    case "settings":
      return "#/settings";
    case "runs":
      return "#/runs";
    case "run":
      return `#/runs/${encodeURIComponent(route.runId)}`;
  }
}
