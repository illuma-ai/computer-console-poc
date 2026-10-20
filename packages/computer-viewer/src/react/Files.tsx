import { useEffect, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { ViewerClient } from "../client/client";
import type { FileEntry } from "../client/types";

/** Revoking a download's object URL right away can cancel the save in some browsers. */
const REVOKE_DELAY_MS = 1_000;

/** The parent of an absolute folder path. `/` is its own parent. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

/** Joins a folder and an entry name without doubling the slash. */
export function joinPath(folder: string, name: string): string {
  return folder === "/" ? `/${name}` : `${folder.replace(/\/+$/, "")}/${name}`;
}

/** Props of {@link Files}. */
export interface FilesProps {
  client: ViewerClient;
  /** The folder shown first. */
  initialPath?: string;
}

/**
 * Read-only folder listing with download. Folders navigate; files download. Nothing here writes to
 * the computer.
 */
export function Files({ client, initialPath = "/" }: FilesProps): ReactElement {
  const [folder, setFolder] = useState(initialPath);
  const [draft, setDraft] = useState(initialPath);
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    client.listFiles(folder).then(
      (list) => {
        if (!cancelled) setEntries(list);
      },
      () => {
        if (!cancelled) {
          setEntries(null);
          setError("Could not list this folder");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, folder]);

  const open = (path: string): void => {
    setFolder(path);
    setDraft(path);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    open(draft.trim() || "/");
  };

  const download = (entry: FileEntry): void => {
    client.downloadFile(joinPath(folder, entry.name)).then(
      (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = entry.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
      },
      () => setError("Could not download this file"),
    );
  };

  return (
    <div className="cv-files">
      <form className="cv-row" onSubmit={onSubmit}>
        <label htmlFor="cv-folder">Folder</label>
        <input
          id="cv-folder"
          className="cv-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
        <button type="submit" className="cv-button">
          Go
        </button>
        <button type="button" className="cv-button" onClick={() => open(parentPath(folder))}>
          Up
        </button>
      </form>
      {error ? (
        <p className="cv-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="cv-list" aria-label="Files">
        {(entries ?? []).map((entry) => (
          <li key={entry.name}>
            {entry.type === "dir" ? (
              <button type="button" className="cv-button" onClick={() => open(joinPath(folder, entry.name))}>
                {entry.name}/
              </button>
            ) : (
              <button type="button" className="cv-button" onClick={() => download(entry)}>
                Download {entry.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
