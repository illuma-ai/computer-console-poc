import { describe, expect, it, vi } from "vitest";
import { parseSegment } from "../src/replay/format";
import { clockText, frameIndexAt, lastPauseEndBefore, pauseAt, pauseLabel, seekMsForSeq, segmentIndexAt } from "../src/replay/model";
import { findPicture, loadRecording, loadSegment, readManifest } from "../src/replay/load";
import { ViewerError } from "../src/client/types";
import {
  binary,
  encodeSegment,
  FIXTURE_INDEX,
  FIXTURE_MANIFEST,
  fixtureBodies,
  fixtureFetcher,
  INDEX_URL,
  json,
  MANIFEST_URL,
  SEGMENT_0_URL,
} from "./replay-fixtures";

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof ViewerError ? err.code : "other";
  }
  return "resolved";
}

describe("parseSegment", () => {
  it("reads the frames of a segment in time order, with their bytes", () => {
    const segment = parseSegment(encodeSegment([{ tMs: 4_000, bytes: 5 }, { tMs: 0, bytes: 3 }]));
    expect(segment.format).toBe("jpeg-frames-v1");
    expect(segment.width).toBe(1280);
    expect(segment.height).toBe(800);
    expect(segment.frames.map((frame) => frame.tMs)).toEqual([0, 4_000]);
    expect(segment.frames.map((frame) => frame.jpeg.length)).toEqual([3, 5]);
    expect(segment.frames[0]!.jpeg[0]).toBe(0xff);
  });

  it("decodes the byte-exact layout the recorder writes: big-endian, one-byte name length", () => {
    // Header for 1280x800 (`CMR1`, length 14, `jpeg-frames-v1`, 0x0500 x 0x0320), then one record at t=0 of 3 bytes.
    const bytes = new Uint8Array([
      0x43, 0x4d, 0x52, 0x31, 0x0e, 0x6a, 0x70, 0x65, 0x67, 0x2d, 0x66, 0x72, 0x61, 0x6d, 0x65, 0x73, 0x2d, 0x76, 0x31,
      0x05, 0x00, 0x03, 0x20,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xff, 0xd8, 0xff,
    ]);
    const segment = parseSegment(bytes.buffer);
    expect(segment.format).toBe("jpeg-frames-v1");
    expect(segment.width).toBe(1280);
    expect(segment.height).toBe(800);
    expect(segment.frames).toHaveLength(1);
    expect(segment.frames[0]!.tMs).toBe(0);
    expect([...segment.frames[0]!.jpeg]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("writes the same header bytes as the recorder's example", () => {
    const header = new Uint8Array(encodeSegment([])).slice(0, 23);
    expect([...header]).toEqual([
      0x43, 0x4d, 0x52, 0x31, 0x0e, 0x6a, 0x70, 0x65, 0x67, 0x2d, 0x66, 0x72, 0x61, 0x6d, 0x65, 0x73, 0x2d, 0x76, 0x31,
      0x05, 0x00, 0x03, 0x20,
    ]);
  });

  it("reads a segment with no frames", () => {
    expect(parseSegment(encodeSegment([])).frames).toEqual([]);
  });

  it("keeps the complete frames of a segment whose last frame was cut short", () => {
    const whole = new Uint8Array(encodeSegment([{ tMs: 0, bytes: 3 }, { tMs: 1_000, bytes: 9 }]));
    const cut = whole.slice(0, whole.length - 4).buffer;
    const segment = parseSegment(cut);
    expect(segment.frames).toHaveLength(1);
    expect(segment.frames[0]!.tMs).toBe(0);
  });

  it("refuses bytes that do not start with the magic", () => {
    const bytes = new Uint8Array(encodeSegment([{ tMs: 0, bytes: 3 }]));
    bytes[0] = 0x58;
    expect(() => parseSegment(bytes.buffer)).toThrow(ViewerError);
    expect(() => parseSegment(new ArrayBuffer(2))).toThrow(ViewerError);
  });

  it("refuses a format it does not decode, rather than guessing", () => {
    try {
      parseSegment(encodeSegment([], { format: "h264-v9" }));
      expect.unreachable("a foreign format must be refused");
    } catch (err) {
      expect((err as ViewerError).code).toBe("unsupported_recording");
    }
  });
});

describe("the replay model", () => {
  it("finds the pause that holds a time, including its start and not its end", () => {
    expect(pauseAt(FIXTURE_MANIFEST.pauses, 19_999)).toBeUndefined();
    expect(pauseAt(FIXTURE_MANIFEST.pauses, 20_000)?.reason).toBe("takeover");
    expect(pauseAt(FIXTURE_MANIFEST.pauses, 24_999)?.reason).toBe("takeover");
    expect(pauseAt(FIXTURE_MANIFEST.pauses, 25_000)).toBeUndefined();
  });

  it("reports where the last finished pause ended, or 0 before any", () => {
    expect(lastPauseEndBefore(FIXTURE_MANIFEST.pauses, 10_000)).toBe(0);
    expect(lastPauseEndBefore(FIXTURE_MANIFEST.pauses, 26_000)).toBe(25_000);
  });

  it("finds the segment that starts at or before a time", () => {
    expect(segmentIndexAt(FIXTURE_MANIFEST.segments, 0)).toBe(0);
    expect(segmentIndexAt(FIXTURE_MANIFEST.segments, 29_999)).toBe(0);
    expect(segmentIndexAt(FIXTURE_MANIFEST.segments, 30_000)).toBe(1);
    expect(segmentIndexAt([], 0)).toBe(-1);
  });

  it("finds the last frame at or before a time, and none before the first", () => {
    const frames = encodeFrames([0, 1_000, 4_000]);
    expect(frameIndexAt(frames, -1)).toBe(-1);
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 3_999)).toBe(1);
    expect(frameIndexAt(frames, 4_000)).toBe(2);
    expect(frameIndexAt(frames, 99_000)).toBe(2);
  });

  it("seeks an event to the time of the last indexed event at or before it", () => {
    expect(seekMsForSeq(FIXTURE_INDEX, 5)).toBe(4_000);
    expect(seekMsForSeq(FIXTURE_INDEX, 7)).toBe(4_000);
    expect(seekMsForSeq(FIXTURE_INDEX, 0)).toBe(0);
    expect(seekMsForSeq([], 5)).toBe(0);
  });

  it("writes a clock as m:ss, or h:mm:ss from an hour", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(65_900)).toBe("1:05");
    expect(clockText(3_725_000)).toBe("1:02:05");
    expect(clockText(-5)).toBe("0:00");
  });

  it("names each pause in words, and a reason it does not know as a plain pause", () => {
    expect(pauseLabel("takeover")).toBe("A person took control");
    expect(pauseLabel("sensitive_input")).toBe("Sensitive input");
    expect(pauseLabel("something_new")).toBe("Recording paused");
  });
});

