# Record and replay (phase 5d): design note

Status: **decided 2026-10-20** (section 10); build in progress. Parent plan: `docs/plans/enterprise-loop.md`, phase 5d.

## 0. Summary and recommendation

- Record **the screen as independent JPEG frames** (about 1 to 2 per second, only when the picture
  changed), taken by `computerd` from the local VNC feed it already reads. Reuse the existing
  encoder (`jpeg-encoder`, already a dependency); add no native library and no binary to the image.
- Group frames into **segments** (sealed every 60 s or 8 MiB), pulled by the manager and stored
  through the artifact store under a **hidden `recording/` prefix** of the run, so a lost computer
  keeps all but its last minute.
- The run service writes an **event index** (run event `seq`, `type`, offset in ms) beside the
  segments, so the console seeks from a timeline card to the picture.
- **Default off per agent definition**; when on, the screen is **paused during a take-over** and
  during the agent's own sensitive typing. Keystrokes are never recorded; only pixels are.
- Size: about 10 MB per hour for a mostly static screen, about 100 MB for a moderately active one,
  about 300 MB for a busy one. Stored, that is under $0.01 per recorded hour per month in every
  case. Size is not what decides this; simplicity, runtime reach and secret handling are.

## 1. What is recorded

**Screen.** The pixels of the desktop, 1280 x 800 in the default template (`CM_SCREEN_SIZE`). The
source is the RFB session `computerd` already opens to the loopback view-only server for
`screen_frame` (`screen_feed.rs`: handshake, Raw encoding, framebuffer, JPEG on change, at most 5
updates a second). Because it is supervisor-local, it works on every runtime, including ones
reached only through `POST /invocations` (SSE-only), with no WebSocket and no new port.

The recorder is a second consumer of the same frame pump, not a second VNC connection, so the
"at most two VNC connections per computer" rule in `screen_feed.rs` still holds. A running
recording counts as activity, so the pump's 60 s idle stop does not fire while recording.

**Event index.** The run service already stores every tool call, plan step, request and take-over
as a run event (`run_events`: `run_id`, `seq`, `type`, `data`, `at`). The index is a projection of
those: `[{ seq, type, offset_ms }]` where `offset_ms = event.at - recording.started_at`. It holds
no event `data` (no titles, arguments or output), so it carries nothing the timeline does not
already show. The console reads titles from the run's own events.

**Not recorded:** keystrokes, pointer events, process output, file contents, audio, clipboard.

**Clocks.** Frame times are the computer's clock; event times are the run service's. The manifest
stores `started_at` as measured by the run service at the `recording on` reply, so skew is
corrected to one round trip (well under a second). Playback tolerates the remainder; seeking lands
on the nearest frame at or before the event.

## 2. Encoding options compared

### Assumptions (stated so the owner can change them)

- Screen 1280 x 800 = 1.02 Mpx. Template: desktop with a browser and terminals.
- Activity profiles, in frames that actually change per hour at a 2 fps cap:
  **static** (agent waiting on a model, 1 change per 30 s: 120 frames/h);
  **moderate** (1 change per 3 s: 1,200 frames/h);
  **busy** (changes about half the time at the cap: 3,600 frames/h; 7,200 is the continuous ceiling).
- JPEG quality 60 to 70 on desktop text: 40 to 120 KB per 1280 x 800 frame; **80 KB** used below.
- Single-core CPU on a typical cloud vCPU. CPU numbers are estimates from published encoder
  speeds, **not measurements**; build phase 1 measures them on the real image before anything else
  is decided.
- S3 Standard at $0.023 per GB-month (verify at build time; region varies). PUT $0.005 per 1,000
  requests. Download $0.09 per GB over the internet.

### (a) Video (encoder binary in the image)

| Codec | Static MB/h | Busy MB/h (2 fps) | Busy MB/h (5 fps) | CPU at 2 fps | CPU at 5 fps | Notes |
|---|---|---|---|---|---|---|
| VP9 (libvpx, realtime) | 8 to 25 | 50 to 100 | 100 to 200 | 3 to 6% of a core | 8 to 15% | Open licence. Needs `ffmpeg` (about 80 MB with libs) |
| H.264 (x264, veryfast) | 10 to 30 | 70 to 140 | 140 to 280 | 2 to 5% | 6 to 12% | GPL build or patent-licence question for redistribution |
| AV1 (SVT-AV1) | 6 to 18 | 40 to 80 | 80 to 160 | 15 to 40% | 40 to 100% | Too heavy for small microVMs |

