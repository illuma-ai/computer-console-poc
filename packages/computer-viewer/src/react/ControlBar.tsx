import type { ReactElement } from "react";
import type { ScreenTransport, ViewerMode, ViewerStatus } from "../client/types";

/** Props of {@link ControlBar}. */
export interface ControlBarProps {
  mode: ViewerMode;
  status: ViewerStatus;
  /** The transport in use, once the screen is open. */
  transport: ScreenTransport | null;
  /** Shown in view mode only. The host gets a control session from its own backend. */
  onTakeControl?: () => void;
  /** Shown in control mode only. */
  onRelease?: () => void;
}

/**
 * The mode, the transport in use, and the take-over buttons. Status text appears only when it
 * needs attention (reconnecting, closed, expired): a healthy connection shows nothing.
 */
export function ControlBar({ mode, status, transport, onTakeControl, onRelease }: ControlBarProps): ReactElement {
  const attention = status === "reconnecting" || status === "closed" || status === "expired";
  return (
    <div className="cv-bar" role="toolbar" aria-label="Computer viewer controls">
      <span className="cv-mode">{mode === "control" ? "Control" : "View"}</span>
      {transport ? <span className="cv-transport">{transport}</span> : null}
      {attention ? <span className="cv-status" role="status">{statusText(status)}</span> : null}
      <span className="cv-spacer" />
      {mode === "view" && onTakeControl ? (
        <button type="button" className="cv-button" onClick={onTakeControl}>
          Take control
        </button>
      ) : null}
      {mode === "control" && onRelease ? (
        <button type="button" className="cv-button" onClick={onRelease}>
          Release
        </button>
      ) : null}
    </div>
  );
}

/** The words shown for a status that needs attention. */
function statusText(status: ViewerStatus): string {
  switch (status) {
    case "reconnecting":
      return "Reconnecting";
    case "expired":
      return "Session expired";
    default:
      return "Disconnected";
  }
}
