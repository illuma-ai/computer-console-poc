import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, SELECT_CLASS } from "../components/Field";
import { StatusBadge, STATUS_LABEL } from "../components/StatusBadge";
import type { AgentsApi } from "../api/agentsApi";
import { failureText } from "../api/runApi";
import type { RunApi, RunsQuery } from "../api/runApi";
import type { AgentJson, RunStatus, RunView } from "../api/types";
import { RUN_STATUSES } from "../api/types";
import { routeHash } from "../routes";
import type { KeyValueStorage } from "../storage";
import { NewRunDialog } from "./NewRunDialog";
import { agentNameIndex, durationText, filterRuns, MISSING, mergeRuns, startedAt, timeText } from "./runList";

/** How often the list refreshes its first page while it is open. */
export const RUNS_REFRESH_MS = 5000;

/** The page size the list asks for. */
export const RUNS_PAGE_SIZE = 50;

/** Props of {@link RunsScreen}. */
export interface RunsScreenProps {
  readonly api: RunApi;
  readonly agents: AgentsApi;
  readonly storage: KeyValueStorage | null;
  /** Overrides the refresh period (tests use a short one). */
  readonly refreshMs?: number;
}

/**
 * The runs, newest first, with a status filter. The first page refreshes on a timer, and older pages load on
 * request. "New run" starts a run and opens it.
 */
export function RunsScreen({ api, agents, storage, refreshMs = RUNS_REFRESH_MS }: RunsScreenProps): ReactElement {
  const [status, setStatus] = useState<RunStatus | "">("");
  const [runs, setRuns] = useState<readonly RunView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [agentList, setAgentList] = useState<readonly AgentJson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  // The status the last request was made for. A slow answer for an older filter must not replace the list.
  const requested = useRef<RunStatus | "">("");

  const refresh = useCallback(async (): Promise<void> => {
    const forStatus = requested.current;
    try {
      const page = await api.listRuns(queryFor(forStatus));
      if (forStatus !== requested.current) return;
      setRuns((previous) => {
        const fresh = new Set(page.runs.map((run) => run.id));
        return [...page.runs, ...previous.filter((run) => !fresh.has(run.id))];
      });
      setCursor(page.next_cursor);
      setError(null);
      setLoaded(true);
      setNow(Date.now());
    } catch (err) {
      setError(failureText(err));
      setLoaded(true);
    }
  }, [api]);

  // The first page is read at once and again on each tick. A changed filter starts from an empty list.
  useEffect(() => {
    requested.current = status;
    setRuns([]);
    setCursor(null);
    setLoaded(false);
    void refresh();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void refresh();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [status, refresh, refreshMs]);

  useEffect(() => {
    let current = true;
    agents
      .listAgents()
      .then((list) => {
        if (current) setAgentList(list);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [agents]);

  async function loadMore(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await api.listRuns({ ...queryFor(status), cursor });
      setRuns((previous) => mergeRuns(previous, page.runs));
      setCursor(page.next_cursor);
    } catch (err) {
      setError(failureText(err));
    }
  }

  const names = agentNameIndex(agentList);
  const visible = filterRuns(runs, status);
  const enabled = agentList.filter((agent) => agent.enabled);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Runs</h1>
        <div className="flex items-end gap-3">
          <div className="w-44">
            <Field label="Status">
              {({ id }) => (
                <select
                  id={id}
                  className={SELECT_CLASS}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as RunStatus | "")}
                >
                  <option value="">All statuses</option>
                  {RUN_STATUSES.map((known) => (
                    <option key={known} value={known}>
                      {STATUS_LABEL[known]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Button type="button" onClick={() => setDialogOpen(true)}>
            New run
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!loaded ? <p className="text-sm text-muted-foreground">Loading runs</p> : null}
      {loaded && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{status === "" ? "No runs yet" : "No runs with this status"}</p>
      ) : null}

      {visible.length > 0 ? (
        <Table aria-label="Runs">
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Runtime</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell>
                  <a
                    className="font-mono text-xs underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={routeHash({ name: "run", runId: run.id })}
                  >
                    {run.id}
                  </a>
                </TableCell>
                <TableCell>{names.get(run.agent_id) ?? run.agent_id}</TableCell>
                <TableCell>{run.runtime ?? MISSING}</TableCell>
                <TableCell>{timeText(startedAt(run))}</TableCell>
                <TableCell>{durationText(run, now)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {cursor !== null ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      ) : null}

      <NewRunDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        api={api}
        agents={enabled}
        storage={storage}
        onStarted={(runId) => {
          setDialogOpen(false);
          window.location.hash = routeHash({ name: "run", runId });
        }}
      />
    </div>
  );
}

/**
 * The query for a page of the list. The status is sent to the service and the page size is fixed.
 *
 * @param status The filter, or empty for all.
 */
export function queryFor(status: RunStatus | ""): RunsQuery {
  return status === "" ? { limit: RUNS_PAGE_SIZE } : { status, limit: RUNS_PAGE_SIZE };
}
