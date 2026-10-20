import { useEffect, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { TransportChoice } from "@cm/computer-viewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RequestCard } from "../cards/RequestCard";
import { StatusBadge } from "../components/StatusBadge";
import { failureText } from "../api/runApi";
import type { AnswerBody, RunApi } from "../api/runApi";
import type { AgentsApi } from "../api/agentsApi";
import type { AgentJson, ArtifactJson, RunRequest, ViewJson } from "../api/types";
import { TERMINAL_RUN_STATUSES } from "../api/types";
import { useRunStream } from "./useRunStream";
import { ComputerPane } from "./ComputerPane";
import { Timeline } from "./TimelineView";
import { ArtifactsList } from "./ArtifactsList";
import { withLinks } from "./timeline";
import { agentNameIndex } from "../runs/runList";

/** Props of {@link RunScreen}. */
export interface RunScreenProps {
  readonly runId: string;
  readonly api: RunApi;
  /** The agent registry, for the agent's name in the header. */
  readonly agents: AgentsApi;
  readonly transport: TransportChoice;
  readonly viewerBaseUrl: string;
}

/** A take-over the person holds: the lease, the request it answers and the control session. */
interface HeldLease {
  readonly leaseId: string;
  readonly requestId: string;
  readonly view: ViewJson;
}

/** The two views of the run's column. */
type Tab = "timeline" | "artifacts";

/**
 * One run: the open requests pinned at the top, the timeline (or the artifacts), the steer and cancel actions,
 * and the computer beside them. The screen follows the run's event stream from the start.
 */
export function RunScreen({ runId, api, agents, transport, viewerBaseUrl }: RunScreenProps): ReactElement {
  const { state, snapshot, streamError } = useRunStream(runId, api);
  const [agentList, setAgentList] = useState<readonly AgentJson[]>([]);
  const [held, setHeld] = useState<HeldLease | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [links, setLinks] = useState<readonly ArtifactJson[]>([]);
  const [tab, setTab] = useState<Tab>("timeline");
  const [steerText, setSteerText] = useState("");

  const status = state.status;
  const ended = TERMINAL_RUN_STATUSES.some((known) => known === status);
  const canSteer = status !== "unknown" && !ended;
  const artifactCount = state.artifacts.length;

  // The artifact links are read once the run has produced files, and again once it has ended.
  useEffect(() => {
    if (artifactCount === 0 && !ended) return undefined;
    let active = true;
    api
      .artifacts(runId)
      .then((list) => {
        if (active) setLinks(list);
      })
      .catch((err: unknown) => {
        if (active) setActionError(`Artifact links could not be loaded. ${failureText(err)}`);
      });
    return () => {
      active = false;
    };
  }, [api, runId, artifactCount, ended]);

  // The agent's name is read once. A failed read leaves the header to show the agent's id.
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

  // A take-over ends when its request is answered, expires or is released elsewhere. The viewer goes with it.
  useEffect(() => {
    if (held && !state.openRequests.some((request) => request.id === held.requestId)) setHeld(null);
  }, [held, state.openRequests]);

  /** Runs one action, showing its failure inline. */
  async function act(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(failureText(err));
    } finally {
      setBusy(false);
    }
  }

  function answer(request: RunRequest, body: AnswerBody): Promise<void> {
    return act(() => api.answer(runId, request.id, body));
  }

  function takeControl(request: RunRequest): Promise<void> {
    return act(async () => {
      const granted = await api.lease(runId, request.id);
      setHeld({ leaseId: granted.lease.id, requestId: request.id, view: granted.view });
    });
  }

  function release(done: boolean): Promise<void> {
    if (!held) return Promise.resolve();
    const lease = held;
    return act(async () => {
      await api.release(runId, lease.leaseId, done);
      setHeld(null);
    });
  }

  async function steer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = steerText.trim();
    if (text === "" || !canSteer) return;
    await act(() => api.steer(runId, text));
    setSteerText("");
  }

  const artifacts = withLinks(state.artifacts, links);
  const requests = state.openRequests;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="font-mono text-sm">{runId}</h1>
          {status === "unknown" ? (
            <Badge variant="outline">Loading</Badge>
          ) : (
            <StatusBadge status={status} />
          )}
          {snapshot ? (
            <span className="text-xs text-muted-foreground" title={snapshot.agent_id}>
              {agentNameIndex(agentList).get(snapshot.agent_id) ?? snapshot.agent_id}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={ended || busy} onClick={() => void act(() => api.cancel(runId))}>
            Cancel run
          </Button>
        </div>
      </header>

      {streamError ? (
        <Alert>
          <AlertDescription>{streamError}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {requests.length > 0 ? (
            <div role="region" aria-label="Requests" className="flex flex-col gap-3">
              {requests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  held={held?.requestId === request.id}
                  canTakeControl={held === null}
                  busy={busy}
                  onAnswer={(body) => void answer(request, body)}
                  onTakeControl={() => void takeControl(request)}
                  onRelease={(done) => void release(done)}
                />
              ))}
            </div>
          ) : null}

          <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="artifacts">Artifacts{artifactCount > 0 ? ` (${artifactCount})` : ""}</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="flex flex-col gap-4">
              <Timeline entries={state.timeline} result={state.result} />
              {canSteer ? (
                <form aria-label="Steer the agent" className="flex gap-2" onSubmit={(event) => void steer(event)}>
                  <Input
                    aria-label="Steer message"
                    placeholder="Steer the agent"
                    value={steerText}
                    disabled={busy}
                    onChange={(event) => setSteerText(event.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={busy || steerText.trim() === ""}>
                    Send
                  </Button>
                </form>
              ) : null}
            </TabsContent>
            <TabsContent value="artifacts">
              <ArtifactsList artifacts={artifacts} ended={ended} />
            </TabsContent>
          </Tabs>
        </div>

        <ComputerPane
          runId={runId}
          api={api}
          transport={transport}
          viewerBaseUrl={viewerBaseUrl}
          status={status}
          control={held?.view ?? null}
          onRelease={() => void release(true)}
        />
      </div>
    </div>
  );
}
