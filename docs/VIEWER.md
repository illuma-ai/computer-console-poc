# Computer viewer

The computer viewer lets a person watch a computer's screen, its processes and its files, and
(with a control session) use its screen. It is the viewer half of `docs/CONTRACT.md`, section
"Viewing a computer". The package does not define any route; it binds to the routes in that section.

Source: `web/` (npm workspaces, not pnpm). Packages and apps:

| Package | Path | Purpose |
|---|---|---|
| `@cm/computer-viewer` | `web/packages/computer-viewer` | The client (`.`) and the React 18 components (`./react`), with `./react/styles.css` |
| `@cm/viewer` | `web/apps/viewer` | The standalone page for channels that open a link |
| `@cm/sample` | `web/apps/sample` | A proof-of-concept host that uses only this package's public exports and the run API. See `docs/SAMPLE.md` |
| `otp-page` | `web/apps/otp-page` | The test sign-in page served beside the sample. See `docs/SAMPLE.md` |

The package never mints a token. The host obtains a view or control session from its own backend
(the manager's `POST /v1/computers/{id}/view`, called by a service that holds a manager key) and
passes it in.

## The session

```ts
interface ViewerSession {
  baseUrl: string;                       // the public viewer listener (CM_PUBLIC_BIND)
  token: string;                         // the view or control token, from the host
  mode: "view" | "control";
  transports: ("websocket" | "sse")[];   // the server's order of preference
  expiresAt: string;                     // ISO 8601, the contract's expires_at
}
```

The client validates the session when it is created and throws `invalid_request` for a missing
token, a base URL that is not http(s), an unknown mode, or an expiry that is not a time. Unknown
transports are dropped and duplicates removed.

The session is held in memory. When `expiresAt` passes, every stream and screen is closed and the
client emits `expired`; later calls fail with `expired`.

## Transports

| Transport | How | Input |
|---|---|---|
| `websocket` | `wss://…/view/v1/screen/ws`, noVNC (RFB) drawn into the container | noVNC sends input only in control mode; in view mode `viewOnly` is set |
| `sse` | `GET /view/v1/screen/frames` (fetch-streamed, `Authorization` header), JPEG frames drawn on a canvas | `POST /view/v1/screen/input` in control mode only |

**WebSocket.** Browsers cannot set headers on a WebSocket, so the client sends the token as the
first message. The server closes the socket if that message is not a valid token for this
computer. The token is sent before noVNC takes over the socket, so the RFB handshake is the first
thing noVNC sees after it. A socket that does not open, closes, or sends no bytes within 5 seconds
fails that attempt. A live socket that later drops is reported once (`status: closed` and an
`error` event); the client does not reconnect it.

**SSE.** Frames are drawn at the frame's size. Pointer positions are scaled from the displayed
canvas to the frame, and clamped to the frame. Input is coalesced over 16 ms and sent in batches of
at most 200 events, one call at a time, so events keep their order. Text goes through a hidden
text area, which takes the virtual keyboard's input on a phone. Named keys (Enter, arrows, and so
on) and key chords are sent as key events. A plain printable key is sent once, through the text
input. Pasted text is sent as text events of at most 1000 characters. The stream reconnects with
`Last-Event-ID` after it had opened, with backoff capped at 10 s.

**`auto`.** The candidates are the session's `transports`, in the session's order. A failed
WebSocket falls back to the next offered transport, and a `transport` event names the transport in
use. A transport the session did not offer is never tried: with `["websocket"]` only, a failing
socket is an error and no SSE request is made. When every candidate fails, `openScreen` rejects and
an `error` event is emitted. A session with no transports has no screen and `openScreen` rejects
with `unsupported`.

## Embedding

React (the package is React 18; `react` and `react-dom` are peers, `>=18.3.1 <19`):

```tsx
import { ComputerViewer } from "@cm/computer-viewer/react";
import "@cm/computer-viewer/react/styles.css";

<ComputerViewer
  session={session}                 // a new object starts a new client
  transport="auto"                  // "auto" | "websocket" | "sse"
  onTakeControl={() => takeControl()} // the host requests a control session and passes it as `session`
  onRelease={() => release()}
/>
```

