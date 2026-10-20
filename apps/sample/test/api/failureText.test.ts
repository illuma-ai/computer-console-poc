import { describe, expect, it } from "vitest";
import { failureText, RunApiError } from "../../src/api/runApi";

describe("failureText", () => {
  it("shows the HTTP status with the API's message", () => {
    expect(failureText(new RunApiError(409, "run_ended", "the run has ended"))).toBe("Error 409: the run has ended");
  });

  it("shows only the message for a failure that never reached the service", () => {
    expect(failureText(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("falls back to fixed text for a value that is not an error", () => {
    expect(failureText("boom")).toBe("The request failed");
    expect(failureText(new Error(""))).toBe("The request failed");
  });
});
