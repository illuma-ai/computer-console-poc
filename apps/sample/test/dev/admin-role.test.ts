import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readSampleDevConfig, SAMPLE_ADMIN_ROLE } from "../../dev/config";
import { mintRunToken } from "../../dev/run-token";
import { API_MOUNTS, AGENTS_API_MOUNT, RUN_API_MOUNT, runTokenPlugin } from "../../dev/run-token-plugin";

const SECRET = "fixture-secret-do-not-use-in-production";
const BASE = {
  SAMPLE_RUN_SERVICE_URL: "http://localhost:3000",
  SAMPLE_RUN_TOKEN_SECRET: SECRET,
};

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("SAMPLE_ROLE", () => {
  it("mints no role claim by default", () => {
    const config = readSampleDevConfig(BASE);
    expect(config.identity).not.toHaveProperty("role");
    expect(payloadOf(mintRunToken({ secret: SECRET, identity: config.identity, ttlS: 60 }))).not.toHaveProperty("role");
  });

  it("adds the admin role claim when set to admin, so a local admin can create agents", () => {
    const config = readSampleDevConfig({ ...BASE, SAMPLE_ROLE: " admin " });
    expect(config.identity.role).toBe(SAMPLE_ADMIN_ROLE);
    expect(payloadOf(mintRunToken({ secret: SECRET, identity: config.identity, ttlS: 60 }))["role"]).toBe("admin");
  });

  it("refuses any other role, naming the variable and not its value", () => {
    expect(() => readSampleDevConfig({ ...BASE, SAMPLE_ROLE: "superuser" })).toThrow(
      "SAMPLE_ROLE must be empty or admin",
    );
    expect(() => readSampleDevConfig({ ...BASE, SAMPLE_ROLE: "superuser" })).not.toThrow(/superuser/);
  });
});

describe("the API mounts the dev server signs and proxies", () => {
  it("maps the run API and the agent registry onto their /v1 routes", () => {
    expect(API_MOUNTS).toEqual([
      { mount: RUN_API_MOUNT, upstream: "/v1/runs" },
      { mount: AGENTS_API_MOUNT, upstream: "/v1/agents" },
    ]);
  });

  it("signs a token for requests on both mounts", () => {
    const config = readSampleDevConfig(BASE);
    const use = vi.fn();
    const hook = runTokenPlugin(config).configureServer as unknown as (server: unknown) => void;
    hook({ middlewares: { use } });

    const mounts = use.mock.calls.map((call) => (call as unknown[])[0]);
    expect(mounts).toEqual([RUN_API_MOUNT, AGENTS_API_MOUNT]);
    const handler = use.mock.calls[1]![1] as (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
    const req = { headers: {} } as unknown as IncomingMessage;
    handler(req, {} as ServerResponse, () => undefined);
    expect(req.headers.authorization).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
