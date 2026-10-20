import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../src/api/types";
import { applyEvent, INITIAL_RUN_STATE, withLinks, withSnapshot } from "../../src/run/timeline";
import type { NoticeEntry, RunState, TimelineEntry } from "../../src/run/timeline";
import { event, progress, runView } from "../support/fakes";

/** Folds a list of events, in order, as the stream does. */
function fold(events: readonly RunEvent[], start: RunState = INITIAL_RUN_STATE): RunState {
  return events.reduce(applyEvent, start);
}

/** The notices of a state, in order. */
function notices(state: RunState): NoticeEntry[] {
  return state.timeline.filter((entry): entry is NoticeEntry => entry.kind === "notice");
}

describe("cursor resume", () => {
  it("ignores an event at or below the last sequence applied, so a replay adds nothing", () => {
    const first = fold([progress(1, "message", { text: "a" }), progress(2, "message", { text: "b" })]);
    const replayed = applyEvent(first, progress(2, "message", { text: "b" }));
    expect(replayed).toBe(first);
    expect(replayed.timeline).toHaveLength(1);
    expect(replayed.lastSeq).toBe(2);
  });

  it("keeps the cursor at the highest sequence, even when events arrive after a gap", () => {
    const state = fold([progress(3, "plan", { entries: [1] }), progress(5, "plan", { entries: [1, 2] })]);
    expect(state.lastSeq).toBe(5);
  });

  it("takes the snapshot only before the first event, so the stream's view wins", () => {
    const snapshot = runView({ status: "queued", computer_id: "c-1", created_at: "2026-10-19T09:00:00Z" });
    const before = withSnapshot(INITIAL_RUN_STATE, snapshot);
    expect(before.status).toBe("queued");
    expect(before.computerId).toBe("c-1");
    expect(before.startedAt).toBe("2026-10-19T09:00:00Z");

    const live = fold([event(1, "run.started", { computer: { runtime: "docker" } })]);
    expect(withSnapshot(live, snapshot)).toBe(live);
  });
});

describe("message chunks", () => {
  it("joins consecutive chunks of one reply into one entry", () => {
    const state = fold([progress(1, "message", { text: "Open" }), progress(2, "message", { text: "ing" }), progress(3, "message", { text: " page" })]);
    const messages = state.timeline.filter((entry) => entry.kind === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: "message", text: "Opening page", key: "m1" });
  });

  it("starts a new entry after a tool row, and keeps the tool row as its own entry", () => {
    const state = fold([
      progress(1, "message", { text: "Opening" }),
      progress(2, "tool", { tool_call_id: "t1", title: "Open page", status: "completed" }),
      progress(3, "message", { text: "Next step" }),
    ]);
    expect(state.timeline.map((entry) => entry.kind)).toEqual(["message", "tool", "message"]);
    expect(state.timeline[2]).toMatchObject({ text: "Next step" });
  });

  it("ends an open reply when a notice arrives, so the next chunk starts a fresh entry", () => {
    const state = fold([
      progress(1, "message", { text: "one" }),
      event(2, "checkpoint.saved", { seq: 2 }),
      progress(3, "message", { text: "two" }),
    ]);
    expect(state.timeline.map((entry) => entry.kind)).toEqual(["message", "notice", "message"]);
  });

  it("ignores an empty chunk", () => {
    const state = fold([progress(1, "message", { text: "" })]);
    expect(state.timeline).toEqual([]);
  });
});

describe("tool rows and plans", () => {
  it("updates one tool row in place as its status changes", () => {
    const state = fold([
      progress(1, "tool", { tool_call_id: "t1", title: "Open page", status: "pending" }),
      progress(2, "message", { text: "between" }),
      progress(3, "tool", { tool_call_id: "t1", title: "Open page", status: "completed" }),
    ]);
    const tools = state.timeline.filter((entry): entry is Extract<TimelineEntry, { kind: "tool" }> => entry.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ status: "completed", title: "Open page", seq: 1 });
    expect(state.timeline.map((entry) => entry.kind)).toEqual(["tool", "message"]);
  });

  it("keeps one plan row that shows the latest step count", () => {
    const state = fold([progress(1, "plan", { entries: [1, 2] }), progress(2, "message", { text: "x" }), progress(3, "plan", { entries: [1, 2, 3] })]);
    const plans = state.timeline.filter((entry) => entry.kind === "plan");
    expect(plans).toEqual([expect.objectContaining({ steps: 3 })]);
  });
});

