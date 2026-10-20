import type { ReactElement, ReactNode } from "react";
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
  /** Asks the replay to seek to a row's event. Without it, rows have no replay action. */
  readonly onSeek?: (seq: number) => void;
}

/** The label each notice type is shown under. A type the sample does not name is shown as an event. */
export const NOTICE_LABEL: Readonly<Record<string, string>> = {
  "run.started": "Started",
  "run.progress": "Setup",
  "run.waiting_input": "Waiting",
  "run.input_answered": "Answer",
  "request.answered": "Answer",
  "harness.started": "Harness",
  "computer.paused": "Computer",
  "computer.parked_deleted": "Computer",
  "computer.resumed": "Computer",
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
export function Timeline({ entries, result, onSeek }: TimelineProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Timeline" role="log" className="flex flex-col gap-2 text-sm">
        {entries.map((entry) => (
          <TimelineRow key={entry.key} entry={entry} onSeek={onSeek} />
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

/** The replay action of a row. Shown on hover or focus, so a long timeline stays quiet. */
function SeekButton({ entry, onSeek }: { readonly entry: TimelineEntry; readonly onSeek: (seq: number) => void }): ReactElement {
  return (
    <button
      type="button"
      className="ml-auto shrink-0 text-xs text-muted-foreground opacity-0 underline-offset-2 hover:underline focus-visible:opacity-100 group-hover:opacity-100"
      aria-label={`Replay from ${rowName(entry)}`}
      onClick={() => onSeek(entry.seq)}
    >
      Replay
    </button>
  );
}

/** The words a row is known by to a screen reader: the call's title, the notice's text, or the kind. */
function rowName(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "message":
      return "message";
    case "tool":
      return entry.title;
    case "plan":
      return "plan";
    case "notice":
      return entry.text;
  }
}

function TimelineRow({ entry, onSeek }: { readonly entry: TimelineEntry; readonly onSeek?: (seq: number) => void }): ReactElement {
  const seek = onSeek ? <SeekButton entry={entry} onSeek={onSeek} /> : null;
  switch (entry.kind) {
    case "message":
      return (
        <li data-kind="message" className="group flex gap-2 whitespace-pre-wrap leading-relaxed">
          <span className="min-w-0">{entry.text}</span>
          {seek}
        </li>
      );
    case "tool":
      return (
        <li data-kind="tool" className="group flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">tool</span>
          <span className="text-foreground">{entry.title}</span>
          {entry.status ? <span>{entry.status}</span> : null}
          {seek}
        </li>
      );
    case "plan":
      return (
        <li data-kind="plan" className="group flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Plan: {entry.steps} {entry.steps === 1 ? "step" : "steps"}
          </span>
          {seek}
        </li>
      );
    case "notice":
      return <NoticeRow notice={entry} seek={seek} />;
  }
}

/** A notice's row. A blocked run gets a banner: the reason is the first thing read. */
function NoticeRow({ notice, seek }: { readonly notice: NoticeEntry; readonly seek: ReactNode }): ReactElement {
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
    <li data-kind="notice" data-type={notice.type} className="group flex flex-wrap items-center gap-2">
      <ToneBadge tone={toneOf(notice.tone)}>{noticeLabel(notice.type)}</ToneBadge>
      <span>{notice.text}</span>
      {notice.detail ? <span className="text-xs text-muted-foreground">{notice.detail}</span> : null}
      {seek}
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
