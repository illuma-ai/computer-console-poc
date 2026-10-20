import { callJson } from "./runApi";
import type { AgentJson, AgentPageJson, AgentWrite } from "./types";

/**
 * The browser's client for the agent registry. It calls only the same-origin mount (`/api/agents`); the dev
 * server rewrites it to the run service's `/v1/agents` and adds the service token. Agents are owned by the run
 * service: the sample keeps no copy of a definition.
 */

/** The same-origin mount the dev proxy serves. */
export const AGENTS_API_BASE = "/api/agents";

/** The page size the list asks for. The service's maximum is 100. */
const LIST_PAGE_SIZE = 100;

/** The calls the agents panel makes. The panel depends on this interface, so tests substitute a fake. */
export interface AgentsApi {
  /** Every agent the caller may see, newest first (all pages). */
  listAgents(): Promise<AgentJson[]>;
  /** @throws {RunApiError} with the service's `AGENT_INVALID` or `REQUEST_INVALID` text, or 403 for a non-admin. */
  createAgent(body: AgentWrite): Promise<AgentJson>;
  /** Changes the fields the body names. A change that alters nothing does not bump the version. */
  updateAgent(id: string, body: Partial<AgentWrite>): Promise<AgentJson>;
  /** Turns a agent off. Disabling a agent that is already disabled changes nothing. */
  disableAgent(id: string): Promise<AgentJson>;
}

/** Options for {@link createAgentsApi}. */
export interface AgentsApiOptions {
  /** Defaults to {@link AGENTS_API_BASE}. */
  readonly baseUrl?: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Build the agent registry client.
 *
 * @param options The base URL and an injectable `fetch`.
 */
export function createAgentsApi(options: AgentsApiOptions = {}): AgentsApi {
  const base = options.baseUrl ?? AGENTS_API_BASE;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const call = <T>(method: string, path: string, body?: unknown): Promise<T> =>
    callJson<T>(doFetch, base, method, path, body);

  return {
    async listAgents() {
      const agents: AgentJson[] = [];
      let cursor: string | null = null;
      do {
        const query = `?limit=${LIST_PAGE_SIZE}${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
        const page: AgentPageJson = await call<AgentPageJson>("GET", query);
        agents.push(...page.agents);
        cursor = page.next_cursor;
      } while (cursor !== null);
      return agents;
    },
    createAgent: (body) => call<AgentJson>("POST", "", body),
    updateAgent: (id, body) => call<AgentJson>("PATCH", `/${encodeURIComponent(id)}`, body),
    disableAgent: (id) => call<AgentJson>("POST", `/${encodeURIComponent(id)}/disable`),
  };
}
