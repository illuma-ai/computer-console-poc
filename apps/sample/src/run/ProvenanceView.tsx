import type { ReactElement, ReactNode } from "react";
import type { RunProvenance } from "../api/types";
import { timeText } from "../runs/runList";
import { isWebUrl } from "../safeUrl";

/**
 * The run's provenance on the Details tab: the agent it ran and its version, the harness, the model, each
 * computer with its runtime, template, digest and times, and the session. A part the service did not send is
 * left out, so the list is only as long as what is known.
 */

/** Props of {@link ProvenanceView}. */
export interface ProvenanceViewProps {
  readonly provenance: RunProvenance;
  /** The agent's name from the registry, or null when the agent is not in it. */
  readonly agentName: string | null;
}

/** One labelled line of the list. */
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 break-words">{children}</dd>
    </>
  );
}

/** The provenance of a run. Renders nothing it has no part for. */
export function ProvenanceView({ provenance, agentName }: ProvenanceViewProps): ReactElement {
  const { agent, harness = [], computers = [], artifacts } = provenance;
  const sessionExport = artifacts?.session_export ?? null;
  return (
    <section aria-label="Provenance" className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-3">
        {agent ? (
          <Row label="Agent">
            <span>
              {agentName ?? agent.id} · version {agent.version}
            </span>
            <a className="text-xs underline underline-offset-4" href="#/agents">
              Agent definition
            </a>
          </Row>
        ) : null}
        {harness.length > 0 ? (
          <Row label="Harness">
            {harness.map((item, index) => (
              <span key={`${item.name}-${index}`}>
                {item.name} {item.version}
                {item.build ? ` (${item.build})` : ""} · {item.computer} · {timeText(item.at)}
              </span>
            ))}
          </Row>
        ) : null}
        {provenance.model ? <Row label="Model">{provenance.model}</Row> : null}
        {computers.length > 0 ? (
          <Row label="Computers">
            <ol className="flex flex-col gap-2">
              {computers.map((computer) => (
                <li key={computer.id} className="flex flex-col gap-0.5 border-l border-border pl-3">
                  <span className="font-mono text-xs">{computer.id}</span>
                  <span className="text-xs text-muted-foreground">
                    {computer.runtime} · {computer.template}
                  </span>
                  {computer.image_digest ? <span className="font-mono text-xs text-muted-foreground">{computer.image_digest}</span> : null}
                  <span className="text-xs text-muted-foreground">
                    {timeText(computer.started_at)} to {computer.ended_at ? timeText(computer.ended_at) : "now"}
                    {computer.reason ? ` · ${computer.reason}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Row>
        ) : null}
        {provenance.session_id ? (
          <Row label="Session">
            <span className="font-mono text-xs">{provenance.session_id}</span>
            {sessionExport && isWebUrl(sessionExport) ? (
              <a className="text-xs underline underline-offset-4" href={sessionExport} target="_blank" rel="noopener noreferrer">
                Session export
              </a>
            ) : null}
          </Row>
        ) : null}
        {provenance.service ? (
          <Row label="Service">
            {provenance.service.version}
            {provenance.service.build ? ` (${provenance.service.build})` : ""}
          </Row>
        ) : null}
        {artifacts?.checkpoints ? <Row label="Checkpoints">{artifacts.checkpoints.length}</Row> : null}
      </dl>
    </section>
  );
}
