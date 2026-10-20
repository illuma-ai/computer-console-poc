import { useEffect, useReducer, useState } from "react";
import type { RunApi } from "../api/runApi";
import type { RunEvent, RunView } from "../api/types";
import { TERMINAL_RUN_STATUSES } from "../api/types";
import { applyEvent, INITIAL_RUN_STATE, withSnapshot } from "./timeline";
import type { RunState } from "./timeline";

/** How long to wait before reconnecting a dropped event stream. The reconnect resumes from the last seq. */
export const STREAM_RETRY_MS = 2000;

/** What the follow loop reports. The hook turns these into state; the loop itself is testable alone. */
export interface FollowHandlers {
  readonly onEvent: (event: RunEvent) => void;
  readonly onDropped: () => void;
  readonly retryMs?: number;
}

/**
 * Follows a run's event stream from `afterSeq` (0 for the start), until the run ends and the stream closes.
 * A dropped connection is reopened from the last sequence seen, with `Last-Event-ID`, so nothing is
 * replayed twice and nothing is lost.
 *
 * @param api The run API.
 * @param runId The run to follow.
 * @param signal Aborts the loop (the view has closed).
 * @param handlers Receives each event, and is told when the connection drops.
 */
export async function followRun(
  api: RunApi,
  runId: string,
  signal: AbortSignal,
  handlers: FollowHandlers,
): Promise<void> {
  let after = 0;
  while (!signal.aborted) {
    try {
      for await (const event of api.streamEvents(runId, after, signal)) {
        after = event.seq;
        handlers.onEvent(event);
      }
      return; // the run ended and its stream closed
    } catch {
      if (signal.aborted) return;
      handlers.onDropped();
      await wait(handlers.retryMs ?? STREAM_RETRY_MS, signal);
    }
  }
}

/** What {@link useRunStream} returns to the run view. */
export interface RunStream {
  /** The run folded from its events, with the snapshot filling what the events have not yet said. */
  readonly state: RunState;
  /** The run as `GET /v1/runs/{id}` last returned it, or null before the first answer. */
  readonly snapshot: RunView | null;
  /** Shown while the stream is down and retrying. Null when it is healthy. */
  readonly streamError: string | null;
}

/**
 * One run, live. It follows the run's event stream from the start, resumes after a dropped connection, and
 * refreshes the snapshot once the run has ended (so the computer id and the stop reason are current).
 *
 * @param runId The run to follow.
 * @param api The run API.
 */
export function useRunStream(runId: string, api: RunApi): RunStream {
  const [state, dispatch] = useReducer(applyEvent, INITIAL_RUN_STATE);
  const [snapshot, setSnapshot] = useState<RunView | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const finished = TERMINAL_RUN_STATUSES.some((status) => status === state.status);

  useEffect(() => {
    const controller = new AbortController();
    void followRun(api, runId, controller.signal, {
      onEvent: (event) => {
        setStreamError(null);
        dispatch(event);
      },
      onDropped: () => setStreamError("The event stream dropped. Reconnecting."),
    });
    return () => controller.abort();
  }, [api, runId]);

  // The snapshot is read when the view opens, again once the run has ended, and when the computer changes (so the
  // provenance lists the computers the run has used).
  const computerId = state.computerId;
  useEffect(() => {
    let current = true;
    api
      .getRun(runId)
      .then((run) => {
        if (current) setSnapshot(run);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api, runId, finished, computerId]);

  return {
    state: snapshot ? withSnapshot(state, snapshot) : state,
    snapshot,
    streamError,
  };
}

/** Resolves after `ms`, or at once when the signal aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
