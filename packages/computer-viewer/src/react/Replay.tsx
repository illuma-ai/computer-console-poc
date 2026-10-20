import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { toViewerError } from "../client/types";
import type { FetchLike } from "../client/types";
import type { CmrSegment } from "../replay/format";
import { findPicture, loadRecording, loadSegment } from "../replay/load";
import type { LoadedRecording, RecordingManifest } from "../replay/load";
import { clockText, pauseAt, pauseLabel, seekMsForSeq, segmentIndexAt } from "../replay/model";
import type { RecordingPause } from "../replay/model";

/** How often the playhead moves while playing. */
export const TICK_MS = 100;
/** Arrow keys move this far; Shift with an arrow moves the longer distance. */
export const SHORT_JUMP_MS = 5_000;
export const LONG_JUMP_MS = 30_000;
/** The playback speeds offered. */
export const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** Aspect ratio used until the manifest gives the screen's size. */
const DEFAULT_ASPECT = "16 / 10";

/**
 * A request to move the playhead. Give a new object for each request, so asking for the same event twice
 * still seeks: `{ seq }` seeks to the event with that sequence number, `{ ms }` to a time in the recording.
 */
export type ReplaySeek = { readonly seq: number } | { readonly ms: number };

/** Props of {@link Replay}. */
export interface ReplayProps {
  /** The run's manifest, `GET /v1/runs/{id}/recording`, as the host addresses it. */
  readonly manifestUrl: string;
  /**
   * Loads the manifest, the index and every segment. The host signs or routes the links it is given, and
   * the package adds no credential. Pass a stable function: a new one reloads the recording.
   */
  readonly fetcher: FetchLike;
  /** Moves the playhead. Nothing happens until the recording has loaded, then the request is applied. */
  readonly seek?: ReplaySeek | null;
}

/** Where the recording stands before the picture is drawn. */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly recording: LoadedRecording };

/** The picture on screen: a frame, nothing known at that time, or not yet decided. */
type Picture = { readonly kind: "loading" } | { readonly kind: "none" } | { readonly kind: "frame"; readonly url: string };

/** A segment as loaded: its decoded frames, and the object URL made for each frame shown so far. */
interface CachedSegment {
  readonly decoded: Promise<CmrSegment>;
  readonly urls: Map<number, string>;
}

/**
 * A replay of a run's recording: the screen as the run saw it, drawn one picture at a time into one image.
 * It starts paused, plays at 1x, 2x or 4x, and seeks by time (the scrubber), by event (`seek`) or by the
 * keyboard. A pause in the recording (a person took control, sensitive input) shows as a gap with its reason.
 *
 * Read-only: it needs no computer and no view token, so it works after the computer has gone.
 */
