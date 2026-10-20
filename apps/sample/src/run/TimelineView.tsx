import type { ReactElement } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToneBadge } from "../components/StatusBadge";
import type { StateTone } from "../components/StatusBadge";
import type { NoticeEntry, TimelineEntry } from "./timeline";

/**
 * The run's timeline rows. Each kind of line has its own row: a message reply reads as text, a tool call is a
 * compact row, and a notice shows its kind as a label. A run's stop is a banner with its reason first.
 */

/** Props of {@link Timeline}. */
export interface TimelineProps {
  readonly entries: readonly TimelineEntry[];
  /** The final reply, once the run has completed. */
  readonly result: string | null;
}

/** The label each notice type is shown under. A type the sample does not name is shown as an event. */
export const NOTICE_LABEL: Readonly<Record<string, string>> = {
  "run.started": "Started",
  "run.progress": "Setup",
  "run.waiting_input": "Waiting",
  "run.input_answered": "Answer",
  "takeover.granted": "Take-over",
  "takeover.released": "Take-over",
  "tools.unavailable": "Tools",
  "tools.available": "Tools",
  "run.reminder": "Reminder",
  "checkpoint.saved": "Checkpoint",
  "checkpoint.failed": "Checkpoint",
  "computer.replaced": "Computer replaced",
  "computer.lifetime_capped": "Computer",
  "artifact.added": "Artifact",
  "artifact.collect_failed": "Artifact",
  "run.completed": "Completed",
  "run.failed": "Failed",
  "run.cancelled": "Cancelled",
  "run.blocked": "Blocked",
  "access.denied": "Access",
};

/** The label of a notice, by its event type. */
export function noticeLabel(type: string): string {
  return NOTICE_LABEL[type] ?? "Event";
}

/** The timeline, in the order the events arrived. */
export function Timeline({ entries, result }: TimelineProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Timeline" role="log" className="flex flex-col gap-2 text-sm">
        {entries.map((entry) => (
          <TimelineRow key={entry.key} entry={entry} />
        ))}
      </ol>
      {result !== null ? (
        <section aria-label="Result" className="flex flex-col gap-1 rounded-md border border-border p-3">
          <h2 className="text-xs font-medium text-muted-foreground">Result</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm">{result}</pre>
        </section>
      ) : null}
    </div>
  );
}

function TimelineRow({ entry }: { readonly entry: TimelineEntry }): ReactElement {
  switch (entry.kind) {
    case "message":
      return <li data-kind="message" className="whitespace-pre-wrap leading-relaxed">{entry.text}</li>;
    case "tool":
      return (
        <li data-kind="tool" className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">tool</span>
          <span className="text-foreground">{entry.title}</span>
          {entry.status ? <span>{entry.status}</span> : null}
        </li>
      );
    case "plan":
      return (
        <li data-kind="plan" className="text-xs text-muted-foreground">
          Plan: {entry.steps} {entry.steps === 1 ? "step" : "steps"}
        </li>
      );
    case "notice":
      return <NoticeRow notice={entry} />;
  }
}

/** A notice's row. A blocked run gets a banner: the reason is the first thing read. */
function NoticeRow({ notice }: { readonly notice: NoticeEntry }): ReactElement {
  if (notice.type === "run.blocked") {
    return (
      <li data-kind="notice" data-type={notice.type} className="list-none">
        <Alert variant="destructive" role="alert">
          <AlertTitle>Run blocked</AlertTitle>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      </li>
    );
  }
  return (
    <li data-kind="notice" data-type={notice.type} className="flex flex-wrap items-center gap-2">
      <ToneBadge tone={toneOf(notice.tone)}>{noticeLabel(notice.type)}</ToneBadge>
      <span>{notice.text}</span>
      {notice.detail ? <span className="text-xs text-muted-foreground">{notice.detail}</span> : null}
    </li>
  );
}

/** The badge tone for a notice tone. A blocked stop is shown as an error. */
export function toneOf(tone: NoticeEntry["tone"]): StateTone {
  switch (tone) {
    case "success":
      return "ok";
    case "warning":
      return "warn";
    case "error":
    case "blocked":
      return "error";
    default:
      return "neutral";
  }
}