Costs beyond CPU: a child process per computer (100 to 250 MB of memory with look-ahead), an
encoder in every desktop image on every architecture (x86_64 and arm64), a codec in the browser
(VP9 and H.264 fine; segment-by-segment playback needs a keyframe at each segment start, which
costs bytes), and redaction is harder (a blurred or removed span breaks inter-frame references, so
the segment must be re-encoded).

### (b) Changed-frame snapshots (recommended)

Each stored frame is a complete JPEG, written only when the picture changed, at most every 500 ms.

| Profile | Frames/h | MB/h | CPU/h (JPEG about 10 ms/frame) |
|---|---|---|---|
| Static | 120 | **10** | 1 s |
| Moderate | 1,200 | **96** | 12 s |
| Busy (half the time at 2 fps) | 3,600 | **290** | 36 s (0.01 of a core) |
| Continuous 2 fps ceiling | 7,200 | 580 | 72 s (0.02 of a core) |

The encode is already done for the feed; a recording-only run adds the JPEG cost above and the
disk write. No process, no codec, no new dependency. Every frame stands alone, so:
seeking is a lookup; a lost or truncated segment loses only its own frames; a redacted frame is
simply deleted; playback is an `<img>` swap, which works in every browser.

Worse than video by 3 to 6 times on busy screens. Headroom if that ever matters: store only the
changed rectangle between periodic full frames (RFB already tells us the rectangles); expect 3 to
10 times smaller on typical UI changes. That is a later, additive format version (section 5), not
part of the first build.

### (c) Raw RFB update log replayed by the viewer

Log each server-to-client update (rectangles in Raw encoding, which `FEED_ENCODINGS` asks for),
compressed with zstd, plus a full framebuffer every 60 s so a viewer can seek.

| Profile | MB/h (compressed) | CPU/h |
|---|---|---|
| Static (cursor, clock) | 1 to 5 plus keyframes (60 x about 0.3 = 18) | seconds |
| Moderate | 100 to 300 | tens of seconds |
| Busy (scrolling, video-like) | 400 to 1,000+ (about 14 GB/h raw before zstd) | about 40 s |

Lossless and exact, but: Raw encoding makes busy screens huge; the viewer must carry an RFB
decoder and replay engine (a second implementation of the part of `rfb.rs` that applies rects);
and it records every intermediate pixel, including a password that is typed and cleared between
two JPEG frames, which (b) would never have captured. Rejected.

### S3 cost per recorded hour, stored one month

| Option, profile | MB/h | Storage per month | PUTs (60 per hour) |
|---|---|---|---|
| (b) static | 10 | $0.00023 | $0.0003 |
| (b) moderate | 96 | $0.0022 | $0.0003 |
| (b) busy | 290 | $0.0067 | $0.0003 |
| (a) VP9 busy, 2 fps | 75 | $0.0017 | $0.0003 |
| (c) busy | 700 | $0.016 | $0.0003 |

Fleet example, 100 agents x 8 recorded hours a day, 90-day retention: moderate profile 77 GB/day,
6.9 TB held, about **$160 a month**; busy profile 230 GB/day, 20.7 TB held, about **$480 a month**.
Watching a busy hour once costs about $0.03 in download. These are small next to model spend, which
is why the choice favours the simplest safe format. Per-day cost scales linearly with the
retention period, which is why retention is per agent (section 3).

### Decision

Recommend **(b)**, cap **2 fps**, JPEG quality 60, frames stored only when the picture changed.
The bytes are 3 to 6 times video on busy screens, which costs cents; in exchange there is no
codec to ship to two architectures, no child process, per-frame redaction, and a viewer that is an
image swap. The segment header carries a `format` field (`jpeg-frames-v1`) so a video segment
format can be added later without a contract change.

## 3. Storage

**Object layout.** Beside the artifacts, under the run's prefix, in a sibling folder:

```
<tenant or "_">/<run>/recording/seg-<first_frame_unix_ms>.cmr     one segment
<tenant or "_">/<run>/recording/index.json                          event index (written by the run service)
<tenant or "_">/<run>/recording/manifest.json                       written at finalize
```

