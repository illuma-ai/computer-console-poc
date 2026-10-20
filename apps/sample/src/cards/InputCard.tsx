import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptAnswer, inputProblems } from "./inputRequest";
import type { InputAnswer, InputField } from "./inputRequest";

/**
 * The card for a request for values (docs/plans/request-input-contract.md). It is a typed component with
 * tests only: the run API does not send this request kind yet, so no screen mounts it. When it does, the
 * request kind dispatches here.
 *
 * A secret field is masked and is cleared as soon as the answer is sent. The answer is handed to the caller
 * and is never kept by this card.
 */

/** Props of {@link InputCard}. */
export interface InputCardProps {
  readonly title: string;
  readonly reason: string | null;
  readonly fields: readonly InputField[];
  readonly busy?: boolean;
  readonly onAnswer: (answer: InputAnswer) => void;
}

/** A field's input element name: stable and unique per request. */
function controlId(field: InputField): string {
  return `input-${field.name}`;
}

/** The form for a request for values. It shows the limits' problems instead of a form when the request breaks them. */
export function InputCard({ title, reason, fields, busy = false, onAnswer }: InputCardProps): ReactElement {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [invalid, setInvalid] = useState<readonly string[]>([]);
  const problems = inputProblems(fields, reason);

  function setValue(field: InputField, value: string | boolean): void {
    setValues((current) => ({ ...current, [field.name]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = acceptAnswer(fields, values);
    if (!result.ok) {
      setInvalid(result.invalid);
      return;
    }
    setInvalid([]);
    onAnswer(result.answer);
    // A secret is never kept after it is sent.
    setValues({});
  }

  return (
    <Card aria-label="Input request" className="gap-3 py-4 shadow-sm">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {problems.length > 0 ? (
          <p role="alert" className="text-sm text-destructive">
            {problems[0]}
          </p>
        ) : (
          <form aria-label="Values requested" className="flex flex-col gap-3" onSubmit={submit}>
            {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
            {fields.map((field) => (
              <FieldControl
                key={field.name}
                field={field}
                value={values[field.name]}
                invalid={invalid.includes(field.name)}
                disabled={busy}
                onChange={(value) => setValue(field, value)}
              />
            ))}
            {invalid.length > 0 ? (
              <p role="alert" className="text-sm text-destructive">
                Fill in: {invalid.join(", ")}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                Send
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAnswer({ action: "decline" })}>
                Decline
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onAnswer({ action: "cancel" })}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

interface FieldControlProps {
  readonly field: InputField;
  readonly value: string | boolean | undefined;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: string | boolean) => void;
}

/** One field: a checkbox, a choice, a masked secret, or a plain text or number input. */
function FieldControl({ field, value, invalid, disabled, onChange }: FieldControlProps): ReactElement {
  const id = controlId(field);
  const label = field.required ? `${field.title} (required)` : field.title;
  const describedBy = field.description ? `${id}-help` : undefined;
  const help = field.description ? <p id={`${id}-help`} className="text-xs text-muted-foreground">{field.description}</p> : null;

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          aria-label={label}
          aria-describedby={describedBy}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <Label htmlFor={id}>{label}</Label>
        {help}
      </div>
    );
  }
  if (typeof field.type === "object") {
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose</option>
          {field.type.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {help}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={field.secret === true ? "password" : field.type === "number" ? "number" : "text"}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {help}
    </div>
  );
}
