import { createHmac, randomBytes } from "node:crypto";

/**
 * Mints the run service's service tokens for the sample's dev server.
 *
 * The format is agent-bridge's run token (`src/runs/auth/run-token.ts` in its repository): a compact
 * HS256 JWT with the claims iss, sub, team, tenant, iat, exp and jti. It is re-implemented here rather
 * than imported, so this app does not depend on another repository's code.
 *
 * WHY Node-side only: the secret signs tokens inside the dev server process. It never reaches the
 * browser bundle, and the browser never sees a token; the dev server adds the header to proxied calls.
 */

/** The only algorithm the run service accepts. */
export const RUN_TOKEN_ALGORITHM = "HS256";

/** The run service refuses a token whose lifetime is longer than this (its RUNS.TOKEN.MAX_TTL_S). */
export const RUN_TOKEN_MAX_TTL_S = 600;

/** The claims that name the caller. A fixed dev user in this sample. */
export interface RunTokenIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly tenant: string;
  readonly team: readonly string[];
  /** The `role` claim. Set to `admin` only for a local developer who creates agents; omitted otherwise. */
  readonly role?: string;
}

/** Input to {@link mintRunToken}. `nowMs` and `jti` exist so tests can pin them. */
export interface MintOptions {
  readonly secret: string;
  readonly identity: RunTokenIdentity;
  readonly ttlS: number;
  readonly nowMs?: number;
  readonly jti?: string;
}

/**
 * Sign one token. Every state-changing request the run service receives spends the token's `jti`, so
 * the caller mints one token per request; a token is never reused for a write.
 *
 * @throws {RangeError} when the lifetime is not an integer in 1..600 seconds, or the secret or an
 * identity claim is empty. The messages name the field and never include the secret.
 */
export function mintRunToken(options: MintOptions): string {
  const { secret, identity, ttlS } = options;
  if (secret.length === 0) throw new RangeError("run token secret is empty");
  if (!Number.isInteger(ttlS) || ttlS < 1 || ttlS > RUN_TOKEN_MAX_TTL_S) {
    throw new RangeError(`run token lifetime must be 1 to ${RUN_TOKEN_MAX_TTL_S} seconds`);
  }
  for (const [name, value] of [
    ["issuer", identity.issuer],
    ["subject", identity.subject],
    ["tenant", identity.tenant],
  ] as const) {
    if (value.length === 0) throw new RangeError(`run token ${name} is empty`);
  }
  const iat = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const header = { alg: RUN_TOKEN_ALGORITHM, typ: "JWT" };
  const payload = {
    iss: identity.issuer,
    sub: identity.subject,
    team: [...identity.team],
    tenant: identity.tenant,
    iat,
    exp: iat + ttlS,
    jti: options.jti ?? randomBytes(16).toString("base64url"),
    ...(identity.role ? { role: identity.role } : {}),
  };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(signingInput: string, secret: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}
