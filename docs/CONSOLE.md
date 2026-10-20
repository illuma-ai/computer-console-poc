# Sample app (proof of concept)

`web/apps/sample` is a plain host for the computer viewer. It proves that the viewer package
(`@cm/computer-viewer`) and the run API's documented routes are enough to build an operator console. The app
imports only the viewer's public entry points, calls only the run API and the agent registry, holds no
long-lived secret and runs no orchestration of its own.

`web/apps/otp-page` is a test sign-in page served beside it, so a run can ask a person to sign in through the
viewer without any outside site.

## Screens

The left navigation has three screens. Each is addressed by its hash, so a reload or a shared link lands on it.

- **Agents** (`#/agents`). The agent definitions, from `GET /v1/agents`. "New agent" starts blank;
  "New from template" starts from a template in the catalog. A row opens its agent in a sheet. The sheet holds
  the name, description, instructions, model, runtime, template, egress, timeout, max wait, take-over allowed,
  allowed channels, setup commands, ready check, a Recording section (record the screen, retention in days,
  recording required, pause on typed text) and the tools. Saving validates first and shows each problem
  under its field. "Disable agent" turns an enabled agent off.
  A recording setting is sent only when the person sets it or the saved definition has it, and the form shows
  its default (off, 30 days) until then, so a service that predates recording still accepts the write.
- **Runs** (`#/runs`). The runs, newest first: status, run id, agent, runtime, started and duration. A status
  filter asks the service for that status. The first page refreshes every five seconds (paused while the page is
  hidden); "Load more" follows the service's cursor. "New run" opens a dialog: pick an agent (the first enabled
  agent is chosen to begin with), pick a scenario (it fills the prompt) or write one, then Start run. The button says
  why it is off.
- **Run** (`#/runs/{id}`). The run's event stream from the start, resumed with `Last-Event-ID` after a drop. The
  header shows the run id, its status and the agent's name (the agent's id on hover, or the id when the agent is
  not in the registry).
  Open requests are pinned at the top: a take-over (Take control, then Done or Can't do it), an approval (its
  options) or a question (its options and a text answer). Only requests still open are shown: once the run's status
  is completed, failed, cancelled or blocked, every request is closed. Below them, a Timeline (message replies as text,
  tool calls as compact rows, plans, and a row per kind of notice: checkpoint, computer replaced, tools,
  reminder, blocked, failed and errors; a blocked run shows its reason in a banner), an Artifacts tab with
  signed download links, and a Replay tab. Steer sends a message to a live run. Cancel run ends it.
  Each timeline row has a Replay action (it appears on hover or focus) that opens the Replay tab at that row's
  event. The Replay tab plays the run's recording: pick Play, or seek with the scrubber, the keyboard or a row.
  Pauses in the recording (a take-over, sensitive input) show as gaps with their reason. A run with no recording
  says so. The viewer's Replay component is described in `docs/VIEWER.md`.
- **Settings** (`#/settings`). The colour theme (system, light or dark; kept in this browser) and the endpoints
  the page uses (run API, agent registry, viewer origin and screen transport). The endpoints come from the build
  and the dev server, so they are shown, not edited.

The computer pane sits beside the run. It is view-only while the run is live. A take-over the person holds swaps
in a control session; when the take-over ends, the pane goes back to view. Once the run has ended, or the
service answers 409 or 410, the pane says the computer has ended and points at Artifacts.

Colour carries state only: a run's status and a notice's tone use the state tokens in `src/index.css`. Everything
else is monochrome, in light and dark.

## Catalogs

The tool list, the agent templates and the scenarios are JSON files in `web/apps/sample/src/catalog/`. Each
file is validated when the app loads. A bad entry stops the app with a message that names the file and the
entry (for example `templates.json: entry "desk": names unknown tools: nope`), so a broken catalog is found at
build time, not in front of an operator.

Ids must be non-empty and unique within their file.

### Add a tool (`tools.json`)

A tool is an MCP server an agent can add. The catalog never holds env values; it names the env variables only,
and the operator enters their values in the agent sheet.