The components are `ComputerViewer` (the whole viewer), and the parts it is made of: `Screen`,
`Terminal` (process list and the selected process's live output), `Files` (folder listing and
download, read-only) and `ControlBar` (mode, transport in use, Take control and Release). Use the
parts when a host wants a different layout. `Replay` plays a recording of a run's screen; see
"Replay" below.

Framework-free: `createViewerClient(session, { fetch?, WebSocket?, reconnectDelayMs? })` from
`@cm/computer-viewer`. It has `getSession()`, `listProcesses()`, `followProcess(pid, onEvent)`,
`listFiles(path)`, `downloadFile(path)`, `openScreen({ transport, container })` and `on(listener)`.
Events are `status` (`connecting`, `connected`, `reconnecting`, `closed`, `expired`), `transport`,
`error` and `expired`.

Standalone link (for a channel that opens a link): the page is `apps/viewer`, built to
`apps/viewer/dist`. The session travels in the URL fragment, which browsers never send to a
server:

```
https://<viewer host>/viewer/#token=<token>&base=<public listener URL>&mode=view&transports=websocket,sse&exp=<epoch seconds>
```

The page reads the fragment, removes it from the address bar and history at once (`replaceState`,
the path and query stay), then renders the viewer. The transport comes from the build-time setting
`VITE_VIEWER_TRANSPORT` (`auto` by default; an unknown value falls back to `auto`). A link without
`mode=control` shows no control buttons. A control link shows Release, which ends the page's session;
Take control needs a control session from the host, so the standalone page never shows it.

The contract's `viewer_url` is the link for this page. Where the page is hosted is a deployment
decision; the manager returns the link and does not serve the page.

## Replay

`Replay` plays a recording of a run's screen. It is read-only: it needs no computer and no view
token, so it works after the computer has gone.

```tsx
import { Replay } from "@cm/computer-viewer/react";

<Replay
  manifestUrl="/api/runs/run-1/recording"  // GET /v1/runs/{id}/recording, as the host addresses it
  fetcher={fetch}                           // loads the manifest, the index and every segment
  seek={{ seq: 5 }}                         // or { ms: 4000 }; a new object seeks again
/>
```

The fetcher is the host's. The package adds no credential, and it does not call the run API itself:
the manifest URL is the host's, and each link the manifest gives is fetched through the same
fetcher. Pass a stable function, because a new one reloads the recording.

**The manifest** (`GET /v1/runs/{id}/recording`, read first) has `state`, `started_at`,
`duration_ms`, `width`, `height`, `segments` (`[{ url, from_ms, to_ms, size }]`), `pauses`
(`[{ from_ms, to_ms, reason }]`) and an optional `index_url`. A `404` means the run has no recording.

**The event index** (`index_url`, read second) is an array of `{ seq, type, offset_ms }`, one per
run event. `seq` seeks to the last indexed event at or before it. Without an index, or when it
cannot be read, playback works and seeking by event goes to the start.

**Segments** are fetched when the playhead reaches them, with the next one fetched ahead. Only the
segments near the playhead stay in memory.

**Segment format `jpeg-frames-v1`** (`.cmr`, version 1). All integers are little-endian:

