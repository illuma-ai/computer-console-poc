import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "../api/types";

/**
 * The state colours. Colour carries state only: a run's status and a timeline notice's tone. Everything
 * else on the page is monochrome.
 */
export type StateTone = "neutral" | "info" | "warn" | "ok" | "error";

/** The Tailwind classes each tone paints the badge with. Tokens live in `index.css`. */
const TONE_CLASS: Record<StateTone, string> = {
  neutral: "border-border bg-muted text-foreground",
  info: "border-transparent bg-state-info/15 text-state-info",
  warn: "border-transparent bg-state-warn/15 text-state-warn",
  ok: "border-transparent bg-state-ok/15 text-state-ok",
  error: "border-transparent bg-state-error/15 text-state-error",
};

/** The words a status is shown as. */
export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  waiting_input: "Waiting for a person",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  blocked: "Blocked",
};

/**
 * The tone of a run status. Running is informational, waiting for a person is a warning, completed is ok, and
 * failed and blocked are errors. Queued, starting and cancelled are neutral.
 *
 * @param status The run's status.
 */
export function toneOfStatus(status: RunStatus): StateTone {
  switch (status) {
    case "running":
      return "info";
    case "waiting_input":
      return "warn";
    case "completed":
      return "ok";
    case "failed":
    case "blocked":
      return "error";
    default:
      return "neutral";
  }
}

/** A run's status as a badge. The text is the status's name, so the colour is never the only signal. */
export function StatusBadge({ status }: { readonly status: RunStatus }): ReactElement {
  return (
    <Badge variant="outline" className={TONE_CLASS[toneOfStatus(status)]} data-status={status}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * A badge with a tone and a text, for notices and other state that is not a run status.
 *
 * @param props.tone The state colour.
 * @param props.children The text shown.
 */
export function ToneBadge({ tone, children }: { readonly tone: StateTone; readonly children: string }): ReactElement {
  return (
    <Badge variant="outline" className={TONE_CLASS[tone]}>
      {children}
    </Badge>
  );
}