describe("findPicture", () => {
  it("shows a picture from the segment before when the segment at the time has none", async () => {
    const load = vi.fn(async (index: number) =>
      parseSegment(index === 0 ? encodeSegment([{ tMs: 0, bytes: 3 }, { tMs: 4_000, bytes: 5 }]) : encodeSegment([])),
    );
    const found = await findPicture(40_000, { ...FIXTURE_MANIFEST, pauses: [] }, load);
    expect(found).toEqual({ segment: 0, frame: 1 });
  });

  it("reports no picture when the last frame predates the end of a pause", async () => {
    const load = vi.fn(async () => parseSegment(encodeSegment([{ tMs: 0, bytes: 3 }, { tMs: 4_000, bytes: 5 }])));
    expect(await findPicture(26_000, FIXTURE_MANIFEST, load)).toBeNull();
  });

  it("reports no picture when no frame has started yet", async () => {
    const load = vi.fn(async () => parseSegment(encodeSegment([{ tMs: 2_000, bytes: 3 }])));
    expect(await findPicture(1_000, { ...FIXTURE_MANIFEST, segments: [FIXTURE_MANIFEST.segments[0]!] }, load)).toBeNull();
  });
});

describe("loadRecording", () => {
  it("reads the manifest and the index", async () => {
    const { fetcher, urls } = fixtureFetcher();
    const loaded = await loadRecording(fetcher, MANIFEST_URL);
    expect(loaded.manifest.duration_ms).toBe(60_000);
    expect(loaded.manifest.segments.map((segment) => segment.url)).toEqual([SEGMENT_0_URL, expect.any(String)]);
    expect(loaded.index).toEqual(FIXTURE_INDEX);
    expect(urls).toEqual([MANIFEST_URL, INDEX_URL]);
  });

  it("reports a run with no recording as not found", async () => {
    const { fetcher } = fixtureFetcher({});
    expect(await codeOf(loadRecording(fetcher, MANIFEST_URL))).toBe("not_found");
  });

  it("reports a manifest that cannot be reached without the URL", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch https://secret.example.test/x");
    });
    try {
      await loadRecording(fetcher as never, MANIFEST_URL);
      expect.unreachable("an unreachable manifest must fail");
    } catch (err) {
      expect((err as ViewerError).code).toBe("network");
      expect((err as ViewerError).message).not.toContain("secret.example.test");
    }
  });

  it("plays without an index when the index cannot be read", async () => {
    const { fetcher } = fixtureFetcher({ ...fixtureBodies(), [INDEX_URL]: () => binary(new ArrayBuffer(3)) });
    const loaded = await loadRecording(fetcher, MANIFEST_URL);
    expect(loaded.index).toEqual([]);
  });

  it("refuses a manifest whose segment has no window", () => {
    expect(() => readManifest({ segments: [{ url: SEGMENT_0_URL }] })).toThrow(ViewerError);
    expect(() => readManifest("not an object")).toThrow(ViewerError);
  });

  it("reads a manifest with no pauses or duration as empty and as the end of its last segment", () => {
    const manifest = readManifest({ segments: [{ url: SEGMENT_0_URL, from_ms: 0, to_ms: 9_000, size: 1 }] });
    expect(manifest.pauses).toEqual([]);
    expect(manifest.duration_ms).toBe(9_000);
  });
});

describe("loadSegment", () => {
  it("decodes a segment from its URL", async () => {
    const { fetcher } = fixtureFetcher();
    const segment = await loadSegment(fetcher, SEGMENT_0_URL);
    expect(segment.frames).toHaveLength(2);
  });

  it("refuses a segment that is not one", async () => {
    const { fetcher } = fixtureFetcher({ [SEGMENT_0_URL]: () => json({ not: "a segment" }) });
    expect(await codeOf(loadSegment(fetcher, SEGMENT_0_URL))).toBe("invalid_recording");
  });
});

/** The frames of a fixture segment built from times alone, for the model tests. */
function encodeFrames(times: readonly number[]): ReturnType<typeof parseSegment>["frames"] {
  return parseSegment(encodeSegment(times.map((tMs) => ({ tMs, bytes: 2 })))).frames;
}
