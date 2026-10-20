import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { createViewerClient } from "../client/client";
import type { ViewerClient } from "../client/client";
import type { ScreenTransport, TransportChoice, ViewerSession, ViewerStatus } from "../client/types";
import { ControlBar } from "./ControlBar";
import { Files } from "./Files";
import { Screen } from "./Screen";
import { Terminal } from "./Terminal";

/** Props of {@link ComputerViewer}. */
export interface ComputerViewerProps {
  /** The session the host minted. A new object (for example after a take-over) starts a new client. */
  session: ViewerSession;
  /** Which screen transport to use. Defaults to `auto`. */
  transport?: TransportChoice;
  /** Shown in view mode. The host gets a control session from its backend and passes it as `session`. */
  onTakeControl?: () => void;
  /** Shown in control mode. */
  onRelease?: () => void;
}

/** The two views under the screen. One type, so a tab name cannot be misspelt. */
type Tab = "terminal" | "files";

/**
 * The computer viewer: the live screen, a read-only terminal (processes and their output), read-only
 * files, and the control bar. It creates one client per session and closes it on unmount or when the
 * session changes.
 */
export function ComputerViewer({ session, transport = "auto", onTakeControl, onRelease }: ComputerViewerProps): ReactElement {
  const [client, setClient] = useState<ViewerClient | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("connecting");
  const [active, setActive] = useState<ScreenTransport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("terminal");

  useEffect(() => {
    let created: ViewerClient;
    try {
      created = createViewerClient(session);
    } catch (err) {
      setClient(null);
      setFailure(err instanceof Error ? err.message : "The viewer could not start");
      return undefined;
    }
    setFailure(null);
    setActive(null);
    setStatus("connecting");
    const off = created.on((event) => {
      if (event.type === "status") setStatus(event.status);
      else if (event.type === "transport") setActive(event.transport);
      else if (event.type === "error") setFailure(event.error.message);
    });
    setClient(created);
    return () => {
      off();
      created.close();
      setClient(null);
    };
  }, [session]);

  const expired = status === "expired";

  return (
    <section className="cv-root" aria-label="Computer viewer">
      <ControlBar
        mode={session.mode}
        status={status}
        transport={active}
        onTakeControl={onTakeControl}
        onRelease={onRelease}
      />
      {failure ? (
        <p className="cv-error" role="alert">
          {failure}
        </p>
      ) : null}
      {client && !expired ? (
        <>
          <Screen client={client} transport={transport} />
          <div className="cv-tabs" role="tablist" aria-label="Computer views">
            <button
              type="button"
              role="tab"
              className="cv-button"
              aria-selected={tab === "terminal"}
              onClick={() => setTab("terminal")}
            >
              Terminal
            </button>
            <button
              type="button"
              role="tab"
              className="cv-button"
              aria-selected={tab === "files"}
              onClick={() => setTab("files")}
            >
              Files
            </button>
          </div>
          <div role="tabpanel" className="cv-panel">
            {tab === "terminal" ? <Terminal client={client} /> : <Files client={client} />}
          </div>
        </>
      ) : null}
    </section>
  );
}
