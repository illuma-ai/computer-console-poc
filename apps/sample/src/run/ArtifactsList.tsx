import type { ReactElement } from "react";
import { isWebUrl } from "../safeUrl";
import type { ArtifactNotice } from "./timeline";

/** An artifact with its download link, when the artifacts route gave one. */
export type ArtifactRow = ArtifactNotice & { readonly url: string | null };

/** Props of {@link ArtifactsList}. */
export interface ArtifactsListProps {
  readonly artifacts: readonly ArtifactRow[];
  /** True once the run has ended. */
  readonly ended: boolean;
}

/** Formats a size in bytes for the list. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * The files the run produced. A link is shown only when the service signed one and it is a web address, so a
 * crafted value cannot become a link.
 */
export function ArtifactsList({ artifacts, ended }: ArtifactsListProps): ReactElement {
  if (artifacts.length === 0) {
    return <p className="text-sm text-muted-foreground">{ended ? "No artifacts" : "No artifacts yet"}</p>;
  }
  return (
    <ul aria-label="Artifacts" className="flex flex-col divide-y divide-border rounded-md border border-border">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 break-all">{artifact.name}</span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{sizeText(artifact.size)}</span>
            {artifact.url && isWebUrl(artifact.url) ? (
              <a
                className="text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={artifact.url}
                download={artifact.name}
              >
                Download {artifact.name}
              </a>
            ) : (
              <span>Link not available</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
