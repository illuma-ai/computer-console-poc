import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Field, SELECT_CLASS } from "../components/Field";
import { TOOLS } from "../catalog/catalog";
import type { ToolEntry } from "../catalog/catalog";
import type { ToolsMode } from "../api/types";
import {
  addCatalogTool,
  addCustomServer,
  AgentFormError,
  removeServer,
  setEnvValue,
  setServerTools,
} from "./agentForm";
import type { AgentForm, ServerDraft } from "./agentForm";

/** The custom server a person starts from: the shape `addCustomServer` reads. */
export const CUSTOM_SERVER_EXAMPLE = `{
  "name": "docs",
  "command": "docs-mcp",
  "args": ["--read-only"],
  "env": [],
  "tools": "indexed"
}`;

/** The listing choices. The first option leaves the harness default in place. */
const MODE_CHOICES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "", label: "Harness default" },
  { value: "full", label: "Full" },
  { value: "indexed", label: "Indexed" },
];

/** Props of {@link ToolsEditor}. */
export interface ToolsEditorProps {
  readonly form: AgentForm;
  readonly onChange: (form: AgentForm) => void;
  /** The catalog to add from. */
  readonly catalog?: readonly ToolEntry[];
  /** Shown on the list when a server row is wrong (for example a duplicate name). */
  readonly error?: string | undefined;
}

/**
 * The MCP servers of an agent. A server comes from the tool catalog or from custom JSON. Each row shows its
 * listing mode (`full` or `indexed`, or the harness default) and, when a value is needed, a value input per env
 * variable. Values are never shown back after saving: the service keeps names only.
 */
export function ToolsEditor({ form, onChange, catalog = TOOLS, error }: ToolsEditorProps): ReactElement {
  const [catalogId, setCatalogId] = useState<string>(catalog[0]?.id ?? "");
  const [custom, setCustom] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  /** Applies a change. Returns false, with the problem shown, when the change is refused. */
  function attempt(change: () => AgentForm): boolean {
    try {
      onChange(change());
      setProblem(null);
      return true;
    } catch (err) {
      setProblem(err instanceof AgentFormError ? err.message : "The server could not be added");
      return false;
    }
  }

  function addFromCatalog(): void {
    const tool = catalog.find((entry) => entry.id === catalogId);
    if (!tool) return;
    attempt(() => addCatalogTool(form, tool));
  }

  function addCustom(): void {
    if (custom.trim() === "") return;
    // The text stays when it is refused, so the person can correct it.
    if (attempt(() => addCustomServer(form, custom))) setCustom("");
  }

  return (
    <section aria-label="Tools" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Tools</h3>
      {form.servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tools</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {form.servers.map((server) => (
            <ServerRow
              key={server.key}
              server={server}
              onEnv={(envName, value) => onChange(setEnvValue(form, server.key, envName, value))}
              onMode={(mode) => onChange(setServerTools(form, server.key, mode))}
              onRemove={() => onChange(removeServer(form, server.key))}
            />
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <Field label="Add from the tool catalog">
          {({ id }) => (
            <div className="flex gap-2">
              <select id={id} className={SELECT_CLASS} value={catalogId} onChange={(event) => setCatalogId(event.target.value)}>
                {catalog.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={addFromCatalog} disabled={catalog.length === 0}>
                Add tool
              </Button>
            </div>
          )}
        </Field>
        <Field label="Or a custom server (JSON)" hint="One object: name, command, args, env (name and value), tools.">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={5}
              className="font-mono text-xs"
              placeholder={CUSTOM_SERVER_EXAMPLE}
              value={custom}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(event) => setCustom(event.target.value)}
            />
          )}
        </Field>
        {problem ? (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        ) : null}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={custom.trim() === ""}>
            Add custom server
          </Button>
        </div>
      </div>
    </section>
  );
}

interface ServerRowProps {
  readonly server: ServerDraft;
  readonly onEnv: (envName: string, value: string) => void;
  readonly onMode: (mode: ToolsMode | null) => void;
  readonly onRemove: () => void;
}

/** One server row: its name and command, its listing mode, its env values and a remove button. */
function ServerRow({ server, onEnv, onMode, onRemove }: ServerRowProps): ReactElement {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{server.name}</p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {[server.command, ...server.args].join(" ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${server.name}`} onClick={onRemove}>
          Remove
        </Button>
      </div>
      <Field label={`Listing for ${server.name}`}>
        {({ id }) => (
          <select
            id={id}
            className={SELECT_CLASS}
            value={server.tools ?? ""}
            onChange={(event) => onMode(event.target.value === "" ? null : (event.target.value as ToolsMode))}
          >
            {MODE_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {server.env.map((entry) => (
        <Field key={entry.name} label={`Value for ${entry.name}`} hint={entry.value === null ? "Not shown after saving. Enter it again to change this server." : undefined}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              aria-describedby={describedBy}
              value={entry.value ?? ""}
              onChange={(event) => onEnv(entry.name, event.target.value)}
            />
          )}
        </Field>
      ))}
    </li>
  );
}
