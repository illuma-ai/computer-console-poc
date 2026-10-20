import type { AgentJson, RunStatus, RunView } from "../api/types";
import { TERMINAL_RUN_STATUSES } from "../api/types";

/**
 * The pure rules of the runs list: filtering, the time columns and the agent names. No React and no network,
 * so the rules are tested directly.
 */

/** The text a missing value shows as in a table. The service does not send every column yet. */
export const MISSING = "—";

/**
 * The status filter a list applies. An empty value means every status.
 *
 * @param runs The runs as the service returned them.
 * @param status The status to keep, or empty for all.
 */
export function filterRuns(runs: readonly RunView[], status: RunStatus | ""): readonly RunView[] {
  return status === "" ? runs : runs.filter((run) => run.status === status);
}

/**
 * Adds a page of runs to the list. A run that is already listed keeps its place and takes the newer
 * copy, so a refresh of the first page does not duplicate a run that a later page showed.
 *
 * @param current The runs listed so far, newest first.
 * @param page The next page, in the same order.
 */
export function mergeRuns(current: readonly RunView[], page: readonly RunView[]): readonly RunView[] {
  const fresh = new Map(page.map((run) => [run.id, run]));
  const kept = current.map((run) => fresh.get(run.id) ?? run);
  const known = new Set(current.map((run) => run.id));
  return [...kept, ...page.filter((run) => !known.has(run.id))];
}

/**
 * When a run started: its start time, else its creation time, else null. The service sends neither today, so
 * the table shows a dash for null.
 *
 * @param run The run.
 */
export function startedAt(run: RunView): string | null {
  return run.started_at ?? run.created_at ?? null;
}

/**
 * A time as the table shows it: local date and time to the second. A missing or unreadable time is a dash.
 *
 * @param iso An ISO 8601 instant, or null.
 */
export function timeText(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? MISSING : at.toLocaleString();
}

/**
 * How long a run has run: from its start to its end, or to `now` while it is still live. A run with no start
 * time has no duration.
 *
 * @param run The run.
 * @param now The reference time in milliseconds (the caller's clock).
 * @returns a short text such as `42 s`, `3 min 5 s` or `1 h 2 min`, or a dash.
 */
export function durationText(run: RunView, now: number): string {
  const start = startedAt(run);
  if (start === null) return MISSING;
  const from = Date.parse(start);
  const to = run.ended_at ? Date.parse(run.ended_at) : now;
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return MISSING;
  return formatSeconds(Math.floor((to - from) / 1000));
}

/**
 * Formats a number of whole seconds for a table.
 *
 * @param total The seconds.
 */
export function formatSeconds(total: number): string {
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes} min ${seconds} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Whether a run has ended, so its row stops changing. */
export function isEnded(run: RunView): boolean {
  return TERMINAL_RUN_STATUSES.some((status) => status === run.status);
}

/**
 * The agent name for each agent id, for the runs list. An id with no agent in the list is shown as the id.
 *
 * @param agents The agents the caller can see.
 */
export function agentNameIndex(agents: readonly AgentJson[]): ReadonlyMap<string, string> {
  return new Map(agents.map((agent) => [agent.id, agent.name]));
}
