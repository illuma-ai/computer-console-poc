import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { acceptAnswer, inputProblems, INPUT_LIMITS } from "../../src/cards/inputRequest";
import type { InputField } from "../../src/cards/inputRequest";
import { InputCard } from "../../src/cards/InputCard";

afterEach(() => cleanup());

const fields: readonly InputField[] = [
  { name: "account", title: "Account", type: "string", required: true },
  { name: "code", title: "One-time code", type: "string", required: true, secret: true },
  { name: "retries", title: "Retries", type: "number", required: false },
  { name: "remember", title: "Remember me", type: "boolean", required: false },
  { name: "region", title: "Region", type: { enum: ["eu", "us"] }, required: true },
];

describe("inputProblems", () => {
  it("accepts a request within the contract's limits", () => {
    expect(inputProblems(fields, "Sign in to continue")).toEqual([]);
  });

  it("refuses a request with no fields or too many", () => {
    expect(inputProblems([], null)).toEqual([`A request has 1 to ${INPUT_LIMITS.maxFields} fields`]);
    const many = Array.from({ length: INPUT_LIMITS.maxFields + 1 }, (_, index) => ({
      name: `f${index}`,
      title: "F",
      type: "string" as const,
      required: false,
    }));
    expect(inputProblems(many, null)[0]).toContain("1 to 8 fields");
  });

  it("refuses a field name outside the pattern, and a duplicate name", () => {
    const problems = inputProblems(
      [
        { name: "Bad-Name", title: "x", type: "string", required: false },
        { name: "ok", title: "x", type: "string", required: false },
        { name: "ok", title: "x", type: "string", required: false },
      ],
      null,
    );
    expect(problems).toEqual(['Field name "Bad-Name" is not allowed', 'Field "ok" is listed twice']);
  });

  it("refuses a multi-line reason, a choice without options and a secret that is not text or number", () => {
    const problems = inputProblems(
      [
        { name: "choice", title: "Choice", type: { enum: [] }, required: false },
        { name: "flag", title: "Flag", type: "boolean", required: false, secret: true },
      ],
      "two\nlines",
    );
    expect(problems).toEqual([
      "The reason is one line of at most 200 characters",
      'Field "choice": a choice needs 1 to 20 options',
      'Field "flag": only a text or number field may be secret',
    ]);
  });
});

describe("acceptAnswer", () => {
  it("builds the accept answer with each value coerced to its type", () => {
    const result = acceptAnswer(fields, { account: "tester", code: "424242", retries: "3", remember: true, region: "eu" });
    expect(result).toEqual({
      ok: true,
      answer: {
        action: "accept",
        content: { account: "tester", code: "424242", retries: 3, remember: true, region: "eu" },
      },
    });
  });

  it("names the required fields left empty", () => {
    const result = acceptAnswer(fields, { account: "", code: "", region: "" });
    expect(result).toEqual({ ok: false, invalid: ["account", "code", "region"] });
  });

  it("refuses a number that is not a number, and a choice that is not on the list", () => {
    const result = acceptAnswer(fields, { account: "a", code: "c", retries: "many", region: "moon" });
    expect(result).toEqual({ ok: false, invalid: ["retries", "region"] });
  });

  it("sends an unticked boolean as false", () => {
    const result = acceptAnswer([{ name: "flag", title: "Flag", type: "boolean", required: false }], {});
    expect(result).toEqual({ ok: true, answer: { action: "accept", content: { flag: false } } });
  });
});

describe("InputCard", () => {
  it("masks a secret field and names the fields still to fill", async () => {
    const onAnswer = vi.fn();
    render(<InputCard title="Sign in" reason="The site needs your code" fields={fields} onAnswer={onAnswer} />);
    expect(screen.getByLabelText("One-time code (required)").getAttribute("type")).toBe("password");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert").textContent).toContain("account");
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("sends the accept answer once the required fields are filled", async () => {
    const onAnswer = vi.fn();
    render(
      <InputCard
        title="Sign in"
        reason={null}
        fields={[{ name: "code", title: "Code", type: "string", required: true, secret: true }]}
        onAnswer={onAnswer}
      />,
    );
    await userEvent.type(screen.getByLabelText("Code (required)"), "424242");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAnswer).toHaveBeenCalledWith({ action: "accept", content: { code: "424242" } });
  });

  it("answers decline and cancel without any values", async () => {
    const onAnswer = vi.fn();
    render(<InputCard title="Sign in" reason={null} fields={fields} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAnswer.mock.calls).toEqual([[{ action: "decline" }], [{ action: "cancel" }]]);
  });

  it("shows the limits' problem instead of a form when the request breaks them", () => {
    render(<InputCard title="Sign in" reason={null} fields={[]} onAnswer={vi.fn()} />);
    expect(screen.queryByRole("form", { name: "Values requested" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("1 to 8 fields");
  });
});
