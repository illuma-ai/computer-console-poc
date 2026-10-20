import type { RunTokenIdentity } from "./run-token.ts";
import { RUN_TOKEN_MAX_TTL_S } from "./run-token.ts";

/** Settings the dev server reads from the environment. Nothing here is sent to the browser. */
export interface SampleDevConfig {
  /** Base URL of the run service (no path). Proxied for `/api/runs`. */
  readonly runServiceUrl: string;
  /** Signs the run service's tokens. Server-side only. */
  readonly secret: string;
  readonly identity: RunTokenIdentity;
  readonly ttlS: number;
  /** The manager's public viewing listener, or null when the viewer is not proxied. */
  readonly viewerBaseUrl: string | null;
}

/** Lifetime of a minted token when `SAMPLE_TOKEN_TTL_S` is unset. Short: one request each. */
export const DEFAULT_TOKEN_TTL_S = 120;

/**
 * The role claim that lets the caller create agents (the run service's `RUNS.TOKEN.ADMIN_ROLE`). It is
 * the only role the sample can mint.
 */
export const SAMPLE_ADMIN_ROLE = "admin";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Read the dev settings from an environment map.
 *
 * WHY `SAMPLE_ROLE` exists: creating a agent is a tenant-admin action. A real host would never give a
 * browser user that role; the sample sets it only in the developer's own dev server, so a local admin can
 * create agents. Unset (the default) mints a token with no role.
 *
 * @throws {Error} when a required variable is missing or malformed. The message names the variable,
 * never its value, so the secret cannot end up in a terminal or a log.
 */
export function readSampleDevConfig(env: Env): SampleDevConfig {
  const team = (env["SAMPLE_TEAM"] ?? "").trim();
  const role = readRole(env["SAMPLE_ROLE"]);
  return {
    runServiceUrl: requireHttpUrl(env, "SAMPLE_RUN_SERVICE_URL"),
    secret: requireValue(env, "SAMPLE_RUN_TOKEN_SECRET"),
    identity: {
      issuer: env["SAMPLE_ISSUER"]?.trim() || "sample-app",
      subject: env["SAMPLE_USER"]?.trim() || "sample-user",
      tenant: env["SAMPLE_TENANT"]?.trim() || "sample-tenant",
      team: team.length > 0 ? [team] : [],
      ...(role !== null ? { role } : {}),
    },
    ttlS: readTtl(env["SAMPLE_TOKEN_TTL_S"]),
    viewerBaseUrl: optionalHttpUrl(env, "SAMPLE_VIEWER_BASE_URL"),
  };
}

function requireValue(env: Env, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function requireHttpUrl(env: Env, name: string): string {
  const value = requireValue(env, name);
  if (!isHttpUrl(value)) throw new Error(`${name} must be an http(s) URL`);
  return value.replace(/\/+$/, "");
}

function optionalHttpUrl(env: Env, name: string): string | null {
  const value = env[name]?.trim() ?? "";
  if (value.length === 0) return null;
  if (!isHttpUrl(value)) throw new Error(`${name} must be an http(s) URL`);
  return value.replace(/\/+$/, "");
}

/**
 * `SAMPLE_ROLE`: empty for no role, or `admin`. Anything else is refused, so a typo cannot silently mint a
 * token without the role the developer asked for.
 *
 * @returns the role claim, or null when none is set.
 */
function readRole(raw: string | undefined): string | null {
  const role = (raw ?? "").trim();
  if (role === "") return null;
  if (role !== SAMPLE_ADMIN_ROLE) throw new Error(`SAMPLE_ROLE must be empty or ${SAMPLE_ADMIN_ROLE}`);
  return role;
}

function readTtl(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TOKEN_TTL_S;
  const ttl = Number(raw.trim());
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > RUN_TOKEN_MAX_TTL_S) {
    throw new Error(`SAMPLE_TOKEN_TTL_S must be an integer from 1 to ${RUN_TOKEN_MAX_TTL_S}`);
  }
  return ttl;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
