/**
 * The typed form of a request for values from a person (docs/plans/request-input-contract.md). The run API
 * does not send this kind yet, so nothing mounts it; this module holds the contract's limits and the
 * answer's shape, so the card can be wired in when the service sends the kind.
 *
 * Secret fields are never echoed or stored by the sample: the answer goes out and the field is cleared.
 */

/** The field types the contract allows. `enum` lists the options a person may pick. */
export type InputFieldType = "string" | "number" | "boolean" | { readonly enum: readonly string[] };

/** One field the agent asks for. */
export interface InputField {
  readonly name: string;
  readonly title: string;
  readonly type: InputFieldType;
  readonly required: boolean;
  /** A secret field is masked on screen. Only string and number fields may be secret. */
  readonly secret?: boolean;
  readonly description?: string;
}

/** The contract's limits. One place, so the card and its tests read the same numbers. */
export const INPUT_LIMITS = {
  maxFields: 8,
  namePattern: /^[a-z][a-z0-9_]{0,31}$/,
  titleMax: 60,
  descriptionMax: 200,
  enumMin: 1,
  enumMax: 20,
  reasonMax: 200,
} as const;

/** A value a person typed for one field. */
export type InputValue = string | number | boolean;

/** The answer the harness expects: accept with the content, decline or cancel. */
export type InputAnswer =
  | { readonly action: "accept"; readonly content: Readonly<Record<string, InputValue>> }
  | { readonly action: "decline" }
  | { readonly action: "cancel" };

/**
 * The limits the contract puts on a request. An empty list means the request is within them.
 *
 * @param fields The fields the agent asked for.
 * @param reason The one-line reason the agent gave, if any.
 * @returns one message per broken limit, in the order the fields are listed.
 */
export function inputProblems(fields: readonly InputField[], reason: string | null): string[] {
  const problems: string[] = [];
  if (fields.length < 1 || fields.length > INPUT_LIMITS.maxFields) {
    problems.push(`A request has 1 to ${INPUT_LIMITS.maxFields} fields`);
  }
  if (reason !== null && (reason.includes("\n") || reason.length > INPUT_LIMITS.reasonMax)) {
    problems.push(`The reason is one line of at most ${INPUT_LIMITS.reasonMax} characters`);
  }
  const names = new Set<string>();
  for (const field of fields) {
    if (!INPUT_LIMITS.namePattern.test(field.name)) problems.push(`Field name "${field.name}" is not allowed`);
    if (names.has(field.name)) problems.push(`Field "${field.name}" is listed twice`);
    names.add(field.name);
    if (field.title.length > INPUT_LIMITS.titleMax) problems.push(`Field "${field.name}": title is too long`);
    if ((field.description ?? "").length > INPUT_LIMITS.descriptionMax) {
      problems.push(`Field "${field.name}": description is too long`);
    }
    if (typeof field.type === "object") {
      const count = field.type.enum.length;
      if (count < INPUT_LIMITS.enumMin || count > INPUT_LIMITS.enumMax) {
        problems.push(`Field "${field.name}": a choice needs 1 to ${INPUT_LIMITS.enumMax} options`);
      }
    }
    if (field.secret === true && field.type !== "string" && field.type !== "number") {
      problems.push(`Field "${field.name}": only a text or number field may be secret`);
    }
  }
  return problems;
}

/**
 * Builds the accept answer from what the person typed. A required field that is empty stops the answer,
 * and a number that is not a number does too. Values are coerced to the field's type.
 *
 * @param fields The fields of the request.
 * @param values What the person typed, by field name. Booleans for boolean fields, text otherwise.
 * @returns the answer, or the names of the fields that stop it.
 */
export function acceptAnswer(
  fields: readonly InputField[],
  values: Readonly<Record<string, string | boolean>>,
): { readonly ok: true; readonly answer: InputAnswer } | { readonly ok: false; readonly invalid: readonly string[] } {
  const content: Record<string, InputValue> = {};
  const invalid: string[] = [];
  for (const field of fields) {
    const raw = values[field.name];
    if (field.type === "boolean") {
      content[field.name] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw : "";
    if (text === "") {
      if (field.required) invalid.push(field.name);
      continue;
    }
    if (field.type === "number") {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) invalid.push(field.name);
      else content[field.name] = parsed;
      continue;
    }
    if (typeof field.type === "object" && !field.type.enum.includes(text)) {
      invalid.push(field.name);
      continue;
    }
    content[field.name] = text;
  }
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, answer: { action: "accept", content } };
}