describe("distinct notice rows", () => {
  it("gives a checkpoint its own row", () => {
    const [row] = notices(fold([event(1, "checkpoint.saved", { seq: 7 })]));
    expect(row).toMatchObject({ type: "checkpoint.saved", tone: "info", text: "Checkpoint saved (seq 7)" });
  });

  it("marks a failed checkpoint as an error", () => {
    const [row] = notices(fold([event(1, "checkpoint.failed", { code: "store_down" })]));
    expect(row).toMatchObject({ type: "checkpoint.failed", tone: "error", detail: "store_down" });
  });

  it("moves the computer id on a replacement and says from which checkpoint", () => {
    const state = fold([event(1, "run.started", { computer: { id: "c1", runtime: "e2b" } }), event(2, "computer.replaced", { new: { id: "c2" }, checkpoint_seq: 9 })]);
    expect(state.computerId).toBe("c2");
    expect(notices(state)[1]).toMatchObject({ type: "computer.replaced", tone: "warning", detail: "From checkpoint 9" });
  });

  it("lists the tools that are unavailable", () => {
    const [row] = notices(fold([event(1, "tools.unavailable", { servers: [{ name: "browser" }, { name: "files" }] })]));
    expect(row).toMatchObject({ type: "tools.unavailable", tone: "warning", detail: "browser, files" });
  });

  it("shows a reminder with its text", () => {
    const [row] = notices(fold([event(1, "run.reminder", { text: "Check the form" })]));
    expect(row).toMatchObject({ type: "run.reminder", text: "Reminder", detail: "Check the form" });
  });

  it("stops the run on a block and keeps the reason as the text", () => {
    const state = fold([event(1, "run.blocked", { reason: "The host is not on the egress list" })]);
    expect(state.status).toBe("blocked");
    expect(state.error).toBe("The host is not on the egress list");
    expect(notices(state)[0]).toMatchObject({ type: "run.blocked", tone: "blocked", text: "The host is not on the egress list" });
    expect(state.endedAt).toBe("2026-10-19T10:00:00Z");
  });

  it("records a failure with its message", () => {
    const state = fold([event(1, "run.failed", { error: "computer lost" })]);
    expect(state).toMatchObject({ status: "failed", error: "computer lost" });
    expect(notices(state)[0]).toMatchObject({ type: "run.failed", tone: "error", text: "computer lost" });
  });

  it("keeps the final reply as the result", () => {
    const state = fold([event(1, "run.completed", { result: "Done: 3 files", usage: { tokens: 12 } })]);
    expect(state).toMatchObject({ status: "completed", result: "Done: 3 files", usage: { tokens: 12 } });
  });
});

describe("recording rows", () => {
  it("gives each recording event its own row, with the reason or code as the detail", () => {
    const rows = notices(
      fold([
        event(1, "recording.started", { computer: { id: "c1" } }),
        event(2, "recording.paused", { reason: "takeover" }),
        event(3, "recording.resumed", {}),
        event(4, "recording.stopped", { reason: "parked" }),
        event(5, "recording.unavailable", { code: "no_screen" }),
      ]),
    );
    expect(rows.map((row) => [row.type, row.text, row.detail])).toEqual([
      ["recording.started", "Recording started", null],
      ["recording.paused", "Recording paused", "takeover"],
      ["recording.resumed", "Recording resumed", null],
      ["recording.stopped", "Recording stopped", "parked"],
      ["recording.unavailable", "Recording unavailable", "no_screen"],
    ]);
    expect(rows[4]).toMatchObject({ tone: "warning" });
  });
});

describe("requests", () => {
  const request = {
    id: "req-1",
    kind: "question",
    title: "Which colour?",
    options: [{ id: "opt-blue", name: "Blue", kind: "allow_once" }],
    meta: {},
    expires_at: "2026-10-19T11:00:00Z",
  };

  it("holds an open request until it is answered, and returns to running", () => {
    const waiting = fold([event(1, "run.waiting_input", { request })]);
    expect(waiting.status).toBe("waiting_input");
    expect(waiting.openRequests.map((item) => item.id)).toEqual(["req-1"]);

    const answered = fold([event(2, "run.input_answered", { request_id: "req-1", answer: { option_id: "opt-blue" } })], waiting);
    expect(answered.openRequests).toEqual([]);
    expect(answered.status).toBe("running");
    expect(notices(answered).at(-1)?.text).toBe("Answered: Blue");
  });

  it("removes a take-over request when its lease is released", () => {
    const takeover = { ...request, id: "req-2", kind: "takeover", title: "Enter the code", options: [] };
    const state = fold([
      event(1, "run.waiting_input", { request: takeover }),
      event(2, "takeover.released", { request_id: "req-2", reason: "done" }),
    ]);
    expect(state.openRequests).toEqual([]);
    expect(notices(state).at(-1)?.text).toBe("Take-over released (done)");
  });

  it.each(["run.completed", "run.failed", "run.cancelled", "run.blocked"])(
    "closes an open take-over when the run ends with %s",
    (endType) => {
      const takeover = { ...request, id: "req-3", kind: "takeover", title: "Enter the code", options: [] };
      const data = endType === "run.failed" ? { error: "boom" } : endType === "run.blocked" ? { reason: "egress" } : {};
      const state = fold([event(1, "run.waiting_input", { request: takeover }), event(2, endType, data)]);
      expect(state.openRequests).toEqual([]);
    },
  );

  it("closes the open requests when the snapshot shows the run has ended", () => {
    const waiting = fold([event(1, "run.waiting_input", { request })]);
    const ended = withSnapshot({ ...waiting, lastSeq: 0 }, runView({ status: "blocked" }));
    expect(ended.openRequests).toEqual([]);
  });

  it("keeps the open requests of a live run", () => {
    const state = fold([event(1, "run.waiting_input", { request }), progress(2, "plan", { entries: [] })]);
    expect(state.openRequests.map((item) => item.id)).toEqual(["req-1"]);
  });
});

describe("unknown events", () => {
  it("ignores an event type it does not know, and still moves the cursor", () => {
    const state = fold([event(1, "run.brand_new_thing", { anything: true })]);
    expect(state.timeline).toEqual([]);
    expect(state.lastSeq).toBe(1);
  });
});

describe("withLinks", () => {
  it("attaches the download link by artifact id, and null when the service gave none", () => {
    const rows = withLinks(
      [
        { id: "a1", name: "report.md", size: 10 },
        { id: "a2", name: "data.csv", size: 20 },
      ],
      [{ id: "a1", name: "report.md", size: 10, sha256: "x", download_url: "https://example.test/a1" }],
    );
    expect(rows).toEqual([
      { id: "a1", name: "report.md", size: 10, url: "https://example.test/a1" },
      { id: "a2", name: "data.csv", size: 20, url: null },
    ]);
  });
});
