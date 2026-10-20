import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, SELECT_CLASS } from "../components/Field";
import { failureText } from "../api/runApi";
import type { RunApi } from "../api/runApi";
import type { AgentJson } from "../api/types";
import { SCENARIOS } from "../catalog/catalog";
import type { ScenarioEntry } from "../catalog/catalog";
import { loadPrompts, savePrompt } from "../runs/promptStore";
import type { KeyValueStorage } from "../storage";

/** Props of {@link NewRunDialog}. */
export interface NewRunDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly api: RunApi;
  /** The enabled agents a run can start on. A run needs an enabled agent. */
  readonly agents: readonly AgentJson[];
  readonly scenarios?: readonly ScenarioEntry[];
  readonly storage: KeyValueStorage | null;
  /** Told the new run's id, so the caller can open it. */
  readonly onStarted: (runId: string) => void;
}

/**
 * Why a run cannot start yet, or null when it can. The button text names the reason, so the disabled button is
 * never a mystery.
 *
 * @param agentId The chosen agent, or empty.
 * @param prompt The prompt as typed.
 * @param hasAgents Whether any enabled agent exists.
 */
export function startBlockedReason(agentId: string, prompt: string, hasAgents: boolean): string | null {
  if (!hasAgents) return "Create or enable an agent to start a run";
  if (agentId === "") return "Choose an agent to start a run";
  if (prompt.trim() === "") return "Add a prompt to start a run";
  return null;
}

/**
 * The new-run dialog: the agent, the prompt, and a scenario that fills the prompt. The prompt is kept per agent
 * in this browser, so the dialog offers the last one again. The run's task is the prompt only; the service reads
 * the rest from the agent.
 */
export function NewRunDialog({
  open,
  onOpenChange,
  api,
  agents,
  scenarios = SCENARIOS,
  storage,
  onStarted,
}: NewRunDialogProps): ReactElement {
  const [agentId, setAgentId] = useState<string>(agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState<string>(() => loadPrompts(storage)[agents[0]?.id ?? ""] ?? "");
  const [scenario, setScenario] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = startBlockedReason(agentId, prompt, agents.length > 0);

  function chooseAgent(next: string): void {
    setAgentId(next);
    setPrompt(loadPrompts(storage)[next] ?? "");
  }

  function chooseScenario(id: string): void {
    setScenario(id);
    const picked = scenarios.find((entry) => entry.id === id);
    if (picked) setPrompt(picked.prompt);
  }

  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (reason !== null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const run = await api.createRun({ agent_id: agentId, prompt: prompt.trim() });
      savePrompt(storage, agentId, prompt.trim());
      onStarted(run.id);
    } catch (err) {
      setError(failureText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New run</DialogTitle>
          <DialogDescription className="sr-only">Start a run on an agent with a prompt.</DialogDescription>
        </DialogHeader>
        <form aria-label="New run" className="flex flex-col gap-4" onSubmit={(event) => void start(event)}>
          <Field label="Agent">
            {({ id, describedBy, invalid }) => (
              <select
                id={id}
                className={SELECT_CLASS}
                value={agentId}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={agents.length === 0}
                onChange={(event) => chooseAgent(event.target.value)}
              >
                {agents.length === 0 ? <option value="">No enabled agents</option> : null}
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Scenario">
            {({ id }) => (
              <select id={id} className={SELECT_CLASS} value={scenario} onChange={(event) => chooseScenario(event.target.value)}>
                <option value="">Write my own</option>
                {scenarios.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Prompt">
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={6}
                value={prompt}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onChange={(event) => setPrompt(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            {reason !== null ? <p className="mr-auto self-center text-xs text-muted-foreground">{reason}</p> : null}
            <Button type="submit" disabled={reason !== null || busy}>
              Start run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
