import { createHmac, timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintRunToken, RUN_TOKEN_MAX_TTL_S } from "../../dev/run-token";

/*
 * The fixture: a port of agent-bridge's verifyRunToken (src/runs/auth/run-token.ts in agent-bridge-runs).
 * It is written out here so the test checks the minted token against the service's rules without
 * importing another repository. Keep it in step with the service's checks: HS256 only, a constant-time
 * signature check against every accepted secret, the claim types, iat not in the future (30 s skew),
 * exp in the future, and a lifetime of at most 600 s.
 */
const CLOCK_SKEW_S = 30;

function verifyLikeAgentBridge(token: string, secrets: readonly string[], nowMs: number): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) throw new Error("malformed");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decode(headerPart);
  if (header["alg"] !== "HS256") throw new Error("unsupported algorithm");
  const signingInput = `${headerPart}.${payloadPart}`;
  const matched = secrets.some((secret) => {
    const expected = Buffer.from(createHmac("sha256", secret).update(signingInput).digest("base64url"));
    const actual = Buffer.from(signaturePart);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
  if (!matched) throw new Error("bad signature");

  const claims = decode(payloadPart);
  for (const key of ["iss", "sub", "tenant", "jti"]) {
    const value = claims[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`claim ${key} missing`);
  }
  if (!Array.isArray(claims["team"]) || !claims["team"].every((t) => typeof t === "string")) {
    throw new Error("claim team invalid");
  }
  const iat = claims["iat"];
  const exp = claims["exp"];
  if (typeof iat !== "number" || !Number.isInteger(iat)) throw new Error("claim iat missing");
  if (typeof exp !== "number" || !Number.isInteger(exp)) throw new Error("claim exp missing");
  const nowS = Math.floor(nowMs / 1000);
  if (iat > nowS + CLOCK_SKEW_S) throw new Error("issued in the future");
  if (exp <= nowS) throw new Error("expired");
  if (exp - nowS > RUN_TOKEN_MAX_TTL_S) throw new Error("lifetime too long");
  return claims;
}

function decode(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

const SECRET = "fixture-secret-do-not-use-in-production";
const IDENTITY = {
  issuer: "sample-app",
  subject: "sample-user",
  tenant: "sample-tenant",
  team: ["ops"],
};
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);

describe("mintRunToken", () => {
  it("produces a token the service's verifier accepts, with the claims it checks", () => {
    const token = mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 120, nowMs: NOW });
    const claims = verifyLikeAgentBridge(token, [SECRET], NOW);
    expect(claims).toMatchObject({
      iss: "sample-app",
      sub: "sample-user",
      tenant: "sample-tenant",
      team: ["ops"],
    });
    expect(claims["exp"]).toBe((claims["iat"] as number) + 120);
  });

  it("is accepted when the secret is one of several (rotation)", () => {
    const token = mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 60, nowMs: NOW });
    expect(() => verifyLikeAgentBridge(token, ["older-secret", SECRET], NOW)).not.toThrow();
  });

  it("is refused by a verifier holding a different secret", () => {
    const token = mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 60, nowMs: NOW });
    expect(() => verifyLikeAgentBridge(token, ["some-other-secret"], NOW)).toThrow("bad signature");
  });

  it("gives every token its own jti, so a token minted per write is never a replay", () => {
    const a = mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 60, nowMs: NOW });
    const b = mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 60, nowMs: NOW });
    expect(decode(a.split(".")[1]!)["jti"]).not.toBe(decode(b.split(".")[1]!)["jti"]);
  });

  it("refuses a lifetime outside 1 to 600 seconds", () => {
    expect(() => mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 0 })).toThrow(RangeError);
    expect(() => mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: RUN_TOKEN_MAX_TTL_S + 1 })).toThrow(
      RangeError,
    );
    expect(() => mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 1.5 })).toThrow(RangeError);
  });

  it("refuses an empty secret, and its message does not echo any secret", () => {
    expect(() => mintRunToken({ secret: "", identity: IDENTITY, ttlS: 60 })).toThrow("run token secret is empty");
  });
});

describe("secret handling", () => {
  let calls: unknown[][];

  beforeEach(() => {
    calls = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never writes the secret to any console method while minting", () => {
    mintRunToken({ secret: SECRET, identity: IDENTITY, ttlS: 60, nowMs: NOW });
    expect(calls).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain(SECRET);
  });
});
