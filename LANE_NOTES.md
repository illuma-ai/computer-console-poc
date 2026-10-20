# Lane notes: console features for the next run-service capabilities (apps/sample)

## Done
1. **Provenance Details tab** (`apps/sample/src/run/ProvenanceView.tsx`, mounted in `RunScreen.tsx`). Shows the
   agent (linked to the agents screen, with its version), harness (name, version, build, computer, time), model,
   each computer (id, runtime, template, digest, start, end, reason), session id with a session-export link (web
   addresses only), service version and checkpoint count. The tab is absent when the run has no provenance; each
   part is left out when absent. The snapshot is refetched when the computer changes (`useRunStream.ts`).
2. **Idle settings on agents**: `idle_pause_s` (0 = never) and `resume_on_answer` in the agent form
   (`agentForm.ts`, validated, sent in every write) and the sheet (`AgentSheet.tsx`). Timeline rows for
   `computer.paused`, `computer.parked_deleted`, `computer.resumed`.
3. **Input request mounted**: an `input` request renders the typed `InputCard` (`RequestCard.tsx`). Payload is read
   from `meta.{message, fields}` by `inputRequestOf` (`cards/inputRequest.ts`); a malformed field makes the list
   empty so the card names the limit and still offers Decline and Cancel. Answers: `{action:"accept", values}`,
   `{action:"decline"}`, `{action:"cancel"}`. Secrets are password inputs, cleared on submit, and never stored in
   the timeline state.
4. **Timeline rows**: `request.answered` (names of the values sent; a secret reads "(provided)"; decline and cancel
   read as such) and `harness.started`. `run.input_answered` still works.
5. Tests for each item (sample: 205 tests). `docs/CONSOLE.md` updated (screens, known differences, tests).

## Assumptions to confirm with the run service
- The input payload sits in the request's `meta` (`meta.message`, `meta.fields`). Not confirmed.
- `request.answered` for an accepted input request carries `answer.values` (keys are read, values never).
- `provenance` is on `GET /v1/runs/{id}` with the shape in `apps/sample/src/api/types.ts`.
- `idle_pause_s` and `resume_on_answer` are always sent on agent writes. A service that has not rolled out these
  fields refuses the write (its body is strict), so the console and the service must roll out together.

## Next
- Confirm the three assumptions against the service, then remove any gap text in `docs/CONSOLE.md`.
- The Details tab reads the snapshot; a long-running run only refreshes it when the computer changes or the run ends.

## Blockers
None.
