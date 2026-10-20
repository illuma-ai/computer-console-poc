import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Replay } from "../src/react/Replay";
import type { ReplaySeek } from "../src/react/Replay";
import type { FetchLike } from "../src/client/types";
import { binary, fixtureBodies, fixtureFetcher, MANIFEST_URL, SEGMENT_0_URL } from "./replay-fixtures";

/*
 * The picture is an object URL made from the frame's bytes, so `blob:size-N` names the frame of N bytes.
 * jsdom has no object URLs, so the test supplies them and checks which frame each time shows.
 */
const createObjectURL = vi.fn((blob: Blob) => `blob:size-${blob.size}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

/** The picture on screen, by its object URL, or null when none is shown. */
function pictureSrc(): string | null {
  const image = screen.queryByRole("img", { name: "Recording frame" });
  return image ? image.getAttribute("src") : null;
}

/**
 * Renders the replay on the fixture recording and waits until it has loaded. The fetcher is made once per
 * test, because a new one reloads the recording. A picture may follow later, so tests that check one wait.
 */
async function renderReplay(seek: ReplaySeek | null = null): Promise<{ readonly fetcher: FetchLike; readonly view: ReturnType<typeof render> }> {
  const { fetcher } = fixtureFetcher();
  const view = render(<Replay manifestUrl={MANIFEST_URL} fetcher={fetcher} seek={seek} />);
  await screen.findByRole("slider", { name: "Replay position" });
  return { fetcher, view };
}

describe("Replay", () => {
  it("starts paused on the first picture, with nothing played", async () => {
    await renderReplay();
    await waitFor(() => expect(pictureSrc()).toBe("blob:size-3"));
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.getByText("0:00 / 1:00")).toBeTruthy();
  });

  it("seeks to an event through the index", async () => {
    const { fetcher, view } = await renderReplay();
    view.rerender(<Replay manifestUrl={MANIFEST_URL} fetcher={fetcher} seek={{ seq: 5 }} />);
    await waitFor(() => expect(pictureSrc()).toBe("blob:size-5"));
    expect(screen.getByText("0:04 / 1:00")).toBeTruthy();
  });

  it("seeks to an event that is not indexed, to the event before it", async () => {
    await renderReplay({ seq: 7 });
    await waitFor(() => expect(pictureSrc()).toBe("blob:size-5"));
    expect(screen.getByText("0:04 / 1:00")).toBeTruthy();
  });

  it("seeks from the scrubber, and a repeated request for the same event seeks again", async () => {
    const { fetcher, view } = await renderReplay({ seq: 5 });
    await waitFor(() => expect(pictureSrc()).toBe("blob:size-5"));

    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "0" } });
    await waitFor(() => expect(pictureSrc()).toBe("blob:size-3"));

    view.rerender(<Replay manifestUrl={MANIFEST_URL} fetcher={fetcher} seek={{ seq: 5 }} />);
    await waitFor(() => expect(pictureSrc()).toBe("blob:size-5"));
  });

  it("shows a take-over as a gap with its reason, and no picture across it", async () => {
    await renderReplay({ ms: 22_000 });
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("A person took control");
    expect(pictureSrc()).toBeNull();
  });

  it("lists the paused spans with their times and reasons", async () => {
    await renderReplay();
    const list = screen.getByRole("list", { name: "Paused spans" });
    expect(list.textContent).toBe("0:20 to 0:25: A person took control");
  });

  it("shows no picture after a pause until the screen next changes", async () => {
    await renderReplay({ ms: 26_000 });
    await waitFor(() => expect(screen.getByText("No picture at this time")).toBeTruthy());
    expect(pictureSrc()).toBeNull();
  });

  it("plays forward with the clock and stops paused when it is pressed again", async () => {
    await renderReplay();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("0:02 / 1:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("0:02 / 1:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("plays at the chosen speed", async () => {
    await renderReplay();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "4x" }));
    expect(screen.getByRole("button", { name: "4x" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("0:04 / 1:00")).toBeTruthy();
  });

  it("moves with the arrow keys, by thirty seconds with Shift, and plays with Space", async () => {
    await renderReplay();
    const region = screen.getByRole("region", { name: "Replay" });
    region.focus();
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(screen.getByText("0:05 / 1:00")).toBeTruthy();
    fireEvent.keyDown(region, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByText("0:35 / 1:00")).toBeTruthy();
    fireEvent.keyDown(region, { key: "Home" });
    expect(screen.getByText("0:00 / 1:00")).toBeTruthy();
    fireEvent.keyDown(region, { key: " " });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(region, { key: " " });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("says there is no recording when the run has none", async () => {
    render(<Replay manifestUrl={MANIFEST_URL} fetcher={fixtureFetcher({}).fetcher} seek={null} />);
    expect(await screen.findByText("This run has no recording")).toBeTruthy();
  });

  it("shows a failed manifest in fixed words, without the address", async () => {
    const fetcher = fixtureFetcher({ [MANIFEST_URL]: () => new Response("boom", { status: 500 }) }).fetcher;
    render(<Replay manifestUrl={MANIFEST_URL} fetcher={fetcher} seek={null} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The recording could not be loaded");
    expect(document.body.textContent).not.toContain("console.example.test");
  });

  it("shows a segment that cannot be read, and keeps the rest of the replay", async () => {
    const bodies = fixtureBodies();
    const { fetcher, urls } = fixtureFetcher({ ...bodies, [SEGMENT_0_URL]: () => binary(new Uint8Array(8).buffer) });
    render(<Replay manifestUrl={MANIFEST_URL} fetcher={fetcher} seek={null} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("A recording segment could not be read")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    // A failed segment is not requested again for every move of the playhead.
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "1000" } });
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "2000" } });
    await waitFor(() => expect(screen.getByText("0:02 / 1:00")).toBeTruthy());
    expect(urls.filter((url) => url === SEGMENT_0_URL)).toHaveLength(1);
  });

  it("releases the object URLs of its frames when it is left", async () => {
    const { view } = await renderReplay();
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:size-3");
  });

  it("loads the manifest first, then the segment at the playhead", async () => {
    const { fetcher, urls } = fixtureFetcher();
    render(<Replay manifestUrl={MANIFEST_URL} fetcher={fetcher} seek={null} />);
    await waitFor(() => expect(urls).toContain(SEGMENT_0_URL));
    expect(urls[0]).toBe(MANIFEST_URL);
    expect(urls).toContain(SEGMENT_0_URL);
  });
});
