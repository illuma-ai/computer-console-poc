import { ViewerError } from "../client/types";

/**
 * The recording segment format this viewer reads, `.cmr` version 1 (`docs/VIEWER.md`, "Replay").
 *
 * Layout, all integers big-endian (the recorder in computerd writes exactly this):
 * - `CMR1` (4 bytes, ASCII)
 * - the format name: one `u8` byte length N, then N UTF-8 bytes. Must be `jpeg-frames-v1` (N = 14).
 * - `width` and `height`: `u16` each.
 * - then records to the end of the segment: `t_ms` (`u32`, offset from the segment's first frame),
 *   `len` (`u32`), and `len` bytes of JPEG.
 */

/** The magic at the start of every segment. */
export const CMR_MAGIC = "CMR1";

/** The one format name this viewer decodes. A newer format is refused, not guessed at. */
export const CMR_FORMAT = "jpeg-frames-v1";

/** One picture of the screen: when it starts, relative to its segment, and the JPEG bytes. */
export interface CmrFrame {
  readonly tMs: number;
  readonly jpeg: Uint8Array;
}

/** A decoded segment. Frames are in time order. */
export interface CmrSegment {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly CmrFrame[];
}

const MAGIC_AND_LENGTH_BYTES = 5;
const RECORD_HEADER_BYTES = 8;

/**
 * Reads a segment. A record cut short at the end (a segment whose upload was interrupted) is dropped and
 * every complete frame before it is kept, so a damaged tail loses only its own frames.
 *
 * @param bytes The segment's bytes, as the server sent them.
 * @throws {ViewerError} `invalid_recording` when the bytes are not a segment, and
 *   `unsupported_recording` when the format is not `jpeg-frames-v1`.
 */
export function parseSegment(bytes: ArrayBuffer): CmrSegment {
  const invalid = (): ViewerError => new ViewerError("invalid_recording", "The recording segment could not be read");
  if (bytes.byteLength < MAGIC_AND_LENGTH_BYTES) throw invalid();
  const view = new DataView(bytes);
  const decoder = new TextDecoder();
  if (decoder.decode(new Uint8Array(bytes, 0, 4)) !== CMR_MAGIC) throw invalid();

  const formatLength = view.getUint8(4);
  let offset = MAGIC_AND_LENGTH_BYTES;
  if (offset + formatLength + 4 > bytes.byteLength) throw invalid();
  const format = decoder.decode(new Uint8Array(bytes, offset, formatLength));
  offset += formatLength;
  if (format !== CMR_FORMAT) throw new ViewerError("unsupported_recording", "The recording format is not supported");
  const width = view.getUint16(offset, false);
  const height = view.getUint16(offset + 2, false);
  offset += 4;

  const frames: CmrFrame[] = [];
  while (offset + RECORD_HEADER_BYTES <= bytes.byteLength) {
    const tMs = view.getUint32(offset, false);
    const length = view.getUint32(offset + 4, false);
    offset += RECORD_HEADER_BYTES;
    if (offset + length > bytes.byteLength) break;
    frames.push({ tMs, jpeg: new Uint8Array(bytes, offset, length) });
    offset += length;
  }
  // Frames are written in time order; sorting keeps the lookup correct if a writer ever batches out of order.
  frames.sort((a, b) => a.tMs - b.tMs);
  return { format, width, height, frames };
}
