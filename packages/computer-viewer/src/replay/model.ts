import type { CmrFrame } from "./format";

/**
 * Pure rules of the replay: where a time falls in the recording, which frame shows it and where an event
 * sits. No React and no network, so the rules are tested directly.
 */

/** A segment as the manifest lists it: its window on the recording's clock, in ms from the start. */
export interface RecordingSegment {
  readonly url: string;
  readonly from_ms: number;
  readonly to_ms: number;
  readonly size: number;
}

/** A span with no picture. `reason` is the server's word for why (`takeover`, `sensitive_input`, ...). */
export interface RecordingPause {
  readonly from_ms: number;
  readonly to_ms: number;
  readonly reason: string;
}

/** One line of the event index: a run event's sequence number and its time in the recording. */
export interface RecordingIndexEntry {
  readonly seq: number;
  readonly type: string;
  readonly offset_ms: number;
}

/** The pause span that holds `ms`, if any. A span includes its start and excludes its end. */
export function pauseAt(pauses: readonly RecordingPause[], ms: number): RecordingPause | undefined {
  return pauses.find((pause) => pause.from_ms <= ms && ms < pause.to_ms);
}

/** The end of the last pause that finished at or before `ms`, or 0. A picture older than this is stale. */
export function lastPauseEndBefore(pauses: readonly RecordingPause[], ms: number): number {
  let end = 0;
  for (const pause of pauses) if (pause.to_ms <= ms && pause.to_ms > end) end = pause.to_ms;
  return end;
}

/** The index of the last segment that starts at or before `ms`, or -1. Segments are in time order. */
export function segmentIndexAt(segments: readonly RecordingSegment[], ms: number): number {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i]!.from_ms <= ms) return i;
  }
  return -1;
}

/**
 * The index of the last frame that starts at or before `relMs` (relative to its segment), or -1. A frame
 * is shown until the next one starts, because only changed pictures are recorded.
 */
export function frameIndexAt(frames: readonly CmrFrame[], relMs: number): number {
  let low = 0;
  let high = frames.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (frames[mid]!.tMs <= relMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * The time to seek to for an event: the offset of the last indexed event at or before `seq`. An event the
 * index does not hold (it was not indexed, or it is before the first) seeks to the start of the nearest
 * earlier one, so the picture is never later than the event.
 *
 * @param index The event index, in sequence order.
 * @param seq The event's sequence number.
 */
export function seekMsForSeq(index: readonly RecordingIndexEntry[], seq: number): number {
  let target = 0;
  for (const entry of index) {
    if (entry.seq <= seq && entry.offset_ms > target) target = entry.offset_ms;
  }
  return target;
}

/** A clock for a time: `m:ss`, or `h:mm:ss` from an hour. Negative times read as 0. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The words shown for a pause span. A reason the viewer does not name reads as a plain pause. */
export function pauseLabel(reason: string): string {
  switch (reason) {
    case "takeover":
      return "A person took control";
    case "sensitive_input":
      return "Sensitive input";
    case "spool_full":
      return "Recording paused: storage full";
    default:
      return "Recording paused";
  }
}
