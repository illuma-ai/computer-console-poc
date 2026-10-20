import { useMemo, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, SELECT_CLASS } from "../components/Field";
import { failureText } from "../api/runApi";
import type { AgentsApi } from "../api/agentsApi";
import type { AgentJson } from "../api/types";
import { bodyOf, LIMITS, AgentFormError, RUNTIMES, serversSignature, validateAgentForm } from "./agentForm";
import type { AgentForm, FormErrors, FormField } from "./agentForm";
import { ToolsEditor } from "./ToolsEditor";

/** Props of {@link AgentSheet}. */
export interface AgentSheetProps {
  readonly mode: "create" | "edit";
  /** The saved agent, for an edit. */
  readonly agent: AgentJson | null;
  /** The form the sheet starts from: blank, a template's, or the saved agent's. */
  readonly initial: AgentForm;
  readonly api: AgentsApi;
  readonly onClose: () => void;
  /** Told the saved agent, so the list can show it. */
  readonly onSaved: (agent: AgentJson) => void;
}

/**
 * The create and edit sheet for an agent. Validation runs on the first submit and then as the person types. A
 * write sends the MCP servers only when they were created or changed, because a read shows env names without
 * values and an untouched list cannot be sent back.
 */
export function AgentSheet({ mode, agent, initial, api, onClose, onSaved }: AgentSheetProps): ReactElement {
  const [form, setForm] = useState<AgentForm>(initial);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedSignature = useMemo(() => serversSignature(initial.servers), [initial.servers]);

  // A create always sends its servers. An edit sends them only when the list differs from the saved one.
  const includeServers = mode === "create" || serversSignature(form.servers) !== savedSignature;
  const errors: FormErrors = attempted ? validateAgentForm(form, includeServers) : {};

  function update(patch: Partial<AgentForm>): void {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAttempted(true);
    setSaveError(null);
    if (Object.keys(validateAgentForm(form, includeServers)).length > 0) return;
    setBusy(true);
    try {
      const saved =
        mode === "create"
          ? await api.createAgent(bodyOf(form, true))
          : await api.updateAgent(agent?.id ?? "", bodyOf(form, includeServers));
      onSaved(saved);
    } catch (err) {
      setSaveError(err instanceof AgentFormError ? err.message : failureText(err));
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    if (!agent) return;
    setBusy(true);
    setSaveError(null);
    try {
      onSaved(await api.disableAgent(agent.id));
    } catch (err) {
      setSaveError(failureText(err));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "create" ? "New agent" : "Edit agent";
  const fieldError = (field: FormField): string | undefined => errors[field];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {mode === "edit" && agent ? `Version ${agent.version}` : "The agent's settings and tools"}
          </SheetDescription>
        </SheetHeader>
        <form aria-label={title} className="flex flex-col gap-4 px-4 pb-4" onSubmit={(event) => void save(event)}>
          <Field label="Name" error={fieldError("name")}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} value={form.name} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ name: event.target.value })} />
            )}
          </Field>
          <Field label="Description">
            {({ id }) => <Input id={id} value={form.description} onChange={(event) => update({ description: event.target.value })} />}
          </Field>
          <Field label="Instructions">
            {({ id }) => (
              <Textarea id={id} rows={5} value={form.instructions} onChange={(event) => update({ instructions: event.target.value })} />
            )}
          </Field>
          <Field label="Model" hint="Blank uses the service's default.">
            {({ id, describedBy }) => (
              <Input id={id} value={form.model} aria-describedby={describedBy} onChange={(event) => update({ model: event.target.value })} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Runtime" error={fieldError("runtime")}>
              {({ id, describedBy, invalid }) => (
                <select
                  id={id}
                  className={SELECT_CLASS}
                  value={form.runtime}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  onChange={(event) => update({ runtime: event.target.value })}
                >
                  {RUNTIMES.map((runtime) => (
                    <option key={runtime} value={runtime}>
                      {runtime}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Template" error={fieldError("template")}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} value={form.template} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ template: event.target.value })} />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Egress" error={fieldError("egress")} hint="open, none, or a host list">
              {({ id, describedBy, invalid }) => (
                <Input id={id} value={form.egress} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ egress: event.target.value })} />
              )}
            </Field>
            <Field label="Timeout (s)" error={fieldError("timeoutS")} hint={`${LIMITS.timeoutMin} to ${LIMITS.timeoutMax}`}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} inputMode="numeric" value={form.timeoutS} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ timeoutS: event.target.value })} />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Max wait (s)" error={fieldError("maxWaitS")}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} inputMode="numeric" value={form.maxWaitS} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ maxWaitS: event.target.value })} />
              )}
            </Field>
            <Field label="Allowed channels" error={fieldError("allowedChannels")} hint="Comma separated">
              {({ id, describedBy, invalid }) => (
                <Input id={id} value={form.allowedChannels} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ allowedChannels: event.target.value })} />
              )}
            </Field>
          </div>
          <Field label="Take-over allowed">
            {({ id }) => (
              <div className="flex items-center gap-2">
                <Switch id={id} checked={form.takeoverAllowed} onCheckedChange={(checked) => update({ takeoverAllowed: checked })} />
                <span className="text-sm text-muted-foreground">{form.takeoverAllowed ? "On" : "Off"}</span>
              </div>
            )}
          </Field>
          <Field label="Setup commands" error={fieldError("setupCommands")} hint="A JSON list of commands, each a list of arguments">
            {({ id, describedBy, invalid }) => (
              <Textarea id={id} rows={3} className="font-mono text-xs" value={form.setupCommands} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ setupCommands: event.target.value })} />
            )}
          </Field>
          <Field label="Ready check" error={fieldError("readyCheck")} hint="A JSON list of arguments. Blank for none.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} className="font-mono text-xs" value={form.readyCheck} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => update({ readyCheck: event.target.value })} />
            )}
          </Field>

          <ToolsEditor form={form} onChange={(next) => setForm(next)} error={fieldError("servers")} />

          {saveError ? (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}
          <SheetFooter className="flex-row justify-between px-0">
            <div className="flex gap-2">
              {mode === "edit" && agent?.enabled ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void disable()}>
                  Disable agent
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {mode === "create" ? "Create agent" : "Save changes"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
