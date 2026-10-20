# Lane notes: console fixes from the live walk-through

## Done
1. Closed requests no longer pinned. `src/run/timeline.ts` closes every open request once the run's status is
   final (completed, failed, cancelled, blocked), from both events and the snapshot. Cards only render what state holds.
2. Run header shows the agent's name (agents list, read as the runs list does), id on hover; falls back to the id.
   `RunScreen` takes an `agents` prop, wired from `App`.
3. New run dialog: the shown agent is the agent used. The first enabled agent is the default when the list arrives
   after the dialog mounts; the prompt last used with that agent is loaded with it.

Each fix has tests, and `docs/CONSOLE.md` is updated.

## Next
- Gate: `npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build`.

## Blockers
- None.
