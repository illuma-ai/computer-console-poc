import { readStored, writeStored } from "../storage";
import type { KeyValueStorage } from "../storage";

/**
 * The prompt last used with each agent. A prompt is per run, so it is not part of the agent; the browser
 * keeps it, keyed by the agent's id, so the new-run dialog can offer it again after a reload.
 */

/** The key the per-agent prompts are stored under: a JSON object from agent id to prompt. */
export const PROMPTS_STORAGE_KEY = "computer-manager.sample.prompts";

/**
 * Reads the saved prompts. A missing or malformed value yields an empty map.
 *
 * @param storage The store, or null when none is available.
 */
export function loadPrompts(storage: KeyValueStorage | null): Record<string, string> {
  const raw = readStored(storage, PROMPTS_STORAGE_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

/**
 * Remembers the prompt last used with an agent.
 *
 * @param storage The store, or null when none is available.
 * @param agentId The agent's id as the run service issued it.
 * @param prompt The prompt to keep.
 * @returns false when the store refused the write.
 */
export function savePrompt(storage: KeyValueStorage | null, agentId: string, prompt: string): boolean {
  const prompts = loadPrompts(storage);
  return writeStored(storage, PROMPTS_STORAGE_KEY, JSON.stringify({ ...prompts, [agentId]: prompt }));
}
