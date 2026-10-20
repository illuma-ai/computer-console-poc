import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { SampleDevConfig } from "./config.ts";
import { mintRunToken } from "./run-token.ts";

/** The mount point of the run API in the browser's namespace. The proxy rewrites it to /v1/runs. */
export const RUN_API_MOUNT = "/api/runs";

/** The mount point of the agent registry. The proxy rewrites it to /v1/agents. */
export const AGENTS_API_MOUNT = "/api/agents";

/**
 * Every same-origin API mount the dev server signs and proxies, with the run service path it maps to. One
 * list, so the signing middleware and the proxy cannot disagree about what is covered.
 */
export const API_MOUNTS: readonly { readonly mount: string; readonly upstream: string }[] = [
  { mount: RUN_API_MOUNT, upstream: "/v1/runs" },
  { mount: AGENTS_API_MOUNT, upstream: "/v1/agents" },
];

/**
 * A connect middleware that signs a fresh run token and sets it as the request's `Authorization`
 * header. It runs before Vite's proxy, so the proxy forwards the header upstream. A header the browser
 * sent is overwritten, so the browser cannot choose the caller.
 *
 * WHY a fresh token per request: a state-changing request spends the token's `jti`, so a token that
 * was used for a write cannot serve the next one.
 *
 * @param mint Produces a new token each time it is called.
 */
export function runTokenMiddleware(
  mint: () => string,
): (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void {
  return (req, _res, next) => {
    req.headers.authorization = `Bearer ${mint()}`;
    next();
  };
}

/**
 * The Vite plugin for the dev server. It registers the signing middleware for the run API mount. The
 * proxy itself is configured in `vite.config.ts` with the same mount point.
 *
 * @param config The dev settings (secret, identity, lifetime). Used only server-side.
 */
export function runTokenPlugin(config: SampleDevConfig): Plugin {
  return {
    name: "sample-run-token",
    apply: "serve",
    configureServer(server) {
      const middleware = runTokenMiddleware(() =>
        mintRunToken({ secret: config.secret, identity: config.identity, ttlS: config.ttlS }),
      );
      for (const { mount } of API_MOUNTS) server.middlewares.use(mount, middleware);
    },
  };
}
