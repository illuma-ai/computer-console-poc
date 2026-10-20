# Lane notes: record and replay, phase 5 (replay in the viewer and the console)

## Done

- **Viewer package** (`packages/computer-viewer`):
  - `src/replay/format.ts`: reads `.cmr` version 1 segments (`jpeg-frames-v1`). A truncated last record is dropped; other formats are refused.
  - `src/replay/model.ts`: pure rules (pause at a time, frame at a time, event seek, clock text, pause labels).
  - `src/replay/load.ts`: loads the manifest, the optional index and segments through a caller-supplied fetcher, and finds the picture at a time. A picture from before the last pause is not shown.
  - `src/react/Replay.tsx`: the `Replay` component. One `<img>` swapped between object URLs, scrubber, Play/Pause, 1x/2x/4x, keyboard (Space or k, arrows ±5 s, Shift ±30 s, Home, End), pause gaps with reasons, seek by `{ seq }` or `{ ms }`. It starts paused and releases its URLs on leave.
  - Tests: `test/replay.test.ts`, `test/Replay.test.tsx`, with fixtures in `test/replay-fixtures.ts`, built from the documented layout.
  - Testing-library is added as devDependencies at the sample's pinned versions (16.3.3, 10.4.2, 14.6.7). The lockfile change is the workspace entry only.
- **Console** (`apps/sample`):
  - `RunApi.recordingUrl(runId)` returns `/api/runs/{id}/recording`, which the dev proxy maps to `/v1/runs/{id}/recording`.
  - The run view has a Replay tab. Each timeline row has a "Replay from …" action, shown on hover or focus, which opens the tab at that row's `seq`.
  - Tests cover the row action, the tab hand-off, and the `Replay` mock.
- **Docs**: `docs/VIEWER.md` (Replay section, format table, open points, pins) and `docs/CONSOLE.md` (run view, tests).

## Assumptions to confirm against the run service and computerd

These are not in this repository. The viewer reads them as written here. Change the viewer, the fixtures and VIEWER.md together if the service differs.

1. **`.cmr` byte layout.** All integers little-endian. The format name is `u16` length plus UTF-8. Width and height are `u16`. Each record is `u32 t_ms` plus `u32 len` plus JPEG. The design leaves these open.
2. **Index shape.** `index_url` returns a bare array of `{ seq, type, offset_ms }`. A wrapped object is not read.
3. **Manifest fields** are those of design section 6: `state`, `started_at`, `duration_ms`, `width`, `height`, `segments`, `pauses`, `index_url`. A missing `duration_ms` falls back to the last segment's end.
4. **Pause reasons** are `takeover`, `sensitive_input` and `spool_full`. Any other reason reads as "Recording paused".
5. **Segment links must be fetchable from the page.** Signed storage links need CORS for the console origin, or the run service serves them.

## Known gaps (not in the brief; next steps)

- **Recorder must write a frame when a pause ends.** Frames are written only on change, so after a take-over the picture shows nothing until the screen changes. This is the most important item for computerd (phase 2).
- **Skip static spans** (design section 6) is not built. Speeds are 1x, 2x and 4x only.
- **Playing does not highlight the timeline row** at the playhead (design section 6). Only seeking from a row is built.
- **Recording events are not drawn on the timeline.** `recording.started`, `recording.paused` and the rest are not folded by `timeline.ts`, so they are not shown, and the pauses appear only in the replay.
- **The Replay tab is always shown.** A run with no recording says "This run has no recording". Hiding the tab needs the run to say whether it was recorded.
- **A failed segment stays failed** for the life of the replay, so a broken link is requested once. A transient network error needs a page reload to retry.
- **The blocked banner has no replay action.** Blocked rows are a banner, not a row, so they are not seekable.

## Blockers

None.

## Gate

`npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build`: exit 0 from a clean install.
Tests: computer-viewer 76, sample 187, and the two other workspaces' suites all pass.
