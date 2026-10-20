import { afterEach, describe, expect, it } from "vitest";
import { clearFragment, parseViewerFragment } from "../src/fragment";
import { readTransport } from "../src/config";

const TOKEN = "link-token-test-19e4";

describe("parseViewerFragment", () => {
  it("reads every field of the fragment", () => {
    const session = parseViewerFragment(
      `#token=${TOKEN}&base=https%3A%2F%2Fview.example.test&mode=control&transports=websocket,sse&exp=1800000000`,
    );
    expect(session).toEqual({
      baseUrl: "https://view.example.test",
      token: TOKEN,
      mode: "control",
      transports: ["websocket", "sse"],
      expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("defaults to a view session with no transports when those fields are absent", () => {
    const session = parseViewerFragment(`#token=${TOKEN}&base=https%3A%2F%2Fview.example.test&exp=1800000000`);
    expect(session?.mode).toBe("view");
    expect(session?.transports).toEqual([]);
  });

  it("returns null when the fragment carries no token", () => {
    expect(parseViewerFragment("")).toBeNull();
    expect(parseViewerFragment("#base=https%3A%2F%2Fview.example.test")).toBeNull();
  });

  it("gives an empty expiry for an unparseable exp, which the client then rejects", () => {
    const session = parseViewerFragment(`#token=${TOKEN}&base=https%3A%2F%2Fv.example.test&exp=soon`);
    expect(session?.expiresAt).toBe("");
  });
});

describe("clearFragment", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("removes the token from the address bar and keeps the path and query", () => {
    window.history.replaceState(
      null,
      "",
      `/viewer/page?ref=chat#token=${TOKEN}&base=https%3A%2F%2Fview.example.test&exp=1800000000`,
    );
    const session = parseViewerFragment(window.location.hash);
    expect(session?.token).toBe(TOKEN);

    clearFragment(window);

    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/viewer/page");
    expect(window.location.search).toBe("?ref=chat");
    expect(window.location.href).not.toContain(TOKEN);
  });
});

describe("readTransport", () => {
  it("accepts the three choices and falls back to auto for anything else", () => {
    expect(readTransport("sse")).toBe("sse");
    expect(readTransport("websocket")).toBe("websocket");
    expect(readTransport("auto")).toBe("auto");
    expect(readTransport("carrier-pigeon")).toBe("auto");
    expect(readTransport(undefined)).toBe("auto");
  });
});
