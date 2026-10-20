import { describe, expect, it } from "vitest";
import { agentNameIndex, durationText, filterRuns, formatSeconds, isEnded, mergeRuns, MISSING, startedAt, timeText } from "../../src/runs/runList";
import { agentJson, runView } from "../support/fakes";

describe("filterRuns", () => {
  const runs = [runView({ id: "a", status: "running" }), runView({ id: "b", status: "failed" }), runView({ id: "c", status: "running" })];

  it("keeps every run when no status is chosen", () => {
    expect(filterRuns(runs, "").map((run) => run.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps only the runs with the chosen status", () => {
    expect(filterRuns(runs, "running").map((run) => run.id)).toEqual(["a", "c"]);
    expect(filterRuns(runs, "cancelled")).toEqual([]);
  });
});

describe("mergeRuns", () => {
  it("appends a page after the runs already listed, and keeps a run's place when it comes again", () => {
    const first = [runView({ id: "1", status: "running" }), runView({ id: "2" })];
    const page = [runView({ id: "2", status: "completed" }), runView({ id: "3" })];
    const merged = mergeRuns(first, page);
    expect(merged.map((run) => run.id)).toEqual(["1", "2", "3"]);
    expect(merged[1]?.status).toBe("completed");
  });
});

describe("time columns", () => {
  it("shows a start from the start time, else the creation time, else nothing", () => {
    expect(startedAt(runView({ started_at: "2026-10-19T10:00:00Z", created_at: "2026-10-19T09:00:00Z" }))).toBe("2026-10-19T10:00:00Z");
    expect(startedAt(runView({ created_at: "2026-10-19T09:00:00Z" }))).toBe("2026-10-19T09:00:00Z");
    expect(startedAt(runView())).toBeNull();
  });

  it("shows a dash for a missing or unreadable time", () => {
    expect(timeText(null)).toBe(MISSING);
    expect(timeText("not a time")).toBe(MISSING);
    expect(timeText("2026-10-19T10:00:00Z")).not.toBe(MISSING);
  });

  it("measures a finished run to its end, and a live one to now", () => {
    const start = Date.parse("2026-10-19T10:00:00Z");
    const finished = runView({ started_at: "2026-10-19T10:00:00Z", ended_at: "2026-10-19T10:03:05Z", status: "completed" });
    expect(durationText(finished, start + 999_999)).toBe("3 min 5 s");
    const live = runView({ started_at: "2026-10-19T10:00:00Z", status: "running" });
    expect(durationText(live, start + 42_000)).toBe("42 s");
  });

  it("has no duration for a run with no start time, or an end before its start", () => {
    expect(durationText(runView(), Date.now())).toBe(MISSING);
    expect(durationText(runView({ started_at: "2026-10-19T10:00:00Z", ended_at: "2026-10-19T09:00:00Z" }), Date.now())).toBe(MISSING);
  });

  it("formats seconds, minutes and hours", () => {
    expect(formatSeconds(59)).toBe("59 s");
    expect(formatSeconds(61)).toBe("1 min 1 s");
    expect(formatSeconds(3720)).toBe("1 h 2 min");
  });
});

describe("isEnded and agent names", () => {
  it("treats the four end states as ended", () => {
    for (const status of ["completed", "failed", "cancelled", "blocked"] as const) expect(isEnded(runView({ status }))).toBe(true);
    for (const status of ["queued", "running", "waiting_input"] as const) expect(isEnded(runView({ status }))).toBe(false);
  });

  it("names an agent by its id, and shows an unknown id as itself", () => {
    const index = agentNameIndex([agentJson({ id: "agent-1", name: "Desk agent" })]);
    expect(index.get("agent-1")).toBe("Desk agent");
    expect(index.get("agent-9") ?? "agent-9").toBe("agent-9");
  });
});
