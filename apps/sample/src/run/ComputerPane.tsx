import { useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { ComputerViewer } from "@cm/computer-viewer/react";
import type { TransportChoice, ViewerSession } from "@cm/computer-viewer";
import { Button } from "@/components/ui/button";
import { failureText, RunApiError } from "../api/runApi";
import type { RunApi } from "../api/runApi";
import { toViewerSession } from "../api/viewerSession";
import type { RunStatus, ViewJson } from "../api/types";
import { LIVE_RUN_STATUSES, TERMINAL_RUN_STATUSES } from "../api/types";

/** Shown once the run has ended, or the service says its computer is gone (409 or 410). */
export const COMPUTER_ENDED_TEXT = "The computer has ended. Its files are in Artifacts.";

/** Props of {@link ComputerPane}. */
export interface ComputerPaneProps {
  readonly runId: string;
  readonly api: RunApi;
  readonly transport: TransportChoice;
  readonly viewerBaseUrl: string;
  /** The run's status, as the stream folds it. */
  readonly status: RunStatus | "unknown";
  /** The control session of a take-over the person holds. Null means view only. */
  readonly control: ViewJson | null;
  /** Ends the take-over, from the viewer's own Release button. */
  readonly onRelease: () => void;
}

/** The mode a pane shows, so the header and the empty states say the same thing. */
export type PaneMode = "view" | "control";

/**
 * The run's computer. It is view-only by default: a view session is opened while the run is live. A take-over
 * the person holds swaps in its control session, and when that ends the pane goes back to view. Once the run has
 * ended, or the service says its computer is gone, the pane says so and points at the artifacts.
 */
export function ComputerPane({
  runId,
  api,
  transport,
  viewerBaseUrl,
  status,
  control,
  onRelease,
}: ComputerPaneProps): ReactElement {
  const [view, setView] = useState<ViewJson | null>(null);
  const [expired, setExpired] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  const ended = gone || TERMINAL_RUN_STATUSES.some((known) => known === status);
  const live = LIVE_RUN_STATUSES.some((known) => known === status);
  const current: ViewJson | null = control ?? view;
  const mode: PaneMode = control ? "control" : "view";

  const session: ViewerSession | null = useMemo(
    () => (current && !expired ? toViewerSession(current, viewerBaseUrl) : null),
    [current, expired, viewerBaseUrl],
  );

  // A view session is opened while the run is live and no take-over is held. It is opened again when a take-over
  // ends, because the control session is not a view.
  useEffect(() => {
    if (!live || control !== null || view !== null || gone || expired) return undefined;
    let active = true;
    setReopening(true);
    void openView(api, runId).then((result) => {
      if (!active) return;
      setReopening(false);
      if (result.kind === "ok") {
        setView(result.view);
        setError(null);
      } else if (result.kind === "gone") {
        setGone(true);
      } else {
        setError(result.message);
      }
    });
    return () => {
      active = false;
    };
  }, [api, runId, live, control, view, gone, expired]);

  // A session lasts until its expiry. When it passes, the pane drops the session and offers to reopen it.
  useEffect(() => {
    if (!current || current.expires_at === undefined) return undefined;
    const delay = Date.parse(current.expires_at) - Date.now();
    if (Number.isNaN(delay)) return undefined;
    const timer = setTimeout(() => setExpired(true), Math.max(delay, 0));
    return () => clearTimeout(timer);
  }, [current]);

  if (ended) {
    return (
      <PaneFrame mode={mode} transport={transport}>
        <p className="text-sm text-muted-foreground">{COMPUTER_ENDED_TEXT}</p>
      </PaneFrame>
    );
  }

  if (session) {
    return (
      <PaneFrame mode={mode} transport={transport}>
        <ComputerViewer session={session} transport={transport} onRelease={control ? onRelease : undefined} />
      </PaneFrame>
    );
  }

  return (
    <PaneFrame mode={mode} transport={transport}>
      {expired && !control ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">The view session expired.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={reopening}
            onClick={() => {
              setExpired(false);
              setView(null);
            }}
          >
            Reopen view
          </Button>
        </div>
      ) : expired ? (
        <p className="text-sm text-muted-foreground">The control session expired. Finish the take-over from its request.</p>
      ) : live ? (
        <p className="text-sm text-muted-foreground">{reopening ? "Opening the view" : "Waiting for the computer"}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the run</p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </PaneFrame>
  );
}

/** The frame around the pane: its heading, the mode and the configured transport. */
function PaneFrame({
  mode,
  transport,
  children,
}: {
  readonly mode: PaneMode;
  readonly transport: TransportChoice;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label="Computer" className="flex min-w-0 flex-col gap-2">
      <header className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <h2 className="text-sm font-medium text-foreground">Computer</h2>
        <span>
          {mode === "control" ? "Control" : "View only"} · transport {transport}
        </span>
      </header>
      {children}
    </section>
  );
}

type OpenResult =
  | { readonly kind: "ok"; readonly view: ViewJson }
  | { readonly kind: "gone" }
  | { readonly kind: "error"; readonly message: string };

/**
 * Opens a view session. A 409 (the run ended) or 410 (the computer is gone) means there is nothing to view; any
 * other failure is shown inline with its status.
 *
 * @param api The run API.
 * @param runId The run.
 */
export async function openView(api: RunApi, runId: string): Promise<OpenResult> {
  try {
    return { kind: "ok", view: await api.view(runId) };
  } catch (err) {
    if (err instanceof RunApiError && (err.status === 409 || err.status === 410)) return { kind: "gone" };
    return { kind: "error", message: failureText(err) };
  }
}
