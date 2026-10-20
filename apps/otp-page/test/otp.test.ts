import { beforeEach, describe, expect, it } from "vitest";
import { checkCode, DEFAULT_USERNAME, mountOtpPage, SIGNED_IN_BANNER } from "../src/page";

const EXPECTED = "424242";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("main");
  document.body.replaceChildren(root);
  mountOtpPage(root, EXPECTED);
});

function submitWith(code: string): void {
  const input = root.querySelector<HTMLInputElement>("#code");
  if (!input) throw new Error("no code field");
  input.value = code;
  root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

describe("checkCode", () => {
  it("accepts the expected code and ignores surrounding spaces", () => {
    expect(checkCode("424242", EXPECTED)).toBe(true);
    expect(checkCode(" 424242 ", EXPECTED)).toBe(true);
    expect(checkCode("424243", EXPECTED)).toBe(false);
    expect(checkCode("", EXPECTED)).toBe(false);
  });
});

describe("sign-in page", () => {
  it("renders the heading, the prefilled username, the code field and the submit button", () => {
    expect(root.querySelector("h1")?.textContent).toBe("Sign in");
    expect(root.querySelector<HTMLInputElement>("#username")?.value).toBe(DEFAULT_USERNAME);
    expect(root.querySelector("#code")).not.toBeNull();
    expect(root.querySelector("button[type=submit]")?.textContent).toBe("Submit");
  });

  it("shows Signed in and the SIGNED-IN-OK banner for the correct code", () => {
    submitWith("424242");
    expect(root.querySelector("#result")?.textContent).toBe("Signed in");
    expect(root.querySelector("#banner")?.textContent).toBe(SIGNED_IN_BANNER);
    expect(root.textContent).toContain("SIGNED-IN-OK");
  });

  it("shows Wrong code and no banner for any other code", () => {
    submitWith("000000");
    expect(root.querySelector("#result")?.textContent).toBe("Wrong code");
    expect(root.querySelector("#banner")).toBeNull();
    expect(root.textContent).not.toContain("SIGNED-IN-OK");
  });

  it("does not show the success text before a sign-in", () => {
    expect(root.textContent).not.toContain("SIGNED-IN-OK");
  });
});
