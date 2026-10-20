/**
 * The typed form of a request for values from a person (docs/plans/request-input-contract.md). The run API
 * sends it as an `input` request whose `meta` is `{ message, fields }`. This module reads that payload, holds
 * the contract's limits and builds the answer's shape.
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

/** The answer the harness expects: accept with the values, decline or cancel. */
export type InputAnswer =
  | { readonly action: "accept"; readonly values: Readonly<Record<string, InputValue>> }
  | { readonly action: "decline" }
  | { readonly action: "cancel" };

/** The payload of an `input` request: the agent's line of context, and the fields it asks for. */
export interface InputRequestPayload {
  readonly message: string | null;
  readonly fields: readonly InputField[];
}

/**
 * Reads the `{ message, fields }` payload of an `input` request. A field that is not in the contract's shape
 * makes the whole list empty, so the card shows the limit it breaks (a request has 1 to 8 fields) and offers
 * decline, rather than asking for fewer values than the agent named.
 *
 * @param meta The request's meta, as the service sent it.
 */
export function inputRequestOf(meta: Readonly<Record<string, unknown>>): InputRequestPayload {
  const message = typeof meta["message"] === "string" ? meta["message"] : null;
  const fields = fieldsOf(meta["fields"]);
  return { message, fields: fields ?? [] };
}

/** The fields of the payload, or null when the value is not a list of fields in the contract's shape. */
function fieldsOf(value: unknown): InputField[] | null {
  if (!Array.isArray(value)) return null;
  const fields: InputField[] = [];
  for (const item of value) {
    const field = fieldOf(item);
    if (field === null) return null;
    fields.push(field);
  }
  return fields;
}

function fieldOf(value: unknown): InputField | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type = typeOf(raw["type"]);
  if (typeof raw["name"] !== "string" || typeof raw["title"] !== "string" || type === null) return null;
  if (raw["required"] !== undefined && typeof raw["required"] !== "boolean") return null;
  if (raw["secret"] !== undefined && typeof raw["secret"] !== "boolean") return null;
  if (raw["description"] !== undefined && typeof raw["description"] !== "string") return null;
  return {
    name: raw["name"],
    title: raw["title"],
    type,
    required: raw["required"] === true,
    ...(raw["secret"] === true ? { secret: true } : {}),
    ...(typeof raw["description"] === "string" ? { description: raw["description"] } : {}),
  };
}

function typeOf(value: unknown): InputFieldType | null {
  if (value === "string" || value === "number" || value === "boolean") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const options = (value as Record<string, unknown>)["enum"];
    if (Array.isArray(options) && options.every((option) => typeof option === "string")) {
      return { enum: [...(options as string[])] };
    }
  }
  return null;
}

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
  return { ok: true, answer: { action: "accept", values: content } };
}
