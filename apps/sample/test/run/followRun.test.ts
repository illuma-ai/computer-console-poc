import { describe, expect, it } from "vitest";
import { followRun } from "../../src/run/useRunStream";
import type { RunEvent } from "../../src/api/types";
import { event, fakeRunApi, streamOf } from "../support/fakes";

/** A stream that yields the events, then fails as a dropped connection does. */
function droppedAfter(events: readonly RunEvent[]): AsyncGenerator<RunEvent> {
  return (async function* (): AsyncGenerator<RunEvent> {
    for (const item of events) yield item;
    throw new Error("socket reset");
  })();
}

describe("followRun", () => {
  it("reopens from the last sequence seen after a drop, so no event is repeated or lost", async () => {
    const cursors: number[] = [];
    const seen: number[] = [];
    let drops = 0;
    const api = fakeRunApi({
      streamEvents: (_runId, afterSeq) => {
        cursors.push(afterSeq);
        if (cursors.length === 1) return droppedAfter([event(1, "run.started"), event(2, "run.progress", { kind: "message", text: "a" })]);
        return streamOf([event(3, "run.completed", { result: "ok" })]);
      },
    });

    await followRun(api, "run-1", new AbortController().signal, {
      onEvent: (item) => seen.push(item.seq),
      onDropped: () => {
        drops += 1;
      },
      retryMs: 0,
    });

    expect(cursors).toEqual([0, 2]);
    expect(seen).toEqual([1, 2, 3]);
    expect(drops).toBe(1);
  });

  it("returns once the run's stream closes, without reconnecting", async () => {
    const cursors: number[] = [];
    const api = fakeRunApi({
      streamEvents: (_runId, afterSeq) => {
        cursors.push(afterSeq);
        return streamOf([event(1, "run.completed", { result: "" })]);
      },
    });
    await followRun(api, "run-1", new AbortController().signal, { onEvent: () => undefined, onDropped: () => undefined, retryMs: 0 });
    expect(cursors).toEqual([0]);
  });

  it("does not connect at all when the view has already closed", async () => {
    const controller = new AbortController();
    controller.abort();
    const api = fakeRunApi();
    await followRun(api, "run-1", controller.signal, { onEvent: () => undefined, onDropped: () => undefined, retryMs: 0 });
    expect(api.streamEvents).not.toHaveBeenCalled();
  });
});
