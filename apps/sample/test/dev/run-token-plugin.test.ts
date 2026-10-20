import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { readSampleDevConfig, DEFAULT_TOKEN_TTL_S } from "../../dev/config";
import { API_MOUNTS, runTokenMiddleware, runTokenPlugin, RUN_API_MOUNT } from "../../dev/run-token-plugin";

const SECRET = "fixture-secret-do-not-use-in-production";
const TOKEN_SHAPE = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function fakeRequest(authorization?: string): IncomingMessage {
  return { headers: authorization === undefined ? {} : { authorization } } as unknown as IncomingMessage;
}

const RES = {} as ServerResponse;

describe("runTokenMiddleware", () => {
  it("sets a fresh bearer token on the proxied request and passes on", () => {
    const mint = vi.fn(() => "a.b.c");
    const req = fakeRequest();
    const next = vi.fn();
    runTokenMiddleware(mint)(req, RES, next);
    expect(req.headers.authorization).toBe("Bearer a.b.c");
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it("overwrites a header the browser sent, so the browser cannot choose the caller", () => {
    const req = fakeRequest("Bearer browser-forged");
    runTokenMiddleware(() => "x.y.z")(req, RES, vi.fn());
    expect(req.headers.authorization).toBe("Bearer x.y.z");
  });

  it("mints once per request, so no token is reused for a write", () => {
    const mint = vi.fn(() => "x.y.z");
    const middleware = runTokenMiddleware(mint);
    middleware(fakeRequest(), RES, vi.fn());
    middleware(fakeRequest(), RES, vi.fn());
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

describe("runTokenPlugin", () => {
  const config = readSampleDevConfig({
    SAMPLE_RUN_SERVICE_URL: "http://run-service.internal:3000/",
    SAMPLE_RUN_TOKEN_SECRET: SECRET,
    SAMPLE_TEAM: "ops",
  });

  it("registers the signing middleware on every API mount when the server configures", () => {
    const use = vi.fn();
    const hook = runTokenPlugin(config).configureServer as unknown as (server: unknown) => void;
    hook({ middlewares: { use } });
    expect(use).toHaveBeenCalledTimes(API_MOUNTS.length);
    const [mount, handler] = use.mock.calls[0] as [string, (req: IncomingMessage, res: ServerResponse, next: () => void) => void];
    expect(mount).toBe(RUN_API_MOUNT);
    const req = fakeRequest();
    handler(req, RES, () => undefined);
    expect(req.headers.authorization).toMatch(TOKEN_SHAPE);
    expect(req.headers.authorization).not.toContain(SECRET);
  });

  it("applies only to the dev server, not to a build", () => {
    expect(runTokenPlugin(config).apply).toBe("serve");
  });
});

describe("readSampleDevConfig", () => {
  it("reads the defaults for a fixed dev user and a short token lifetime", () => {
    const config = readSampleDevConfig({
      SAMPLE_RUN_SERVICE_URL: "http://localhost:3000",
      SAMPLE_RUN_TOKEN_SECRET: SECRET,
    });
    expect(config.identity).toEqual({ issuer: "sample-app", subject: "sample-user", tenant: "sample-tenant", team: [] });
    expect(config.ttlS).toBe(DEFAULT_TOKEN_TTL_S);
    expect(config.viewerBaseUrl).toBeNull();
  });

  it("names a missing variable without echoing any value", () => {
    expect(() => readSampleDevConfig({ SAMPLE_RUN_TOKEN_SECRET: SECRET })).toThrow("SAMPLE_RUN_SERVICE_URL is required");
    try {
      readSampleDevConfig({ SAMPLE_RUN_SERVICE_URL: "ftp://x", SAMPLE_RUN_TOKEN_SECRET: SECRET });
      expect.unreachable("a non-http URL must be refused");
    } catch (err) {
      expect((err as Error).message).toBe("SAMPLE_RUN_SERVICE_URL must be an http(s) URL");
      expect((err as Error).message).not.toContain(SECRET);
    }
  });

  it("refuses a token lifetime above the service maximum", () => {
    expect(() =>
      readSampleDevConfig({
        SAMPLE_RUN_SERVICE_URL: "http://localhost:3000",
        SAMPLE_RUN_TOKEN_SECRET: SECRET,
        SAMPLE_TOKEN_TTL_S: "601",
      }),
    ).toThrow("SAMPLE_TOKEN_TTL_S must be an integer from 1 to 600");
  });
});