```json
{
  "id": "docs",
  "name": "Docs (read-only)",
  "description": "Searches the team's documentation.",
  "server": { "name": "docs", "command": "docs-mcp", "args": ["--read-only"], "env": [{ "name": "DOCS_TOKEN" }] },
  "tools": "indexed"
}
```

- `tools` is the default listing mode: `full` (every tool is listed to the model) or `indexed` (listed by index).
- `server.env` lists names only. An entry with a `value` is refused at load.

### Add a template (`templates.json`)

A template is a starting point for "New from template". Its `tools` are tool ids from `tools.json`; an unknown
id is refused at load.

```json
{
  "id": "desk",
  "name": "Desk agent",
  "description": "Works in files on a desktop computer.",
  "agent": {
    "description": "Works in files.",
    "instructions": "Do the task in the workspace. Leave every deliverable in /home/user/outbox.",
    "model": null,
    "computer": { "runtime": "docker", "template": "agent-computer", "egress": "none", "timeout_s": 3600 },
    "max_wait_s": 1800,
    "takeover_allowed": false,
    "allowed_channels": ["api"],
    "setup_commands": [],
    "ready_check": null,
    "tools": ["docs"]
  }
}
```

The runtime must be one the form offers: `docker`, `e2b`, `agentcore` or `lambda`.

### Add a scenario (`scenarios.json`)

A scenario is a preset prompt the New run dialog offers.

```json
{
  "id": "files-report",
  "title": "Files and report",
  "prompt": "Create two CSV files of sample sales figures and write report.md comparing them."
}
```

The title is what the operator sees; the prompt is what the agent receives. Source identifiers stay generic
(the sign-in scenario is `sign-in-code-host`, titled "Sign in to GitHub").

## Run it

Prerequisites: Node 24, `npm install` once from `web/`.

1. Start the run service with runs enabled and `RUN_TOKEN_SECRETS` set. Its first secret signs tokens, so use
   the same value as `SAMPLE_RUN_TOKEN_SECRET`.
2. Start the manager (`docs/setup/manager.md`). For the viewer, set `CM_PUBLIC_BIND`, `CM_PUBLIC_URL` and
   `CM_VIEWER_URL` as that page describes, and give the run service its manager key.
3. Start the test sign-in page on port 8399, reachable from a Docker computer:

   ```
   OTP_CODE=424242 npm -w otp-page run serve
   ```

   It binds to `0.0.0.0`. A computer on Docker reaches it at `http://host.docker.internal:8399/`.
4. Start the sample:

   ```
   SAMPLE_RUN_SERVICE_URL=http://localhost:3000 \
   SAMPLE_RUN_TOKEN_SECRET=<the run service's first secret> \
   SAMPLE_VIEWER_BASE_URL=http://localhost:<manager public listener port> \
   npm -w @cm/sample run dev
   ```

   Open `http://localhost:5173/`. To create agents, add `SAMPLE_ROLE=admin` to the same settings. Settings can
   also go in `web/apps/sample/.env.local`, which is gitignored; `web/apps/sample/.env.example` lists them with
   placeholders.

## How the calls are made

- The browser calls `/api/runs/...` and `/api/agents/...` on the dev server only. The dev server rewrites them to
  the run service's `/v1/runs/...` and `/v1/agents/...` (Vite `server.proxy`). The two mounts are one list
  (`API_MOUNTS` in `dev/run-token-plugin.ts`), so the signing and the proxy cover the same paths.
- A Node dev middleware (`dev/run-token-plugin.ts`, a Vite `configureServer` hook) signs an HS256 service token
  for each proxied request and sets it as the `Authorization` header. It overwrites any header the browser sent.
  The format is the run service's token, re-implemented here so this repository does not import another one.
- A fresh token is minted per request because the run service spends a token's `jti` on every write.
- The secret stays in the dev server process. It is never in the browser bundle, a URL, a query string or a log
  line.
- The viewer's own calls (`/view/v1/...`) go to the manager's public listener through the `/view` proxy. They
  carry the viewer token, which the run service returns, not a run token.

## Environment variables