export function Replay({ manifestUrl, fetcher, seek }: ReplayProps): ReactElement {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [picture, setPicture] = useState<Picture>({ kind: "loading" });
  const [fault, setFault] = useState<string | null>(null);
  const cache = useRef(new Map<number, CachedSegment>());
  const request = useRef(0);

  const recording = load.kind === "ready" ? load.recording : null;
  const manifest: RecordingManifest | null = recording?.manifest ?? null;
  const duration = manifest?.duration_ms ?? 0;
  const gap: RecordingPause | undefined = manifest ? pauseAt(manifest.pauses, position) : undefined;

  // The manifest and the index, once per manifest URL. A failure is shown in place of the player.
  useEffect(() => {
    let active = true;
    setLoad({ kind: "loading" });
    setPosition(0);
    setPlaying(false);
    loadRecording(fetcher, manifestUrl).then(
      (loaded) => {
        if (active) setLoad({ kind: "ready", recording: loaded });
      },
      (err: unknown) => {
        if (!active) return;
        const viewerError = toViewerError(err);
        setLoad(viewerError.code === "not_found" ? { kind: "missing" } : { kind: "failed", message: viewerError.message });
      },
    );
    return () => {
      active = false;
    };
  }, [fetcher, manifestUrl]);

  // Frames of one recording are cached while it is on screen. Its object URLs are released when it changes.
  useEffect(() => {
    const cached = cache.current;
    return () => {
      for (const entry of cached.values()) for (const url of entry.urls.values()) URL.revokeObjectURL(url);
      cached.clear();
    };
  }, [recording]);

  // A seek request moves the playhead once the recording (and so its index) is known.
  useEffect(() => {
    if (!seek || !recording) return;
    const target = "ms" in seek ? seek.ms : seekMsForSeq(recording.index, seek.seq);
    setPosition(Math.min(Math.max(target, 0), recording.manifest.duration_ms));
  }, [seek, recording]);

  // While playing, the playhead advances by the real time that passed, scaled by the speed.
  useEffect(() => {
    if (!playing) return undefined;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      setPosition((prev) => Math.min(prev + elapsed * speed, duration));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, duration]);

  // Playback stops at the end of the recording.
  useEffect(() => {
    if (playing && position >= duration) setPlaying(false);
  }, [playing, position, duration]);

  // The picture follows the playhead. A pause shows its gap instead of a frame, so the frame drawn before the
  // pause is never shown over it. Segments are fetched on demand: the one at the playhead and the next.
  useEffect(() => {
    if (!recording) return undefined;
    const current = recording.manifest;
    const token = ++request.current;
    if (gap) return undefined;
    const segmentFrames = (index: number): Promise<CmrSegment> => {
      const existing = cache.current.get(index);
      if (existing) return existing.decoded;
      // A failed segment stays failed for this recording. The picture is checked on every tick, so a retry
      // here would request a broken link many times a second; the operator reloads the replay to try again.
      const decoded = loadSegment(fetcher, current.segments[index]!.url);
      cache.current.set(index, { decoded, urls: new Map() });
      return decoded;
    };

    findPicture(position, current, segmentFrames)
      .then(async (found) => {
        if (token !== request.current) return;
        const next = segmentIndexAt(current.segments, position);
        if (next + 1 < current.segments.length) segmentFrames(next + 1).catch(() => undefined);
        if (!found) {
          setPicture({ kind: "none" });
          return;
        }
        const entry = cache.current.get(found.segment);
        if (!entry) return;
        const decoded = await entry.decoded;
        if (token !== request.current) return;
        let url = entry.urls.get(found.frame);
        if (!url) {
          url = URL.createObjectURL(new Blob([decoded.frames[found.frame]!.jpeg.slice()], { type: "image/jpeg" }));
          entry.urls.set(found.frame, url);
        }
        setPicture({ kind: "frame", url });
        setFault(null);
        evictFar(cache.current, Math.min(found.segment, next), Math.max(found.segment, next));
      })
      .catch(() => {
        if (token !== request.current) return;
        setPicture({ kind: "none" });
        setFault("A recording segment could not be read");
      });
    return undefined;
  }, [fetcher, recording, position, gap]);

  /** Moves the playhead within the recording. */
  function jump(to: number): void {
    setPosition(Math.min(Math.max(to, 0), duration));
  }

  /** Space and k play or pause; arrows and Home and End move. Keys aimed at a control are left to it. */
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget || duration === 0) return;
    const long = event.shiftKey;
    const step = long ? LONG_JUMP_MS : SHORT_JUMP_MS;
    switch (event.key) {
      case " ":
      case "k":
        setPlaying((value) => !value);
        break;
      case "ArrowLeft":
        jump(position - step);
        break;
      case "ArrowRight":
        jump(position + step);
        break;
      case "Home":
        jump(0);
        break;
      case "End":
        jump(duration);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const aspect = manifest && manifest.width > 0 && manifest.height > 0 ? `${manifest.width} / ${manifest.height}` : DEFAULT_ASPECT;

  return (
    <section className="cv-replay" aria-label="Replay" tabIndex={0} onKeyDown={onKeyDown}>
      {load.kind === "loading" ? <p className="cv-status">Loading the recording</p> : null}
      {load.kind === "missing" ? <p className="cv-status">This run has no recording</p> : null}
      {load.kind === "failed" ? (
        <p className="cv-error" role="alert">
          {load.message}
        </p>
      ) : null}
      {manifest ? (
        <>
          <div className="cv-stage" style={{ aspectRatio: aspect }}>
            {gap ? (
              <p className="cv-status" role="status">
                {pauseLabel(gap.reason)}
              </p>
            ) : picture.kind === "frame" ? (
              <img className="cv-frame" src={picture.url} alt="Recording frame" />
            ) : (
              <p className="cv-status">{picture.kind === "loading" ? "Loading the picture" : "No picture at this time"}</p>
            )}
          </div>
          {fault ? (
            <p className="cv-error" role="alert">
              {fault}
            </p>
          ) : null}
          <div className="cv-row">
            <button type="button" className="cv-button" disabled={duration === 0} onClick={() => setPlaying((value) => !value)}>
              {playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              className="cv-scrub"
              aria-label="Replay position"
              aria-valuetext={clockText(position)}
              min={0}
              max={duration}
              step={TICK_MS}
              value={Math.round(position)}
              onChange={(event) => jump(Number(event.target.value))}
            />
            <span className="cv-clock">
              {clockText(position)} / {clockText(duration)}
            </span>
            <div role="group" aria-label="Speed" className="cv-row">
              {SPEEDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="cv-button"
                  aria-pressed={speed === option}
                  onClick={() => setSpeed(option)}
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>
          {recording?.indexTruncated ? (
            <p className="cv-status">The event index is cut short: an event after its last line seeks to that line.</p>
          ) : null}
          {manifest.pauses.length > 0 ? (
            <>
              <div className="cv-track" aria-hidden="true">
                {manifest.pauses.map((pause) => (
                  <span
                    key={`${pause.from_ms}-${pause.reason}`}
                    className="cv-gap"
                    title={pauseLabel(pause.reason)}
                    style={gapStyle(pause, duration)}
                  />
                ))}
              </div>
              <ul className="cv-gaps" aria-label="Paused spans">
                {manifest.pauses.map((pause) => (
                  <li key={`${pause.from_ms}-${pause.reason}`}>
                    {clockText(pause.from_ms)} to {clockText(pause.to_ms)}: {pauseLabel(pause.reason)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Where a pause sits on the scrubber, as percentages of the whole recording. */
function gapStyle(pause: RecordingPause, duration: number): { left: string; width: string } {
  if (duration <= 0) return { left: "0%", width: "0%" };
  const left = (Math.min(pause.from_ms, duration) / duration) * 100;
  const width = (Math.max(pause.to_ms - pause.from_ms, 0) / duration) * 100;
  return { left: `${left}%`, width: `${width}%` };
}

/**
 * Releases the frames of segments outside the window around the playhead, so a long recording holds only a
 * few segments in memory at a time.
 */
function evictFar(cache: Map<number, CachedSegment>, first: number, last: number): void {
  for (const [index, entry] of cache) {
    if (index >= first - 1 && index <= last + 1) continue;
    for (const url of entry.urls.values()) URL.revokeObjectURL(url);
    cache.delete(index);
  }
}
