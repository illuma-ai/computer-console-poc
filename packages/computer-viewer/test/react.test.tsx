import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactElement } from "react";
import { ComputerViewer } from "../src/react/ComputerViewer";
import { ControlBar } from "../src/react/ControlBar";
import { Terminal } from "../src/react/Terminal";
import { createViewerClient } from "../src/client/client";
import { FakeWebSocketCtor, flush, jsonResponse, makeSession, openSseResponse, recordingFetch, sseResponse, stubCanvasContext } from "./helpers";

// React 18 test environment: state updates go through act().
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

/** Mounts an element into a fresh container and returns it. */
function mount(element: ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return host;
}

/** The first button whose visible text matches. */
function button(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

describe("React components", () => {
  beforeEach(() => {
    stubCanvasContext();
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });

  it("ControlBar shows the mode and calls the take-over callbacks", () => {
    const onTakeControl = vi.fn();
    mount(<ControlBar mode="view" status="connected" transport="sse" onTakeControl={onTakeControl} />);
    expect(host.textContent).toContain("View");
    expect(host.textContent).toContain("sse");
    act(() => button("Take control").click());
    expect(onTakeControl).toHaveBeenCalledTimes(1);
    expect(host.querySelector("button[type=button]")?.textContent).toBe("Take control");
    act(() => root.unmount());

    const onRelease = vi.fn();
    mount(<ControlBar mode="control" status="connected" transport={null} onRelease={onRelease} />);
    expect(host.textContent).toContain("Control");
    act(() => button("Release").click());
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(Array.from(host.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Release"]);
  });

  it("ControlBar shows status text only when it needs attention", () => {
    mount(<ControlBar mode="view" status="connected" transport={null} />);
    expect(host.querySelector(".cv-status")).toBeNull();
    act(() => root.unmount());
    mount(<ControlBar mode="view" status="reconnecting" transport={null} />);
    expect(host.querySelector(".cv-status")?.textContent).toBe("Reconnecting");
  });

  it("ComputerViewer renders the screen, the views and the control bar", async () => {
    const held = openSseResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/view/v1/screen/frames")) return held.response;
        if (url.includes("/view/v1/processes")) return jsonResponse([]);
        return jsonResponse({ error: { code: "not_found", message: "x" } }, 404);
      }),
    );
    mount(
      <ComputerViewer
        session={makeSession({ mode: "view", transports: ["sse"] })}
        transport="sse"
        onTakeControl={() => undefined}
      />,
    );
    await act(async () => {
      await flush(20);
    });
    expect(host.querySelector(".cv-screen")).not.toBeNull();
    expect(host.querySelector("[role=toolbar]")?.textContent).toContain("View");
    expect(button("Take control")).toBeTruthy();
    expect(host.querySelector("[role=tablist]")?.textContent).toContain("Terminal");
    expect(host.querySelector("[role=tablist]")?.textContent).toContain("Files");
    held.end();
  });

  it("Terminal lists processes and shows the streamed output of the selected one", async () => {
    const { fetch } = recordingFetch((url) => {
      if (url.endsWith("/view/v1/processes")) return jsonResponse([{ pid: "7", cmd: ["make", "test"] }]);
      if (url.endsWith("/view/v1/processes/7/events")) {
        return sseResponse([
          'event: stdout\ndata: {"data":"line one\\n"}\n\n',
          'event: stderr\ndata: {"data":"line two\\n"}\n\n',
          'event: exited\ndata: {"exit_code":0}\n\n',
        ]);
      }
      return jsonResponse({}, 404);
    });
    const client = createViewerClient(makeSession({ transports: ["sse"] }), { fetch, WebSocket: FakeWebSocketCtor });
    mount(<Terminal client={client} />);
    await act(async () => {
      await flush(10);
    });
    act(() => button("make test").click());
    await act(async () => {
      await flush(30);
    });
    const log = host.querySelector("pre.cv-log");
    expect(log?.textContent).toBe("line one\nline two\n\n[exit 0]\n");
    expect(button("make test").getAttribute("aria-pressed")).toBe("true");
    client.close();
  });
});