| Bytes | Field | Meaning |
|---|---|---|
| 4 | magic | `CMR1` |
| 2 + n | format | a `u16` length, then the UTF-8 name. Must be `jpeg-frames-v1`; any other name is refused |
| 4 | width, height | `u16` each |
| 8 + len, repeated | records | `t_ms` (`u32`, from the segment's first frame), `len` (`u32`), then `len` bytes of JPEG |

A record cut short at the end of a segment is dropped; the complete frames before it play. The
writer (computerd) must write this layout; the viewer's test fixtures are built from it.

**Playback.** The replay starts paused. Frames are written only when the picture changes, so each
frame is shown until the next one starts, and the picture at a time is the last frame before it,
which may sit in an earlier segment. The screen is one image, swapped as the playhead moves.

- **Pauses.** A span with a pause (a person took control, sensitive input) shows its reason in
  place of a picture, and the spans are listed below the scrubber. The screen is not recorded
  during a pause, so the picture from before it is not carried over: after a pause, no picture
  shows until the screen next changes.
- **Speed** is 1x, 2x or 4x.
- **Keyboard**, when the replay region has focus: Space or k plays and pauses; Left and Right move
  5 s (Shift with either, 30 s); Home and End go to the start and the end. The scrubber and the
  buttons are ordinary controls.
- **No autoplay.** Nothing plays until the operator presses Play, and the replay has no audio.

Frames are held in memory as object URLs. They are released when the replay is left or the
recording changes.

## Security rules

- The token lives in memory, in the `Authorization: Bearer` header of each request, and as the
  WebSocket's first message. It is never in a URL path or query, never in a log, and never written
  to storage. The package has no logging code at all.
- The standalone page takes the token from the fragment and clears the fragment before it renders.
- No input leaves the page in view mode: the SSE input element and its listeners are not created,
  and noVNC runs `viewOnly`. The server enforces the same rule: input needs a control token.
- Keystrokes and pixels are never logged or stored by the package.
- Error messages are fixed text (or the contract's message from the server). A network failure
  reports `network` with a fixed message, so the host name is not shown.
- Every stream and screen closes at expiry, and no request is made after it.
- The replay holds frames in memory only, as object URLs, and releases them when it is left.

## Mobile web view

Pointer events drive the SSE canvas, with `touch-action: none` so the page does not scroll under a
drag. The hidden text area receives the virtual keyboard. The WebSocket path uses noVNC's own touch
and gesture handling, which has not been checked on a device; the SSE path is the safer choice for a
phone until it has been. The layout has no fixed width and works at phone width.

## Open points

Things still open or deliberately left out.

- **Response shapes** are fixed in `docs/CONTRACT.md` ("Viewing a computer"). The client also
  tolerates bare arrays, which no server sends.
- **Server side.** The public listener (`CM_PUBLIC_BIND`) is not in the manager yet. Every test
  here runs offline against fakes, so this package has not been run against a live computer.
- **Input key names.** Named keys follow `docs/SUPERVISOR.md` ("Frames and input"). A key outside
  that list is not sent.
- **WebSocket reconnect.** A live WebSocket that drops is not reconnected. The host can re-open
  the screen with `openScreen` after `closed`.
- **Injection.** `createViewerClient` takes `fetch`, `WebSocket` and `reconnectDelayMs`. There is no
  `EventSource` option, because the SSE path is a fetch stream (it needs the header).
- **Replay links.** A segment or index link must be fetchable from the page: a signed storage link
  needs CORS for the page's origin, or the run service must serve the segments itself.
- **Frame at resume.** After a pause the picture is unknown until the screen next changes. The
  recorder should write a frame when a pause ends, so the picture shows straight away.
- **Not in the replay.** Skipping static spans, audio, and speeds beyond 4x.

## Dependencies

Exact versions, no ranges (`web/package.json`, `web/packages/computer-viewer/package.json`):

| Package | Version | Why |
|---|---|---|
| `@novnc/novnc` | 1.7.0 | The VNC client for the WebSocket transport. Released 2026-04-28, ESM (`"type": "module"`, `exports` to `core/rfb.js`, default export `RFB`). It ships no types, so `src/client/novnc.d.ts` types the few members used |
| `react`, `react-dom`, `@types/react`, `@types/react-dom` | 18.3.1, 18.3.1, 18.3.31, 18.3.7 | React 18, as the components are specified |
| `typescript` | 7.0.2 | Compiler |
| `vite`, `@vitejs/plugin-react` | 8.3.2, 6.1.2 | The standalone page |
| `vitest`, `jsdom` | 5.0.3, 30.1.2 | Tests |
| `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` | 16.3.3, 10.4.2, 14.6.7 | Tests of the React components (the same pins as the sample app) |

The peer range for React is `>=18.3.1 <19`, so a host can take a later 18.x patch.

## Tests

From `web/`:

```
npm install     # once
npm run typecheck
npm test        # offline: fake fetch, fake WebSocket, noVNC double, jsdom
npm run build
npm run lint    # tsc with unused-code and return-path checks
```

The replay's tests (`test/replay.test.ts`, `test/Replay.test.tsx`) run on fixture recordings that
`test/replay-fixtures.ts` encodes from the layout above, so a change to the format fails them.

Tests never reach the network. `packages/computer-viewer/test/setup.ts` replaces noVNC with a
double, so no real canvas, ResizeObserver or server is needed.
