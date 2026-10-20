import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgentsApi } from "../api/agentsApi";
import { failureText } from "../api/runApi";
import type { AgentJson } from "../api/types";
import { TEMPLATES } from "../catalog/catalog";
import type { TemplateEntry } from "../catalog/catalog";
import { BLANK_FORM, formFromTemplate, formOf } from "./agentForm";
import type { AgentForm } from "./agentForm";
import { AgentSheet } from "./AgentSheet";
import { MISSING, timeText } from "../runs/runList";

/** Props of {@link AgentsScreen}. */
export interface AgentsScreenProps {
  readonly agents: AgentsApi;
}

/** The sheet's state: a new agent from a form, or an edit of a saved one. */
type Editor =
  | { readonly mode: "create"; readonly key: number; readonly initial: AgentForm }
  | { readonly mode: "edit"; readonly key: number; readonly agent: AgentJson; readonly initial: AgentForm };

/**
 * The agent definitions, newest first. A row opens its agent in the sheet; "New agent" starts blank and
 * "New from template" starts from a template in the catalog. The service owns the definitions, so the list is
 * read from it after every save.
 */
export function AgentsScreen({ agents }: AgentsScreenProps): ReactElement {
  const [list, setList] = useState<readonly AgentJson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setList(await agents.listAgents());
      setError(null);
    } catch (err) {
      setError(failureText(err));
      setList((current) => current ?? []);
    }
  }, [agents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openNew(initial: AgentForm): void {
    setSheetKey((key) => key + 1);
    setEditor({ mode: "create", key: sheetKey + 1, initial });
  }

  function openEdit(agent: AgentJson): void {
    setSheetKey((key) => key + 1);
    setEditor({ mode: "edit", key: sheetKey + 1, agent, initial: formOf(agent) });
  }

  function pickTemplate(template: TemplateEntry): void {
    setTemplatesOpen(false);
    openNew(formFromTemplate(template));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Agents</h1>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setTemplatesOpen(true)}>
            New from template
          </Button>
          <Button type="button" onClick={() => openNew(BLANK_FORM)}>
            New agent
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {list === null ? <p className="text-sm text-muted-foreground">Loading agents</p> : null}
      {list !== null && list.length === 0 && error === null ? (
        <p className="text-sm text-muted-foreground">No agents yet</p>
      ) : null}

      {list !== null && list.length > 0 ? (
        <Table aria-label="Agents">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Runtime</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Take-over</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell>
                  <button
                    type="button"
                    aria-label={`Edit ${agent.name}`}
                    className="font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openEdit(agent)}
                  >
                    {agent.name}
                  </button>
                </TableCell>
                <TableCell>
                  <Badge variant={agent.enabled ? "secondary" : "outline"}>{agent.enabled ? "Enabled" : "Disabled"}</Badge>
                </TableCell>
                <TableCell>{agent.computer.runtime}</TableCell>
                <TableCell>{agent.computer.template || MISSING}</TableCell>
                <TableCell>{agent.takeover_allowed ? "Allowed" : "Off"}</TableCell>
                <TableCell>{agent.version}</TableCell>
                <TableCell>{timeText(agent.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {editor ? (
        <AgentSheet
          key={editor.key}
          mode={editor.mode}
          agent={editor.mode === "edit" ? editor.agent : null}
          initial={editor.initial}
          api={agents}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void refresh();
          }}
        />
      ) : null}

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New from template</DialogTitle>
            <DialogDescription className="sr-only">Choose a template to start an agent from.</DialogDescription>
          </DialogHeader>
          <ul aria-label="Templates" className="flex flex-col divide-y divide-border">
            {TEMPLATES.map((template) => (
              <li key={template.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.description}</p>
                </div>
                <Button type="button" size="sm" variant="outline" aria-label={`Use ${template.name}`} onClick={() => pickTemplate(template)}>
                  Use
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