| Variable | Read by | Default | Meaning |
|---|---|---|---|
| `SAMPLE_RUN_SERVICE_URL` | dev server | required | Run service base URL (http or https, no path). |
| `SAMPLE_RUN_TOKEN_SECRET` | dev server | required | Signs the run service's tokens. Never sent to the browser. |
| `SAMPLE_ISSUER` | dev server | `sample-app` | The token's `iss` claim. |
| `SAMPLE_USER` | dev server | `sample-user` | The token's `sub` claim: the caller the runs belong to. |
| `SAMPLE_TENANT` | dev server | `sample-tenant` | The token's `tenant` claim. Must match the tenant the runs use. |
| `SAMPLE_TEAM` | dev server | empty | One team name for the token's `team` claim. Empty means no team. |
| `SAMPLE_ROLE` | dev server | empty | `admin` adds the `role: admin` claim, so the developer can create agents. Any other value stops the dev server. |
| `SAMPLE_TOKEN_TTL_S` | dev server | `120` | Lifetime of each minted token, 1 to 600 seconds. |
| `SAMPLE_VIEWER_BASE_URL` | dev server | unset | The manager's public viewing listener. When set, `/view` is proxied there. |
| `VITE_VIEWER_TRANSPORT` | browser build | `auto` | Screen transport: `auto`, `websocket` or `sse`. An unknown value falls back to `auto`. |
| `OTP_CODE` | otp-page build | `424242` | The one-time code the test sign-in page accepts. Baked in at build time. |

A missing or malformed required variable stops the dev server at start, and the message names the variable, never
its value.

## The test sign-in page

`npm -w otp-page run serve` builds the page with `OTP_CODE` and serves it on port 8399.

- The form has a username (prefilled `tester`), a one-time code and a Submit button.
- A correct code shows "Signed in" and a green banner with the text `SIGNED-IN-OK`. The banner is added only after
  a correct code, so the text is not in the page before sign-in.
- Any other code shows "Wrong code".
- The page makes no network calls.

## Known differences from the run API

These are where the sample is shaped by the service as it is today.

- **The run takes only the agent id and the prompt.** The create route accepts `agent_id`, `prompt`, `team` and
  `origin`, and refuses other fields. The agent's settings are read by the service from the agent it names.
- **No allowed runtime or model list.** The run API does not list the runtimes or models the service accepts, so
  the form offers the four runtimes it knows and takes the model as free text.
- **No agent change-history route.** An agent's version is shown, but its earlier versions cannot be read back.
- **Run rows lack runtime and times.** `GET /v1/runs` rows carry no runtime and no start or end time. The table
  shows a dash for each, and the duration appears once the run's stream has supplied a start.
- **Creating an agent needs the admin role.** A real host would take the role from its own sign-in; the dev
  server gives it only with `SAMPLE_ROLE=admin`.
- **No `url` on take-over requests.** The card shows a link only when the service adds a `url`.
- **Take-over release.** Done and Can't do it call the release route, as does the viewer's own Release button while
  a lease is held.
- **No request-for-values card is mounted.** The typed input card (`src/cards/InputCard.tsx`) is tested but the
  run API does not send that request kind yet.

## Tests

From `web/`, `npm test -w @cm/sample` runs the sample's tests offline (jsdom, the viewer and the run API stubbed):

- the API clients (run, agents, SSE parsing, failure text) and the token minting and proxy settings;
- the stream follower, which reopens from the last sequence after a drop and never repeats an event;
- the timeline reducer: cursor resume, message grouping, tool rows updated in place, one row per notice kind, and
  the replay action on each row (offered only when the host takes one);
- the request cards per kind, and the typed input contract;
- the agent form rules and the agent sheet and screen (validation, catalog insert, tools mode, the env-value rule
  on edit, refusal text);
- the catalog loaders, against the shipped files and against bad entries;
- the runs list (filtering, paging, refresh, the new-run dialog);
- the run screen with the viewer and the replay mocked at the module boundary (take-over and lease, approval,
  cancel, steer, artifacts, a block, a timeline row opening the replay at its event);
- the settings, routes and theme.

`npm test -w @cm/computer-viewer` runs the viewer package's tests. `npm test -w otp-page` runs the sign-in page's.

What the offline tests do not prove: a live run on a real computer.
