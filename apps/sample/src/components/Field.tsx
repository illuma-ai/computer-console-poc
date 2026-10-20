import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * The form controls the screens share. Selects are native elements: they are keyboard reachable and read the
 * same to assistive technology everywhere, and the form tests drive them directly.
 */

/** The classes of a native select, matched to the text input so the two line up in a form. */
export const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive disabled:opacity-50";

/** Props of {@link Field}. */
export interface FieldProps {
  readonly label: string;
  /** A message for the field, shown under it and linked to the control. Empty means the field is valid. */
  readonly error?: string | undefined;
  /** A short hint under the control. */
  readonly hint?: string;
  readonly children: (ids: { readonly id: string; readonly describedBy: string | undefined; readonly invalid: boolean }) => ReactNode;
}

/**
 * A label, its control and its message. The control receives the id it must use, the description link and
 * whether it is invalid, so each control is labelled and its error is announced.
 */
export function Field({ label, error, hint, children }: FieldProps): ReactElement {
  const id = useId();
  const messageId = `${id}-message`;
  const describedBy = error || hint ? messageId : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={messageId} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
