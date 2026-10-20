import { ViewerError } from "../client/types";
import type { FetchLike } from "../client/types";
import { parseSegment } from "./format";
import type { CmrSegment } from "./format";
import { frameIndexAt, lastPauseEndBefore, segmentIndexAt } from "./model";
import type { RecordingIndexEntry, RecordingPause, RecordingSegment } from "./model";

/**
 * The recording as the run service describes it (`GET /v1/runs/{id}/recording`). Snake_case, as the wire
 * sends it. The span starts at zero, the run's first start, and `duration_ms` is its end. A segment's `url`
 * is `null` when the store cannot sign links, and then the recording cannot be played.
 */
export interface RecordingManifest {
  readonly state: string;
  readonly duration_ms: number;
  readonly width: number;
  readonly height: number;
  readonly segments: readonly RecordingSegment[];
  readonly pauses: readonly RecordingPause[];
}

/**
 * A recording the replay can play: its manifest, and its event index (empty when none could be read).
 * `indexTruncated` is set when the service cut the index, so seeking by a later event goes to the last one it holds.
 */
export interface LoadedRecording {
  readonly manifest: RecordingManifest;
  readonly index: readonly RecordingIndexEntry[];
  readonly indexTruncated: boolean;
}

/**
 * Loads the manifest and the event index. The index is `GET .../recording/index`, beside the manifest. It is
 * optional: a failed index leaves playback working and only disables seeking by event.
 *
 * @param fetcher The host's fetch. The manifest and every link go through it, so the host signs them.
 * @param manifestUrl The manifest's URL, as the host knows it. The index is at the same URL with `/index`.
 * @throws {ViewerError} `not_found` when the run has no recording, `network` when it cannot be reached,
 *   `invalid_recording` when the manifest is not readable.
 */
export async function loadRecording(fetcher: FetchLike, manifestUrl: string): Promise<LoadedRecording> {
  const manifest = readManifest(await readJson(fetcher, manifestUrl));
  const { index, truncated } = await loadIndex(fetcher, `${manifestUrl}/index`);
  return { manifest, index, indexTruncated: truncated };
}

/**
 * Loads and decodes one segment.
 *
 * @throws {ViewerError} as {@link loadRecording}, and `invalid_recording` or `unsupported_recording` for
 *   a segment that cannot be decoded.
 */
export async function loadSegment(fetcher: FetchLike, url: string | null): Promise<CmrSegment> {
  if (url === null) throw new ViewerError("unavailable", "This recording cannot be played: its links cannot be signed");
  const res = await get(fetcher, url);
  return parseSegment(await res.arrayBuffer());
}

/** One GET, with every failure turned into a fixed-text ViewerError. */
async function get(fetcher: FetchLike, url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, { method: "GET", cache: "no-store" });
  } catch {
    throw new ViewerError("network", "The recording could not be reached");
  }
  if (res.status === 404) throw new ViewerError("not_found", "This run has no recording", 404);
  if (!res.ok) throw new ViewerError("request_failed", "The recording could not be loaded", res.status);
  return res;
}

async function readJson(fetcher: FetchLike, url: string): Promise<unknown> {
  const res = await get(fetcher, url);
  try {
    return await res.json();
  } catch {
    throw new ViewerError("invalid_recording", "The recording manifest could not be read");
  }
}

/**
 * Reads the event index: `{ events: [{ seq, type, offset_ms }], truncated }`. A failed or unreadable one is
 * empty and not truncated, so playback still works and only seeking by event is lost.
 */
async function loadIndex(
  fetcher: FetchLike,
  url: string,
): Promise<{ readonly index: readonly RecordingIndexEntry[]; readonly truncated: boolean }> {
  try {
    const body = objectOf(await readJson(fetcher, url));
    const events: unknown = body?.["events"];
    if (!Array.isArray(events)) return { index: [], truncated: false };
    const index = events
      .filter((item): item is RecordingIndexEntry => typeof item?.seq === "number" && typeof item?.offset_ms === "number")
      .sort((a, b) => a.seq - b.seq);
    return { index, truncated: body?.["truncated"] === true };
  } catch {
    return { index: [], truncated: false };
  }
}

/**
 * Checks the shape the replay uses. Missing lists are read as empty; a segment without a window is refused,
 * because it cannot be placed on the timeline. A segment's `url` may be `null` (see {@link RecordingManifest}).
 */
export function readManifest(body: unknown): RecordingManifest {
  const invalid = (): ViewerError => new ViewerError("invalid_recording", "The recording manifest could not be read");
  const raw = objectOf(body);
  if (raw === undefined) throw invalid();
  const segments = raw["segments"] ?? [];
  const pauses = raw["pauses"] ?? [];
  if (!Array.isArray(segments) || !Array.isArray(pauses)) throw invalid();
  for (const segment of segments) {
    const s = segment as Partial<RecordingSegment>;
    if ((typeof s.url !== "string" && s.url !== null) || typeof s.from_ms !== "number" || typeof s.to_ms !== "number") {
      throw invalid();
    }
  }
  const ordered = [...(segments as RecordingSegment[])].sort((a, b) => a.from_ms - b.from_ms);
  const duration = raw["duration_ms"];
  return {
    state: typeof raw["state"] === "string" ? raw["state"] : "unknown",
    duration_ms: typeof duration === "number" ? duration : endOf(ordered),
    width: typeof raw["width"] === "number" ? raw["width"] : 0,
    height: typeof raw["height"] === "number" ? raw["height"] : 0,
    segments: ordered,
    pauses: pauses as RecordingPause[],
  };
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The end of the last segment, used when the manifest does not state a duration. */
function endOf(segments: readonly RecordingSegment[]): number {
  return segments.reduce((end, segment) => Math.max(end, segment.to_ms), 0);
}

/**
 * The frame that shows the picture at `ms`, as a segment index and a frame index. A frame is only recorded
 * when the picture changes, so the picture at a time is the last frame before it, which may sit in an
 * earlier segment. The screen was not recorded during a pause, so a frame from before the last pause ended
 * is not the picture: the walk back stops there and reports no picture.
 *
 * @param ms The time in the recording.
 * @param manifest The recording's manifest.
 * @param load Returns a segment by its index, loading it if needed.
 * @returns The segment and frame indexes, or null when no picture is known at that time.
 */
export async function findPicture(
  ms: number,
  manifest: RecordingManifest,
  load: (segment: number) => Promise<CmrSegment>,
): Promise<{ readonly segment: number; readonly frame: number } | null> {
  const floor = lastPauseEndBefore(manifest.pauses, ms);
  for (let i = segmentIndexAt(manifest.segments, ms); i >= 0; i -= 1) {
    const segment = manifest.segments[i]!;
    if (segment.to_ms <= floor) return null;
    const decoded = await load(i);
    const frame = frameIndexAt(decoded.frames, ms - segment.from_ms);
    if (frame < 0) continue;
    return segment.from_ms + decoded.frames[frame]!.tMs >= floor ? { segment: i, frame } : null;
  }
  return null;
}
