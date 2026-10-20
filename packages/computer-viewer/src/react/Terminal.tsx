import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, UIEvent } from "react";
import type { ViewerClient } from "../client/client";
import type { ProcessInfo } from "../client/types";

/** Output kept on screen. Older text is dropped so a chatty process cannot exhaust memory. */
export const MAX_OUTPUT_CHARS = 200_000;
/** A reader within this many pixels of the bottom counts as following the output. */
export const STICK_SLACK_PX = 24;

/**
 * Appends output and keeps the most recent {@link MAX_OUTPUT_CHARS} characters.
 *
 * @param previous The text on screen.
 * @param added The new chunk.
 */
export function appendOutput(previous: string, added: string): string {
  const next = previous + added;
  return next.length > MAX_OUTPUT_CHARS ? next.slice(next.length - MAX_OUTPUT_CHARS) : next;
}

/** Props of {@link Terminal}. */
export interface TerminalProps {
  client: ViewerClient;
}

/**
 * Read-only process list and the live output of the selected process. Output auto-scrolls while
 * the reader is at the bottom; scrolling up pauses it, and returning to the bottom resumes it.
 */
export function Terminal({ client }: TerminalProps): ReactElement {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const following = useRef(true);

  const refresh = useCallback(() => {
    setError(null);
    client.listProcesses().then(setProcesses, () => setError("Could not load the processes"));
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (selected === null) return undefined;
    setOutput("");
    following.current = true;
    return client.followProcess(selected, (event) => {
      if (event.type === "stdout" || event.type === "stderr") {
        const data = event.payload.data;
        if (typeof data === "string" && data) setOutput((prev) => appendOutput(prev, data));
      } else if (event.type === "exited") {
        const code = event.payload.exit_code;
        setOutput((prev) => appendOutput(prev, `\n[exit ${typeof code === "number" ? code : "?"}]\n`));
      }
    });
  }, [client, selected]);

  useEffect(() => {
    const log = logRef.current;
    if (log && following.current) log.scrollTop = log.scrollHeight;
  }, [output]);

  const onScroll = (event: UIEvent<HTMLPreElement>): void => {
    const el = event.currentTarget;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_SLACK_PX;
  };

  return (
    <div className="cv-terminal">
      <div className="cv-row">
        <button type="button" className="cv-button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error ? (
        <p className="cv-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="cv-list" aria-label="Processes">
        {processes.map((proc) => (
          <li key={proc.pid}>
            <button
              type="button"
              className="cv-button cv-process"
              aria-pressed={selected === proc.pid}
              onClick={() => setSelected(proc.pid)}
            >
              {(proc.cmd ?? []).join(" ") || proc.pid}
            </button>
          </li>
        ))}
      </ul>
      {selected !== null ? (
        <pre className="cv-log" ref={logRef} onScroll={onScroll} tabIndex={0} aria-label="Process output">
          {output}
        </pre>
      ) : null}
    </div>
  );
}
