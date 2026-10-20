# Computer console (proof of concept)

A test console for autonomous agents that work on computers, plus the embeddable computer viewer.

| Path | What it is |
|---|---|
| `apps/sample` | The console: agent definitions (templates, tool catalog), runs, the live run view with timeline, request cards and the computer screen |
| `packages/computer-viewer` | The computer viewer component: live screen over WebSocket or SSE, view-only or control |
| `apps/viewer` | A standalone page that opens the viewer from a link |
| `apps/otp-page` | A test sign-in page with a fixed one-time code, for take-over scenarios |

## Run
Requires Node 24.
```
npm ci
npm run typecheck && npm test && npm run build
```
The console needs a run API to talk to; see `docs/CONSOLE.md` (settings, screens, catalogs) and `docs/VIEWER.md` (the viewer contract).

## Development
Changes are made on branches and merged through pull requests; CI runs the gate on every pull
request. See `CLAUDE.md` for the rules.
