# Lane notes: record and replay, phase 5 (replay in the viewer and the console)

## Done

Phase 5 (replay in the viewer and the console), then the API alignment to the run service's documentation.

- **Viewer package** (`packages/computer-viewer`):
  - `src/replay/format.ts`: reads `.cmr` version 1 segments (`jpeg-frames-v1`), big-endian, as computerd writes them.
  - `src/replay/model.ts`: pure rules (pause at a time, frame at a time, event seek, clock text, pause labels).
    Pause labels follow the documented reasons: `takeover` is named, any other reason is a plain pause.
  - `src/replay/load.ts`: loads the manifest, then the index at `<manifest URL>/index`, then segments through a
    caller-supplied fetcher. The index is `{ events, truncated }`. A segment whose `url` is `null` (a store that
    cannot sign links) cannot be loaded and reports `unavailable`.
  - `src/react/Replay.tsx`: the `Replay` component. It says when the event index was cut short.
  - Tests: `test/replay.test.ts`, `test/Replay.test.tsx`, fixtures in `test/replay-fixtures.ts`.
- **Console** (`apps/sample`):
  - `RunApi.recordingUrl(runId)` returns `/api/runs/{id}/recording`, which the dev proxy maps to `/v1/runs/{id}/recording`.
  - The run view has a Replay tab. Each timeline row has a "Replay from ..." action that opens the tab at that row's `seq`.
  - Timeline rows for `recording.started`, `recording.paused`, `recording.resumed`, `recording.stopped` (detail: its
    reason) and `recording.unavailable` (warning, detail: its code). `src/run/timeline.ts`.
  - Agent definitions: `recording` is one object `{ mode, required, fps, retention_days, pause_on_text }`, replaced
    whole on each write (`src/api/types.ts`, `src/agents/agentForm.ts`). The form holds a `RecordingDraft` or `null`.
    `null` means nobody set it and the loaded definition had none, and then the key is left out of the write. A
    changed setting or a loaded object sends all five keys. The sheet has a Frames a second select (1 or 2).
  - Tests: `test/agents/agentForm.test.ts`, `test/agents/AgentSheet.test.tsx`, `test/run/timeline.test.ts`.
- **Docs**: `docs/VIEWER.md` (Replay section, format table, open points) and `docs/CONSOLE.md` (run view, agent sheet).

## Assumptions to confirm against the run service and computerd

The service's documentation names the concepts and the routes, but not every field. These names are the viewer's and
the console's guesses. Change them in the code, the fixtures and the docs together if the service differs.

1. **`.cmr` byte layout.** The recorder's documented layout: big-endian integers, `u8` format name length, `u16` width
   and height, records of `u32 t_ms`, `u32 len`, then JPEG. Confirm against computerd's writer.
2. **Manifest fields.** `state`, `duration_ms` (the span's end, zero being the first start), `segments`
   (`{ url, from_ms, to_ms, size }`), `pauses` (`{ from_ms, to_ms, reason }`). `width` and `height` are read when
   present. `started_at` and `index_url` are no longer read: the index is at `.../recording/index`.
3. **Index shape.** `{ events: [{ seq, type, offset_ms }], truncated }`. The 10,000-event cut is said by `truncated`.
   The docs say "says so" but not how.
4. **Event data names.** `recording.paused` and `recording.stopped` carry `reason`; `recording.unavailable` carries `code`.
5. **Segment links must be fetchable from the page.** Signed storage links need CORS for the console origin, or the run
   service serves them.
6. **Fields the service may not send.** Agent `recording` is read as an object when present; the form shows the defaults
   when it is absent. Retention has a minimum of 1 in the form; the maximum is `RUN_RECORDING_RETENTION_MAX_DAYS`, which
   the console does not know, so the service states it.

## Known gaps (not in the brief; next steps)

- **Recorder must write a frame when a pause ends.** Frames are written only on change, so after a take-over the picture
  shows nothing until the screen changes.
- **Skip static spans** is not built. Speeds are 1x, 2x and 4x only.
- **Playing does not highlight the timeline row** at the playhead. Only seeking from a row is built.
- **The Replay tab is always shown.** A run with no recording says "This run has no recording". Hiding the tab needs the
  run to say whether it was recorded.
- **A failed segment stays failed** for the life of the replay, so a broken link is requested once.
- **The blocked banner has no replay action.** Blocked rows are a banner, not a row, so they are not seekable.
- **`pause_on_text` is stored, not enforced.** The service does not send text into the computer, so nothing sets
  `sensitive` events yet. The form keeps the switch so the stored value round-trips.
- **Erasure has no button.** `DELETE /v1/runs/{id}/recording` is not called from the console.

## Blockers

None.

## Gate

`npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build`: exit 0 from a clean install.
Tests: computer-viewer 83, sample 199, and the two other workspaces (5 and 6) all pass.