(If the agent-platform layout adds an `<agent>` segment, `recording/` follows `checkpoints/` in
whatever it becomes; both are siblings of `artifacts/`.) The segment name carries the first frame's
time, so it is unique and sortable without any counter held anywhere: a replacement computer
continues the same run with no coordination (stateless manager).

**Segment format `.cmr` (v1).** Header: magic `CMR1`, `format` string, width, height. Then repeated
records: `t_ms` (u32, offset from the segment's first frame), `len` (u32), JPEG bytes. Documented
in the contract; about 30 lines to parse in a browser with `DataView`.

**Upload: pulled by the manager, in chunks.** `computerd` holds no store credentials (existing
rule for artifacts). It spools sealed segments to a local folder (cap 256 MiB, about 26 minutes of
busy screen) and the **manager pulls them**, the same way it collects files today: with open
egress via a short-lived link scoped to one object (direct, nothing through the manager), otherwise
relayed (segments are at most 8 MiB, inside the relay limit). The run service's worker, which is
already following the run, calls `flush` every 60 s and once more at run end with `final: true`
(seals the open segment). After a segment is stored, the manager tells `computerd` to delete it
(acknowledge). Uploading is idempotent per name and content, so a worker that dies mid-flush is
replaced and repeats it harmlessly.

A lost computer keeps everything up to its last flush: at most 60 s and one open segment are
lost. If the spool fills (the manager cannot reach the store), recording pauses with
reason `spool_full`; it never drops quietly.

**Hidden like checkpoints.** `GET /v1/artifacts?run_id=` lists only the `artifacts/` prefix, as
today, so recordings never appear among a run's files or in a bot's reply. They are reachable only
through the run service's recording route (section 6) and the `kind=recording` filter on the
artifact routes for operators.

**Retention.** Per agent definition (`recording.retention_days`, default 30, maximum the tenant's
`RUN_EVENT_RETENTION_DAYS` ceiling of 90 unless the tenant raises it). The run service sweeper (a
job on the existing queue) deletes `recording/` of runs older than the agent's retention, and a
bucket lifecycle rule on `*/recording/*` at the tenant maximum is the backstop, so a stuck sweeper
cannot keep recordings forever. `DELETE /v1/artifacts?run_id=` extended with `kind=recording`
serves erasure requests. Encrypted at rest by the bucket's default KMS encryption, like every
artifact.

**Access.** Exactly the run's: a caller who may read the run may read its recording, through links
minted fresh per request and never stored (contract rule for artifacts). No separate public route;
the view-token listener is not used, since the computer is usually gone at replay time.

## 4. Secrets

Pixels cannot be scanned for secrets, so the design avoids capturing them rather than finding them
later. Three cases.

**Keystrokes.** Never recorded; the recorder consumes the framebuffer, not `screen_input`.

**The agent's own secret typing.** A secret the agent types appears on screen only if the target
field shows it in plain text (a visible API-key field, a revealed password); password fields draw
dots. Policy: a `screen_input` text event may carry `sensitive: true` (additive). The run service
sets it whenever the text comes from a secret reference. `computerd` then **pauses recording from
before the event until 10 s after it** and discards frames in the window (no gap-fill), then
resumes. Blur is not offered: the field's position is unknown, so a correct blur would cover the
whole frame, which is a pause with extra steps. The 10 s hold covers the browser's reveal and
submit; a longer hold can be requested per event (`hold_s`, at most 60). A per-agent option
`recording.pause_on_text` (default false) pauses for every typed text event, for strict tenants.
The pause appears as a marker on the timeline (`recording.paused`, `reason: sensitive_input`),
never with the text.

Limit, stated plainly: a secret that appears on screen *without* the agent typing it (a page that
displays a token, a terminal that prints `env`) is recorded. Run-level controls (do not print
secrets; the egress and tool rules) remain the defence; recording does not weaken them but does
inherit their gaps. Recordings are as sensitive as the screen was.

**A person during take-over.** A person typing a code into a visible field (for example a
one-time code, or a password shown while typing) is recorded if the recording keeps running.

- Option 1: record through. Full audit; captures the person's credentials and any private content
  on screen.
- Option 2: pause during take-over. No audit pixels for that span; the audit trail (`takeover.granted`,
  `takeover.released`, holder, times) is already in the run events.
- Option 3: record but blur. Same flaw as above (no field geometry).

**Recommended default: option 2, pause for the whole take-over.** Reasons: the person is a
different data subject from the agent and has not agreed to be recorded; what they type is the
most likely place for a live credential or code; the audit need is met by events (who, when, how
long), and the files, processes and results after release are still visible; and failing closed is
cheap, since a missed span costs a gap in the replay and a recorded credential cannot be
un-recorded. A tenant that needs the pixels sets `recording.during_takeover: record` on the agent,
and the take-over card then states "this session is recorded" before the person starts.

**Enforcement is in the manager, not the harness.** When the manager mints a `mode: control` view
token for a computer whose recording is on, it first sets the recording to `paused`
(`reason: takeover`, `until` = the token's `expires_at`) and **only then returns the token**; if
the pause fails the token is not issued. `computerd` resumes by itself at `until`; the run service
resumes earlier on lease release. A crashed run service therefore leaves the recording paused, not
running (safe direction). Because the agent's own input goes through the key-protected API and a
person's goes through a view token, the manager can tell them apart; the supervisor cannot, and
need not.

## 5. Contract additions (all additive; `contract-change` skill applies)

Computer-manager (v1, no existing field changes):

| Addition | Shape |
|---|---|
| `PUT /v1/computers/{id}/recording` | `{ state: "on" \| "paused" \| "off", fps?: 1..2, reason?, until?, hold_s? }` → `Recording`. `on` starts or resumes; `paused` with optional `until` (auto-resume); `off` seals and stops |
| `GET /v1/computers/{id}/recording` | `Recording` = `{ state, started_at, frames, pending_segments, pending_bytes, paused_reason? }`; `state: "unavailable"` when the computer has no screen |
| `POST /v1/computers/{id}/recording/flush` | `{ final?: bool }` → `{ stored: n, bytes }`. Seals when `final`, uploads sealed segments, acknowledges them. Idempotent |
| `screen_input` text event | optional `sensitive: bool` and `hold_s` |
| Artifact | optional `kind: "artifact" \| "recording"` (default `artifact`); `GET /v1/artifacts` and `DELETE /v1/artifacts` accept `kind` (default `artifact`, so existing callers never see recordings) |
| Capabilities | per runtime `recording: bool` (true where a desktop screen and the artifact store exist). `unsupported` is returned otherwise; no fake recording |
| Error text | fixed messages only; no screen content or event data in any error |

Supervisor (`docs/SUPERVISOR.md`, the RPC envelope and REST): `recording` (control and status),
`recording_segments` (list sealed), `recording_read` and `recording_ack` (read bytes, then delete).
All ride the existing envelope, so they reach SSE-only runtimes.

Stop before building: confirm with the owner that the `PUT recording` shape, the `kind` filter
and the `sensitive` flag are acceptable v1 additions (project rule: stop and ask before touching
contract v1).

## 6. Run-service wiring and console playback

**Agent definition** gains `recording`: `{ mode: "off" | "on" (default off), required: bool
(default false), fps: 1..2 (default 2), retention_days: 1..90 (default 30), during_takeover:
"pause" | "record" (default pause), pause_on_text: bool (default false) }`.

**Run lifecycle.**

1. Start: after the computer is up and the template reports a screen, `PUT recording on`. If it
   is `unsupported` or fails: `required` fails the run before the prompt; otherwise the run
   continues with a `recording.unavailable` event.
2. Follow loop: `flush` every 60 s alongside saving the stream cursor.
3. Take-over: `lease` grant pauses via the manager (section 4); release resumes.
4. Typed secrets: the tool server sets `sensitive` on the text event.
5. End (completed, failed, cancelled, expired): `flush { final: true }`, then write `index.json`
   and `manifest.json` (segment list, frame count, `started_at`, duration, size, pause spans).
   A run whose computer vanished is finalized from the segments already stored.
6. Replacement computer (5e/6): `PUT recording on` again on the new computer; the manifest lists
   spans per computer.

**Run events** (additive to the run-service table): `recording.started`, `recording.paused
{ reason }`, `recording.resumed`, `recording.stopped { frames, bytes }`,
`recording.unavailable`. They draw the pause gaps on the timeline.

**Run-service route** `GET /v1/runs/{id}/recording` → `{ state, started_at, duration_ms, width,
height, segments: [{ url, from_ms, to_ms, size }], index_url, pauses: [{ from_ms, to_ms, reason }]
}`. Links are minted per request. `404 not_found` when the run has no recording; erasure removes it.

**Console playback beside the timeline** (viewer package, `@cm/computer-viewer`, new `Replay`
component): fetches the manifest, loads segments on demand (the one under the playhead plus the
next), draws the current frame into one `<img>`, and shows a scrubber with the pause gaps greyed
and labelled ("a person took control", "sensitive input"). Clicking a timeline event seeks to
`offset_ms`; playing advances the highlighted timeline card. Speed 1x/2x/4x and "skip static
spans" (jump between frames more than 5 s apart). Read-only: it needs no computer and no view
token, so it works after the computer is gone. Per `docs/VIEWER.md`, the client half goes in
`web/packages/computer-viewer`; the run page in the console embeds it.

## 7. Phased build plan

Estimates are focused engineering days for one implementer plus review; they exclude owner wait.

| Phase | Work | Days |
|---|---|---|
| 0 | Owner decisions (section 9); contract additions confirmed | 0.5 |
| 1 | **Measure** on the real desktop image on two runtimes: frame sizes, CPU and memory per hour at the three profiles; confirm JPEG q60 legibility; adjust section 2 numbers | 1 |
| 2 | `computerd`: recorder task on the frame pump, `.cmr` writer, spool and caps, pause/resume with `until`, sensitive hold, supervisor ops, unit tests with a fake VNC server (like the feed tests) | 4 |
| 3 | Manager: contract routes, `kind` on artifacts and store keys, flush and ack, relay and direct paths, pause-on-control-token, capabilities, conformance cases, docs, CHANGELOG | 4 |
| 4 | Run service: agent definition, lifecycle, flush loop, events, index and manifest, retention sweeper, erasure, `GET /v1/runs/{id}/recording` | 4 |
| 5 | Viewer `Replay` component and console run page, seek from timeline, pause gaps | 4 |
| 6 | Live test on every runtime (Docker, E2B, Lambda MicroVMs, AgentCore): record, kill the computer mid-run, take-over pause, secret hold, replay, erase; teardown verified clean | 3 |
| | **Total** | **about 20 days** |

Phases 2 and 3 can overlap after the contract is agreed; 5 can start once 3 is stubbed.

## 8. Risks and what we do about them

- **Estimates are not measurements.** Phase 1 exists to replace them; if frames run well above
  120 KB, lower quality or add the changed-rectangle format before phase 2 finishes.
- **A frame between two actions can show something brief.** At 2 fps a flash shorter than 500 ms
  may or may not appear; the recording is evidence of the screen, not a full log. Say so in the
  console.
- **The manager is down while the run continues.** Segments queue on the computer up to the spool
  cap, then recording pauses visibly. Nothing is kept on a manager disk.
- **Egress `none` computers.** Segments relay through the manager (8 MiB each). If the relay limit
  is smaller on some runtime, the segment cap drops to it; conformance tests assert it.
- **Legal and consent.** Recording people (take-over) is regulated in some regions; the default
  excludes them and the opt-in states the recording in the card.

## 9. Decisions needed from the owner

1. Format: changed-frame JPEG segments (recommended) or video (adds an encoder to the image).
2. Default: recording **off** unless the agent turns it on (recommended), and the default
   retention (30 days).
3. Take-over: **pause** by default (recommended) or record through.
4. Pause-on-sensitive-input: explicit flag plus a 10 s hold (recommended), with `pause_on_text`
   as the strict switch.
5. Contract additions in section 5 acceptable as v1 additions.
6. Whether `required: true` (fail the run when it cannot be recorded) should be allowed per
   agent, for tenants whose policy demands a record.

## 10. Decisions (2026-10-20)

The owner asked for development not to wait on reviews; the lead took the recommended options,
any of which the owner can change:
1. Format: changed-frame JPEG segments (`jpeg-frames-v1`), 2 fps cap, quality 60.
2. Default off per agent definition; retention 30 days by default, set per agent.
3. Take-over: recording pauses.
4. Sensitive input: explicit flag plus the 10 s hold; `pause_on_text` as the strict switch.
5. The section 5 contract additions are accepted as additive v1 changes.
6. `required: true` is allowed per agent definition (the run fails when it cannot be recorded).
Phase 1 (measurement) runs in the testing phase on the real image; the numbers in section 2 are
revised then.
