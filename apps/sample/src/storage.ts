/**
 * The browser's own state for the sample: the theme and the prompt last used with each agent. Nothing here is
 * authoritative. Agents, runs and artifacts live in the run service.
 *
 * Storage failures are not fatal: a private window or a blocked store yields empty state and a no-op save.
 */

/** The subset of the Storage interface the sample needs. Injectable for tests. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The browser's localStorage, or null when the store cannot be reached (a blocked or private context
 * throws on access).
 */
export function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads a stored string. Null when none is stored, the store is unreachable or the read throws.
 *
 * @param storage The store, or null when none is available.
 * @param key The key to read.
 */
export function readStored(storage: KeyValueStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a stored string.
 *
 * @param storage The store, or null when none is available.
 * @param key The key to write.
 * @param value The value to keep.
 * @returns false when the store refused the write, so the caller can say so.
 */
export function writeStored(storage: KeyValueStorage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
