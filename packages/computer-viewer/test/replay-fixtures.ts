import { vi } from "vitest";
import type { FetchLike } from "../src/client/types";
import { CMR_FORMAT, CMR_MAGIC } from "../src/replay/format";
import type { RecordingManifest } from "../src/replay/load";

/*
 * Fixture recordings. Every URL and value says it is a fixture: the example.test host is reserved and no
 * test reaches it. A frame's JPEG bytes are a short run of the byte 0xff, so the frame's size identifies it.
 */

export const MANIFEST_URL = "https://console.example.test/api/runs/run-fixture/recording";
/** The index is beside the manifest, at `.../recording/index`. */
export const INDEX_URL = `${MANIFEST_URL}/index`;
export const SEGMENT_0_URL = "https://segments.example.test/recording/seg-0.cmr";
export const SEGMENT_1_URL = "https://segments.example.test/recording/seg-30000.cmr";

/** One frame of a fixture segment: its time from the segment's start, and its JPEG size in bytes. */
export interface FixtureFrame {
  readonly tMs: number;
  readonly bytes: number;
}

/**
 * Encodes a `.cmr` segment the way the format describes it: magic, a one-byte format name length, the name,
 * width, height, then records. All integers are big-endian. It is written from the layout in `docs/VIEWER.md`,
 * not from the parser, so the tests check both.
 */
export function encodeSegment(frames: readonly FixtureFrame[], options: { format?: string } = {}): ArrayBuffer {
  const format = new TextEncoder().encode(options.format ?? CMR_FORMAT);
  const records = frames.map((frame) => ({ tMs: frame.tMs, jpeg: new Uint8Array(frame.bytes).fill(0xff) }));
  const size = 4 + 1 + format.length + 4 + records.reduce((total, record) => total + 8 + record.jpeg.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(CMR_MAGIC), 0);
  view.setUint8(4, format.length);
  out.set(format, 5);
  let offset = 5 + format.length;
  view.setUint16(offset, 1280, false);
  view.setUint16(offset + 2, 800, false);
  offset += 4;
  for (const record of records) {
    view.setUint32(offset, record.tMs, false);
    view.setUint32(offset + 4, record.jpeg.length, false);
    out.set(record.jpeg, offset + 8);
    offset += 8 + record.jpeg.length;
  }
  return out.buffer;
}

/**
 * A recording of 60 s, with one segment per 30 s. The first segment has two pictures (at 0 s and 4 s);
 * the second has none, so its pictures are the first segment's. A take-over pauses 20 s to 25 s.
 */
export const FIXTURE_MANIFEST: RecordingManifest = {
  state: "stopped",
  duration_ms: 60_000,
  width: 1280,
  height: 800,
  segments: [
    { url: SEGMENT_0_URL, from_ms: 0, to_ms: 30_000, size: 0 },
    { url: SEGMENT_1_URL, from_ms: 30_000, to_ms: 60_000, size: 0 },
  ],
  pauses: [{ from_ms: 20_000, to_ms: 25_000, reason: "takeover" }],
};

/** The event index for the fixture: the run's first event, a tool call at 4 s, and the end at 26 s. */
export const FIXTURE_INDEX = [
  { seq: 1, type: "run.started", offset_ms: 0 },
  { seq: 5, type: "run.progress", offset_ms: 4_000 },
  { seq: 9, type: "run.completed", offset_ms: 26_000 },
];

/** The index body as the service sends it: its events, and whether it was cut at its limit. */
export function fixtureIndexBody(truncated = false): { events: typeof FIXTURE_INDEX; truncated: boolean } {
  return { events: FIXTURE_INDEX, truncated };
}

/** The bodies a fixture host serves, by URL. A missing URL answers 404. */
export function fixtureBodies(): Record<string, () => Response> {
  return {
    [MANIFEST_URL]: () => json(FIXTURE_MANIFEST),
    [INDEX_URL]: () => json(fixtureIndexBody()),
    [SEGMENT_0_URL]: () => binary(encodeSegment([{ tMs: 0, bytes: 3 }, { tMs: 4_000, bytes: 5 }])),
    [SEGMENT_1_URL]: () => binary(encodeSegment([])),
  };
}

/** A fetcher that serves the fixture bodies and records the URLs it was asked for. */
export function fixtureFetcher(bodies: Record<string, () => Response> = fixtureBodies()): {
  fetcher: FetchLike;
  urls: string[];
} {
  const urls: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const serve = bodies[url];
    return serve ? serve() : new Response(null, { status: 404 });
  });
  return { fetcher: fetcher as unknown as FetchLike, urls };
}

/** A JSON response with the given body. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A binary response with the given bytes. */
export function binary(bytes: ArrayBuffer): Response {
  return new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
}
